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
