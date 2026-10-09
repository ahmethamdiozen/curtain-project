import io
import json

from PIL import Image

from scripts.export_demo import export_demo
from tests.test_api import FakeSegmenter


def test_export_writes_index_and_scene_packages(tmp_path):
    src = tmp_path / "samples"
    src.mkdir()
    for name in ("b.jpg", "a.jpg"):
        Image.new("RGB", (320, 240), (180, 170, 160)).save(src / name)
    out = tmp_path / "demo"
    export_demo(sorted(src.glob("*.jpg")), out, FakeSegmenter())
    index = json.loads((out / "index.json").read_text())
    assert index == ["a.jpg", "b.jpg"]
    scene = json.loads((out / "a.json").read_text())
    assert scene["width"] == 320 and scene["windows"][0]["corners"]
    assert set(scene["masks"]) == {"occluder", "limit", "window", "surface", "curtain"}
