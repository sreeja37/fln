"""MasterKey JSON loader.

This is the SEAM between the heterogeneous MasterKey schemas produced by
the worksheet generators (class1.html, class2.html) and the canonical
`MasterKey` / `Region` types used by the rest of the OCR pipeline.

Why a seam
----------
Class 1 and Class 2 emit genuinely different JSON shapes:

    Class 1 (`buildMasterJSON` in class1.html):
        - `questions` keyed by `q1..q9`, each entry may carry its own
          `coords_mm` dict (nested per-question).
        - `registration_marks` is a {tl, tr, bl, br} map of bbox dicts.

    Class 2 (`buildMasterJSON` in class2.html):
        - `sections[]` carries the answer key structure.
        - `coords_mm` is a TOP-LEVEL dict grouped by `q{N}` keys.
        - Same `registration_marks` shape as Class 1.

Both share the reg-marks shape, but everything else differs. Downstream
consumers (aligner, cropper, recognizers) want a single shape. That's us.

Independence
------------
This module imports only stdlib + types.py. No coupling to the Node server,
the evaluation pipeline, the OCR libs, or any TypeScript file. The
canonical MasterKey type and the convert helpers (`to_expected_mm`,
`flatten_regions`) form the public surface; nothing else escapes this
module.

Detection strategy
-------------------
The two schemas are disambiguated by which top-level keys are present:

    - has top-level "questions"  -> Class 1
    - has top-level "sections"    -> Class 2

Each parser path is a private function. They share validation helpers
(`_validate_meta`, `_extract_reg_marks`, `_validate_bbox`) so error
messages stay consistent.

Error philosophy
----------------
Every failure raises `InvalidMasterKeyError` with a SPECIFIC message that
names the offending field. We never raise bare `ValueError` from inside
the parser. We never let Pydantic-style errors bubble out — this module
doesn't depend on Pydantic, and a generic "validation error" traceback
is unhelpful for someone debugging a JSON they just produced.

Validation we DO
----------------
    - JSON parses cleanly (`json.JSONDecodeError` -> InvalidMasterKeyError)
    - Top-level is an object
    - `meta` exists, is an object, has `coord_unit == 'mm'`, `set` is int
    - `registration_marks` exists; if it's not None, each of tl/tr/br/bl
      is either a bbox dict or None; if the bbox exists, all four fields
      (`x_min`, `y_min`, `x_max`, `y_max`) are numeric
    - For Class 1: `questions` is a non-empty object; every question's
      `type` is a string; the per-question `icr` is an object
    - For Class 2: `sections` is a non-empty list; every section has
      `items`; every item has `icr` (object) and `data` (object)

Validation we DELIBERATELY DO NOT do
------------------------------------
    - ICR recipe internal consistency (e.g. every `region` reference in
      an `icr` block actually exists in `coords_mm`). That kind of check
      belongs in Task 4's pipeline, which can decide what to do with
      broken references (warn vs. fail).
    - Page-size sanity vs. registration_marks (e.g. warning if the marks
      aren't at A4 corner positions). Class 3/4/personalised worksheets
      may use different page sizes; we don't assume A4.
    - Cross-version compatibility checks against a stored schema version.
      That's a future concern; right now we know there are exactly two
      schemas we care about.

Detection-kind canonicalisation
-------------------------------
The ICR recipes use a variety of shapes:

    icr = { detect: 'circle_mark', ... }        # single-shot
    icr = { detect_circle: {...}, detect_tick: {...} }   # dual-mark

`_canonicalise_detect_kind` reduces these to a coarse string the
pipeline can switch on without parsing each shape. When in doubt, we
return 'unknown' — the recognizer falls back to generic OCR.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .ocr_schema import (
    InvalidMasterKeyError,
    MasterKey,
    Region,
    REG_CORNERS,
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def load_master_json(source: str | Path | dict[str, Any]) -> MasterKey:
    """Parse a MasterKey JSON from a path, string, or pre-parsed dict.

    Parameters
    ----------
    source : str | Path | dict
        If dict, used directly. If str or Path, treated as either a file
        path (read with `Path.read_text`) or a raw JSON string. String
        detection: source is a file path iff it points to an existing
        file; otherwise it's parsed as JSON text.

    Returns
    -------
    MasterKey
        Canonical in-memory representation.

    Raises
    ------
    InvalidMasterKeyError
        On any parse or validation failure. Message names the offending
        field where possible.
    """
    raw = _coerce_to_dict(source)
    return _parse_master_json(raw)


def to_expected_mm(masterkey: MasterKey) -> dict[str, tuple[float, float]]:
    """Return `aligner.compute_homography`'s expected-mm argument.

    Shape: `{tl: (x_min, y_min), tr: (x_max, y_min),
             br: (x_max, y_max), bl: (x_min, y_max)}`.

    The values are the INSIDE corner of each registration-mark square
    (the corner adjacent to the page interior). For a 5 mm reg-sq at
    the page's top-left corner with bbox `{x_min: 0, y_min: 0, ...}`
    this returns `(0.0, 0.0)` for `tl`.
    """
    rm = masterkey.registration_marks
    return {
        "tl": (rm["tl"][0], rm["tl"][1]),
        "tr": (rm["tr"][0], rm["tr"][1]),
        "br": (rm["br"][0], rm["br"][1]),
        "bl": (rm["bl"][0], rm["bl"][1]),
    }


def flatten_regions(masterkey: MasterKey) -> list[dict[str, Any]]:
    """Convert `MasterKey.regions` into the dict-list shape cropper expects.

    Each entry is `{qid, sub_id, x_min, y_min, x_max, y_max}` — every
    field cropper needs, in exactly the form it expects. The pipeline
    pairs this with `masterkey.page_size_mm` to know the full page extent.

    The recognizer (Task 4 pipeline) cross-references its own results
    with MasterKey via `Region.qid_full()` — that key is computed from
    `(qid, sub_id)`, not stored here directly, to keep this layer
    pipeline-agnostic.
    """
    return [
        {
            "qid": r.qid_full(),
            "sub_id": r.sub_id,
            "x_min": r.x_min,
            "y_min": r.y_min,
            "x_max": r.x_max,
            "y_max": r.y_max,
        }
        for r in masterkey.regions
    ]


# ---------------------------------------------------------------------------
# Source coercion
# ---------------------------------------------------------------------------

def _coerce_to_dict(source: str | Path | dict[str, Any]) -> dict[str, Any]:
    """Normalise the input into a dict; raise InvalidMasterKeyError on failure."""
    if isinstance(source, dict):
        return source

    # Both str and Path flow through the same path-detection logic below.
    candidate = Path(source)

    if candidate.is_file():
        try:
            text = candidate.read_text(encoding="utf-8")
        except OSError as exc:
            raise InvalidMasterKeyError(
                f"could not read MasterKey file {candidate}: {exc}"
            ) from exc
    else:
        # Treat as raw JSON text. This handles the common case of passing
        # `response.json()` from a Node fetch, but expressed as text.
        text = str(source)

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise InvalidMasterKeyError(
            f"MasterKey JSON parse error at line {exc.lineno} col {exc.colno}: {exc.msg}"
        ) from exc

    if not isinstance(parsed, dict):
        raise InvalidMasterKeyError(
            f"MasterKey JSON top-level must be an object, got {type(parsed).__name__}"
        )
    return parsed


# ---------------------------------------------------------------------------
# Format dispatch
# ---------------------------------------------------------------------------

def _parse_master_json(raw: dict[str, Any]) -> MasterKey:
    """Dispatch to the class-1 or class-2 parser based on top-level keys."""
    has_questions = "questions" in raw
    has_sections = "sections" in raw

    if has_questions == has_sections:
        # Both present or both absent: ambiguous or invalid.
        if has_questions:
            raise InvalidMasterKeyError(
                "MasterKey JSON has both 'questions' (Class 1) and 'sections' "
                "(Class 2) at top level — only one is allowed"
            )
        else:
            raise InvalidMasterKeyError(
                "MasterKey JSON top level is missing BOTH 'questions' (Class 1) "
                "and 'sections' (Class 2) — cannot identify schema"
            )

    meta = _validate_meta(raw.get("meta"))
    if not isinstance(raw.get("registration_marks"), dict) and raw.get("registration_marks") is not None:
        raise InvalidMasterKeyError(
            f"MasterKey.registration_marks must be an object or null, "
            f"got {type(raw.get('registration_marks')).__name__}"
        )
    reg_marks_bbox = _extract_reg_marks(raw.get("registration_marks"))
    page_size_mm = _derive_page_size(reg_marks_bbox)
    reg_marks_corners = _bbox_dict_to_corners(reg_marks_bbox)

    if has_questions:
        questions = raw["questions"]
        if not isinstance(questions, dict) or not questions:
            raise InvalidMasterKeyError(
                "Class 1 schema: 'questions' must be a non-empty object"
            )
        regions = _parse_class1_questions(questions)
    else:
        sections = raw["sections"]
        coords_mm = raw.get("coords_mm")
        if not isinstance(sections, list) or not sections:
            raise InvalidMasterKeyError(
                "Class 2 schema: 'sections' must be a non-empty list"
            )
        regions = _parse_class2_sections(sections, coords_mm)

    return MasterKey(
        set_number=meta["set"],
        pid=meta["pid"],
        layout=meta["layout"],
        coord_unit=meta["coord_unit"],
        page_size_mm=page_size_mm,
        registration_marks=reg_marks_corners,
        regions=regions,
    )


# ---------------------------------------------------------------------------
# Meta validation (shared between schemas)
# ---------------------------------------------------------------------------

def _validate_meta(meta: Any) -> dict[str, Any]:
    """Validate the shared `meta` block. Returns it on success."""
    if not isinstance(meta, dict):
        raise InvalidMasterKeyError(
            f"MasterKey.meta must be an object, got {type(meta).__name__}"
        )
    coord_unit = meta.get("coord_unit")
    if coord_unit != "mm":
        raise InvalidMasterKeyError(
            f"MasterKey.meta.coord_unit must be 'mm' "
            f"(only mm is supported; got {coord_unit!r})"
        )
    set_number = meta.get("set")
    if not isinstance(set_number, int) or set_number < 1:
        raise InvalidMasterKeyError(
            f"MasterKey.meta.set must be a positive integer, got {set_number!r}"
        )
    pid = meta.get("pid")
    if not isinstance(pid, str) or not pid:
        raise InvalidMasterKeyError(
            f"MasterKey.meta.pid must be a non-empty string, got {pid!r}"
        )
    layout = meta.get("layout")
    if not isinstance(layout, str):
        raise InvalidMasterKeyError(
            f"MasterKey.meta.layout must be a string, got {layout!r}"
        )
    return meta


# ---------------------------------------------------------------------------
# Registration-marks handling (shared between schemas)
# ---------------------------------------------------------------------------

def _extract_reg_marks(raw_rm: Any) -> dict[str, dict[str, float] | None]:
    """Validate reg-marks shape; return a normalised {tl,tr,br,bl} -> bbox-or-None."""
    if raw_rm is None:
        return {corner: None for corner in REG_CORNERS}
    if not isinstance(raw_rm, dict):
        raise InvalidMasterKeyError(
            f"MasterKey.registration_marks must be an object or null, "
            f"got {type(raw_rm).__name__}"
        )

    result: dict[str, dict[str, float] | None] = {}
    for corner in REG_CORNERS:
        if corner not in raw_rm:
            raise InvalidMasterKeyError(
                f"MasterKey.registration_marks is missing key {corner!r}"
            )
        bbox = raw_rm[corner]
        if bbox is None:
            result[corner] = None
            continue
        result[corner] = _validate_bbox(bbox, f"registration_marks.{corner}")
    return result


def _validate_bbox(bbox: Any, path: str) -> dict[str, float]:
    """Validate a `{x_min, y_min, x_max, y_max}` bbox dict."""
    if not isinstance(bbox, dict):
        raise InvalidMasterKeyError(
            f"{path} must be an object, got {type(bbox).__name__}"
        )
    out: dict[str, float] = {}
    for key in ("x_min", "y_min", "x_max", "y_max"):
        if key not in bbox:
            raise InvalidMasterKeyError(f"{path}.{key} is missing")
        val = bbox[key]
        if not isinstance(val, (int, float)) or isinstance(val, bool):
            raise InvalidMasterKeyError(
                f"{path}.{key} must be a number, got {val!r}"
            )
        out[key] = float(val)

    if out["x_max"] <= out["x_min"]:
        raise InvalidMasterKeyError(
            f"{path}: x_max ({out['x_max']}) must be > x_min ({out['x_min']})"
        )
    if out["y_max"] <= out["y_min"]:
        raise InvalidMasterKeyError(
            f"{path}: y_max ({out['y_max']}) must be > y_min ({out['y_min']})"
        )
    return out


def _derive_page_size(reg_marks_bbox: dict[str, dict[str, float] | None]) -> tuple[float, float]:
    """Derive (W_mm, H_mm) from registration_marks.br bbox.

    A 5 mm reg-sq at the page's bottom-right corner has `br.x_max == W_mm`
    and `br.y_max == H_mm` — i.e. the FAR corner of the reg-sq is the
    page's own bottom-right interior edge. Returns (0, 0) when br is
    missing; the pipeline can detect this and degrade.
    """
    br = reg_marks_bbox.get("br")
    if br is None:
        return (0.0, 0.0)
    return (br["x_max"], br["y_max"])


def _bbox_dict_to_corners(
    reg_marks_bbox: dict[str, dict[str, float] | None],
) -> dict[str, tuple[float, float]]:
    """Convert a {corner: bbox-or-None} dict into {corner: (x,y) point-or-(0,0)}.

    For each present reg-mark, the returned point is the INSIDE corner
    of the reg-sq (adjacent to the page interior). When a reg-mark is
    missing, the corresponding corner is the geometric guess: (0, 0)
    for tl, (210, 0) for tr, etc. — but only if the page size was
    derivable. If page size was (0, 0), every missing corner is (0, 0).
    """
    page_w, page_h = _derive_page_size(reg_marks_bbox)
    fallback = {
        "tl": (0.0, 0.0),
        "tr": (page_w, 0.0),
        "br": (page_w, page_h),
        "bl": (0.0, page_h),
    }
    out: dict[str, tuple[float, float]] = {}
    for corner in REG_CORNERS:
        bbox = reg_marks_bbox.get(corner)
        if bbox is None:
            out[corner] = fallback[corner]
            continue
        if corner == "tl":
            out[corner] = (bbox["x_min"], bbox["y_min"])
        elif corner == "tr":
            out[corner] = (bbox["x_max"], bbox["y_min"])
        elif corner == "br":
            out[corner] = (bbox["x_max"], bbox["y_max"])
        else:  # bl
            out[corner] = (bbox["x_min"], bbox["y_max"])
    return out


# ---------------------------------------------------------------------------
# Class 1 schema
# ---------------------------------------------------------------------------

def _parse_class1_questions(questions: dict[str, Any]) -> list[Region]:
    """Walk Class 1's `questions` map and produce a flat list of Regions."""
    out: list[Region] = []
    for q_key, q_value in questions.items():
        if not isinstance(q_key, str) or not q_key:
            raise InvalidMasterKeyError(
                f"Class 1 schema: questions has invalid key {q_key!r}"
            )
        if not isinstance(q_value, dict):
            raise InvalidMasterKeyError(
                f"Class 1 schema: questions.{q_key} must be an object, "
                f"got {type(q_value).__name__}"
            )

        icr = q_value.get("icr")
        if icr is None:
            icr = {}
        if not isinstance(icr, dict):
            raise InvalidMasterKeyError(
                f"Class 1 schema: questions.{q_key}.icr must be an object "
                f"or null, got {type(icr).__name__}"
            )
        icr_for_match = icr  # by-reference; immutable enough

        detect_kind = _canonicalise_detect_kind(icr)
        coords_mm = q_value.get("coords_mm")

        # A question may or may not have answer regions. Some questions
        # are text-only (with no per-region marks) — those get a single
        # Region with sub_id=None IF the question has coords_mm, else no
        # region at all. (Text-only questions are out of scope for the
        # geometric pipeline; they'd be a generic-OCR pass.)
        if coords_mm is None:
            continue
        if not isinstance(coords_mm, dict):
            raise InvalidMasterKeyError(
                f"Class 1 schema: questions.{q_key}.coords_mm must be an "
                f"object or null, got {type(coords_mm).__name__}"
            )

        for region_key, bbox in coords_mm.items():
            if not isinstance(region_key, str) or not region_key:
                raise InvalidMasterKeyError(
                    f"Class 1 schema: questions.{q_key}.coords_mm has "
                    f"invalid key {region_key!r}"
                )
            validated_bbox = _validate_bbox(
                bbox, f"questions.{q_key}.coords_mm.{region_key}"
            )
            qid, sub_id = _split_region_key(region_key, q_key)
            out.append(
                Region(
                    qid=qid,
                    sub_id=sub_id,
                    x_min=validated_bbox["x_min"],
                    y_min=validated_bbox["y_min"],
                    x_max=validated_bbox["x_max"],
                    y_max=validated_bbox["y_max"],
                    icr=icr_for_match,
                    detect_kind=detect_kind,
                )
            )
    return out


