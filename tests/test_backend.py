"""Tests for backend/main.py: the runtime floor-plan upload API.

Uses FastAPI's TestClient against a temporary runtime directory so these
tests never touch the real project's runtime/ or output/ folders.
"""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """A TestClient wired to a throwaway runtime/ directory."""
    from backend import main as backend_main

    monkeypatch.setattr(backend_main, "RUNTIME_DIR", tmp_path / "runtime")
    backend_main.RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    return TestClient(backend_main.app)


@pytest.fixture(scope="module")
def sample_plan_bytes(tmp_path_factory):
    from tools.make_sample_plan import make_sample

    path = tmp_path_factory.mktemp("backend_data") / "sample_plan.png"
    make_sample(str(path))
    return path.read_bytes()


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_process_valid_image(client, sample_plan_bytes):
    r = client.post(
        "/api/process",
        files={"file": ("sample_plan.png", io.BytesIO(sample_plan_bytes), "image/png")},
    )
    assert r.status_code == 200

    body = r.json()
    assert body["success"] is True
    assert body["status"] == "completed"
    assert body["walls_detected"] > 0
    assert body["rooms_detected"] > 0
    assert len(body["session_id"]) == 32  # uuid4 hex
    assert body["session_id"] in body["layout_path"]
    assert body["session_id"] in body["obj_path"]


def test_process_rejects_non_image_extension(client):
    r = client.post(
        "/api/process",
        files={"file": ("notes.txt", io.BytesIO(b"hello"), "text/plain")},
    )
    assert r.status_code == 400
    assert "PNG" in r.json()["detail"]


def test_process_rejects_empty_file(client):
    r = client.post(
        "/api/process",
        files={"file": ("empty.png", io.BytesIO(b""), "image/png")},
    )
    assert r.status_code == 400
    assert "empty" in r.json()["detail"].lower()


def test_process_rejects_unreadable_image_without_traceback(client):
    r = client.post(
        "/api/process",
        files={"file": ("garbage.png", io.BytesIO(b"not a real png"), "image/png")},
    )
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert "Traceback" not in detail
    assert "unable to process" in detail.lower()


def test_process_creates_isolated_session_directory(client, sample_plan_bytes):
    from backend import main as backend_main

    r = client.post(
        "/api/process",
        files={"file": ("sample_plan.png", io.BytesIO(sample_plan_bytes), "image/png")},
    )
    session_id = r.json()["session_id"]
    session_dir = backend_main.RUNTIME_DIR / session_id

    assert session_dir.is_dir()
    assert (session_dir / "layout.json").exists()
    assert (session_dir / "tenix_floorplan.obj").exists()
    # session directory stays inside runtime/, never touching output/
    assert session_dir.parent == backend_main.RUNTIME_DIR
