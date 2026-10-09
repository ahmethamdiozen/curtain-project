"""Photo → scene package (see spec §8)."""

from __future__ import annotations

import base64
import io
import time
from typing import Protocol

import numpy as np
from PIL import Image

from .groups import normalize_label
from .imageio import load_working_image
from .light import light_stats
from .segmentation import SegResult
from .shading import encode_shading, shading_map
from .windows import fallback_window, find_windows, upright_outer

MASK_NAMES = ("occluder", "limit", "window", "surface", "curtain")
EXISTING_CURTAIN_MIN_FRAC = 0.02
SHADING_LABELS = frozenset({"wall", "column"})


class SegmenterLike(Protocol):
    device: str

    def run(self, rgb: np.ndarray) -> SegResult: ...


def _data_url(data: bytes, mime: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(data).decode("ascii")


def _png_l(prob: np.ndarray) -> str:
    buf = io.BytesIO()
    Image.fromarray((np.clip(prob, 0, 1) * 255).round().astype(np.uint8), "L").save(buf, "PNG", optimize=False)
    return _data_url(buf.getvalue(), "image/png")


def _jpeg(rgb: np.ndarray) -> str:
    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, "JPEG", quality=90)
    return _data_url(buf.getvalue(), "image/jpeg")


def analyze(data: bytes, segmenter: SegmenterLike) -> dict:
    t0 = time.perf_counter()
    wi = load_working_image(data)  # raises PIL.UnidentifiedImageError on bad input
    res = segmenter.run(wi.rgb)
    gp = res.group_probs
    h, w = wi.rgb.shape[:2]

    curtain_frac = float((gp["curtain"] > 0.5).mean())
    # An existing curtain usually hides most of the window; the new curtain replaces it, so the
    # window+curtain area is the better proposal.
    if curtain_frac > EXISTING_CURTAIN_MIN_FRAC:
        proposal, source = np.maximum(gp["window"], gp["curtain"]), "window+curtain"
    else:
        proposal, source = gp["window"], "window"
    windows = [{"corners": upright_outer(win.corners) if source == "window+curtain" else win.corners,
                "areaFrac": win.area_frac, "fallback": False, "source": source}
               for win in find_windows(proposal)]
    if not windows:
        fb = fallback_window(w, h)
        windows = [{"corners": fb.corners, "areaFrac": 0.0, "fallback": True, "source": "fallback"}]

    # Illumination is estimated on bare wall only (paintings, TVs, doors have their own albedo).
    wall_ids = [i for i, label in res.id2label.items() if normalize_label(label) in SHADING_LABELS]
    valid = np.isin(res.class_map, wall_ids) & (gp["window"] < 0.5) & (gp["curtain"] < 0.5)
    shading = shading_map(wi.rgb, valid)
    light = light_stats(wi.rgb, valid, gp["window"] > 0.5)

    ids, counts = np.unique(res.class_map, return_counts=True)
    class_stats = sorted(
        ({"label": res.id2label.get(int(i), str(int(i))).strip(), "frac": round(float(c) / res.class_map.size, 4)}
         for i, c in zip(ids, counts)),
        key=lambda r: -r["frac"],
    )
    return {
        "width": w,
        "height": h,
        "image": _jpeg(wi.rgb),
        "masks": {name: _png_l(gp[name]) for name in MASK_NAMES},
        "shading": _data_url(encode_shading(shading), "image/png"),
        "windows": windows,
        "focalPx": round(wi.focal_px, 2),
        "focalSource": wi.focal_source,
        "classStats": [c for c in class_stats if c["frac"] >= 0.005][:15],
        "existingCurtainFrac": round(curtain_frac, 4),
        "light": light,
        "timingsMs": {"inference": round(res.inference_ms, 1),
                      "total": round((time.perf_counter() - t0) * 1000.0, 1)},
        "device": res.device,
    }
