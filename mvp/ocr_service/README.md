# FLN Skeleton OCR Service

This directory is the **skeleton** ICR service for the FLN MVP. It implements
the image-processing pipeline (preprocess → page alignment → region cropping)
using OpenCV, with a pluggable Recognizer interface and a stub recognizer.
**No OCR model is integrated in this phase.** Phase 2 will add TrOCR and
PaddleOCR implementations behind the same interface.

## What's here (Phase 1, Task 1)

```
mvp/ocr_service/
├── README.md                  ← you are here
├── requirements.txt           ← skeleton dependencies only (no OCR libs)
├── preprocessor.py            ← grayscale + blur + Otsu threshold
├── aligner.py                 ← reg-sq detection + homography (OpenCV findHomography)
├── cropper.py                 ← warp + per-region cropping
└── recognizers/
    ├── __init__.py            ← package marker (Phase 2 will add REGISTRY here)
    ├── base.py                ← Recognizer abstract base class
    └── stub.py                ← StubRecognizer — honest placeholder
```

## What's NOT here yet (later Phase 1 tasks)

| File / feature | Added in |
|---|---|
| `server.py` (FastAPI HTTP entry) | Task 7 |
| `pipeline.py` (orchestrates the four CV modules) | Task 4 |
| `regions.py` (MasterKey JSON loader) | Task 2 |
| `types.py` (Pydantic I/O models) | Task 2 |
| `tests/` | Task 8 |
| `recognizers/__init__.py` registry | Task 3 |

## Phase 2 entry points (not implemented yet)

Real recognizers will land in:

- `recognizers/trocr_digit.py`       — handwritten digits / words
- `recognizers/paddleocr_text.py`    — printed-text fallback
- `recognizers/shape_classifier.py`   — circles / ticks / lines / loops (classical CV + small CNN)

Each will be a subclass of `Recognizer` (see `recognizers/base.py`) and will
register itself in `recognizers/__init__.py:REGISTRY`.

## Design constraints (locked for the whole service)

1. **No OCR libraries** in Phase 1. `requirements.txt` declares only OpenCV +
   numpy + Pillow + FastAPI + Pydantic. TrOCR/PaddleOCR land in Phase 2 in
   a separate `requirements-ocr.txt`.
2. **No hardcoded page dimensions** in `aligner.py`. The expected mm coordinates
   come from the MasterKey JSON (`registration_marks`), supplied by the caller.
   A4 (210×297 mm) is the default only when the caller doesn't supply values.
3. **No Express / evaluation coupling.** This directory is a leaf. It imports
   nothing from `mvp/server/`, `mvp/evaluation_metrics/`, or any TypeScript file.
4. **OpenCV first.** We use `cv2.findHomography`, `cv2.warpPerspective`,
   `cv2.findContours`, etc. The DLT math is documented in `aligner.py` for
   reference, but the production path delegates to OpenCV's solver.

## Module independence

Each module is testable on its own:

- `preprocessor.preprocess(bgr) → binary` — pure function, OpenCV only.
- `aligner.find_registration_squares(binary) → [tl, tr, br, bl]` — pure function, no JSON.
- `aligner.compute_homography(detected, expected_mm) → H | None` — pure function.
- `cropper.warp_and_crop(bgr, H, regions, dpi) → {qid: crop}` — pure function.
- `recognizers.stub.StubRecognizer().recognize(crop, icr_hint) → dict` — pure function.

None of these import from `mvp.server`, `mvp.evaluation_metrics`, or
`mvp.ocr_service.regions`. They form a chain in pipeline.py (Task 4), but
the chain is opt-in — each module stands alone.

## Phase 1 Task 1 acceptance

After this task lands, the following should be true:

- `pip install -r requirements.txt` works in a fresh venv.
- `python -c "from mvp.ocr_service.preprocessor import preprocess"` works (once
  the directory is on `PYTHONPATH`).
- The four CV modules can each be exercised from a Python REPL.
- `StubRecognizer` returns `{answer: None, confidence: 0.0, method: 'stub'}`
  for every input.
- No file outside `mvp/ocr_service/` is modified.