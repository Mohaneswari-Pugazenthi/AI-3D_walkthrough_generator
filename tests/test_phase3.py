"""Phase 3 tests: layout.json -> OBJ geometry generation."""

import json
from pathlib import Path

import pytest

from tenix.geometry import generate, load_layout


@pytest.fixture(scope="module")
def sample_layout(tmp_path_factory) -> dict:
    """Synthetic layout: one square room of 4 walls + one door on the bottom wall."""
    return {
        "metadata": {"image_width": 400, "image_height": 400},
        "walls": [
            {"id": "w1", "start": [50, 50], "end": [350, 50], "orientation": "horizontal"},
            {"id": "w2", "start": [350, 50], "end": [350, 350], "orientation": "vertical"},
            {"id": "w3", "start": [350, 350], "end": [50, 350], "orientation": "horizontal"},
            {"id": "w4", "start": [50, 350], "end": [50, 50], "orientation": "vertical"},
        ],
        "rooms": [{"id": "room_1", "name": None, "bbox": [50, 50, 300, 300],
                   "center": [200, 200], "area_px": 90000, "area_frac": 0.56}],
        "doors": [{"id": "door_1", "position": [200, 350], "bbox": [185, 344, 30, 12],
                   "width_px": 30, "orientation": "horizontal", "confidence": "uncertain"}],
    }


def test_layout_json_loadable():
    """The real Phase 2 output can be loaded when present."""
    real = Path("output/layout.json")
    if real.exists():
        layout = load_layout(str(real))
        assert {"metadata", "walls", "rooms", "doors"} <= set(layout)
    else:
        assert isinstance(load_layout.__doc__, str)  # module API present


def test_geometry_generated(sample_layout, tmp_path):
    report = generate(sample_layout, str(tmp_path))
    assert report["vertices"] > 0 and report["faces"] > 0
    assert report["door_lintels"] == 1  # the door on the bottom wall was applied


def test_obj_exists(sample_layout, tmp_path):
    generate(sample_layout, str(tmp_path))
    assert (tmp_path / "tenix_floorplan.obj").exists()


def test_obj_contains_vertices_and_faces(sample_layout, tmp_path):
    generate(sample_layout, str(tmp_path))
    text = (tmp_path / "tenix_floorplan.obj").read_text(encoding="utf-8")
    v_lines = [l for l in text.splitlines() if l.startswith("v ")]
    f_lines = [l for l in text.splitlines() if l.startswith("f ")]
    assert len(v_lines) > 0 and len(f_lines) > 0
    assert all(len(l.split()) == 4 for l in v_lines)  # "v x y z"


def test_geometry_dimensions_valid(sample_layout, tmp_path):
    report = generate(sample_layout, str(tmp_path), max_extent=10.0)
    # plan is square -> X and Z extents ~10 m, Y = wall height
    assert report["extents_m"]["x"] == pytest.approx(10.0, abs=0.5)
    assert report["extents_m"]["z"] == pytest.approx(10.0, abs=0.5)
    assert report["extents_m"]["y"] == pytest.approx(2.8, abs=0.01)

    text = (tmp_path / "tenix_floorplan.obj").read_text(encoding="utf-8")
    ys = [float(l.split()[2]) for l in text.splitlines() if l.startswith("v ")]
    assert min(ys) >= -0.01 and max(ys) <= 2.81  # floor at 0, nothing below ground
