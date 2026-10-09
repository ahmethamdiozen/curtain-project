from curtain_server.groups import GROUPS, group_index_lists, groups_of

ID2LABEL = {0: "wall", 1: "floor", 2: "windowpane", 3: "sofa", 4: "curtain", 5: "bed ",
            6: "sky", 7: "ceiling", 8: "blind", 9: "mystery object", 10: "radiator", 11: "rug"}


def test_wall_is_surface_only():
    assert groups_of("wall") == {"surface"}


def test_window_is_surface_and_window():
    assert groups_of("windowpane") == {"surface", "window"}
    assert groups_of("blind") == {"surface", "window"}


def test_floor_ceiling_rug_are_limit():
    assert groups_of("floor") == {"limit"}
    assert groups_of("ceiling") == {"limit"}
    assert groups_of("rug") == {"limit"}


def test_furniture_and_unknown_are_occluders():
    assert groups_of("sofa") == {"occluder"}
    assert groups_of("bed ") == {"occluder"}  # HF config has a trailing space
    assert groups_of("mystery object") == {"occluder"}


def test_existing_curtain_is_surface_and_curtain():
    assert groups_of("curtain") == {"surface", "curtain"}


def test_outdoor_view_through_window_is_surface():
    assert groups_of("sky") == {"surface"}
    assert groups_of("building") == {"surface"}


def test_wall_attached_objects_are_surface():
    assert groups_of("radiator") == {"surface"}
    assert groups_of("painting") == {"surface"}


def test_index_lists_partition_classes():
    idx = group_index_lists(ID2LABEL)
    assert set(idx) == set(GROUPS)
    base = idx["surface"] + idx["limit"] + idx["occluder"]
    assert sorted(base) == sorted(ID2LABEL)  # surface/limit/occluder partition every class
    assert idx["window"] == [2, 8]
    assert idx["curtain"] == [4]
    assert idx["occluder"] == [3, 5, 9]
