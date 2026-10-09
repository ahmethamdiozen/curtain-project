"""Generate placeholder grayscale, tileable fabric textures into assets/fabrics/.

Textures are luminance detail maps with mean ≈ 0.5; color is applied in LAB by the renderer.
Usage: python -m scripts.gen_fabrics [--out ../assets/fabrics]
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

N = 512
rng = np.random.default_rng(7)
yy, xx = np.mgrid[0:N, 0:N] / N  # [0,1) torus coordinates → everything below tiles seamlessly


def periodic_noise(sigma_px: float, aniso: tuple[float, float] = (1.0, 1.0)) -> np.ndarray:
    """Gaussian-filtered white noise in the Fourier domain (periodic → tileable), unit std.

    aniso scales frequencies per axis: a large x factor makes the noise smooth along x (streaks).
    """
    white = rng.standard_normal((N, N))
    fy = np.fft.fftfreq(N)[:, None] * aniso[1]
    fx = np.fft.fftfreq(N)[None, :] * aniso[0]
    filt = np.exp(-2 * (np.pi * sigma_px) ** 2 * (fx**2 + fy**2))
    out = np.real(np.fft.ifft2(np.fft.fft2(white) * filt))
    return (out - out.mean()) / (out.std() + 1e-9)


def finish(t: np.ndarray, contrast: float) -> np.ndarray:
    t = (t - t.mean()) / (t.std() + 1e-9)
    return np.clip(0.5 + t * contrast, 0, 1)


def linen():
    rows = np.repeat(rng.standard_normal((N, 1)), N, axis=1)
    cols = np.repeat(rng.standard_normal((1, N)), N, axis=0)
    weave = np.cos(2 * np.pi * xx * 128) * np.cos(2 * np.pi * yy * 128)
    slub = periodic_noise(2, (1.0, 6.0))
    return finish(0.6 * rows + 0.6 * cols + 0.5 * weave + 0.5 * slub, 0.09)


def velvet():
    return finish(periodic_noise(18) + 0.3 * periodic_noise(4), 0.06)


def stripe():
    x = xx * 3  # 3 repeats per tile
    f = np.fmod(x, 1.0)
    band = np.where(f < 0.18, 1.0, np.where(f < 0.24, -0.4, np.where((f > 0.55) & (f < 0.6), 0.6, -0.2)))
    return finish(band + 0.15 * linen(), 0.16)


def damask():
    t = np.zeros((N, N))
    for cx, cy in [(0.25, 0.25), (0.75, 0.75)]:
        dx = (xx - cx + 0.5) % 1.0 - 0.5
        dy = (yy - cy + 0.5) % 1.0 - 0.5
        r = np.hypot(dx * 1.25, dy)
        th = np.arctan2(dy, dx)
        petals = 0.17 + 0.06 * np.cos(6 * th) + 0.025 * np.cos(12 * th)
        t += 1 / (1 + np.exp((r - petals) * 120))  # medallion
        t -= 0.6 / (1 + np.exp((r - 0.06) * 160))  # inner eye
        ring = np.exp(-(((r - 0.215 - 0.015 * np.cos(8 * th)) / 0.008) ** 2))
        t += 0.6 * ring
    return finish(t + 0.12 * linen(), 0.14)


def check():
    def bands(c):
        f = np.fmod(c * 2, 1.0)
        return np.where(f < 0.3, 1.0, 0.0) + np.where((f > 0.55) & (f < 0.62), 0.6, 0.0)

    return finish(bands(xx) + bands(yy) + 0.1 * linen(), 0.17)


def sheer():
    mesh = np.cos(2 * np.pi * xx * 170) + np.cos(2 * np.pi * yy * 170)
    return finish(mesh + 0.8 * periodic_noise(10), 0.05)


def wood():
    warp = periodic_noise(12, (4.0, 1.0))
    grain = np.sin(2 * np.pi * (yy * 9 + 0.25 * warp))
    fine = periodic_noise(1.2, (20.0, 1.0))
    return finish(grain + 0.6 * fine, 0.11)


def metal():
    return finish(periodic_noise(1.0, (40.0, 1.0)) + 0.3 * periodic_noise(30), 0.035)


TEXTURES = {"linen": linen, "velvet": velvet, "stripe": stripe, "damask": damask,
            "check": check, "sheer": sheer, "wood": wood, "metal": metal}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[2] / "assets" / "fabrics")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for name, fn in TEXTURES.items():
        img = (fn() * 255).round().astype(np.uint8)
        Image.fromarray(img, "L").save(args.out / f"{name}.png")
        print(f"{name}: mean {img.mean():.1f} std {img.std():.1f}")


if __name__ == "__main__":
    main()
