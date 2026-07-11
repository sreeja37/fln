# OCR Service + Worksheet Pipeline — TODO

> Snapshot of the OCR service module (`mvp/ocr_service/`) and the
> Class 2 worksheet fixture it depends on. This TODO is the
> resume point for the next session.

---

## 1. Completed work

### A. OCR service scaffold + skeleton wiring

| # | Task | File(s) |
|---|---|---|
| T1 | Skeleton OCR service (CV primitives, MasterKey loader, StubRecognizer) | `preprocessor.py`, `aligner.py`, `cropper.py`, `regions.py`, `ocr_schema.py`, `recognizers/{__init__,base,stub}.py`, `requirements.txt`, `README.md` |
| T2 | MasterKey loader — handles Class 1 (`questions` key) and Class 2 (`sections` key) schemas with field-specific errors | `regions.py`, `ocr_schema.py` |
| T3 | Pipeline orchestrator: `preprocess → find_registration_squares → compute_homography → warp_and_crop → recognize` with graceful degradation (never raises) | `pipeline.py` |
| T4 | FastAPI HTTP service: `POST /recognize` (multipart: `image` + `masterkey`), `GET /health` | `server.py` |
| T5 | Bug fix — `types.py` shadowed stdlib `types` (`MappingProxyType` ImportError on uvicorn startup); renamed to `ocr_schema.py` and updated 3 import sites | `ocr_schema.py`, `pipeline.py`, `regions.py`, `server.py` |
| T6 | Recognizer registry + factory (`RecognizerRegistry` with `register/resolve/all`; stores CLASSES not instances; caller instantiates via `registry.resolve("trocr")()`); dispatch wired into `pipeline.py` | `recognizers/registry.py`, `recognizers/__init__.py`, `pipeline.py` |
| T7 | **Recognizer selection policy**: detect `torch` AND `transformers` via `importlib.util.find_spec` BEFORE instantiating; prefer TrOCR if both present, else fall back to StubRecognizer (no exception) | `pipeline.py` |

### B. Recognizer + requirements

| # | Task | File(s) |
|---|---|---|
| T8 | `TrOcrRecognizer` — supports `handwritten_digit`, `handwritten_digit_in_box`, `handwritten_digit_per_box`, `handwritten_digit_multi`, AND `handwritten_text`; `_postprocess()` decides normalization based on detect kind; stub-shaped fallback response on any failure | `recognizers/trocr.py` |
| T9 | `requirements-ocr.txt` — separate from `requirements.txt`; pins `transformers==4.46.2`, `tokenizers==0.20.3` (see blocker note) | `requirements-ocr.txt` |
| T10 | TrOcrRecognizer lazy model load end-to-end verified; single-call smoke test returned `answer='1'`, `method='trocr'`, `confidence=0.2332` (warm-up 30.77s, subsequent 1.78s) | — |

### C. Test fixture (official OCR test artifact)

| # | Task | File(s) |
|---|---|---|
| T11 | Generated one Class 2 worksheet + matching MasterKey JSON via existing pipeline; became official OCR test fixtures | `mvp/output/class2_diagnostic_c607c698-80ab-422d-adf4-ef8dd179b0b6.pdf` (540 KB, 6 pages) and `…-set1.json` (44 KB) |
| T12 | Rendered all 6 PDF pages at 300 DPI (each 2481×3508 px) | `mvp/output/class2_diagnostic_…_page{1..6}.png` |
| T13 | Cropping validation — produced 5 valid crops from MasterKey coords (`q2-ans-1..5`, handwritten_digit, 112×144 px, ink_pct 0.15-0.31); direct mm→px slicing; per-box coords filtered out (degenerate y span) | `mvp/output/_demo_crops/` |
| T14 | TrOcrRecognizer ran on the 5 crops → 1 None + 4 hallucinated '1' (expected for blank printed boxes); TSV saved | `mvp/output/_demo_crops/_ocr_results.tsv` |
| T15 | Full pipeline ran on existing real handwritten scan (`scan_class2_…_page1.png.png`); failed at **alignment**, as expected (see blocker) | `mvp/output/page1_ocr_results.tsv` |

---

## 2. Current blocker

**The OCR pipeline expects registration squares for homography, but the
generated Class 2 PDF does not contain visible registration squares on
all pages, while the MasterKey still contains `registration_marks`.**

Concrete symptom on every page of the regenerated PDF:
- All 4 page corners are pure white (0 black px in 60×60 samples @ 300 DPI).
- `find_registration_squares` either finds <4 candidates or finds
  4 false-positive ink blobs that don't form a valid quadrilateral
  against the MasterKey's `(0,0)→(210,1151.95)` virtual page.
- `compute_homography` returns `None` → `alignment_ok=False`.
- 0 crops built → 0 recognitions per scan.

