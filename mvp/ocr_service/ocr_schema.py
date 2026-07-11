"""Canonical in-memory data types for the OCR service.

These are the types the rest of the OCR pipeline (aligner, cropper,
recognizers, pipeline) talks in. They are deliberately decoupled from the
MasterKey JSON schemas produced by class1.html / class2.html — those
schemas are heterogeneous (Class 1 nests `coords_mm` per-question, Class
2 keeps it top-level) and Task 2's `regions.py` is the seam that
normalises them.

Style note: plain @dataclass, NOT Pydantic. Reasons:
    - The pipeline's downstream consumers (aligner, cropper, recognizers)
      don't need Pydantic's runtime validation overhead — they're called
      many times per scanned sheet.
    - The validation belongs at the loader boundary (regions.py), where
      it raises InvalidMasterKeyError with field-level messages. By the
      time a MasterKey lands in the pipeline, it's already validated.
    - This stays consistent with recognizers/base.py's plain-Python style.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


# Position labels used for registration marks. These are the four keys we
# always expect (and only these four) on a MasterKey.centralised so
# aligner.py and regions.py can refer to one source of truth.
REG_CORNER_TL: str = "tl"
REG_CORNER_TR: str = "tr"
REG_CORNER_BR: str = "br"
REG_CORNER_BL: str = "bl"
REG_CORNERS: tuple[str, ...] = (REG_CORNER_TL, REG_CORNER_TR, REG_CORNER_BR, REG_CORNER_BL)


@dataclass(frozen=True)
class Region:
    """One answer region on the page, in page-mm coordinates.

    Attributes
    ----------
    qid : str
        Question identifier. Always present. Examples: 'q1', 'q2', 'q9'.
        For Class 2 (multi-section), qid is still 'q{N}' — sections are
        flattened at load time.
    sub_id : str | None
        Sub-region identifier within the question. None for a region that
        IS the question (single-region questions). For multi-region
        questions, the part after the qid prefix. Examples:
            'q1'           -> qid='q1', sub_id=None
            'q3-blank-2'   -> qid='q3', sub_id='blank-2'
            'q9-c0'        -> qid='q9', sub_id='c0'
    x_min, y_min, x_max, y_max : float
        Bounding box in millimetres, relative to the page's own top-left
        corner (matching the coord_unit declared in MasterKey.meta).
    icr : dict[str, Any]
        Detection recipe for this region. The exact shape varies by
        question type (matching, mcq, fill_number, ...). The recognizer
        receives this and uses it to choose the right algorithm.
        For sub-regions of a multi-region question, the recipe is the
        closest-matching one from the question's ICR block.
    detect_kind : str
        Canonicalised detection kind (a coarse string the pipeline can
        dispatch on without parsing icr). Examples:
            'circle_mark', 'circle_or_tick', 'drawn_line_between_dots',
            'freehand_circle', 'loop_around_items',
            'pencil_line_on_dashed_path', 'handwritten_digit_in_box',
            'handwritten_text', 'unknown'.
        Empty string '' means "no detection recipe was found for this
        region"; the recognizer will fall back to generic OCR.
    page_index : int
        0-based page number this region lives on. Class 1 is single-sheet
        A4 with all regions on page 0. Class 2 is multi-page A4; today
        every region is also page 0 (the layout is multi-page in the
        meta sense, but the regions list itself doesn't yet carry a page
        field — see schema notes in regions.py). Default 0.
    """

    qid: str
    sub_id: str | None
    x_min: float
    y_min: float
    x_max: float
    y_max: float
    icr: dict[str, Any] = field(default_factory=dict)
    detect_kind: str = ""
    page_index: int = 0

    def qid_full(self) -> str:
        """Return the canonical key used in the cropped-output dict.

        Format: `{qid}` if sub_id is None, otherwise `{qid}-{sub_id}`.
        This matches the keys the existing pipeline (`evaluateAIDiagnostic`
        / `evaluateAIWorksheet`) already expects on its `{qId: text}` input.
        """
        if self.sub_id is None or self.sub_id == "":
            return self.qid
        return f"{self.qid}-{self.sub_id}"


@dataclass(frozen=True)
class MasterKey:
    """Canonical in-memory form of a MasterKey JSON, class-agnostic.

    Attributes
    ----------
    set_number : int
        1-based set number from meta.set (Class 1) or from the page
        parameter (Class 2). The pipeline uses this for logging and for
        matching scanned sheets to expected answer keys.
    pid : str
        Persistent ID, e.g. 'SET-00042'. From meta.pid.
    layout : str
        From meta.layout. Examples: '3-page-A4', 'multi-page-A4'. Used
        for logging and for future multi-physical-page logic.
    coord_unit : str
        Always 'mm' for now; we validate at load time. If a future
        MasterKey declares another unit (e.g. 'cm'), the loader will
        reject it — supporting it would require a unit-conversion
        pipeline and is out of scope.
    page_size_mm : tuple[float, float]
        (W_mm, H_mm) — page width and height in millimetres. Derived
        from registration_marks.br.bbox (the br reg-sq's far corner is
        at the page's bottom-right interior edge). For a 5 mm reg-sq
        that sits flush at the page corner, br.x_max == page_w_mm and
        br.y_max == page_h_mm.
    registration_marks : dict[str, tuple[float, float]]
        Four page-mm corner points keyed by 'tl', 'tr', 'br', 'bl'. The
        value is the INSIDE corner of the reg-sq (the corner adjacent
        to the page interior), so:
            tl -> (x_min, y_min)
            tr -> (x_max, y_min)
            br -> (x_max, y_max)
            bl -> (x_min, y_max)
        This is exactly the shape that aligner.compute_homography
        expects — no further conversion is needed.
    regions : list[Region]
        Flat list of every answer region on the page, across all
        questions and sub-regions. Class 1's per-question `coords_mm`
        dicts and Class 2's top-level `coords_mm` are both flattened
        into this single list.
    """

    set_number: int
    pid: str
    layout: str
    coord_unit: str
    page_size_mm: tuple[float, float]
    registration_marks: dict[str, tuple[float, float]]
    regions: list[Region]


class InvalidMasterKeyError(Exception):
    """Raised when a MasterKey JSON fails to parse or validate.

    The message is always specific (names the offending field), so a
    developer reading the traceback can fix the input without spelunking
    through the loader. Examples:

        "Class 1 schema: missing meta.coord_unit"
        "Class 2 schema: registration_marks.br is missing all four bbox keys"
        "Class 1 schema: questions.q3.coords_mm['q3-blank-X'].x_min is not a number"
    """