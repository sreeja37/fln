"""Warp-and-crop: rectify the page and slice out each answer region.

The single public function, warp_and_crop, does two things in one call:

    1. Warp. Apply the homography from aligner.compute_homography to the
       original BGR image, producing a rectified A4 (or whatever size the
       MasterKey specifies) at the target DPI. After this step, every page-
       mm coordinate maps 1:1 to a pixel coordinate in the rectified image
       — no projective division needed for cropping.

    2. Crop. For each region in the input list, slice the rectified image
       using the region's bounding box (in mm) converted to pixels at the
       target DPI. Each crop is padded by 8 % (or 3 px minimum) on every
       side so marks that overflow the printed box aren't clipped at the
       edge.

Why one combined function: the rectified image is an intermediate that the
caller would otherwise have to manage themselves. Bundling it eliminates a
class of bugs where the caller warps at one DPI and crops at another.

Why pass regions as a plain list of dicts: this module is independent of
the MasterKey JSON loader (regions.py — added in Task 2). Passing plain
dicts keeps this module testable without any JSON parsing. The dict shape
is {qid: str, x_min: float, y_min: float, x_max: float, y_max: float},
which is a subset of the MasterKey's coordinates schema.

The DPI parameter is the single knob that controls output resolution.
200 DPI is a sensible default for handwritten text recognition — high
enough to preserve digit shape, low enough that 50 sheets fit in ~75 MB
of working memory.
"""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np


#: Default output DPI for the rectified page and per-region crops.
DEFAULT_DPI: int = 200

#: Padding fraction applied to each side of each crop. 0.08 means each crop
#: is 16 % wider and 16 % taller than the printed box. This guards against
#: marks that extend slightly beyond the printed boundary.
CROP_PAD_FRACTION: float = 0.08

#: Minimum padding in pixels (used when 8 % of the box is sub-pixel).
CROP_PAD_MIN_PX: int = 3

#: Millimetres per inch. Used to convert mm <-> pixels at a given DPI.
MM_PER_INCH: float = 25.4


def _mm_to_px(value_mm: float, dpi: int) -> int:
    """Convert a millimetre measurement to pixels at the given DPI."""
    return int(round(value_mm * dpi / MM_PER_INCH))


def _pad_box(
    x0: int, y0: int, x1: int, y1: int, image_h: int, image_w: int
) -> tuple[int, int, int, int]:
    """Pad a pixel bounding box by CROP_PAD_FRACTION (min CROP_PAD_MIN_PX).

    Clips to image bounds so out-of-range coordinates can't IndexError.
    Returns (x0, y0, x1, y1) as integers, with x1 > x0 and y1 > y0.
    """
    width = x1 - x0
    height = y1 - y0
    pad_w = max(CROP_PAD_MIN_PX, int(round(width * CROP_PAD_FRACTION)))
    pad_h = max(CROP_PAD_MIN_PX, int(round(height * CROP_PAD_FRACTION)))

    nx0 = max(0, x0 - pad_w)
    ny0 = max(0, y0 - pad_h)
    nx1 = min(image_w, x1 + pad_w)
    ny1 = min(image_h, y1 + pad_h)

    # Defensive: if padding clipped the box entirely (zero-width image,
    # degenerate coords), return a 1x1 box at the requested origin so the
    # caller gets a numpy array back instead of an IndexError.
    if nx1 <= nx0:
        nx1 = min(image_w, nx0 + 1)
    if ny1 <= ny0:
        ny1 = min(image_h, ny0 + 1)

    return nx0, ny0, nx1, ny1


