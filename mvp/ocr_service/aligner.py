"""Registration-marker detection and page-alignment homography.

Two public functions:

    find_registration_squares(binary)  ->  list[tuple[float, float]]
    compute_homography(detected, expected_mm)  ->  np.ndarray | None

The split is deliberate: detection is geometry (find contours in pixel
space), alignment is the math that links pixel space back to the page-mm
coordinate system exported in the MasterKey JSON.

EXPECTED-MM INPUT CONTRACT
--------------------------
We deliberately do NOT hardcode A4 (210x297) here. The expected coordinates
come from the caller — typically from MasterKey.registration_marks, which
captures the four corner squares exactly as they were rendered when the
worksheet was generated. This means the service works for any page size
that the worksheet generator emits (A4 today; potentially letter, legal,
or custom sizes later), without changing this file.

A small helper, default_expected_mm(), returns A4 corners as a fallback for
callers that don't (yet) have a MasterKey in hand. The pipeline will
prefer the MasterKey-derived values; this helper is for tests and for the
case where someone calls compute_homography from a REPL without a JSON.

DLT vs OpenCV findHomography
----------------------------
We use cv2.findHomography with method=cv2.LMEDS for the production path:
    - LMEDS (Least-Median-of-Squares) is robust to one bad point.
    - When the caller passes exactly 4 points (the normal case), LMEDS is
      equivalent to a clean DLT solve, but we get OpenCV's well-tested
      numeric path instead of re-implementing SVD.
For reference, the closed-form DLT is documented in a docstring below.
We don't ship the DLT path because the OpenCV one is faster and better
tested, and the prior constraint said "prefer OpenCV built-ins."

Sanity checks
-------------
compute_homography runs two safety checks before returning H:
    1. det(H) > 0  — orientation-preserving (a flipped scan means the
       caller sorted tl/tr/br/bl incorrectly).
    2. Re-projection RMS error <= 1.5 px (normalized).
If either fails, returns None. The pipeline treats None as "alignment failed"
and degrades gracefully (returns empty answers with meta.alignment_ok=False).
"""

from __future__ import annotations

import logging
from typing import Iterable

import cv2
import numpy as np

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Contour-filter tuning constants
# ---------------------------------------------------------------------------
# These govern which contours survive as candidate registration squares.
# They are intentionally tunable (and documented) so a noisy scan can be
# adapted without code changes by overriding at the module level in tests.

#: Minimum contour area in pixels. Below this, the contour is noise.
REG_SQ_MIN_AREA_PX: int = 50

#: Maximum contour area as a fraction of total image area. Above this, the
#: contour is the page background or a large shaded block, not a reg-sq.
REG_SQ_MAX_AREA_FRAC: float = 0.05

#: Aspect ratio bounds (min_w/h, max_w/h) for a "square" contour.
REG_SQ_ASPECT_MIN: float = 0.7
REG_SQ_ASPECT_MAX: float = 1.4

#: Minimum solidity (area / convex-hull area) for a filled square.
REG_SQ_MIN_SOLIDITY: float = 0.9

#: Minimum extent (area / bounding-box area) for a filled square.
REG_SQ_MIN_EXTENT: float = 0.9

#: Max normalized re-projection error (in pixels at unit scale) for H.
HOMOGRAPHY_MAX_REPROJ_ERROR: float = 1.5

#: A4 page dimensions as a fallback when no MasterKey is provided.
A4_WIDTH_MM: float = 210.0
A4_HEIGHT_MM: float = 297.0


def default_expected_mm() -> dict[str, tuple[float, float]]:
    """Return A4 corner coordinates as a sensible fallback.

    The pipeline normally reads these from MasterKey.registration_marks, so
    this helper is only used in tests and REPL experimentation. The returned
    dict uses the same keys (tl, tr, br, bl) and same value shape
    (x_min, y_min) bounding-box corner as the MasterKey.

    Each value is the top-left corner of the 5 mm registration square, in
    millimetres relative to the page's own top-left corner. (The full
    bounding box is (x_min, y_min) -> (x_min+5, y_min+5), but for homography
    we only need point correspondences, and using the top-left corner keeps
    us independent of the mark size.)
    """
    return {
        "tl": (0.0, 0.0),
        "tr": (A4_WIDTH_MM, 0.0),
        "br": (A4_WIDTH_MM, A4_HEIGHT_MM),
        "bl": (0.0, A4_HEIGHT_MM),
    }


