"""Phase 2: structural extraction (walls / rooms / doors) using OpenCV heuristics.

Run: python -m tenix.structure data/floorplan.png -o output
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from . import preprocessing as pp

FONT = cv2.FONT_HERSHEY_SIMPLEX
MIN_ROOM_AREA_FRAC = 0.01   # room must be >= 1% of image area
MAX_ROOM_AREA_FRAC = 0.60   # and < 60% (excludes the whole-plan blob)
MIN_WALL_LEN_FRAC = 0.10    # wall segment >= 10% of largest image side


# ---------------------------------------------------------------- walls
def extract_walls(binary: np.ndarray) -> list[dict]:
    """Walls via morphological direction opening + probabilistic Hough."""
    h, w = binary.shape
    min_len = int(MIN_WALL_LEN_FRAC * max(h, w))
    horiz = cv2.morphologyEx(binary, cv2.MORPH_OPEN,
                             cv2.getStructuringElement(cv2.MORPH_RECT, (15, 1)))
    vert = cv2.morphologyEx(binary, cv2.MORPH_OPEN,
                            cv2.getStructuringElement(cv2.MORPH_RECT, (1, 15)))
    lines = cv2.HoughLinesP(horiz | vert, 1, np.pi / 180, threshold=30,
                            minLineLength=min_len, maxLineGap=5)
    walls = []
    for i, (x1, y1, x2, y2) in enumerate(map(tuple, lines[:, 0])) if lines is not None else []:
        ang = float(np.degrees(np.arctan2(y2 - y1, x2 - x1)) % 180)
        orientation = "horizontal" if ang < 30 or ang > 150 else ("vertical" if 60 < ang < 120 else "diagonal")
        walls.append({
            "id": f"wall_{i + 1}",
            "start": [int(x1), int(y1)],
            "end": [int(x2), int(y2)],
            "length_px": round(float(np.hypot(x2 - x1, y2 - y1)), 1),
            "angle_deg": round(ang, 1),
            "orientation": orientation,
        })
    return walls


def close_door_gaps(binary: np.ndarray) -> tuple[np.ndarray, int]:
    """Morphological close sized to door widths; returns (closed_mask, max_door_px)."""
    h, w = binary.shape
    max_door = max(10, max(h, w) // 14)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2 * max_door + 1, 2 * max_door + 1))
    return cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel), max_door


# ---------------------------------------------------------------- rooms
def extract_rooms(binary: np.ndarray) -> list[dict]:
    """Rooms = enclosed floor regions. Door gaps are closed first so rooms
    separated by openings are not merged into one component."""
    h, w = binary.shape
    img_area = h * w
    closed, _ = close_door_gaps(binary)
    floor = cv2.bitwise_not(closed)  # floor/background becomes white
    n, labels, stats, cents = cv2.connectedComponentsWithStats(floor, 8)
    rooms = []
    for i in range(1, n):
        x, y, bw, bh, area = map(int, stats[i])
        is_background = bw > 0.9 * w and bh > 0.9 * h  # surrounding background blob
        if is_background or not (MIN_ROOM_AREA_FRAC * img_area <= area <= MAX_ROOM_AREA_FRAC * img_area):
            continue
        cx, cy = cents[i]
        rooms.append({
            "id": f"room_{len(rooms) + 1}",
            "name": None,  # no OCR; names not inferred (per spec)
            "bbox": [x, y, bw, bh],
            "center": [int(round(cx)), int(round(cy))],
            "area_px": area,
            "area_frac": round(area / img_area, 4),
        })
    rooms.sort(key=lambda r: -r["area_px"])
    for i, r in enumerate(rooms, 1):
        r["id"] = f"room_{i}"
    return rooms


# ---------------------------------------------------------------- doors
def extract_doors(binary: np.ndarray, max_doors: int = 15) -> list[dict]:
    """Doors = gaps the morphological closing fills in walls (heuristic, all 'uncertain')."""
    h, w = binary.shape
    closed, max_door = close_door_gaps(binary)
    gap_mask = cv2.bitwise_and(closed, cv2.bitwise_not(binary))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(gap_mask, 8)
    doors = []
    for i in range(1, n):
        x, y, bw, bh, area = map(int, stats[i])
        if x <= 1 or y <= 1 or x + bw >= w - 1 or y + bh >= h - 1:
            continue
        long_side, short_side = max(bw, bh), min(bw, bh)
        if area < 20 or long_side > max_door * 1.6 or short_side > max_door:
            continue
        cx, cy = x + bw // 2, y + bh // 2
        doors.append({
            "id": f"door_{len(doors) + 1}",
            "position": [cx, cy],
            "bbox": [x, y, bw, bh],
            "width_px": int(long_side),
            "orientation": "horizontal" if bw >= bh else "vertical",
            "confidence": "uncertain",
        })
    doors.sort(key=lambda d: -d["width_px"])
    for i, d in enumerate(doors[:max_doors], 1):
        d["id"] = f"door_{i}"
    return doors[:max_doors]


# ---------------------------------------------------------------- overlay + driver
def draw_overlay(img_bgr: np.ndarray, layout: dict) -> np.ndarray:
    overlay = img_bgr.copy()
    for wall in layout["walls"]:
        cv2.line(overlay, tuple(wall["start"]), tuple(wall["end"]), (0, 0, 255), 2)  # red walls
    for room in layout["rooms"]:
        x, y, bw, bh = room["bbox"]
        cv2.rectangle(overlay, (x, y), (x + bw, y + bh), (0, 255, 0), 2)  # green rooms
        cv2.putText(overlay, room["id"], (x + 4, y + 18), FONT, 0.45, (0, 180, 0), 1)
    for door in layout["doors"]:
        x, y, bw, bh = door["bbox"]
        cv2.rectangle(overlay, (x - 2, y - 2), (x + bw + 2, y + bh + 2), (255, 0, 0), 2)  # blue doors
    return overlay


def extract_structure(input_path: str, output_dir: str = "output") -> dict:
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    img = pp.load_image(input_path)
    info = pp.validate_image(img)
    gray = pp.to_grayscale(img)
    gray, _ = pp.resize_cap(gray)
    binary = pp.preprocess(gray)

    layout = {
        "metadata": {"image_width": info["width"], "image_height": info["height"]},
        "walls": extract_walls(binary),
        "rooms": extract_rooms(binary),
        "doors": extract_doors(binary),
    }

    layout_path = out / "layout.json"
    layout_path.write_text(json.dumps(layout, indent=2), encoding="utf-8")
    cv2.imwrite(str(out / "detection_overlay.png"), draw_overlay(img, layout))
    layout["layout_path"] = str(layout_path)
    return layout


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="TENIX Phase 2: structural extraction")
    ap.add_argument("image")
    ap.add_argument("-o", "--output", default="output")
    args = ap.parse_args()

    result = extract_structure(args.image, args.output)
    print(json.dumps({k: v for k, v in result.items() if k != "walls"}, indent=2))
    print(f"\nwalls: {len(result['walls'])}  rooms: {len(result['rooms'])}  doors: {len(result['doors'])}")
    print(f"OK: {result['layout_path']}")