# ---------------------------------------------------------------------------
# Class 2 schema
# ---------------------------------------------------------------------------

def _parse_class2_sections(
    sections: list[Any], coords_mm: Any
) -> list[Region]:
    """Walk Class 2's `sections` and top-level `coords_mm` and produce Regions.

    Class 2's two sources of truth:
        - `sections[].items[].icr` -> the detection recipe for that section
        - `coords_mm[qN]` -> the bbox map for question qN

    Each question's region picks up its ICR from its item; for multi-
    region questions (e.g. `q3-blank-1`, `q3-blank-2`), every region
    in that question gets the SAME icr (the item-level recipe), which
    is consistent with how Class 1's question-level `icr` is shared
    across its sub-regions.
    """
    if coords_mm is None:
        return []

    if not isinstance(coords_mm, dict):
        raise InvalidMasterKeyError(
            f"Class 2 schema: 'coords_mm' (top level) must be an object "
            f"or null, got {type(coords_mm).__name__}"
        )

    # First pass: build the per-question ICR index by walking sections.
    # qN -> icr_recipe (so multi-region questions all share one recipe).
    icr_by_q: dict[str, dict[str, Any]] = {}
    detect_kind_by_q: dict[str, str] = {}
    for s_idx, section in enumerate(sections):
        if not isinstance(section, dict):
            raise InvalidMasterKeyError(
                f"Class 2 schema: sections[{s_idx}] must be an object, "
                f"got {type(section).__name__}"
            )
        items = section.get("items")
        if items is None:
            continue  # section with no items contributes no regions
        if not isinstance(items, list):
            raise InvalidMasterKeyError(
                f"Class 2 schema: sections[{s_idx}].items must be a list "
                f"or null, got {type(items).__name__}"
            )
        # The section's items each have their own (question, icr). Walk
        # them and group by question number.
        for item in items:
            if not isinstance(item, dict):
                raise InvalidMasterKeyError(
                    f"Class 2 schema: sections[{s_idx}].items has a "
                    f"non-object entry"
                )
            icr = item.get("icr")
            if icr is None:
                icr = {}
            if not isinstance(icr, dict):
                raise InvalidMasterKeyError(
                    f"Class 2 schema: sections[{s_idx}].items[].icr "
                    f"must be an object or null"
                )
            qn = item.get("question")
            if not isinstance(qn, str) or not qn:
                continue
            if qn not in icr_by_q:
                icr_by_q[qn] = icr
                detect_kind_by_q[qn] = _canonicalise_detect_kind(icr)

    # Second pass: walk coords_mm. Each qN-keyed dict expands to one
    # Region per region_key.
    out: list[Region] = []
    for q_key, region_bboxes in coords_mm.items():
        if not isinstance(q_key, str) or not q_key:
            raise InvalidMasterKeyError(
                f"Class 2 schema: coords_mm has invalid key {q_key!r}"
            )
        if not isinstance(region_bboxes, dict):
            raise InvalidMasterKeyError(
                f"Class 2 schema: coords_mm.{q_key} must be an object, "
                f"got {type(region_bboxes).__name__}"
            )
        icr = icr_by_q.get(q_key, {})
        detect_kind = detect_kind_by_q.get(q_key, "unknown")
        for region_key, bbox in region_bboxes.items():
            if not isinstance(region_key, str) or not region_key:
                raise InvalidMasterKeyError(
                    f"Class 2 schema: coords_mm.{q_key} has invalid "
                    f"region key {region_key!r}"
                )
            validated_bbox = _validate_bbox(
                bbox, f"coords_mm.{q_key}.{region_key}"
            )
            qid, sub_id = _split_region_key(region_key, q_key)
            out.append(
                Region(
                    qid=qid,
                    sub_id=sub_id,
                    x_min=validated_bbox["x_min"],
                    y_min=validated_bbox["y_min"],
                    x_max=validated_bbox["x_max"],
                    y_max=validated_bbox["y_max"],
                    icr=icr,
                    detect_kind=detect_kind,
                )
            )
    return out


