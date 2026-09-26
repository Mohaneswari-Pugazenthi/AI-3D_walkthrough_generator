"""Phase 1 preprocessing: load -> validate -> grayscale -> cap size -> denoise -> binarize."""

from __future__ import annotations

import cv2
import numpy as np

MAX_SIDE = 2000  # cap the largest dimension so later stages stay fast


def load_image(path: str) -> np.ndarray:
    """Load a floor-plan image from disk (BGR). Raises FileNotFoundError if unreadable."""
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        raise FileNotFoundError(f"Could not read image: {path}")
    return img


def validate_image(img: np.ndarray) -> dict:
    """Sanity-check an image; return basic info. Raises ValueError if unusable."""
    if img is None or img.size == 0:
        raise ValueError("Image is empty")
    h, w = img.shape[:2]
    if h < 64 or w < 64:
        raise ValueError(f"Image too small: {w}x{h} (minimum 64x64)")
    return {"width": int(w), "height": int(h), "channels": int(img.shape[2])}


def to_grayscale(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def resize_cap(img: np.ndarray, max_side: int = MAX_SIDE) -> tuple[np.ndarray, float]:
    """Downscale so the largest side is <= max_side. Returns (image, scale_factor)."""
    h, w = img.shape[:2]
    if max(h, w) <= max_side:
        return img, 1.0
    scale = max_side / max(h, w)
    img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return img, scale


def preprocess(gray: np.ndarray) -> np.ndarray:
    """Denoise + Otsu threshold. Ink/walls -> white (255), background -> black (0)."""
    blurred = cv2.medianBlur(gray, 5)
    _, binary = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return binary


def save_image(img: np.ndarray, path: str) -> None:
    if not cv2.imwrite(path, img):
        raise IOError(f"Failed to write image: {path}")
