"""Phase 2 tests: wall/room/door extraction on a synthetic plan + end-to-end run."""

import json

import cv2
import numpy as np
import pytest

from tenix.structure import draw_overlay, extract_doors, extract_rooms, extract_structure, extract_walls


@pytest.fixture(scope="module")
def sample_plan(tmp_path_factory):
    from tools.make_sample_plan import make_sample
    path = tmp_path_factory.mktemp("data2") / "sample_plan.png"
    make_sample(str(path))
    return str(path)


def synthetic_plan(size: int = 400, t: int = 6) -> np.ndarray:
    """Outer walls + one interior vertical wall with a 30px door gap. Ink = white."""
    img = np.zeros((size, size), dtype=np.uint8)
    cv2.rectangle(img, (20, 20), (size - 20, size - 20), 255, t)
    cv2.line(img, (size // 2, 20), (size // 2, size // 2 - 15), 255, t)   # upper half
    cv2.line(img, (size // 2, size // 2 + 15), (size // 2, size - 20), 255, t)  # lower half
    return img


def test_extract_walls_synthetic():
    walls = extract_walls(synthetic_plan())
    assert len(walls) >= 3
    assert all({"id", "start", "end", "length_px", "orientation"} <= set(w) for w in walls)


def test_extract_rooms_synthetic():
    rooms = extract_rooms(synthetic_plan())
    assert len(rooms) == 2  # left and right chamber
    assert all(r["name"] is None and r["id"] in ("room_1", "room_2") for r in rooms)


def test_extract_doors_synthetic():
    doors = extract_doors(synthetic_plan())
    assert len(doors) >= 1
    assert doors[0]["confidence"] == "uncertain"
    assert doors[0]["orientation"] == "vertical"


def test_extract_structure_end_to_end(sample_plan, tmp_path):
    result = extract_structure(sample_plan, str(tmp_path / "out"))
    assert result["metadata"]["image_width"] == 800
    assert len(result["walls"]) > 0 and len(result["rooms"]) > 0

    saved = json.loads((tmp_path / "out" / "layout.json").read_text(encoding="utf-8"))
    assert set(saved) == {"metadata", "walls", "rooms", "doors"}
    assert (tmp_path / "out" / "detection_overlay.png").exists()

    overlay = draw_overlay(np.zeros((100, 100, 3), dtype=np.uint8),
                           {"walls": [], "rooms": [], "doors": []})
    assert overlay.shape == (100, 100, 3)
