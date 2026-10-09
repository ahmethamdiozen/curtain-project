import numpy as np

from curtain_server.shading import decode_shading, encode_shading, shading_map


def test_uniform_wall_is_one():
    rgb = np.full((240, 320, 3), 180, np.uint8)
    valid = np.ones((240, 320), bool)
    s = shading_map(rgb, valid)
    assert s.shape == (240, 320)
    assert np.allclose(s, 1.0, atol=0.02)


def test_dark_side_preserved_and_median_normalised():
    rgb = np.full((240, 320, 3), 200, np.uint8)
    rgb[:, :160] = 100  # left half in shadow
    s = shading_map(rgb, np.ones((240, 320), bool))
    assert s[:, :60].mean() < 0.75 < 0.95 < s[:, 260:].mean()
    assert np.all((s >= 0) & (s <= 2))


def test_invalid_regions_are_filled_from_wall():
    rgb = np.full((240, 320, 3), 150, np.uint8)
    rgb[80:160, 120:200] = 255  # bright window, excluded
    valid = np.ones((240, 320), bool)
    valid[80:160, 120:200] = False
    s = shading_map(rgb, valid)
    assert abs(s[120, 160] - 1.0) < 0.1


def test_encode_decode_roundtrip():
    s = np.linspace(0, 2, 256, dtype=np.float32).reshape(16, 16)
    back = decode_shading(encode_shading(s))
    assert np.abs(back - s).max() < 0.01


def test_bright_frame_ring_does_not_leak_into_filled_window():
    rgb = np.full((240, 320, 3), 120, np.uint8)
    rgb[70:170, 110:210] = 255  # bright window frame ring (classified as wall)
    rgb[80:160, 120:200] = 255  # window glass, excluded
    valid = np.ones((240, 320), bool)
    valid[80:160, 120:200] = False
    s = shading_map(rgb, valid)
    assert abs(s[120, 160] - 1.0) < 0.2
    assert abs(s[20, 20] - 1.0) < 0.05
