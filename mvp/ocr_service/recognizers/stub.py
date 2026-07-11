"""Stub recognizer.

This is the placeholder that lets the rest of the service be exercised
end-to-end without committing to an OCR model. It deliberately returns:

    answer     = None          # no opinion
    confidence = 0.0           # explicit zero so callers can filter on it
    method     = 'stub'        # identifies this as a stub response
    notes      = 'recognizer_not_implemented'

This shape is honest: the response envelope carries 0.0 confidence so any
downstream filter ("only act on confidence >= 0.7") trivially ignores stub
output. We do NOT fabricate plausible answers (no random digits, no echoing
expected_value) because that would mask wiring bugs in the pipeline.

supported_detects is intentionally empty — the stub handles nothing. The
pipeline's dispatch (added in Task 4) will see this empty set and route the
crop to a concrete recognizer when one exists; if no recognizer claims a
crop, the pipeline falls back to the stub. This is the fallback semantics.

Phase 2 will add real recognizers (trocr_digit.py, paddleocr_text.py,
shape_classifier.py) as siblings of this file. None of them will need to
modify stub.py.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from mvp.ocr_service.recognizers.base import Recognizer


class StubRecognizer(Recognizer):
    """Placeholder recognizer that returns an empty answer for every crop."""

    name = "stub"
    supported_detects: set[str] = set()

    def recognize(self, crop: np.ndarray, icr_hint: dict[str, Any]) -> dict[str, Any]:
        # Intentionally ignore crop and icr_hint — the stub has no opinion.
        return {
            "answer": None,
            "confidence": 0.0,
            "method": self.name,
            "notes": "recognizer_not_implemented",
        }