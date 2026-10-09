"""Phase 1: run segmentation on photos and visualise the masks.

Usage:
    python -m scripts.segment_visualize ../assets/samples/*.jpg --out ../out/segviz

For every image writes <out>/<name>/panel.jpg (original | classes | groups | window),
<out>/<name>/masks/<group>.png (soft masks, 0–255) and <out>/<name>/stats.json.
"""

from __future__ import annotations

import argparse
import colorsys
import json
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from curtain_server.groups import GROUPS
from curtain_server.imageio import load_working_image
from curtain_server.segmentation import MODEL_NAME, Segmenter

GROUP_COLORS = {
    "surface": (70, 130, 255),
    "limit": (140, 140, 140),
    "occluder": (255, 70, 70),
    "curtain": (255, 210, 0),
    "window": (0, 230, 230),
}
TILE_W = 720


def class_palette(n: int) -> np.ndarray:
    golden = 0.618033988749895
    return np.array(
        [[int(c * 255) for c in colorsys.hsv_to_rgb((i * golden) % 1.0, 0.65, 0.95)] for i in range(n)],
        dtype=np.uint8,
    )


def _font(size: int):
    for path in ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _label(tile: Image.Image, text: str) -> Image.Image:
    d = ImageDraw.Draw(tile)
    f = _font(20)
    d.rectangle((0, 0, tile.width, 30), fill=(0, 0, 0))
    d.text((8, 4), text, fill=(255, 255, 255), font=f)
    return tile


def _blend(rgb: np.ndarray, color_img: np.ndarray, alpha: float) -> np.ndarray:
    return (rgb.astype(np.float32) * (1 - alpha) + color_img.astype(np.float32) * alpha).astype(np.uint8)


def class_tile(rgb, class_map, id2label, palette):
    tile = Image.fromarray(_blend(rgb, palette[class_map], 0.65))
    ids, counts = np.unique(class_map, return_counts=True)
    order = np.argsort(-counts)[:10]
    d = ImageDraw.Draw(tile)
    f = _font(max(14, tile.width // 50))
    y = 40
    for i in order:
        cid, frac = int(ids[i]), counts[i] / class_map.size
        d.rectangle((8, y, 26, y + 18), fill=tuple(int(c) for c in palette[cid]), outline=(0, 0, 0))
        text = f"{id2label[cid].strip()} {frac * 100:.1f}%"
        d.text((32, y), text, fill=(0, 0, 0), font=f, stroke_width=3, stroke_fill=(255, 255, 255))
        y += 24
    return _label(tile, "ADE20K classes")


def group_tile(rgb, gp):
    base = np.stack([gp["surface"], gp["limit"], gp["occluder"]], axis=0).argmax(axis=0)
    color = np.zeros_like(rgb)
    for i, g in enumerate(("surface", "limit", "occluder")):
        color[base == i] = GROUP_COLORS[g]
    color[gp["curtain"] > 0.5] = GROUP_COLORS["curtain"]
    tile = Image.fromarray(_blend(rgb, color, 0.55))
    d = ImageDraw.Draw(tile)
    f = _font(max(14, tile.width // 50))
    for k, g in enumerate(("surface", "limit", "occluder", "curtain")):
        y = 40 + k * 24
        d.rectangle((8, y, 26, y + 18), fill=GROUP_COLORS[g], outline=(0, 0, 0))
        d.text((32, y), g, fill=(0, 0, 0), font=f, stroke_width=3, stroke_fill=(255, 255, 255))
    return _label(tile, "Groups: surface / limit / occluder / curtain")


def window_tile(rgb, window_prob):
    mask = (window_prob > 0.5).astype(np.uint8)
    out = _blend(rgb, np.full_like(rgb, GROUP_COLORS["window"]), 0.0)
    out[mask > 0] = _blend(out[mask > 0], np.full_like(out[mask > 0], GROUP_COLORS["window"]), 0.45)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)
    for i, c in enumerate(contours):
        cv2.drawContours(out, [c], -1, (255, 0, 255) if i == 0 else (0, 160, 160), 3)
    return _label(Image.fromarray(out), f"Window mask ({len(contours)} components)")


def make_panel(tiles: list[Image.Image]) -> Image.Image:
    w = TILE_W
    scaled = [t.resize((w, round(t.height * w / t.width)), Image.LANCZOS) for t in tiles]
    h = scaled[0].height
    panel = Image.new("RGB", (w * 2, h * 2), "white")
    for i, t in enumerate(scaled):
        panel.paste(t, ((i % 2) * w, (i // 2) * h))
    return panel


def process(path: Path, out_root: Path, seg: Segmenter, palette: np.ndarray) -> dict:
    t0 = time.perf_counter()
    wi = load_working_image(path)
    res = seg.run(wi.rgb)
    out = out_root / path.stem
    (out / "masks").mkdir(parents=True, exist_ok=True)
    for g in GROUPS:
        Image.fromarray((res.group_probs[g] * 255).round().astype(np.uint8)).save(out / "masks" / f"{g}.png")
    tiles = [
        _label(Image.fromarray(wi.rgb), f"{path.name} {wi.rgb.shape[1]}x{wi.rgb.shape[0]}"),
        class_tile(wi.rgb, res.class_map, res.id2label, palette),
        group_tile(wi.rgb, res.group_probs),
        window_tile(wi.rgb, res.group_probs["window"]),
    ]
    make_panel(tiles).save(out / "panel.jpg", quality=88)
    ids, counts = np.unique(res.class_map, return_counts=True)
    stats = {
        "image": str(path),
        "working_size": [int(wi.rgb.shape[1]), int(wi.rgb.shape[0])],
        "orig_size": list(wi.orig_size),
        "focal_px": round(wi.focal_px, 1),
        "focal_source": wi.focal_source,
        "device": res.device,
        "model": seg.model_name,
        "inference_ms": round(res.inference_ms, 1),
        "total_ms": round((time.perf_counter() - t0) * 1000.0, 1),
        "group_frac": {g: round(float((res.group_probs[g] > 0.5).mean()), 4) for g in GROUPS},
        "classes": sorted(
            ({"label": res.id2label[int(i)].strip(), "frac": round(c / res.class_map.size, 4)}
             for i, c in zip(ids, counts)),
            key=lambda r: -r["frac"],
        ),
    }
    (out / "stats.json").write_text(json.dumps(stats, indent=2, ensure_ascii=False))
    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("images", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, default=Path("../out/segviz"))
    ap.add_argument("--model", default=MODEL_NAME)
    ap.add_argument("--device", default=None, help="cuda | mps | cpu (default: auto)")
    args = ap.parse_args()

    seg = Segmenter(args.model, args.device)
    palette = class_palette(len(seg.id2label))
    print(f"model={seg.model_name} device={seg.device}")
    for p in args.images:
        s = process(p, args.out, seg, palette)
        top = ", ".join(f"{c['label']} {c['frac'] * 100:.0f}%" for c in s["classes"][:5])
        print(f"{p.name}: {s['inference_ms']:.0f} ms inference, {s['total_ms']:.0f} ms total | {top}")
    print(f"→ {args.out.resolve()}")


if __name__ == "__main__":
    main()
