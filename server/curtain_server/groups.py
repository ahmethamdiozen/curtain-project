"""ADE20K label → curtain-compositing group mapping.

Groups:
  surface   lies on/behind the wall plane; the curtain is drawn over it
  limit     the curtain stops here (floor, ceiling)
  occluder  everything else — stays in front of the curtain
  window    subset of surface used for corner detection
  curtain   subset of surface: an existing curtain (warning only)

surface, limit and occluder partition all classes. Occluder is defined by exclusion so that
objects we never thought about stay in front of the curtain. Always map by label name
(model.config.id2label), never by numeric class id.
"""

from __future__ import annotations

GROUPS = ("surface", "limit", "occluder", "window", "curtain")

WINDOW_LABELS = frozenset({"windowpane", "blind"})
CURTAIN_LABELS = frozenset({"curtain"})
LIMIT_LABELS = frozenset({"floor", "ceiling", "rug"})

# Things on the wall plane, plus what is seen *through* a window (the curtain covers the view).
SURFACE_LABELS = frozenset(
    WINDOW_LABELS
    | CURTAIN_LABELS
    | {
        "wall", "door", "screen door", "painting", "poster", "mirror", "radiator", "column",
        "sconce", "clock", "bulletin board",
        # outdoor view through the window
        "building", "sky", "tree", "road", "grass", "sidewalk", "earth", "mountain", "water",
        "house", "sea", "field", "fence", "rock", "sand", "skyscraper", "path", "river",
        "bridge", "hill", "palm", "tower", "streetlight", "awning", "pole", "land", "railing",
        "lake", "car", "bus", "truck", "van", "boat", "ship", "traffic light",
    }
)


def normalize_label(label: str) -> str:
    return label.strip().lower()


def groups_of(label: str) -> set[str]:
    name = normalize_label(label)
    if name in LIMIT_LABELS:
        return {"limit"}
    if name in SURFACE_LABELS:
        out = {"surface"}
        if name in WINDOW_LABELS:
            out.add("window")
        if name in CURTAIN_LABELS:
            out.add("curtain")
        return out
    return {"occluder"}


def group_index_lists(id2label: dict[int, str]) -> dict[str, list[int]]:
    out: dict[str, list[int]] = {g: [] for g in GROUPS}
    for idx in sorted(id2label):
        for g in groups_of(id2label[idx]):
            out[g].append(idx)
    return out
