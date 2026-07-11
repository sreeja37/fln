"""FastAPI HTTP entry point for the OCR service.

Exposes:

    POST /recognize  - multipart/form-data, fields:
                          image     : UploadFile (the scanned sheet)
                          masterkey : UploadFile OR text (the MasterKey JSON)
                        Returns PipelineResult serialised as JSON.
    GET  /health     - returns {"status": "ok"} for liveness probes.

Independence
------------
This module does not import anything from `mvp.server` (the Node Express
app), from `mvp.evaluation_metrics`, or from any TypeScript file. The
Node backend treats this service as a black-box HTTP API.

The OCR service is intentionally a leaf — it has no opinion about how
its callers authenticate, log, or persist results.

Run locally:
    python -m mvp.ocr_service.server
    # or:
    uvicorn mvp.ocr_service.server:app --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import logging
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from . import pipeline
from .regions import load_master_json
from .ocr_schema import InvalidMasterKeyError

logger = logging.getLogger(__name__)

app = FastAPI(
    title="FLN OCR Service",
    version="0.1.0",
    description="Skeleton image-to-JSON recognition pipeline (Phase 1).",
)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe. No work done; safe to hit at high frequency."""
    return {"status": "ok"}


@app.post("/recognize")
async def recognize(
    image: UploadFile = File(..., description="Scanned sheet image (jpg/png/webp)."),
    masterkey: UploadFile | str = File(
        ...,
        description="MasterKey JSON. May be sent as a file part or as raw text in the same field.",
    ),
    dpi: int = Form(200, description="Output DPI for rectified crops."),
) -> dict[str, Any]:
    """Run the OCR pipeline on one scanned sheet.

    Returns
    -------
    JSON object mirroring `PipelineResult`:
        {
            "answers": { "<qid_full>": "<text>", ... },
            "meta":    { ... PipelineMeta fields ... },
            "errors":  [ "<warning>", ... ]
        }
    """
    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="image is empty")

    image_bgr = _decode_image_bgr(image_bytes)
    if image_bgr is None:
        raise HTTPException(
            status_code=400,
            detail="image_decode_failed: bytes could not be decoded as an image",
        )

    master_key = _load_masterkey_from_field(masterkey)

    result = pipeline.run_pipeline(
        image_bgr,
        master_key,
        dpi=dpi,
        image_path=image.filename or "<upload>",
    )

    # PipelineResult is a frozen dataclass; jsonable_encoder handles the
    # nested PipelineMeta dataclass and the dict[str, str] / list[str]
    # fields cleanly.
    from fastapi.encoders import jsonable_encoder

    return jsonable_encoder(result)


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _decode_image_bgr(image_bytes: bytes) -> np.ndarray | None:
    """Decode raw image bytes to a (H, W, 3) uint8 BGR ndarray.

    Uses cv2.imdecode with numpy buffer input so we never touch the
    filesystem. Returns None on decode failure.
    """
    buf = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    return img  # None on failure


def _load_masterkey_from_field(field: UploadFile | str) -> Any:
    """Accept the masterkey form field as either an UploadFile or raw text.

    Browsers typically send JSON files as `UploadFile`. Some clients send
    the JSON inline as a text field with the same name; we accept both.
    """
    if isinstance(field, str):
        text = field
    else:
        raw_bytes = field.file.read()  # type: ignore[union-attr]
        try:
            text = raw_bytes.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"masterkey_decode_failed: {exc}",
            ) from exc

    try:
        return load_master_json(text)
    except InvalidMasterKeyError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"invalid_masterkey: {exc}",
        ) from exc


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(
        "mvp.ocr_service.server:app",
        host="127.0.0.1",
        port=8000,
        reload=False,
    )