from pathlib import Path

import numpy as np
import pytest

from curtain_server.imageio import load_working_image

SAMPLES = Path(__file__).resolve().parents[2] / "assets" / "samples"


@pytest.mark.model
def test_real_model_masks_match_working_image():
    from curtain_server.segmentation import Segmenter

    seg = Segmenter()
    wi = load_working_image(SAMPLES / "empty_corner.jpg")
    res = seg.run(wi.rgb)
    h, w = wi.rgb.shape[:2]
    assert res.class_map.shape == (h, w)
    for g, p in res.group_probs.items():
        assert p.shape == (h, w), g
    total = res.group_probs["surface"] + res.group_probs["limit"] + res.group_probs["occluder"]
    assert np.allclose(total, 1.0, atol=1e-3)
    labels = {res.id2label[i].strip() for i in np.unique(res.class_map)}
    assert {"wall", "windowpane", "floor"} <= labels
