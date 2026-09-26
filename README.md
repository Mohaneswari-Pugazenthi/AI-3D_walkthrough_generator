# TENIX — AI-Assisted 3D Walkthrough Generator

Pipeline: 2D floor-plan image → preprocessing → structural extraction → 3D geometry → browser-based interactive walkthrough.

TENIX has two ways to get a floor plan through that pipeline:

1. **CLI** — process a file on disk into the fixed `output/` folder (Phases 1–3 only).
2. **Web app** — upload an image at runtime through the browser; a FastAPI backend
   runs the same Phases 1–3 modules per-session and the result opens straight in
   the Phase 4 3D viewer.

It also ships a second, independent feature: the **Blueprint Navigator**, a
client-side 2D/3D pathfinding tool merged in from a separate project (see
[Blueprint Navigator](#blueprint-navigator-additional-feature) below).

## 1. Installation

```bash
pip install -r requirements.txt
```

This installs OpenCV/NumPy (Phases 1–3), FastAPI/Uvicorn (the web backend), and
pytest/httpx (tests). Python 3.10+ recommended.

## 2. Backend startup

```bash
python -m uvicorn backend.main:app --reload --port 8000
```

This single process serves the landing page, the 3D viewer, the runtime upload
API, and the Blueprint Navigator, all from `http://localhost:8000`:

| URL | What it is |
|---|---|
| http://localhost:8000/web/ | Landing page (upload a floor plan here) |
| http://localhost:8000/web/viewer.html | 3D viewer, fixed sample data |
| http://localhost:8000/web/viewer.html?session=`<id>` | 3D viewer for a runtime-uploaded floor plan |
| http://localhost:8000/navigator/ | Blueprint Navigator (see below) |
| `POST` http://localhost:8000/api/process | Upload endpoint (multipart `file` field) |

> Note: `python -m http.server 8000` (the old way of serving just `web/`) still
> works for browsing the fixed `output/` sample data, but it can't run on the
> same port as the FastAPI server at the same time, and it doesn't serve
> `/api/process` or `/navigator/`. Use the Uvicorn command above for the full app.

## 3. Runtime upload workflow

From http://localhost:8000/web/:

1. Drag & drop (or choose) a PNG/JPG/JPEG floor plan — up to 10 MB.
2. Click **Process Floor Plan**. The backend runs, in order, the existing
   `tenix.pipeline.run_pipeline` (Phase 1), `tenix.structure.extract_structure`
   (Phase 2), and `tenix.geometry.generate` (Phase 3) — unmodified — against a
   new `runtime/<session_id>/` directory, so the fixed `output/layout.json` /
   `output/tenix_floorplan.obj` sample data is never touched.
3. On success the page shows the detected wall/room/door counts and enables
   **Launch 3D Walkthrough**, which opens `viewer.html?session=<id>` — the
   viewer loads that session's own `layout.json`/`.obj` instead of the fixed
   sample.
4. On failure (corrupt image, wrong file type, etc.) the page shows a plain
   "Unable to process this floor plan" message — no Python tracebacks are ever
   sent to the browser.

## 4. Existing CLI workflow

Unchanged — still works exactly as before, independent of the web backend:

```bash
python tools/make_sample_plan.py        # generate a test floor plan
python main.py data/sample_plan.png -o output
python -m pytest tests/ -v
```

## 5. Project architecture

```
main.py                 CLI entry point (Phase 1 orchestration)
tenix/
  preprocessing.py       Phase 1 - load / grayscale / resize / binarize
  structure.py           Phase 2 - wall / room / door extraction -> layout.json
  geometry.py            Phase 3 - layout.json -> 3D OBJ geometry
  pipeline.py            Orchestrates Phase 1 for the CLI
backend/
  main.py                FastAPI app: POST /api/process (runs Phases 1-3 per
                          upload) + serves web/, output/, runtime/, navigator/
web/
  index.html              Landing page: upload widget, stats, pipeline diagram
  viewer.html             Phase 4 3D viewer (Three.js)
  app.js                  Viewer logic (movement, camera, collision, rendering)
  style.css / landing.css Viewer / landing page styles
navigator/                Blueprint Navigator (see below) - separate React app
output/                   Fixed sample Phase 1-3 output (CLI + viewer fallback)
runtime/<session_id>/     Per-upload generated output (gitignored)
tests/                    pytest suite (Phases 1-3 + backend)
```

## Blueprint Navigator (additional feature)

`navigator/` is a separate, self-contained project (originally
"blueprint-path-navigator") merged in as an **additional feature**, without
changing any of the files above. It's a client-side React app: upload a
floor-plan image (or load its built-in demo) and it detects rooms directly in
the browser (Canvas-based image analysis, no server calls), then runs A*
pathfinding between two rooms you pick and shows the route in an interactive
3D scene (react-three-fiber) or a 2D top-down view.

It's wired in as a single additive static-file mount in `backend/main.py`
(`/navigator` -> `navigator/dist/`) and one link in the landing page nav
("Blueprint Navigator"). Nothing in `tenix/`, `web/app.js`, `web/viewer.html`,
`web/style.css`, `output/`, or the existing `/api/process` route was changed
to add it.

**Build it once before starting the backend** (its `dist/` folder isn't
committed, since it's a regenerable build artifact):

```bash
cd navigator
npm install
npm run build:merged   # vite build --base=/navigator/ - required for subpath serving
cd ..
python -m uvicorn backend.main:app --reload --port 8000
```

Then open http://localhost:8000/navigator/.

If you skip the build step, everything else still starts up fine - the backend
just logs a warning and `/navigator/` 404s until you build it.

For local navigator-only development with hot reload (separate from the merged
backend), `cd navigator && npm run dev` still works as it did standalone,
serving on its own port (8080 per `navigator/vite.config.ts`).