def _bounding_box_aspect(bbox: tuple[float, float, float, float]) -> float:
    """Return width / height for an OpenCV bounding rect (x, y, w, h)."""
    _x, _y, w, h = bbox
    if h == 0:
        return float("inf")
    return w / h


def _is_candidate_square(contour: np.ndarray, image_area: int) -> bool:
    """Apply the four geometric filters (area, aspect, solidity, extent)."""
    area = cv2.contourArea(contour)
    if area < REG_SQ_MIN_AREA_PX:
        return False
    if area > REG_SQ_MAX_AREA_FRAC * image_area:
        return False

    bbox = cv2.boundingRect(contour)
    aspect = _bounding_box_aspect(bbox)
    if not (REG_SQ_ASPECT_MIN <= aspect <= REG_SQ_ASPECT_MAX):
        return False

    hull = cv2.convexHull(contour)
    hull_area = cv2.contourArea(hull)
    if hull_area <= 0:
        return False
    solidity = area / hull_area
    if solidity < REG_SQ_MIN_SOLIDITY:
        return False

    bbox_area = bbox[2] * bbox[3]
    if bbox_area <= 0:
        return False
    extent = area / bbox_area
    if extent < REG_SQ_MIN_EXTENT:
        return False

    return True


def _centroid(contour: np.ndarray) -> tuple[float, float]:
    """Sub-pixel centroid from image moments.

    More accurate than averaging the contour points because it weights by
    pixel intensity (every black pixel inside the contour contributes
    equally, not just the boundary).
    """
    moments = cv2.moments(contour)
    m00 = moments["m00"]
    if m00 == 0:
        # Degenerate — fall back to bounding-box centre.
        x, y, w, h = cv2.boundingRect(contour)
        return (x + w / 2.0, y + h / 2.0)
    cx = moments["m10"] / m00
    cy = moments["m01"] / m00
    return (float(cx), float(cy))