# ---------------------------------------------------------------------------
# Region-key parsing (shared)
# ---------------------------------------------------------------------------

def _split_region_key(region_key: str, q_key: str) -> tuple[str, str | None]:
    """Split a region key like 'q3-blank-2' into ('q3', 'blank-2').

    The expected prefix is the question key in lowercase (matching what
    the worksheet generators actually emit). If the region_key doesn't
    start with that prefix, we still split it as best we can (taking
    the first '-'-separated chunk as the qid, the rest as sub_id). This
    is more permissive than strict prefix matching — and matches how
    the existing `evaluateAIDiagnostic` flattens its results anyway.
    """
    parts = region_key.split("-", 1)
    if len(parts) == 1:
        return (parts[0], None)
    return (parts[0], parts[1])


# ---------------------------------------------------------------------------
# Detection-kind canonicalisation
# ---------------------------------------------------------------------------

def _canonicalise_detect_kind(icr: dict[str, Any]) -> str:
    """Reduce an ICR recipe to a coarse detection string.

    Returns one of:
        'circle_mark', 'circle_or_tick', 'drawn_line_between_dots',
        'freehand_circle', 'loop_around_items',
        'pencil_line_on_dashed_path', 'handwritten_digit_in_box',
        'handwritten_text', 'unknown'.

    The values come straight from the worksheet generators' `icr.detect`
    field when present; otherwise we infer from the recipe's shape
    (e.g. dual_mark has detect_circle + detect_tick).
    """
    detect = icr.get("detect")
    if isinstance(detect, str) and detect:
        # Pass-through. Future versions might want a stricter allowlist
        # but for now the worksheet generators' vocabulary IS ours.
        return detect

    # No top-level `detect`. Try the dual-mark shape.
    if "detect_circle" in icr or "detect_tick" in icr:
        return "symbol_recognition"

    # As a last resort, try to infer from the block's presence of items.
    if "pairs" in icr:
        return "drawn_line_between_dots"
    if "cells" in icr:
        return "freehand_circle"
    if "blanks" in icr:
        return "handwritten_digit_in_box"
    return "unknown"