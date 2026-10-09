"""Window mask → 4-corner proposals (TL, TR, BR, BL in image pixels)."""

from __future__ import annotations

import math
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class Window:
    corners: list[list[float]]  # [[x, y]] × 4, order TL, TR, BR, BL
    area_frac: float  # quad area / image area


def order_corners(pts: np.ndarray) -> np.ndarray:
    """Order 4 points clockwise on screen (y down), starting at top-left."""
    pts = np.asarray(pts, dtype=np.float64).reshape(4, 2)
    c = pts.mean(axis=0)
    ang = np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0])
    pts = pts[np.argsort(ang)]
    start = int(np.argmin(pts[:, 0] + pts[:, 1]))
    return np.roll(pts, -start, axis=0)


def _diagonal_extremes(hull: np.ndarray) -> np.ndarray:
    p = hull.reshape(-1, 2).astype(np.float64)
    s, d = p[:, 0] + p[:, 1], p[:, 0] - p[:, 1]
    return np.array([p[np.argmin(s)], p[np.argmax(d)], p[np.argmax(s)], p[np.argmin(d)]])


def _fit_quad(hull: np.ndarray) -> np.ndarray:
    hull_area = cv2.contourArea(hull)
    peri = cv2.arcLength(hull, True)
    for eps in np.linspace(0.005, 0.1, 20):
        approx = cv2.approxPolyDP(hull, eps * peri, True)
        if len(approx) < 4:
            break
        if len(approx) == 4 and cv2.isContourConvex(approx) and cv2.contourArea(approx) >= 0.85 * hull_area:
            return approx.reshape(4, 2).astype(np.float64)
    return _diagonal_extremes(hull)


def find_windows(window_prob: np.ndarray, min_area_frac: float = 0.005, thresh: float = 0.5) -> list[Window]:
    mask = (window_prob > thresh).astype(np.uint8)
    h, w = mask.shape
    if not mask.any():
        return []
    diag = math.hypot(h, w)
    k = max(3, int(0.015 * diag)) | 1
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    # Group panes split by thick mullions/frames into one window.
    g = max(3, int(0.03 * diag)) | 1
    grouping = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_RECT, (g, g)))
    n, labels = cv2.connectedComponents(grouping, connectivity=8)
    out: list[Window] = []
    for i in range(1, n):
        comp = ((labels == i) & (mask > 0)).astype(np.uint8)
        if comp.sum() < min_area_frac * h * w:
            continue
        contours, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        hull = cv2.convexHull(np.vstack(contours))
        quad = order_corners(_fit_quad(hull))
        if not _plausible_widths(quad):
            quad = np.array(upright_outer(quad.tolist()))
        area = cv2.contourArea(quad.astype(np.float32)) / (h * w)
        out.append(Window([[round(float(x), 1), round(float(y), 1)] for x, y in quad], round(area, 4)))
    # A window cut off by the image border can't be measured properly: rank it after complete ones.
    def clipped(win: Window) -> bool:
        return any(x <= 2 or y <= 2 or x >= w - 3 or y >= h - 3 for x, y in win.corners)

    out.sort(key=lambda win: (clipped(win), -win.area_frac))
    return out


def upright_outer(corners: list[list[float]]) -> list[list[float]]:
    """Make the side edges vertical, pushed outward (TL,TR,BR,BL).

    Used for proposals derived from existing drapes, whose hull narrows toward the floor while the
    rod/frame above them is the true outer extent.
    """
    (tlx, tly), (trx, try_), (brx, bry), (blx, bly) = corners
    left, right = min(tlx, blx), max(trx, brx)
    return [[left, tly], [right, try_], [right, bry], [left, bly]]


def _plausible_widths(q: np.ndarray, lo: float = 0.75) -> bool:
    """Phone photos are taken roughly level: top and bottom edges of a window have similar lengths.

    A much narrower top usually comes from a non-rectangular outline (pointed/round arch), not from
    camera pitch.
    """
    top = float(np.linalg.norm(q[1] - q[0]))
    bottom = float(np.linalg.norm(q[2] - q[3]))
    r = top / bottom if bottom > 0 else 0.0
    return lo < r < 1 / lo


def fallback_window(w: int, h: int) -> Window:
    """Centered default rectangle when no window was detected (user adjusts it)."""
    x0, x1, y0, y1 = w * 0.32, w * 0.68, h * 0.18, h * 0.6
    return Window([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], 0.0)