---

## 3. Root cause investigation summary

Multi-layer mismatch between HTML DOM, MasterKey, and rendered PDF.

### Findings (in DOM order)

1. **Reg-sq CSS** — `class2.html:77-81` defines 5×5 mm black squares,
   absolutely positioned at corners of `.page-wrapper` (NOT `.page`).
2. **Original DOM placement** — `class2.html:667-668` put the 4 reg-sq
   divs as siblings of `.page` inside `.page-wrapper` (outside `.page`
   subtree).
3. **Phase 1 fix applied (test approved)** — one-line edit to
   `class2.html:671-673`: moved the 4 `.reg-sq` divs from
   `<div class="page-wrapper">'+reg+
     <div class="page" id="page-set-…">` to
   `  <div class="page-wrapper">'+
     '<div class="page" id="page-set-…">'+reg+`.
4. **Effect of fix** — html2canvas's intermediate `fullCanvas` now
   contains all 4 reg-sqs at exactly the MasterKey-declared positions
   (verified by pixel probe of the 952×5253 px canvas).
5. **MasterKey** — still describes a single 210×1111.95 mm virtual page
   with regCoords at all 4 corners. Not updated.
6. **PDF slicing** — `buildPdfBlobForSet` builds `blockEls` from
   `.ws-header + sections + .ws-footer` only. Greedy packer slices
   canvas at these block boundaries. Result:
   - Page 1 PDF contains TL+TR reg-sqs (visible at top corners, pushed
     14 mm down by `PDF_MARGIN_MM = 14`).
   - Pages 2–6 contain no reg-sqs anywhere. BL/BR reg-sqs sit at
     canvas-y ≈ 1107 mm, below `.ws-footer.bottom` (~1105 mm), in the
     ~7 mm empty band that no block covers.
7. **OCR pipeline** — `regions.py:_derive_page_size` reads
   `br.y_max - tl.y_min` → 1111.95 mm. `aligner.compute_homography`
   expects 4 corners at this geometry, but no scanned page provides
   that layout.

### Why the Phase 1 fix was necessary but not sufficient
- Hypothesis was confirmed (reg-sqs were outside html2canvas render
  subtree).
- Phase 1 fix unblocked html2canvas rendering.
- But the PDF slicing algorithm still drops BL+BR squares.
- And the OCR pipeline still expects all 4 corners on a single virtual
  page that doesn't match any physical PDF page.

---

## 4. Files involved

### Modified during this investigation (Phase 1)
- `mvp/public/worksheets/class2.html:671-673` — reg-sq divs moved
  inside `.page` (one-line change).

### Active code references
- `mvp/public/worksheets/class2.html:77-81` (CSS), `:172`
  (print-CSS hint, irrelevant to html2canvas), `:667-823, 835-855`
  (MasterKey emission and captureCoords), `:1087-1222`
  (`buildPdfBlobForSet`, especially `:1117-1120` for `blockEls`,
  `:1158-1188` for greedy packer, `:1190-1221` for jsPDF).
- `mvp/server/classAdapters.ts`, `worksheetRenderer.ts`,
  `paperGenerator.ts:183-185` (preview-only reg-sq block, never
  reaches PDF).
- `mvp/ocr_service/regions.py:14-28, 70-160, 244-270, 365-395`.
- `mvp/ocr_service/aligner.py:60-100, 191-247`.

### Generated artifacts (test inputs)
- `mvp/output/class2_SET-00001_regen.pdf` (544 KB, 6 pages)
- `mvp/output/SET-00001_regen_masterkey.json`
- `mvp/output/class2_SET-00001_regen_page{1..6}.png`
- `mvp/output/page1_ocr_results.tsv` (35 rows, alignment failed)
- `mvp/output/_demo_crops/{q2-ans-1..5.png, _ocr_results.tsv}`

### Driver scripts (Temp, can be reused)
- `C:\Users\sreej\AppData\Local\Temp\regen_one_set.mjs`
- `C:\Users\sreej\AppData\Local\Temp\probe_canvas.mjs`
- `C:\Users\sreej\AppData\Local\Temp\crop_5_regions.py`
- `C:\Users\sreej\AppData\Local\Temp\recognize_5_crops.py`
- `C:\Users\sreej\AppData\Local\Temp\page1_pipeline.py`

---

## 5. What remains to be done (NOT done yet — explicit per-step approval required)

### Outstanding fixes (independent of the blocker)
- [ ] **T-REQ** Update `mvp/ocr_service/requirements-ocr.txt` with
  `transformers<5.0` upper bound (the 5.13.1 version breaks TrOCR; only
  the exact 4.46.2 pin is currently there).
