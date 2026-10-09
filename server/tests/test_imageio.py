import io

import numpy as np
from PIL import Image

from curtain_server.imageio import DEFAULT_FOCAL_35MM, load_working_image, model_input_size


def _jpeg(w, h, orientation=None, focal35=None):
    im = Image.new("RGB", (w, h))
    im.paste((255, 0, 0), (0, 0, w // 2, h))  # left half red
    exif = Image.Exif()
    if orientation:
        exif[0x0112] = orientation
    if focal35:
        exif.get_ifd(0x8769)[41989] = focal35
    buf = io.BytesIO()
    im.save(buf, "JPEG", exif=exif.tobytes())
    return buf.getvalue()


def test_exif_rotation_is_applied():
    wi = load_working_image(_jpeg(400, 200, orientation=6))
    assert wi.rgb.shape[:2] == (400, 200)  # rotated 90°: height 400, width 200
    # orientation 6 rotates clockwise for display: the red left half ends up on top
    assert wi.rgb[10, 100, 0] > 200 and wi.rgb[390, 100, 0] < 60


def test_downscale_keeps_aspect_and_caps_long_side():
    wi = load_working_image(_jpeg(4000, 3000), max_side=1280)
    assert wi.rgb.shape[:2] == (960, 1280)
    assert wi.orig_size == (4000, 3000)


def test_small_image_not_upscaled():
    wi = load_working_image(_jpeg(640, 480))
    assert wi.rgb.shape[:2] == (480, 640)


def test_focal_from_exif_35mm():
    wi = load_working_image(_jpeg(800, 600, focal35=52))
    diag = (800**2 + 600**2) ** 0.5
    assert wi.focal_source == "exif"
    assert abs(wi.focal_px - 52 / 43.27 * diag) < 1e-3


def test_focal_default_when_missing():
    wi = load_working_image(_jpeg(800, 600))
    assert wi.focal_source == "default"
    assert abs(wi.focal_px - DEFAULT_FOCAL_35MM / 43.27 * 1000) < 1e-3


def test_rgb_is_uint8_hwc():
    wi = load_working_image(_jpeg(64, 32))
    assert wi.rgb.dtype == np.uint8 and wi.rgb.shape == (32, 64, 3)


def test_model_input_size_short_side_640_multiple_of_32():
    assert model_input_size(960, 1280) == (640, 864)  # 853.3 → 864
    h, w = model_input_size(1280, 720)
    assert w == 640 and h % 32 == 0 and abs(h - 1138) <= 32


def test_model_input_size_caps_long_side():
    h, w = model_input_size(300, 3000)
    assert w <= 2048 and h % 32 == 0 and w % 32 == 0
