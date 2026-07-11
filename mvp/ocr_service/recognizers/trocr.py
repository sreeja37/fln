"""TrOCR-based recognizer for handwritten crops.

Uses `microsoft/trocr-base-handwritten` (HuggingFace), a
vision-encoder-decoder model fine-tuned on the IAM handwriting
dataset. Strongest out-of-the-box on handwritten lines — single
digits, multi-digit numbers, and short handwritten words.

Scope (locked):

  Handles:
    - handwritten_digit
    - handwritten_digit_in_box
    - handwritten_digit_per_box
    - handwritten_digit_multi
    - handwritten_text

  Declines (returns stub-shaped no-op; never raises):
    - any icr.detect value not listed above
    - model load failures
    - inference failures

The model is loaded LAZILY on the first call to `.recognize()`.
Importing this module is side-effect free, and deployments that
don't need TrOCR pay zero startup cost. Class-level metadata
(`name`, `supported_detects`) is available without instantiation
and without importing torch/transformers.

Output normalization (Option A):
  - digit* detects   → keep digits only, return last digit run
  - handwritten_text → collapse whitespace, strip non-printable

Returns "" when nothing usable remains; the caller is expected
to map "" -> None in the response envelope.

Dependencies (in requirements-ocr.txt, NOT requirements.txt):
    transformers >= 4.35
    torch >= 2.1, < 3.0
"""

from __future__ import annotations

import re
from typing import Any

import numpy as np

from .base import Recognizer


_MODEL_ID = "microsoft/trocr-base-handwritten"


# Single source of truth for which detect kinds are treated as
# numeric answers by _postprocess.
_DIGIT_DETECTS = frozenset(
    {
        "handwritten_digit",
        "handwritten_digit_in_box",
        "handwritten_digit_per_box",
        "handwritten_digit_multi",
    }
)


class TrOcrRecognizer(Recognizer):
    """TrOCR-base-handwritten recognizer for handwritten digit and text crops.

    Exposed in the default registry as `"trocr"`.
    """

    name = "trocr"
    supported_detects: set[str] = {
        "handwritten_digit",
        "handwritten_digit_in_box",
        "handwritten_digit_per_box",
        "handwritten_digit_multi",
        "handwritten_text",
    }

    def __init__(self) -> None:
        # Lazily populated on first recognize() call.
        self._processor = None
        self._model = None

    # ----- lifecycle -----

    def _ensure_loaded(self) -> None:
        """Load the TrOCR processor and model on first call.

        Imported inside the method so importing this module is
        safe even when transformers / torch are not installed.
        """
        if self._model is not None:
            return
        from transformers import TrOCRProcessor, VisionEncoderDecoderModel

        self._processor = TrOCRProcessor.from_pretrained(_MODEL_ID)
        self._model = VisionEncoderDecoderModel.from_pretrained(_MODEL_ID)
        self._model.eval()

    # ----- helpers -----

    @staticmethod
    def _bgr_to_pil(crop: np.ndarray):
        """Convert a numpy crop (BGR, uint8) to a PIL.Image (RGB).

        TrOCR expects a 3-channel RGB PIL.Image. Grayscale crops
        (H, W) are promoted to (H, W, 3) by stacking the channel.
        """
        from PIL import Image

        if crop.ndim == 2:
            crop = np.stack([crop] * 3, axis=-1)
        rgb = crop[:, :, ::-1]  # BGR -> RGB
        return Image.fromarray(rgb)

    @staticmethod
    def _postprocess(text: str, detect: str) -> str:
        """Normalize TrOCR output by detect kind.

        digit* detects    → keep digits only, return last run.
        handwritten_text  → collapse whitespace, strip non-printable.

        Returns "" when nothing usable remains; the caller maps
        "" to None in the response envelope.
        """
        if detect in _DIGIT_DETECTS:
            digits = re.findall(r"\d+", text)
            return digits[-1] if digits else ""
        # handwritten_text (or any other supported text-like detect)
        cleaned = re.sub(r"\s+", " ", text).strip()
        cleaned = re.sub(r"[^\x20-\x7E]", "", cleaned)
        return cleaned

    @staticmethod
    def _stub_response(detect: str, notes: str) -> dict[str, Any]:
        """Honest no-op response preserving the envelope shape."""
        return {
            "answer": None,
            "confidence": 0.0,
            "method": "trocr",
            "notes": notes,
        }

    # ----- public API -----

    def recognize(
        self,
        crop: np.ndarray,
        icr_hint: dict[str, Any],
    ) -> dict[str, Any]:
        """Recognize the contents of a single cropped region.

        Never raises. On any failure path returns a stub-shaped
        dict so the pipeline's response envelope stays stable.
        """
        detect = (icr_hint or {}).get("detect")

        # Decline non-claimed detects without raising.
        if detect not in self.supported_detects:
            return self._stub_response(detect, f"unsupported_detect:{detect}")

        # Lazy model load.
        try:
            self._ensure_loaded()
        except Exception as exc:
            return self._stub_response(detect, f"trocr_load_failed:{exc}")

        # Inference.
        try:
            import torch

            image = self._bgr_to_pil(crop)
            inputs = self._processor(images=image, return_tensors="pt")
            with torch.no_grad():
                out = self._model.generate(
                    **inputs,
                    output_scores=True,
                    return_dict_in_generate=True,
                )
            text = self._processor.batch_decode(
                out.sequences, skip_special_tokens=True
            )[0].strip()

            # Coarse confidence from mean per-token probability.
            confidence = 0.0
            try:
                probs = torch.stack(out.scores, dim=1).softmax(-1)
                token_ids = out.sequences[:, 1:]  # shift past BOS
                gathered = probs.gather(-1, token_ids.unsqueeze(-1)).squeeze(-1)
                confidence = float(gathered.mean().clamp(0.0, 1.0).item())
            except Exception:
                # Confidence is best-effort; don't fail the whole call.
                pass

            cleaned = self._postprocess(text, detect)
            return {
                "answer": cleaned if cleaned else None,
                "confidence": confidence,
                "method": self.name,
                "notes": f"model:{_MODEL_ID}",
            }
        except Exception as exc:
            return self._stub_response(detect, f"trocr_inference_failed:{exc}")