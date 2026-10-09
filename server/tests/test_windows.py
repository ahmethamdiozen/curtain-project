import cv2
import numpy as np

from curtain_server.windows import find_windows, order_corners


def _quad_mask(h, w, pts):
    m = np.zeros((h, w), np.float32)
    cv2.fillPoly(m, [np.array(pts, np.int32)], 1.0)
    return m


def test_order_corners_tl_tr_br_bl():
    pts = np.array([[300, 210], [100, 50], [90, 220], [310, 40]], float)
    out = order_corners(pts)
    assert out.tolist() == [[100, 50], [310, 40], [300, 210], [90, 220]]


def test_perspective_quad_recovered():
    truth = [[220, 120], [520, 150], [510, 420], [230, 460]]
    m = _quad_mask(600, 800, truth)
    # add mullions (thin wall-colored bars inside the window) — must not break detection
    m[:, 365:372] = 0
    m[280:286, :] = 0
    wins = find_windows(m)
    assert len(wins) == 1
    got = np.array(wins[0].corners)
    assert np.abs(got - np.array(truth)).max() <= 4
    assert 0.1 < wins[0].area_frac < 0.25


def test_multiple_windows_sorted_by_area():
    m = _quad_mask(400, 800, [[50, 50], [200, 50], [200, 200], [50, 200]])
    m += _quad_mask(400, 800, [[400, 40], [750, 40], [750, 350], [400, 350]])
    wins = find_windows(m)
    assert len(wins) == 2
    assert wins[0].area_frac > wins[1].area_frac
    assert wins[0].corners[0][0] > 350  # big one is on the right


def test_tiny_blobs_ignored():
    m = _quad_mask(400, 400, [[10, 10], [14, 10], [14, 14], [10, 14]])
    assert find_windows(m) == []


def test_no_window_returns_empty():
    assert find_windows(np.zeros((300, 300), np.float32)) == []


def test_irregular_blob_still_gives_four_ordered_corners():
    m = np.zeros((400, 400), np.float32)
    cv2.circle(m, (200, 200), 100, 1.0, -1)
    wins = find_windows(m)
    c = np.array(wins[0].corners)
    assert c.shape == (4, 2)
    assert c[0][0] < c[1][0] and c[3][0] < c[2][0]  # left corners left of right corners
    assert c[0][1] < c[3][1] and c[1][1] < c[2][1]  # top corners above bottom corners


def test_partially_occluded_window_keeps_upright_edges():
    # upright window whose lower-left part is hidden behind a sofa back (diagonal cut)
    m = _quad_mask(600, 800, [[200, 100], [600, 100], [600, 400], [200, 400]])
    cv2.fillPoly(m, [np.array([[200, 250], [200, 400], [450, 400]], np.int32)], 0.0)
    c = np.array(find_windows(m)[0].corners)
    assert np.abs(c[0] - [200, 100]).max() <= 6  # TL
    assert np.abs(c[1] - [600, 100]).max() <= 6  # TR
    assert np.abs(c[2] - [600, 400]).max() <= 6  # BR
    assert abs(c[3][0] - c[0][0]) < 40  # left edge stays near-vertical


def test_window_cut_by_image_border_ranks_after_a_complete_one():
    # bigger window cut off at the right image edge vs. a smaller, fully visible one
    m = _quad_mask(400, 800, [[100, 100], [300, 100], [300, 300], [100, 300]])
    m += _quad_mask(400, 800, [[520, 60], [799, 60], [799, 360], [520, 360]])
    wins = find_windows(m)
    assert len(wins) == 2
    assert wins[0].corners[0][0] < 200  # the complete window comes first
    assert wins[1].area_frac > wins[0].area_frac


def test_pointed_arch_window_gets_upright_sides():
    # gothic window: rectangle with a pointed arch on top → hull narrows sharply toward the tip
    m = _quad_mask(600, 800, [[300, 250], [420, 250], [420, 460], [300, 460]])
    cv2.fillPoly(m, [np.array([[300, 250], [360, 150], [420, 250]], np.int32)], 1.0)
    c = np.array(find_windows(m)[0].corners)
    top_w, bottom_w = c[1][0] - c[0][0], c[2][0] - c[3][0]
    assert 0.75 < top_w / bottom_w < 1.33
    assert abs(c[0][0] - 300) <= 4 and abs(c[1][0] - 420) <= 4
