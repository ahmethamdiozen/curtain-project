import numpy as np

from curtain_server.light import light_stats

rng = np.random.default_rng(0)


def _wall(h=240, w=320, color=(128, 128, 128), noise=0.0):
    img = np.empty((h, w, 3), np.float32)
    img[:] = color
    img += rng.normal(0, noise, (h, w, 1)) if noise else 0
    return np.clip(img, 0, 255).astype(np.uint8)


def test_noise_sigma_recovers_added_grain():
    rgb = _wall(noise=4.0)
    s = light_stats(rgb, np.ones(rgb.shape[:2], bool), np.zeros(rgb.shape[:2], bool))
    assert abs(s["noiseSigma"] - 4.0) < 0.6


def test_clean_wall_has_near_zero_noise():
    rgb = _wall()
    s = light_stats(rgb, np.ones(rgb.shape[:2], bool), np.zeros(rgb.shape[:2], bool))
    assert s["noiseSigma"] < 0.3


def test_wall_tint_and_luminance():
    rgb = _wall(color=(200, 180, 150))
    s = light_stats(rgb, np.ones(rgb.shape[:2], bool), np.zeros(rgb.shape[:2], bool))
    r, g, b = s["wallRgb"]
    assert r > g > b > 0
    assert 0.4 < s["wallLum"] < 0.5  # linear luminance of (200,180,150) ≈ 0.46


def test_window_luminance_and_extremes():
    rgb = _wall(color=(100, 100, 100))
    rgb[50:150, 100:200] = 250
    rgb[200:, :] = 5
    win = np.zeros(rgb.shape[:2], bool)
    win[50:150, 100:200] = True
    wall = ~win
    s = light_stats(rgb, wall, win)
    assert s["windowLum"] > 0.9
    assert s["blackLum"] < 0.01 and s["whiteLum"] > 0.9


def test_no_window_gives_none_and_no_wall_gives_defaults():
    rgb = _wall()
    s = light_stats(rgb, np.zeros(rgb.shape[:2], bool), np.zeros(rgb.shape[:2], bool))
    assert s["windowLum"] is None
    assert s["wallLum"] > 0 and len(s["wallRgb"]) == 3
