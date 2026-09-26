# TENIX — AI-Assisted 3D Walkthrough Generator

Pipeline: 2D floor-plan image → preprocessing → structural extraction → JSON → 3D geometry → Unity walkthrough.

## Phase 1 (current)
Preprocessing only: load → validate → grayscale → resize cap → median blur + Otsu binarize → save + JSON report.

## Usage
```bash
pip install -r requirements.txt
python tools/make_sample_plan.py        # generate a test floor plan
python main.py data/sample_plan.png -o output
python -m pytest tests/ -v
```

## Layout
- `tenix/preprocessing.py` — image ops (swap in better models here later)
- `tenix/pipeline.py` — orchestration + JSON report
- `main.py` — CLI
- `tools/` — helper scripts
- `tests/` — pytest suite

## Web Viewer (Phase 4)
The browser walkthrough reads `output/layout.json` and `output/tenix_floorplan.obj`,
so it must be served from the project root (not opened as a local `file://` page):

```bash
python -m http.server 8000
```

- Landing page: http://localhost:8000/web/
- 3D Walkthrough viewer: http://localhost:8000/web/viewer.html

The landing page links to the viewer via its "Launch 3D Walkthrough" button and
its "Launch Viewer" nav link.
