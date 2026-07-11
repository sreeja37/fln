"""OCR pipeline orchestrator.

Chains the four CV modules together end-to-end:

    bgr image
        -> preprocessor.preprocess(bgr)            -> binary
        -> aligner.find_registration_squares(bin)   -> [(x, y) x 4] | []
        -> aligner.compute_homography(px, mm)       -> 3x3 H | None
        -> cropper.warp_and_crop(bgr, H, regions)   -> {qid_full: crop}
        -> Recognizer.recognize(crop, icr_hint)     -> {answer, ...}

Independence
------------
This module imports nothing from `mvp.server`, `mvp.evaluation_metrics`,
FastAPI, or any HTTP layer. It depends only on numpy, opencv-python-
headless (already in requirements.txt), and the sibling modules
(preprocessor, aligner, cropper, regions, recognizers.stub, types).

Return contract
---------------
The result has exactly three fields:

    PipelineResult(
        answers : dict[str, str]   # {qid_full: text}, drop-in for evaluateAI*
        meta    : PipelineMeta
        errors  : list[str]        # top-level warnings (empty on full success)
    )

Graceful degradation
--------------------
The pipeline never raises to the caller. Any stage failure is captured
in `meta` and `errors`, and the affected regions still get a stub-shaped
answer (None) so the response shape is stable.
"""

from __future__ import annotations

import importlib.util
import time
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np

from . import aligner, cropper, preprocessor
from .recognizers.registry import build_default_registry
from .regions import flatten_regions, to_expected_mm
from .ocr_schema import MasterKey


@dataclass(frozen=True)
class PipelineMeta:
    """Health and alignment metadata for one pipeline run.

    All boolean flags default to False; callers can read the field
    directly without checking for missing keys.
    """

    image_path: str
    width: int
    height: int
    dpi: int
    preprocess_ok: bool = False
    registration_found: bool = False
    alignment_ok: bool = False
    reprojection_rms_px: float | None = None
    recognized_count: int = 0
    skipped_count: int = 0
    duration_ms: int = 0


@dataclass(frozen=True)
class PipelineResult:
    """What `run_pipeline` returns. Stable wire contract."""

    answers: dict[str, str]
    meta: PipelineMeta
    errors: list[str] = field(default_factory=list)


# --- Recognizer selection (registry-based default) ----------------------
#
# The default recognizer is resolved through the RecognizerRegistry rather
# than hard-coded. Preference order:
#   1. "trocr"   — the Phase-2 handwritten recognizer (requires
#                  `requirements-ocr.txt` to be installed).
#   2. "stub"    — the Phase-1 placeholder recognizer (always available).
#
# Phase-1 deployments without torch/transformers will transparently fall
# back to the stub. No caller code change is needed.
_DEFAULT_RECOGNIZER_NAME = "trocr"
_FALLBACK_RECOGNIZER_NAME = "stub"
_DEFAULT_REGISTRY = build_default_registry()


def _trcr_dependencies_available() -> bool:
    """Return True iff both torch AND transformers are importable.

    Static check via importlib.util.find_spec — does NOT actually
    load the modules, so it is fast and side-effect free. Used by
    `_default_recognizer_instance` to choose between TrOCR and stub
    without ever instantiating a recognizer known to be unusable.
    Both packages are required:
      - transformers: the model + tokenizer loader (TrOCRProcessor,
        VisionEncoderDecoderModel, batch_decode, etc.)
      - torch:        the tensor runtime used by the model
    """
    torch_ok = importlib.util.find_spec("torch") is not None
    transformers_ok = importlib.util.find_spec("transformers") is not None
    return torch_ok and transformers_ok


def _default_recognizer_instance():
    """Resolve and instantiate the default Recognizer for this pipeline run.

    Selection policy (intentional, evaluated upfront):
      1. If torch + transformers are both importable, return a
         TrOcrRecognizer() instance. The actual model weights are
         loaded lazily inside TrOcrRecognizer.recognize on first use.
      2. Otherwise, return a StubRecognizer() directly. We never
         instantiate a recognizer that is known to be unusable.

    A narrow exception guard remains around the registry lookup so
    unexpected registry corruption falls back to stub rather than
    propagating up to the caller; this preserves the pipeline's
    graceful-degradation contract without masking real inference
    errors (which TrOcrRecognizer.recognize handles itself).
    """
    if _trcr_dependencies_available():
        try:
            cls = _DEFAULT_REGISTRY.resolve(_DEFAULT_RECOGNIZER_NAME)
            return cls()
        except Exception:
            # Registry corrupted or "trocr" not registered — fall through.
            pass
    # Phase-1 fallback: stub is always registered, so this cannot fail.
    cls = _DEFAULT_REGISTRY.resolve(_FALLBACK_RECOGNIZER_NAME)
    return cls()


