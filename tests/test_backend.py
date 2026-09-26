"""Backend tests: POST /api/process drives the existing Phase 1-3 modules end-to-end."""

import shutil

import pytest
from fastapi.testclient import TestClient

from backend.main import RUNTIME_DIR, app
from tools.make_sample_plan import make_sample

client = TestClient(app)


@pytest.fixture(scope="module")
def sample_plan_bytes(tmp_path_factory) -> bytes:
    path = tmp_path_factory.mktemp("backend_data") / "sample_plan.png"
    make_sample(str(path))
    return path.read_bytes()


def test_root_redirects_to_landing_page():
    response = client.get("/", follow_redirects=False)
    assert response.status_code in (302, 307)
    assert response.headers["location"] == "/web/"


def test_process_valid_image_returns_counts_and_files(sample_plan_bytes):
    response = client.post(
        "/api/process",
        files={"file": ("sample_plan.png", sample_plan_bytes, "image/png")},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True
    assert data["walls_detected"] > 0
    assert data["rooms_detected"] > 0
    assert "session_id" in data
    assert data["viewer_url"] == f"/web/viewer.html?session={data['session_id']}"
    assert data["status"] == "Walkthrough ready"

    session_dir = RUNTIME_DIR / data["session_id"]
    try:
        assert (session_dir / "layout.json").exists()
        assert (session_dir / "tenix_floorplan.obj").exists()
        assert (session_dir / "gray.png").exists()  # Phase 1 output preserved too
    finally:
        shutil.rmtree(session_dir, ignore_errors=True)


def test_runtime_layout_is_served_over_http(sample_plan_bytes):
    """The exact URL app.js will fetch for a session must resolve."""
    upload = client.post(
        "/api/process",
        files={"file": ("sample_plan.png", sample_plan_bytes, "image/png")},
    ).json()
    session_id = upload["session_id"]

    try:
        response = client.get(f"/runtime/{session_id}/layout.json")
        assert response.status_code == 200
        layout = response.json()
        assert {"metadata", "walls", "rooms", "doors"} <= set(layout)
    finally:
        shutil.rmtree(RUNTIME_DIR / session_id, ignore_errors=True)


def test_original_output_untouched_by_upload(sample_plan_bytes):
    """Processing an upload must never overwrite the fixed sample output/ files."""
    from pathlib import Path

    original = Path("output/layout.json")
    before = original.read_bytes() if original.exists() else None

    upload = client.post(
        "/api/process",
        files={"file": ("sample_plan.png", sample_plan_bytes, "image/png")},
    ).json()

    after = original.read_bytes() if original.exists() else None
    assert before == after

    shutil.rmtree(RUNTIME_DIR / upload["session_id"], ignore_errors=True)


def test_process_rejects_non_image_extension():
    response = client.post(
        "/api/process",
        files={"file": ("not_an_image.txt", b"hello world", "text/plain")},
    )
    assert response.status_code == 400
    data = response.json()
    assert data["success"] is False
    assert "error" in data
    assert "traceback" not in data["error"].lower()


def test_process_rejects_oversized_upload():
    huge = b"0" * (10 * 1024 * 1024 + 1)
    response = client.post(
        "/api/process",
        files={"file": ("big.png", huge, "image/png")},
    )
    assert response.status_code == 400
    assert response.json()["success"] is False


def test_process_rejects_empty_upload():
    response = client.post(
        "/api/process",
        files={"file": ("empty.png", b"", "image/png")},
    )
    assert response.status_code == 400
    assert response.json()["success"] is False


def test_process_rejects_corrupt_image_content():
    """Right extension/content-type, but bytes that don't decode as an image."""
    response = client.post(
        "/api/process",
        files={"file": ("broken.png", b"not a real png", "image/png")},
    )
    assert response.status_code == 422
    data = response.json()
    assert data["success"] is False
    assert "error" in data
