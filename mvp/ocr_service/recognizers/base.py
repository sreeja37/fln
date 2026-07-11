"""Recognizer abstract base class.

This is the seam between the OCR service's CV pipeline and the recognition
models. Every concrete recognizer (Stub, TrOCR, PaddleOCR, shape classifier)
subclasses Recognizer. The pipeline dispatches a crop to a recognizer based
on the crop's icr.detect value and the recognizer's supported_detects set.

Design intent (locked for the whole service):

- The interface is intentionally tiny — one method, one return shape.
- The return value is a plain dict (not a Pydantic model) so this base has
  zero dependency on types.py / Pydantic. Pipeline.py (Task 4) will validate
  and wrap the dicts into the response envelope.
- supported_detects is a set of strings drawn from the values of
  icr.detect already produced by the worksheet's buildMasterJSON:
      circle_mark, circle_or_tick, drawn_line_between_dots,
      pencil_line_on_dashed_path, loop_around_items, freehand_circle,
      handwritten_digit, handwritten_digit_in_box,
      handwritten_digit_per_box, handwritten_digit_multi, handwritten_text,
      handwritten_symbol, symbol_recognition, ...
  Concrete recognizers list exactly the ones they handle. An empty set
  (as in the StubRecognizer) means "I don't handle anything — I'm a no-op."
- name is a stable string identifier used by the registry and by the
  response envelope's meta.recognizer field. Must be unique service-wide.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

import numpy as np


class Recognizer(ABC):
    """Abstract base class for all recognizers in the OCR service."""

    #: Stable identifier (e.g. 'stub', 'trocr-digit', 'paddleocr-text').
    #: Subclasses MUST override this as a class attribute.
    name: str = ""

    #: Set of icr.detect values this recognizer knows how to handle.
    #: Empty set means "no-op / placeholder".
    supported_detects: set[str] = set()

    @abstractmethod
    def recognize(self, crop: np.ndarray, icr_hint: dict[str, Any]) -> dict[str, Any]:
        """Recognize the contents of a single cropped region.

        Parameters
        ----------
        crop : np.ndarray
            A (H, W, 3) BGR image of the answer region, already rectified
            and cropped by cropper.warp_and_crop. The recognizer is
            responsible for any further preprocessing (greyscale, threshold,
            resize) appropriate to its model.
        icr_hint : dict
            The icr block from the MasterKey JSON for this region. Always
            carries at minimum a 'detect' key (the icr.detect value) and
            often carries expected values, options, pairs, etc. The
            recognizer uses this to know WHAT to look for and (optionally)
            to validate its own output.

        Returns
        -------
        dict with keys:
            answer     : Any  — the recognized value, or None if undecided.
                          Type matches the question type (str for digits/words,
                          bool for marks, list for multi-field, etc.).
            confidence : float — in [0.0, 1.0]. 0.0 means "no opinion".
            method     : str   — the recognizer's name (mirrors self.name).
                          Useful when responses are aggregated from multiple
                          recognizers and we need to know who said what.
            notes      : str   — free-form debug / audit info. May be empty.
        """
        raise NotImplementedError