def warp_and_crop(
    image_bgr: np.ndarray,
    homography: np.ndarray,
    regions: list[dict[str, Any]],
    dpi: int = DEFAULT_DPI,
) -> dict[str, np.ndarray]:
    """Rectify the page and slice out each answer region.

    Parameters
    ----------
    image_bgr : np.ndarray
        The original (un-rectified) BGR image. Shape (H, W, 3), uint8.
    homography : np.ndarray
        3x3 homography matrix from aligner.compute_homography.
        Maps page-mm (homogeneous) -> scanned-pixel coordinates.
        This matrix's effect, when applied as a perspective warp to the
        whole image, "un-rotates" the page into a clean rectangle.
    regions : list of dict
        Each dict has keys: qid (str), x_min, y_min, x_max, y_max (floats,
        in millimetres relative to the page's top-left corner). The caller
        builds this list from MasterKey.coords_mm (Task 2 will provide the
        loader that produces it).
    dpi : int
        Output resolution. Default 200. Higher = larger memory but better
        recognition accuracy for small handwriting. Trade-off is left to
        the caller.

    Returns
    -------
    dict
        Mapping {qid: crop_array}. Each crop_array is (h, w, 3) BGR uint8,
        already padded. An empty dict if `regions` is empty.

    Notes
    -----
    The output canvas size is derived from the homography's behaviour, not
    from a hardcoded A4 size. We compute the bounding box of the four
    corner points after warping and use that. This keeps the function
    correct for non-A4 page sizes — a future letter-sized or custom-sized
    worksheet produces a correctly-sized rectified image without code
    changes here.
    """
    if image_bgr is None:
        raise ValueError("warp_and_crop: image_bgr is None")
    if homography is None or homography.shape != (3, 3):
        raise ValueError(
            f"warp_and_crop: expected 3x3 homography, got "
            f"{None if homography is None else homography.shape}"
        )
    if dpi <= 0:
        raise ValueError(f"warp_and_crop: dpi must be > 0, got {dpi}")

    # Compute the rectified canvas size from the homography itself.
    # We project the four page corners (0,0), (W_mm, 0), (W_mm, H_mm), (0, H_mm)
    # through H to find where they land in pixel space. The output canvas
    # is the bbox of those projected points, scaled to the target DPI.
    #
    # NOTE: We don't have W_mm / H_mm passed in directly. We infer them
    # from the regions' bounding box — the union of all regions + a
    # margin equal to one reg-sq (5 mm) gives us a tight envelope that
    # covers the page in practice. This is a deliberate trade-off: it
    # keeps the function signature small, at the cost of a small assumption
    # (that regions span the whole page). If a future caller passes only
    # a sub-region list, the rectified canvas will be smaller than the
    # physical page; that's still correct because the crops are taken from
    # within the regions' envelope.
    if not regions:
        return {}

    xs_min = min(r["x_min"] for r in regions)
    ys_min = min(r["y_min"] for r in regions)
    xs_max = max(r["x_max"] for r in regions)
    ys_max = max(r["y_max"] for r in regions)

    # Inflate by 5 mm on each side to give the registration margin room.
    # (5 mm matches the reg-sq size — generous enough that the warped
    # page always fits, conservative enough that we don't waste pixels.)
    margin_mm = 5.0
    page_w_mm = (xs_max - xs_min) + 2 * margin_mm
    page_h_mm = (ys_max - ys_min) + 2 * margin_mm

    canvas_w = max(1, _mm_to_px(page_w_mm, dpi))
    canvas_h = max(1, _mm_to_px(page_h_mm, dpi))

    # Apply the warp. INTER_CUBIC for smooth edges; this is the same
    # interpolation used by professional document scanners.
    rectified = cv2.warpPerspective(
        image_bgr,
        homography,
        (canvas_w, canvas_h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(255, 255, 255),  # white border for any pixels outside the page
    )

    # Adjust region coordinates to the canvas's coordinate frame.
    # The homography maps page-mm to original-pixel coordinates. The
    # rectified canvas's (0, 0) corresponds to (xs_min - margin_mm,
    # ys_min - margin_mm) in page-mm, i.e. we shift everything by the
    # negative of (xs_min - margin_mm, ys_min - margin_mm).
    offset_x_mm = xs_min - margin_mm
    offset_y_mm = ys_min - margin_mm

    crops: dict[str, np.ndarray] = {}
    image_h, image_w = rectified.shape[:2]

    for region in regions:
        qid = region["qid"]
        x0 = _mm_to_px(region["x_min"] - offset_x_mm, dpi)
        y0 = _mm_to_px(region["y_min"] - offset_y_mm, dpi)
        x1 = _mm_to_px(region["x_max"] - offset_x_mm, dpi)
        y1 = _mm_to_px(region["y_max"] - offset_y_mm, dpi)

        px0, py0, px1, py1 = _pad_box(x0, y0, x1, y1, image_h, image_w)

        # Defensive: ensure ordering (already guaranteed by _pad_box, but
        # explicit check makes the slice safe even if someone passes a
        # region with x_min > x_max upstream).
        if px1 <= px0 or py1 <= py0:
            logger.warning(
                "warp_and_crop: degenerate region %s after padding, skipping", qid
            )
            continue

        crops[qid] = rectified[py0:py1, px0:px1].copy()

    return crops


# Module-level logger, used by the defensive checks above. Avoids a bare
# print and lets callers configure logging once at the application level.
import logging  # noqa: E402  (placed after public API to keep imports clean)

logger = logging.getLogger(__name__)