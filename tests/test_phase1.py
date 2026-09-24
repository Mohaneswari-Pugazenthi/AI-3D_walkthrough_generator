"""Phase 1 tests: preprocessing functions and end-to-end pipeline."""

import json

import cv2
import numpy as np
import pytest

from tenix import preprocessing as pp
from tenix.pipeline import run_pipeline
from tools.make_sample_plan import make_sample


@pytest.fixture(scope="module")
def sample_plan(tmp_path_factory):
    path = tmp_path_factory.mktemp("data") / "sample_plan.png"
    make_sample(str(path))
    return str(path)


def test_load_and_validate(sample_plan):
    img = pp.load_image(sample_plan)
    info = pp.validate_image(img)
    assert info == {"width": 800, "height": 800, "channels": 3}


def test_load_missing_file_raises():
    with pytest.raises(FileNotFoundError):
        pp.load_image("no_such_file.png")


def test_validate_rejects_tiny_image():
    with pytest.raises(ValueError):
        pp.validate_image(np.zeros((10, 10, 3), dtype=np.uint8))


def test_grayscale_and_preprocess(sample_plan):
    gray = pp.to_grayscale(pp.load_image(sample_plan))
    assert gray.ndim == 2
    binary = pp.preprocess(gray)
    assert binary.ndim == 2 and set(np.unique(binary)) <= {0, 255}
    coverage = np.count_nonzero(binary) / binary.size
    assert 0.01 < coverage < 0.5  # only walls/ink should be white


def test_resize_cap():
    small, scale = pp.resize_cap(np.zeros((3000, 1500), dtype=np.uint8), max_side=1000)
    assert max(small.shape) == 1000 and scale == pytest.approx(1000 / 3000)
    same, scale = pp.resize_cap(np.zeros((800, 600), dtype=np.uint8))
    assert same.shape == (800, 600) and scale == 1.0


def test_run_pipeline_end_to_end(sample_plan, tmp_path):
    out = tmp_path / "out"
    report = run_pipeline(sample_plan, str(out))

    assert (out / "gray.png").exists()
    assert (out / "processed.png").exists()
    saved = json.loads((out / "report.json").read_text(encoding="utf-8"))
    assert saved["image"]["width"] == 800
    assert saved["binarization"]["method"] == "otsu+median_blur"
    assert 0.01 < saved["binarization"]["ink_coverage"] < 0.5

    binary = cv2.imread(str(out / "processed.png"), cv2.IMREAD_GRAYSCALE)
    assert binary is not None and binary.shape == (800, 800)
