"""TENIX backend: FastAPI orchestration around the existing Phase 1-3 tenix modules.

Serves the web/ static site, the legacy fixed output/ sample, and a runtime
POST /api/process endpoint that accepts an uploaded floor-plan image, runs the
existing preprocessing -> structure extraction -> geometry generation chain,
and returns a session id the 3D viewer can load at runtime.

Run:
    python -m uvicorn backend.main:app --reload --port 8000

Then open:
    http://localhost:8000/web/
"""

from __future__ import annotations

import logging
import shutil
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from tenix.geometry import generate as generate_geometry
from tenix.geometry import load_layout
from tenix.pipeline import run_pipeline
from tenix.structure import extract_structure

logger = logging.getLogger("tenix.backend")

# ---------------------------------------------------------------- paths
ROOT_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT_DIR / "web"
OUTPUT_DIR = ROOT_DIR / "output"      # fixed Phase 1-4 sample output (never written by the API)
RUNTIME_DIR = ROOT_DIR / "runtime"    # per-session uploads + generated artifacts
RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------- config
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg"}

app = FastAPI(title="TENIX API", version="1.0.0")


@app.get("/")
def root() -> RedirectResponse:
    """Convenience redirect so http://localhost:8000/ opens the landing page."""
    return RedirectResponse(url="/web/")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


# ---------------------------------------------------------------- helpers
def _resolve_extension(upload: UploadFile) -> str:
    """Determine a safe, allow-listed extension for the upload.

    The original filename is used only to sniff an extension - it is never
    used to build a filesystem path, so there is nothing to path-traverse
    or execute.
    """
    suffix = Path(upload.filename or "").suffix.lower()
    content_type = (upload.content_type or "").lower()

    if suffix in {".jpg", ".jpeg"} or content_type == "image/jpeg":
        return ".jpg"
    if suffix == ".png" or content_type == "image/png":
        return ".png"

    raise HTTPException(status_code=400, detail="Only PNG, JPG, and JPEG images are supported.")


def _new_session_dir() -> tuple[str, Path]:
    session_id = uuid.uuid4().hex
    session_dir = RUNTIME_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=False)
    return session_id, session_dir


# ---------------------------------------------------------------- API
@app.post("/api/process")
async def process_floorplan(file: UploadFile = File(...)) -> JSONResponse:
    """Upload a floor-plan image and run the existing Phase 1-3 pipeline on it.

    Reuses tenix.pipeline.run_pipeline (Phase 1), tenix.structure.extract_structure
    (Phase 2, which re-runs Phase 1 internally the same way the CLI does), and
    tenix.geometry.generate (Phase 3) exactly as they exist today - no algorithm
    changes, only orchestration and a runtime/<session_id>/ output directory.
    """
    extension = _resolve_extension(file)

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image is larger than the 10 MB limit.")

    session_id, session_dir = _new_session_dir()
    input_path = session_dir / f"input{extension}"
    input_path.write_bytes(data)

    try:
        # Phase 1: preprocessing (gray.png, processed.png, report.json)
        run_pipeline(str(input_path), str(session_dir))

        # Phase 2: structural extraction (layout.json, detection_overlay.png)
        layout = extract_structure(str(input_path), str(session_dir))

        # Phase 3: 3D geometry generation (tenix_floorplan.obj)
        generate_geometry(load_layout(str(session_dir / "layout.json")), str(session_dir))

    except FileNotFoundError:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(
            status_code=400,
            detail="Unable to process this floor plan. The file could not be read as an image.",
        )
    except ValueError as exc:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail=f"Unable to process this floor plan. {exc}")
    except Exception:
        logger.exception("Processing failed for session %s", session_id)
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(
            status_code=500,
            detail="Unable to process this floor plan. Please try a different image.",
        )

    return JSONResponse(
        {
            "success": True,
            "session_id": session_id,
            "walls_detected": len(layout["walls"]),
            "rooms_detected": len(layout["rooms"]),
            "doors_detected": len(layout["doors"]),
            "layout_path": f"runtime/{session_id}/layout.json",
            "obj_path": f"runtime/{session_id}/tenix_floorplan.obj",
            "viewer_url": f"/web/viewer.html?session={session_id}",
            "status": "completed",
        }
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc):  # noqa: ANN001 - starlette signature
    """Last-resort safety net: never leak a Python traceback to the client."""
    logger.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": "Unable to process this floor plan."},
    )


# ---------------------------------------------------------------- static files
# Mounted after the routes above so /api/* keeps matching first.
app.mount("/runtime", StaticFiles(directory=str(RUNTIME_DIR)), name="runtime")
app.mount("/output", StaticFiles(directory=str(OUTPUT_DIR)), name="output")
app.mount("/web", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