def _sort_corners(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Sort four detected centroids into (tl, tr, br, bl) order.

    Strategy: rank by (cy, cx). Top two are top-row; bottom two are
    bottom-row. Within each row, smaller cx is the left point.

    This is robust for the typical case where rotation < 45 degrees. Heavier
    rotation is handled by the homography itself — at that point the points
    may still be in the right shape even if the labels flip, because the
    page is symmetric across the tl/br diagonal.
    """
    if len(points) != 4:
        return points  # caller will check len()

    sorted_by_cy = sorted(points, key=lambda p: (p[1], p[0]))
    top_two = sorted(sorted_by_cy[:2], key=lambda p: p[0])
    bottom_two = sorted(sorted_by_cy[2:], key=lambda p: p[0])
    tl, tr = top_two
    bl, br = bottom_two
    return [tl, tr, br, bl]


def find_registration_squares(binary: np.ndarray) -> list[tuple[float, float]]:
    """Detect the four registration-square centroids in a binary image.

    Parameters
    ----------
    binary : np.ndarray
        Output of preprocessor.preprocess — a (H, W) uint8 array where
        ink is 255 and page background is 0.

    Returns
    -------
    list of (cx, cy) tuples
        In pixel space, ordered as [tl, tr, br, bl]. Empty list if fewer
        than 4 candidate squares are found.
    """
    if binary is None or binary.ndim != 2:
        raise ValueError(
            f"find_registration_squares: expected 2-D binary image, "
            f"got shape {None if binary is None else binary.shape}"
        )

    image_area = binary.shape[0] * binary.shape[1]
    contours, _hierarchy = cv2.findContours(
        binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )

    candidates: list[tuple[float, float]] = []
    for contour in contours:
        if _is_candidate_square(contour, image_area):
            candidates.append(_centroid(contour))

    if len(candidates) < 4:
        logger.warning(
            "find_registration_squares: expected 4 candidate reg-sq, found %d",
            len(candidates),
        )
        return []

    # If more than 4 survive (rare), keep the four largest by area.
    if len(candidates) > 4:
        # We re-walk contours to keep area ordering; centroids are already
        # aligned by construction (we appended in contour-iteration order).
        areas: list[tuple[float, tuple[float, float]]] = []
        for contour in contours:
            if _is_candidate_square(contour, image_area):
                areas.append((cv2.contourArea(contour), _centroid(contour)))
        areas.sort(key=lambda a: a[0], reverse=True)
        candidates = [c for _area, c in areas[:4]]

    return _sort_corners(candidates)


def compute_homography(
    detected: Iterable[tuple[float, float]],
    expected_mm: dict[str, tuple[float, float]],
) -> np.ndarray | None:
    """Solve for the 3x3 homography that maps page-mm -> scanned pixels.

    Parameters
    ----------
    detected : iterable of (x, y)
        Four pixel-space centroids as returned by find_registration_squares,
        in (tl, tr, br, bl) order.
    expected_mm : dict
        Four page-mm coordinates keyed by 'tl', 'tr', 'br', 'bl'. Normally
        derived from MasterKey.registration_marks — see default_expected_mm
        for the A4 fallback shape.

    Returns
    -------
    np.ndarray, shape (3, 3), dtype float64
        The homography. Multiply a homogeneous page-mm point by this matrix
        to get scanned-pixel coordinates (after the standard projective
        divide by w).
        Returns None if the input is invalid or the sanity checks fail.
    """
    detected_list = list(detected)
    if len(detected_list) != 4:
        logger.warning(
            "compute_homography: expected 4 detected points, got %d",
            len(detected_list),
        )
        return None

    required_keys = ("tl", "tr", "br", "bl")
    if not all(k in expected_mm for k in required_keys):
        logger.warning(
            "compute_homography: expected_mm missing one of %s", required_keys
        )
        return None

    src = np.array(
        [expected_mm["tl"], expected_mm["tr"], expected_mm["br"], expected_mm["bl"]],
        dtype=np.float64,
    )
    dst = np.array(detected_list, dtype=np.float64)

    # cv2.findHomography with LMEDS is robust to one bad point. With exactly
    # 4 points, it reduces to a clean solve. For reference, the equivalent
    # closed-form DLT is:
    #
    #   For each (src_i, dst_i) pair, build the 2x9 matrix A_i:
    #       [ -X  -Y  -1   0   0   0   x*X  x*Y  x ]
    #       [  0   0   0  -X  -Y  -1   y*X  y*Y  y ]
    #   Stack 4 A_i vertically -> 8x9 A. Solve A*h = 0 by SVD; h is the
    #   column of V corresponding to the smallest singular value. Reshape
    #   to (3, 3).
    #
    # We use OpenCV's solver instead of re-implementing SVD inline. It is
    # faster, numerically better-conditioned, and widely battle-tested.
    H, _mask = cv2.findHomography(src, dst, method=cv2.LMEDS)

    if H is None:
        logger.warning("compute_homography: cv2.findHomography returned None")
        return None

    # Sanity check 1: orientation. det(H) must be positive for a scan that
    # preserves the page's orientation. A negative determinant means the
    # four detected points are clockwise instead of counter-clockwise (or
    # vice versa), which usually means the caller mis-sorted them.
    if np.linalg.det(H) <= 0:
        logger.warning(
            "compute_homography: det(H) = %.4f (must be > 0)", np.linalg.det(H)
        )
        return None

    # Sanity check 2: re-projection error. Apply H to each expected_mm point
    # and compare against the detected point. If RMS is too large, the
    # correspondences are wrong (a contour filter let a non-reg-sq through).
    projected = cv2.perspectiveTransform(
        src.reshape(-1, 1, 2), H
    ).reshape(-1, 2)
    errors = np.linalg.norm(projected - dst, axis=1)
    rms = float(np.sqrt(np.mean(errors ** 2)))
    if rms > HOMOGRAPHY_MAX_REPROJ_ERROR:
        logger.warning(
            "compute_homography: re-projection RMS = %.3f px exceeds %.3f",
            rms,
            HOMOGRAPHY_MAX_REPROJ_ERROR,
        )
        return None

    return H