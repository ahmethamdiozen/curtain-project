import base64
import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from curtain_server import api
from curtain_server.groups import GROUPS
from curtain_server.segmentation import SegResult


class FakeSegmenter:
    model_name = "fake"
    device = "cpu"

    def __init__(self, with_window=True):
        self.with_window = with_window

    def run(self, rgb):
        h, w = rgb.shape[:2]
        gp = {g: np.zeros((h, w), np.float32) for g in GROUPS}
        gp["surface"][:] = 1.0
        gp["limit"][int(h * 0.85):] = 1.0
        gp["surface"][int(h * 0.85):] = 0.0
        if self.with_window:
            gp["window"][int(h * .2):int(h * .6), int(w * .3):int(w * .7)] = 1.0
        gp["occluder"][int(h * .6):int(h * .85), :int(w * .4)] = 1.0
        gp["surface"][int(h * .6):int(h * .85), :int(w * .4)] = 0.0
        return SegResult(np.zeros((h, w), np.int16), gp, {0: "wall"}, 1.0, "cpu")


def _png(w=400, h=300):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (200, 190, 180)).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def client():
    api.app.dependency_overrides[api.get_segmenter] = lambda: FakeSegmenter()
    yield TestClient(api.app)
    api.app.dependency_overrides.clear()


def test_analyze_returns_scene_package(client):
    r = client.post("/api/analyze", files={"file": ("room.png", _png(), "image/png")})
    assert r.status_code == 200, r.text
    d = r.json()
    assert (d["width"], d["height"]) == (400, 300)
    assert d["image"].startswith("data:image/jpeg;base64,")
    assert set(d["masks"]) == {"occluder", "limit", "window", "surface", "curtain"}
    occ = Image.open(io.BytesIO(base64.b64decode(d["masks"]["occluder"].split(",", 1)[1])))
    assert occ.size == (400, 300) and occ.mode == "L"
    assert d["shading"].startswith("data:image/png;base64,")
    win = d["windows"][0]
    assert len(win["corners"]) == 4 and not win["fallback"]
    assert abs(win["corners"][0][0] - 120) <= 3 and abs(win["corners"][0][1] - 60) <= 3
    assert d["focalSource"] == "default" and d["focalPx"] > 0
    assert "inference" in d["timingsMs"]


def test_no_window_gives_fallback_rectangle():
    api.app.dependency_overrides[api.get_segmenter] = lambda: FakeSegmenter(with_window=False)
    try:
        r = TestClient(api.app).post("/api/analyze", files={"file": ("r.png", _png(), "image/png")})
    finally:
        api.app.dependency_overrides.clear()
    d = r.json()
    assert r.status_code == 200
    assert len(d["windows"]) == 1 and d["windows"][0]["fallback"] is True


def test_bad_image_is_400(client):
    r = client.post("/api/analyze", files={"file": ("x.jpg", b"not an image", "image/jpeg")})
    assert r.status_code == 400
    assert "detail" in r.json()


def test_too_large_is_413(client, monkeypatch):
    monkeypatch.setattr(api, "MAX_UPLOAD_BYTES", 1000)
    r = client.post("/api/analyze", files={"file": ("big.png", _png(), "image/png")})
    assert r.status_code == 413


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["ok"] is True


class CurtainCoveredSegmenter(FakeSegmenter):
    """Window fully hidden behind an existing sheer curtain except a small patch."""

    def run(self, rgb):
        res = super().run(rgb)
        h, w = rgb.shape[:2]
        gp = res.group_probs
        gp["window"][:] = 0.0
        gp["window"][int(h * .3):int(h * .35), int(w * .45):int(w * .5)] = 1.0
        gp["curtain"][int(h * .1):int(h * .6), int(w * .2):int(w * .8)] = 1.0
        return res


def test_existing_curtain_area_used_for_corner_proposal():
    api.app.dependency_overrides[api.get_segmenter] = lambda: CurtainCoveredSegmenter()
    try:
        d = TestClient(api.app).post("/api/analyze", files={"file": ("r.png", _png(), "image/png")}).json()
    finally:
        api.app.dependency_overrides.clear()
    c = d["windows"][0]["corners"]
    assert abs(c[0][0] - 80) <= 4 and abs(c[2][0] - 320) <= 4  # spans the curtain, not the patch
    assert d["windows"][0]["source"] == "window+curtain"


class DarkTvSegmenter(FakeSegmenter):
    """A black TV (label 'mirror', surface group) must not darken the shading map."""

    def run(self, rgb):
        res = super().run(rgb)
        h, w = rgb.shape[:2]
        res.class_map[int(h * .1):int(h * .4), int(w * .75):int(w * .95)] = 1
        res.id2label = {0: "wall", 1: "mirror"}
        return res


def test_shading_uses_wall_class_only():
    from curtain_server.shading import decode_shading

    buf = io.BytesIO()
    im = Image.new("RGB", (400, 300), (200, 190, 180))
    im.paste((5, 5, 5), (300, 30, 380, 120))  # black TV on the wall
    im.save(buf, "PNG")
    api.app.dependency_overrides[api.get_segmenter] = lambda: DarkTvSegmenter()
    try:
        d = TestClient(api.app).post("/api/analyze", files={"file": ("r.png", buf.getvalue(), "image/png")}).json()
    finally:
        api.app.dependency_overrides.clear()
    s = decode_shading(base64.b64decode(d["shading"].split(",", 1)[1]))
    assert s[75, 340] > 0.8


class DrapedCurtainSegmenter(FakeSegmenter):
    """Existing drapes narrow toward the floor → trapezoid; proposal must keep upright outer edges."""

    def run(self, rgb):
        import cv2

        res = super().run(rgb)
        h, w = rgb.shape[:2]
        gp = res.group_probs
        gp["window"][:] = 0.0
        poly = np.array([[60, 30], [340, 30], [300, 250], [100, 250]], np.int32)
        cv2.fillPoly(gp["curtain"], [poly], 1.0)
        return res


def test_curtain_proposal_has_upright_outer_edges():
    api.app.dependency_overrides[api.get_segmenter] = lambda: DrapedCurtainSegmenter()
    try:
        d = TestClient(api.app).post("/api/analyze", files={"file": ("r.png", _png(), "image/png")}).json()
    finally:
        api.app.dependency_overrides.clear()
    tl, tr, br, bl = d["windows"][0]["corners"]
    assert abs(tl[0] - 60) <= 3 and abs(bl[0] - 60) <= 3
    assert abs(tr[0] - 340) <= 3 and abs(br[0] - 340) <= 3


def test_decompression_bomb_is_400(client, monkeypatch):
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1000)  # 400×300 = 120k px ≫ 2× limit → bomb error
    r = client.post("/api/analyze", files={"file": ("huge.png", _png(), "image/png")})
    assert r.status_code == 400
