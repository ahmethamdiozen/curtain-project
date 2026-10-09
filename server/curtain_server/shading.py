"""Low-frequency wall illumination map S (median of wall = 1), applied multiplicatively in linear RGB."""

from __future__ import annotations

import io

import cv2
import numpy as np
from PIL import Image

S_MAX = 2.0
SATURATED_Y = 0.92  # blown-out pixels (lamps, sunlit frames) are not wall illumination


def _linear_luminance(rgb: np.ndarray) -> np.ndarray:
    c = rgb.astype(np.float32) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)


def _fill_normalized_convolution(y: np.ndarray, valid: np.ndarray, sigma: float) -> np.ndarray:
    """Smooth y over valid pixels and fill holes with the surrounding average, coarse to fine.

    Each level estimates G(y·v)/G(v); finer levels override coarser ones where they have enough
    valid support, so big holes get a broad average instead of propagated edge pixels.
    """
    v = valid.astype(np.float32)
    result = np.full_like(y, float(y[valid].mean()))
    for s in (sigma * 16, sigma * 8, sigma * 4, sigma * 2, sigma):
        num = cv2.GaussianBlur(y * v, (0, 0), s)
        den = cv2.GaussianBlur(v, (0, 0), s)
        est = num / np.maximum(den, 1e-6)
        weight = np.clip(den / 0.3, 0.0, 1.0)
        result = weight * est + (1.0 - weight) * result
    return result


def shading_map(rgb: np.ndarray, valid: np.ndarray, blur_frac: float = 0.015) -> np.ndarray:
    h, w = rgb.shape[:2]
    y = _linear_luminance(rgb)
    sw, sh = max(8, w // 8), max(8, h // 8)
    ys = cv2.resize(y, (sw, sh), interpolation=cv2.INTER_AREA)
    vs = cv2.resize(valid.astype(np.float32), (sw, sh), interpolation=cv2.INTER_AREA) > 0.99
    # Drop a margin around excluded regions: mixed edge pixels (window frames) leak light.
    vs = cv2.erode(vs.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & (ys < SATURATED_Y)
    if vs.sum() < max(4, 0.01 * vs.size):
        return np.ones((h, w), np.float32)
    sigma = max(1.0, blur_frac * max(h, w) / 8.0)
    smooth = _fill_normalized_convolution(ys, vs, sigma)
    up = cv2.resize(smooth, (w, h), interpolation=cv2.INTER_LINEAR)
    med = float(np.median(smooth[vs])) or 1.0
    return np.clip(up / med, 0.0, S_MAX).astype(np.float32)


def encode_shading(s: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(np.clip(s / S_MAX * 255.0, 0, 255).round().astype(np.uint8)).save(buf, "PNG")
    return buf.getvalue()


def decode_shading(png: bytes) -> np.ndarray:
    return np.asarray(Image.open(io.BytesIO(png)), np.float32) / 255.0 * S_MAX
