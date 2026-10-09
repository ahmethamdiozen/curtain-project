"""Precompute scene packages for the sample photos (static GitHub Pages demo).

Writes <out>/<stem>.json (same format as POST /api/analyze) and <out>/index.json (sample file names).
Usage: python -m scripts.export_demo [../assets/samples/*.jpg] [--out ../assets/demo]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from curtain_server.analyze import SegmenterLike, analyze

ROOT = Path(__file__).resolve().parents[2]


def export_demo(images: list[Path], out: Path, segmenter: SegmenterLike) -> None:
    out.mkdir(parents=True, exist_ok=True)
    names = []
    for path in sorted(images, key=lambda p: p.name):
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
    export_demo(images, args.out, Segmenter())


if __name__ == "__main__":
    main()
