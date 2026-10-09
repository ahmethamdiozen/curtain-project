"""Image loading: EXIF orientation, working resolution, focal length estimate."""

from __future__ import annotations

import io
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

MAX_SIDE = 1280
DEFAULT_FOCAL_35MM = 26.0  # typical phone main camera
FULL_FRAME_DIAG_MM = 43.27
MODEL_SHORT_SIDE = 640
MODEL_MAX_LONG_SIDE = 2048

_EXIF_IFD = 0x8769
_FOCAL_35MM_TAG = 41989


@dataclass
class WorkingImage:
    rgb: np.ndarray  # H×W×3 uint8, EXIF-corrected, long side ≤ MAX_SIDE
    orig_size: tuple[int, int]  # (width, height) after EXIF transpose, before downscale
    focal_px: float  # focal length in working-image pixels
    focal_source: str  # "exif" | "default"


def _read_focal_35mm(im: Image.Image) -> float | None:
    try:
        value = im.getexif().get_ifd(_EXIF_IFD).get(_FOCAL_35MM_TAG)
    except Exception:
        return None
    if value is None:
        return None
    value = float(value)
    return value if 8.0 <= value <= 300.0 else None


def load_working_image(src: bytes | str | Path, max_side: int = MAX_SIDE) -> WorkingImage:
    if isinstance(src, (bytes, bytearray)):
        im = Image.open(io.BytesIO(src))
    else:
        im = Image.open(src)
    im.load()
    focal35 = _read_focal_35mm(im)
    im = ImageOps.exif_transpose(im).convert("RGB")
    orig_size = im.size
    scale = min(1.0, max_side / max(im.size))
    if scale < 1.0:
        size = (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
        im = im.resize(size, Image.LANCZOS)
    diag = math.hypot(im.width, im.height)
    source = "exif" if focal35 else "default"
    focal_px = (focal35 or DEFAULT_FOCAL_35MM) / FULL_FRAME_DIAG_MM * diag
    return WorkingImage(np.asarray(im, dtype=np.uint8).copy(), orig_size, focal_px, source)


def _round32(x: float) -> int:
    return max(32, int(round(x / 32.0)) * 32)


def model_input_size(h: int, w: int) -> tuple[int, int]:
    """Aspect-preserving model input size: short side 640, long side ≤ 2048, multiples of 32."""
    scale = MODEL_SHORT_SIDE / min(h, w)
    if max(h, w) * scale > MODEL_MAX_LONG_SIDE:
        scale = MODEL_MAX_LONG_SIDE / max(h, w)
    return _round32(h * scale), _round32(w * scale)
