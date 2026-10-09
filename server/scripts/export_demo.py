"""Precompute scene packages for the sample photos (static GitHub Pages demo).

Writes <out>/<stem>.json (same format as POST /api/analyze) and <out>/index.json (sample file names).
Usage: python -m scripts.export_demo [../assets/samples/*.jpg] [--out ../assets/demo]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageOps

from curtain_server.analyze import SegmenterLike, analyze

ROOT = Path(__file__).resolve().parents[2]
THUMB_WIDTH = 320


def write_thumbnail(path: Path, thumbs: Path) -> None:
    """Small Lanczos-downscaled copy for the sample picker (full photos alias and weigh ~10 MB)."""
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    im = im.resize((THUMB_WIDTH, round(im.height * THUMB_WIDTH / im.width)), Image.LANCZOS)
    im.save(thumbs / path.name, "JPEG", quality=82, optimize=True)


def export_demo(images: list[Path], out: Path, segmenter: SegmenterLike, thumbs: Path | None = None) -> None:
    out.mkdir(parents=True, exist_ok=True)
    if thumbs:
        thumbs.mkdir(parents=True, exist_ok=True)
    names = []
    for path in sorted(images, key=lambda p: p.name):
        if thumbs:
            write_thumbnail(path, thumbs)
        scene = analyze(path.read_bytes(), segmenter)
        (out / f"{path.stem}.json").write_text(json.dumps(scene, separators=(",", ":")))
        names.append(path.name)
        print(f"{path.name}: {(out / f'{path.stem}.json').stat().st_size / 1e6:.2f} MB")
    (out / "index.json").write_text(json.dumps(names))


def main() -> None:
    from curtain_server.segmentation import Segmenter

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("images", nargs="*", type=Path)
    ap.add_argument("--out", type=Path, default=ROOT / "assets" / "demo")
    args = ap.parse_args()
    images = args.images or sorted((ROOT / "assets" / "samples").glob("*.jpg"))
    export_demo(images, args.out, Segmenter(), thumbs=ROOT / "assets" / "samples" / "thumbs")


if __name__ == "__main__":
    main()
