# TENIX — AI-Assisted 3D Walkthrough Generator

Pipeline: 2D floor-plan image → preprocessing → structural extraction → JSON → 3D geometry → browser walkthrough.

## Architecture

```
Landing Page (web/index.html)
    ↓ upload image
FastAPI backend (backend/main.py)
    ↓
Phase 1  tenix/preprocessing.py + tenix/pipeline.py   (load → grayscale → denoise → binarize)
Phase 2  tenix/structure.py                           (walls / rooms / doors)
Phase 3  tenix/geometry.py                            (layout.json → OBJ)
    ↓
runtime/<session-id>/  (layout.json, tenix_floorplan.obj, gray.png, processed.png,
                        detection_overlay.png, report.json)
    ↓
3D Viewer (web/viewer.html?session=<session-id>)
```

The backend is a thin orchestration layer: it saves the upload, then calls the
existing `run_pipeline`, `extract_structure`, and `generate` functions exactly
as the CLI does. No detection or geometry algorithm was changed.

The original fixed `output/` directory (from the CLI workflow below) is never
written to by the API and still works as a fallback: opening the viewer with
no `?session=` parameter loads `output/layout.json` / `output/tenix_floorplan.obj`
as before.

## Installation

```bash
pip install -r requirements.txt
```

## 1. Backend startup (runtime upload workflow)

A single FastAPI server serves both the web app and the processing API on
port 8000 — do **not** also run `python -m http.server 8000` at the same time,
they'll conflict on the port.

```bash
python -m uvicorn backend.main:app --reload --port 8000
```

- Landing page: http://localhost:8000/web/
- Upload a PNG/JPG/JPEG floor plan (10 MB max) and click **Process Floor Plan**.
- On success the page shows live wall/room/door counts and a
  **Launch 3D Walkthrough** button that opens:
  `http://localhost:8000/web/viewer.html?session=<session-id>`

Each upload gets its own `runtime/<session-id>/` directory, so uploads never
overwrite each other or the fixed sample in `output/`.

## 2. Existing CLI workflow (unchanged)

```bash
python tools/make_sample_plan.py        # generate a test floor plan
python main.py data/sample_plan.png -o output
python -m tenix.structure data/sample_plan.png -o output
python -m tenix.geometry output/layout.json -o output
python -m pytest tests/ -v
```

## Layout
- `tenix/preprocessing.py` — Phase 1 image ops
- `tenix/pipeline.py` — Phase 1 orchestration + JSON report
- `tenix/structure.py` — Phase 2 wall/room/door extraction
- `tenix/geometry.py` — Phase 3 layout.json → OBJ
- `main.py` — Phase 1 CLI
- `backend/main.py` — FastAPI runtime upload API + static file server
- `tools/` — helper scripts
- `tests/` — pytest suite (Phase 1-3 + backend API tests)
- `runtime/` — per-session uploads and generated artifacts (git-ignored contents)

## Web Viewer (Phase 4)

The browser walkthrough reads a session's `layout.json` and
`tenix_floorplan.obj` from `runtime/<session-id>/`, or falls back to the fixed
`output/layout.json` / `output/tenix_floorplan.obj` sample when no session is
given. It must be served over HTTP (not opened as a local `file://` page),
which the FastAPI server above does automatically.

- Landing page: http://localhost:8000/web/
- 3D Walkthrough viewer (runtime session): http://localhost:8000/web/viewer.html?session=`<session-id>`
- 3D Walkthrough viewer (fixed sample fallback): http://localhost:8000/web/viewer.html

The landing page links to the viewer via its "Launch 3D Walkthrough" button and
its "Launch Viewer" nav link.

### Controls
- `W` / `S` — move forward / backward
- `A` / `D` — turn left / right
- Mouse — look (first-person mode)
- `1` / `2` / `3` — first-person / top-down / free-orbit camera
- `R` — reset position

