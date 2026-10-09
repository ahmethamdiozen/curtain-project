"""Photo statistics the client uses to match a rendered curtain to the photo.

All luminances are linear (sRGB decoded); noiseSigma is in 8-bit sRGB units.
"""

from __future__ import annotations

import cv2
import numpy as np

_HP_SIGMA = 1.2
# std(n − G_σ*n) / std(n) for white noise and σ=1.2 → divide to recover the noise std.
_HP_GAIN = float(np.sqrt(1 - 2 / (2 * np.pi * _HP_SIGMA**2) + 1 / (4 * np.pi * _HP_SIGMA**2)))


def _linear(rgb: np.ndarray) -> np.ndarray:
    c = rgb.astype(np.float32) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def light_stats(rgb: np.ndarray, wall: np.ndarray, window: np.ndarray) -> dict:
    lin = _linear(rgb)
    lum = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    has_wall = int(wall.sum()) >= 50
    region = wall if has_wall else np.ones_like(wall)

    wall_rgb = lin[region].mean(axis=0)
    wall_lum = float(np.median(lum[region]))

    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    hp = gray - cv2.GaussianBlur(gray, (0, 0), _HP_SIGMA)
    inner = cv2.erode(region.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
    vals = hp[inner] if inner.sum() >= 50 else hp.ravel()
    mad = float(np.median(np.abs(vals - np.median(vals)))) * 1.4826
    noise = min(20.0, mad / _HP_GAIN)

    return {
        "wallRgb": [round(float(v), 5) for v in np.maximum(wall_rgb, 1e-4)],
        "wallLum": round(max(wall_lum, 1e-3), 5),
        "windowLum": round(float(np.median(lum[window])), 5) if window.sum() >= 50 else None,
        "blackLum": round(float(np.percentile(lum, 1)), 5),
        "whiteLum": round(float(np.percentile(lum, 99)), 5),
        "noiseSigma": round(noise, 3),
    }