- [ ] **T-COERCE** Fix MasterKey `question: 1` (int) vs `regions.py`
  string indexing so `Region.detect_kind` resolves correctly when loaded
  via `load_master_json` (currently falls back to `'unknown'` on Class 2;
  current cropper works around it by reading raw JSON).

### Blocker remediation — Phase 2

Two options; the user has not yet chosen between them.

**Option A — Pin slice bounds to include all 4 reg-sqs** (worksheet gen only)
- In `buildPdfBlobForSet` after `blockEls` is computed, prepend a
  synthetic top block `[0, ws-header.top]` and append a synthetic
  bottom block `[ws-footer.bottom, fullCanvas.height]`.
- Greedy packer will then naturally extend page 1 (TL+TR) and page 6
  (BL+BR) slices to include the reg-sqs.
- MasterKey stays unchanged.
- OCR alignment can succeed against either the rendered page 1 (if
  scanned with margins that capture TL+TR) OR the rendered page 6
  (BL+BR).
- No OCR service changes needed.
- Verification target: re-render PDF, find ~5×5 mm black squares at
  page 1 top corners AND page 6 bottom corners.

**Option B — Per-page MasterKey + per-page OCR alignment** (cross-module)
- Change the worksheet generator to emit one MasterKey per physical
  page (per-page `registration_marks` with y_min/y_max reset to
  `[0, pageH]`).
- Update `regions.py` to expose per-page coords.
- Update OCR pipeline to accept a `page_index` and align only that
  page's reg-sqs to that page's MasterKey.
- Lets the OCR pipeline run end-to-end on a single-page handwritten
  scan with no scan-side margin requirements.

**Recommendation**: Option A first (smaller scope, proves the physical
fix). Verify both reg-sq corners in PDF and ≥2 detectable on a
handwritten scan before considering Option B.

### Follow-ups gated on the blocker being resolved
- [ ] Re-render the official Class 2 fixture after the chosen fix.
- [ ] Re-capture the handwritten page 1 scan with the right scan
  settings (full resolution, include margin region, reg-sqs visible).
- [ ] Run full pipeline on the corrected scan; verify
  `meta.alignment_ok=True`, ≥1 region recognized, recognitions match
  expected answers (q1-r1-b3=3, q1-r1-b7=7, q1-r1-b8=8 on page 1).
- [ ] Run pipeline on each remaining page (2–6) and verify per-page
  cover of the other detect kinds
  (`handwritten_symbol`, `handwritten_digit_per_box`,
  `handwritten_digit_multi`, `drawn_or_written_shape`, `handwritten_text`,
  `circle_mark`).

---

## 6. The exact next implementation task

> **Choose Option A or Option B (pending user decision). Then implement
> that option end-to-end:**

### Next concrete steps for Option A (if chosen)
1. In `mvp/public/worksheets/class2.html`, in `buildPdfBlobForSet`,
   locate the `blockEls` assembly (around line 1117-1120).
2. After computing `domBlocks` from `blockEls`, prepend a synthetic
   entry `{ top: 0, bottom: ws-header.top }` and append
   `{ top: ws-footer.bottom, bottom: canvas-px of fullCanvas.height }`.
3. Re-render one Class 2 PDF (run `regen_one_set.mjs`).
4. Re-render the 6 pages at 300 DPI (`render_pdf.py`).
5. Probe pixel-patches at all 4 corners of page 1 and page 6 (the
   helper pattern is in `inspect_corners.py` / `probe_59px.py`).
   Expected: page 1 has TL+TR 5×5 mm black squares; page 6 has BL+BR
   5×5 mm black squares; pages 2–5 unchanged.
6. Run the OCR pipeline against a high-resolution page-1 scan of
   the regenerated PDF (use synthetic handwritten test data or a
   real scan with margin region intact).
7. Report: detected 4 reg-sqs? homography succeeded? ≥1 region
   recognized? recognized answers match expected values?

### Next concrete steps for Option B (if chosen)
1. In `mvp/public/worksheets/class2.html`, change `buildMasterJSON` to
   emit one MasterKey per page (split `coords_mm` by physical page
   using the same `pages[]` slice boundaries used by `buildPdfBlobForSet`).
2. Update `mvp/output/class2_SET-00001_regen.{pdf,*.json}` to be one
   MasterKey per page.
3. In `mvp/ocr_service/regions.py`, extend `load_master_json` to accept
   a `page_index` and resolve per-page `registration_marks`.
4. In `mvp/ocr_service/pipeline.py`, accept a `page_index` and align
   only the scanned page against that page's regCoords.
5. Add a route in `server.py` (`POST /recognize?page=N`) or change
   the multipart contract.
6. Re-render fixture, re-scan page 1, run pipeline; expect
   `alignment_ok=True` and recognitions.

> **Do not proceed without an explicit "go" on Option A or Option B
> (or a different approach the user specifies). The current TODO is
> captured; this is the resume point.**
