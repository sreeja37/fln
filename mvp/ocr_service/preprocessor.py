"""Image preprocessing.

Single responsibility: take a BGR image as captured from a phone or scanner
and produce a clean binary image where black ink (registration squares,
printed text, handwritten marks) is the foreground (white = 255) and the
white page background is suppressed (black = 0).

The downstream consumer (aligner.find_registration_squares) expects this
binary shape. Anything we don't clean here leaks into contour detection —
typically as false-positive squares or merged markers.

Pipeline (all standard OpenCV, no models):
    BGR image
      -> grayscale
      -> Gaussian blur (5x5) to suppress scanner noise
      -> Otsu threshold with THRESH_BINARY_INV (ink -> 255, page -> 0)
      -> binary uint8 ndarray

We deliberately do NOT do:
    - Adaptive thresholding  (local neighbourhood darkness can erode reg-sq
      if a printed question block sits next to one)
    - Morphological open/close (kept as a future hook for noisy scans;
      Phase 1 Task 2 may add a small morphology pass if real scans need it)
    - Deskew (the homography in aligner.py absorbs rotation + perspective;
      pre-deskewing would double-correct)

The function is pure: same input -> same output, no global state, no I/O.
"""

from __future__ import annotations

import cv2
import numpy as np


def preprocess(image_bgr: np.ndarray) -> np.ndarray:
    """Convert a BGR image to a clean binary image for contour detection.

    Parameters
    ----------
    image_bgr : np.ndarray
        Input image as returned by cv2.imread / cv2.imdecode, shape (H, W, 3),
        dtype uint8, channel order BGR.

    Returns
    -------
    np.ndarray
        Binary image, shape (H, W), dtype uint8, values in {0, 255}.
        Foreground (ink) = 255. Background (paper) = 0.
    """
    if image_bgr is None:
        raise ValueError("preprocess: image_bgr is None")

    if image_bgr.ndim != 3 or image_bgr.shape[2] != 3:
        raise ValueError(
            f"preprocess: expected 3-channel BGR image, got shape {image_bgr.shape}"
        )

    # 1. Greyscale. Standard luminance-weighted conversion (OpenCV default).
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)

    # 2. Gaussian blur with a 5x5 kernel. Suppresses high-frequency scanner
    #    noise without blurring the 5 mm registration squares below the
    #    detection threshold.
    blurred = cv2.GaussianBlur(gray, (5, 5), sigmaX=0)

    # 3. Otsu threshold with THRESH_BINARY_INV.
    #    Otsu picks T automatically from the image histogram. Because our
    #    pages are mostly white with black ink, Otsu reliably finds a T
    #    around 100-150. We invert so ink is foreground (255) — that's
    #    what cv2.findContours with RETR_EXTERNAL expects.
    _threshold_value, binary = cv2.threshold(
        blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
    )

    return binary