def run_pipeline(
    image_bgr: np.ndarray,
    master_key: MasterKey,
    *,
    recognizer: Any | None = None,
    dpi: int = cropper.DEFAULT_DPI,
    image_path: str = "<memory>",
) -> PipelineResult:
    """Run the full CV pipeline on one scanned sheet.

    Parameters
    ----------
    image_bgr : np.ndarray
        (H, W, 3) uint8 BGR image. File reading / decoding is the
        caller's responsibility (keeps this module I/O-free).
    master_key : MasterKey
        Canonical, already-validated MasterKey from `regions.load_master_json`.
    recognizer : Recognizer, optional
        Defaults to StubRecognizer. Tests may inject a fake. No registry,
        no factory lookup — that lives elsewhere.
    dpi : int
        Output resolution for the rectified page and per-region crops.
    image_path : str
        Free-form label for logging / debugging. Defaults to "<memory>".

    Returns
    -------
    PipelineResult
        Always populated. On full success `answers` has one entry per
        region in `master_key.regions`; on partial failure the missing
        entries are absent (callers can detect by key absence) and the
        failure reason is in `meta` + `errors`.
    """
    started = time.monotonic()
    recognizer = recognizer or _default_recognizer_instance()
    height, width = image_bgr.shape[:2]

    answers: dict[str, str] = {}
    errors: list[str] = []
    preprocess_ok = False
    registration_found = False
    alignment_ok = False
    reprojection_rms_px: float | None = None
    recognized_count = 0
    skipped_count = 0

    # --- Stage 1: preprocess ---
    try:
        binary = preprocessor.preprocess(image_bgr)
        preprocess_ok = True
    except Exception as exc:
        errors.append(f"preprocess_failed: {exc}")
        binary = None

    # --- Stage 2: find registration squares ---
    detected_px: list[tuple[float, float]] = []
    if binary is not None:
        try:
            detected_px = aligner.find_registration_squares(binary)
            registration_found = len(detected_px) == 4
        except Exception as exc:
            errors.append(f"registration_detection_failed: {exc}")

    # --- Stage 3: compute homography ---
    homography: np.ndarray | None = None
    if registration_found:
        try:
            homography = aligner.compute_homography(
                detected_px, to_expected_mm(master_key)
            )
            if homography is not None:
                alignment_ok = True
        except Exception as exc:
            errors.append(f"homography_failed: {exc}")

    # --- Stage 4 + 5: warp/crop + recognize ---
    # If alignment failed we still walk every region so the response
    # shape is stable (one entry per region, all None).
    crops: dict[str, np.ndarray] = {}
    if alignment_ok and homography is not None:
        try:
            crops = cropper.warp_and_crop(
                image_bgr,
                homography,
                flatten_regions(master_key),
                dpi=dpi,
            )
        except Exception as exc:
            errors.append(f"warp_and_crop_failed: {exc}")
            alignment_ok = False

    for region in master_key.regions:
        key = region.qid_full()
        crop = crops.get(key)
        if crop is None:
            notes = "alignment_failed" if not alignment_ok else "crop_missing"
            answers[key] = ""
            skipped_count += 1
            if notes not in errors:
                errors.append(notes)
            continue
        try:
            out = recognizer.recognize(crop, region.icr)
        except Exception as exc:
            answers[key] = ""
            errors.append(f"recognizer_error[{key}]: {exc}")
            skipped_count += 1
            continue

        answer = out.get("answer")
        # Stub returns answer=None. Stringify so the answers dict type
        # is stable for downstream JSON serialization.
        answers[key] = "" if answer is None else str(answer)
        if answer is not None:
            recognized_count += 1
        else:
            skipped_count += 1

    duration_ms = int((time.monotonic() - started) * 1000)

    meta = PipelineMeta(
        image_path=image_path,
        width=width,
        height=height,
        dpi=dpi,
        preprocess_ok=preprocess_ok,
        registration_found=registration_found,
        alignment_ok=alignment_ok,
        reprojection_rms_px=reprojection_rms_px,
        recognized_count=recognized_count,
        skipped_count=skipped_count,
        duration_ms=duration_ms,
    )

    return PipelineResult(answers=answers, meta=meta, errors=errors)