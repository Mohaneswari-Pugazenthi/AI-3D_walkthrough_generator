"""Phase 3: convert output/layout.json into simple 3D geometry (OBJ) for Unity import.

Run: python -m tenix.geometry output/layout.json -o output
"""

from __future__ import annotations

import json
import math
from pathlib import Path

DEFAULT_WALL_HEIGHT = 2.8      # meters
DEFAULT_WALL_THICKNESS = 0.2   # meters
DEFAULT_DOOR_HEIGHT = 2.0      # meters (lintel starts here)
DEFAULT_MAX_EXTENT = 15.0      # longest plan side maps to this many meters


def load_layout(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def px_to_m(x: float, y: float, w: int, h: int, s: float) -> tuple[float, float]:
    """Image px (Y down) -> plan meters (X right, Z down), centered on origin."""
    return (x - w / 2) * s, (y - h / 2) * s


def _box(p1, p2, thickness: float, y0: float, y1: float, tag: str) -> dict:
    """Axis-aligned-to-segment box between 2D points p1,p2 (meters), from y0 to y1."""
    dx, dy = p2[0] - p1[0], p2[1] - p1[1]
    length = math.hypot(dx, dy) or 1e-6
    nx, ny = -dy / length, dx / length  # unit normal
    t = thickness / 2
    base = [(p1[0] - nx * t, p1[1] - ny * t), (p1[0] + nx * t, p1[1] + ny * t),
            (p2[0] + nx * t, p2[1] + ny * t), (p2[0] - nx * t, p2[1] - ny * t)]
    verts = [(x, y0, z) for x, z in base] + [(x, y1, z) for x, z in base]
    return {"verts": verts, "tag": tag}


def _split_wall(p1, p2, doors: list[dict], w: int, h: int, s: float, thickness: float,
                wall_h: float, door_h: float) -> list[dict]:
    """Split a wall around door openings; openings get a lintel above door_h."""
    dx, dy = p2[0] - p1[0], p2[1] - p1[1]
    length = math.hypot(dx, dy)
    if length < 1e-6:
        return [_box(p1, p2, thickness, 0.0, wall_h, "wall")]
    ux, uy = dx / length, dy / length

    cuts = []  # (t_start, t_end) along the wall in meters
    for d in doors:
        cx, cy = px_to_m(d["position"][0], d["position"][1], w, h, s)
        tproj = (cx - p1[0]) * ux + (cy - p1[1]) * uy          # along-wall offset
        perp = abs(-(cx - p1[0]) * uy + (cy - p1[1]) * ux)      # distance from wall line
        if 0 <= tproj <= length and perp <= thickness:
            half = max(d["width_px"] * s / 2, 0.3)
            cuts.append((max(0.0, tproj - half), min(length, tproj + half)))
    cuts.sort()

    boxes, cursor = [], 0.0
    for t0, t1 in cuts:
        if t0 > cursor + 1e-3:  # solid piece before the opening
            boxes.append(_box((p1[0] + ux * cursor, p1[1] + uy * cursor),
                              (p1[0] + ux * t0, p1[1] + uy * t0), thickness, 0.0, wall_h, "wall"))
        boxes.append(_box((p1[0] + ux * t0, p1[1] + uy * t0),
                          (p1[0] + ux * t1, p1[1] + uy * t1), thickness, door_h, wall_h, "door_lintel"))
        cursor = t1
    if cursor < length - 1e-3:  # solid tail piece
        boxes.append(_box((p1[0] + ux * cursor, p1[1] + uy * cursor), p2, thickness, 0.0, wall_h, "wall"))
    return boxes


def _quad(p0, p1, p2, p3, y: float, tag: str) -> dict:
    return {"verts": [(p0[0], y, p0[1]), (p1[0], y, p1[1]), (p2[0], y, p2[1]), (p3[0], y, p3[1])],
            "tag": tag}


_FACES = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
_QUAD_FACE = [(1, 2, 3, 4)]


def write_obj(boxes: list[dict], path: Path) -> tuple[int, int]:
    v_lines, f_lines, offset = [], [], 0
    groups: dict[str, list[dict]] = {}
    for b in boxes:
        groups.setdefault(b["tag"], []).append(b)
    for tag, items in groups.items():
        v_lines.append(f"g {tag}")
        for b in items:
            for x, y, z in b["verts"]:
                v_lines.append(f"v {x:.3f} {y:.3f} {z:.3f}")
            faces = _QUAD_FACE if len(b["verts"]) == 4 else _FACES
            for face in faces:
                idx = " ".join(str(offset + i) for i in face)
                f_lines.append(f"f {idx}")
            offset += len(b["verts"])
    path.write_text("\n".join(v_lines + f_lines) + "\n", encoding="utf-8")
    n_verts = sum(len(b["verts"]) for b in boxes)
    n_faces = sum(len(_QUAD_FACE) if len(b["verts"]) == 4 else len(_FACES) for b in boxes)
    return n_verts, n_faces


def generate(layout: dict, output_dir: str = "output", wall_height: float = DEFAULT_WALL_HEIGHT,
             wall_thickness: float = DEFAULT_WALL_THICKNESS, door_height: float = DEFAULT_DOOR_HEIGHT,
             max_extent: float = DEFAULT_MAX_EXTENT) -> dict:
    w, h = layout["metadata"]["image_width"], layout["metadata"]["image_height"]
    s = max_extent / max(w, h)  # px -> meters

    boxes: list[dict] = []
    # floor
    hw, hh = w * s / 2, h * s / 2
    boxes.append(_quad((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh), 0.0, "floor"))
    # room floor patches (thin quads at 1cm to visualize boundaries)
    for room in layout["rooms"]:
        x, y, bw, bh = room["bbox"]
        x0, z0 = px_to_m(x, y, w, h, s)
        x1, z1 = px_to_m(x + bw, y + bh, w, h, s)
        boxes.append(_quad((x0, z0), (x1, z0), (x1, z1), (x0, z1), 0.01, "rooms"))
    # walls (with door openings where a door lies on a wall)
    doors_applied = 0
    for wall in layout["walls"]:
        p1 = px_to_m(*wall["start"], w, h, s)
        p2 = px_to_m(*wall["end"], w, h, s)
        before = len(boxes)
        boxes.extend(_split_wall(p1, p2, layout["doors"], w, h, s, wall_thickness, wall_height, door_height))
        doors_applied += any(b["tag"] == "door_lintel" for b in boxes[before:])

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    obj_path = out / "tenix_floorplan.obj"
    n_verts, n_faces = write_obj(boxes, obj_path)

    xs = [v[0] for b in boxes for v in b["verts"]]
    zs = [v[2] for b in boxes for v in b["verts"]]
    ys = [v[1] for b in boxes for v in b["verts"]]
    return {
        "obj_path": str(obj_path),
        "scale_m_per_px": round(s, 5),
        "vertices": n_verts,
        "faces": n_faces,
        "extents_m": {"x": round(max(xs) - min(xs), 2), "y": round(max(ys), 2),
                      "z": round(max(zs) - min(zs), 2)},
        "wall_pieces": sum(1 for b in boxes if b["tag"] == "wall"),
        "door_lintels": sum(1 for b in boxes if b["tag"] == "door_lintel"),
        "room_patches": len(layout["rooms"]),
        "doors_on_walls": doors_applied,
    }


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="TENIX Phase 3: layout.json -> OBJ")
    ap.add_argument("layout")
    ap.add_argument("-o", "--output", default="output")
    ap.add_argument("--wall-height", type=float, default=DEFAULT_WALL_HEIGHT)
    ap.add_argument("--wall-thickness", type=float, default=DEFAULT_WALL_THICKNESS)
    ap.add_argument("--door-height", type=float, default=DEFAULT_DOOR_HEIGHT)
    ap.add_argument("--max-extent", type=float, default=DEFAULT_MAX_EXTENT,
                    help="meters for the longest plan side (default 15)")
    args = ap.parse_args()

    report = generate(load_layout(args.layout), args.output, args.wall_height,
                      args.wall_thickness, args.door_height, args.max_extent)
    print(json.dumps(report, indent=2))
