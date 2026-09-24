"""Phase 1 pipeline: run preprocessing steps end-to-end and emit a JSON report."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import preprocessing as pp


def run_pipeline(input_path: str, output_dir: str = "output") -> dict:
    """Run Phase 1 on one image. Returns a report dict; writes images + report.json."""
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    img = pp.load_image(input_path)
    info = pp.validate_image(img)
    gray = pp.to_grayscale(img)
    gray, scale = pp.resize_cap(gray)
    binary = pp.preprocess(gray)

    gray_path = str(out_dir / "gray.png")
    binary_path = str(out_dir / "processed.png")
    pp.save_image(gray, gray_path)
    pp.save_image(binary, binary_path)

    report = {
        "input": str(input_path),
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "image": {**info, "scale_applied": round(scale, 4)},
        "binarization": {
            "method": "otsu+median_blur",
            "ink_coverage": round(float(np.count_nonzero(binary) / binary.size), 4),
        },
        "outputs": {"gray": gray_path, "binary": binary_path},
    }

    report_path = out_dir / "report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    report["report_path"] = str(report_path)
    return report


def print_report(report: dict) -> None:
    print(json.dumps(report, indent=2))
