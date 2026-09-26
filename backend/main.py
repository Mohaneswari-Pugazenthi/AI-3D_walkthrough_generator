"""TENIX FastAPI backend.

Orchestrates the EXISTING, UNMODIFIED Phase 1-3 tenix modules against a
runtime-uploaded floor-plan image, and serves the web/ and runtime/ folders
so a single process can host both the site and the API.

Run:
    python -m uvicorn backend.main:app --reload --port 8000

Serves:
    GET  /web/            -> landing page (web/index.html)
    GET  /web/viewer.html -> 3D viewer
    GET  /output/*        -> legacy fixed sample output (fallback data)
    GET  /runtime/*       -> per-session generated output (layout.json, .obj, ...)
    POST /api/process     -> upload a floor-plan image, run Phase 1-3, return counts + paths
"""

from __future__ import annotations

import logging
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from tenix import geometry, pipeline, structure

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tenix.backend")

BASE_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = BASE_DIR / "web"
OUTPUT_DIR = BASE_DIR / "output"
RUNTIME_DIR = BASE_DIR / "runtime"
NAVIGATOR_DIST_DIR = BASE_DIR / "navigator" / "dist"

OUTPUT_DIR.mkdir(exist_ok=True)
RUNTIME_DIR.mkdir(exist_ok=True)

ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg"}
ALLOWED_CONTENT_TYPES = {"image/png", "image/jpeg", "image/jpg"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB

app = FastAPI(
    title="TENIX",
    description="AI-Assisted 3D Walkthrough Generator — runtime floor-plan processing API.",
)


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    """Convenience redirect so http://localhost:8000/ opens the landing page."""
    return RedirectResponse(url="/web/")


def _validate_upload(filename: Optional[str], content_type: Optional[str], size: int) -> str:
    """Reject anything that isn't a small PNG/JPEG. Returns the sanitized extension."""
    if not filename or "." not in filename:
        raise HTTPException(status_code=400, detail="Please upload a PNG or JPEG image.")

    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only PNG and JPEG floor plans are supported.")

    if content_type and content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Only PNG and JPEG floor plans are supported.")

    if size == 0:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")

    if size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="Image is too large (10 MB limit).")

    return ext


@app.post("/api/process")
async def process_floor_plan(file: UploadFile = File(...)) -> JSONResponse:
    """Upload a floor plan and run the existing Phase 1-3 pipeline against it.

    Every uploaded image gets its own runtime/<session_id>/ directory, so this
    never touches the original output/layout.json or output/tenix_floorplan.obj.
    """
    contents = await file.read()
    ext = _validate_upload(file.filename, file.content_type, len(contents))

    # uuid4 hex -> safe to use directly as a directory name and URL segment
    # (no path separators, no user-controlled characters).
    session_id = uuid.uuid4().hex
    session_dir = RUNTIME_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=False)

    input_path = session_dir / f"input{ext}"
    input_path.write_bytes(contents)

    try:
        # Phase 1 - preprocessing (tenix.pipeline.run_pipeline, unmodified)
        pipeline.run_pipeline(str(input_path), str(session_dir))

        # Phase 2 - structural extraction (tenix.structure.extract_structure, unmodified)
        layout = structure.extract_structure(str(input_path), str(session_dir))

        # Phase 3 - 3D geometry generation (tenix.geometry.generate, unmodified)
        geometry.generate(layout, str(session_dir))

    except (FileNotFoundError, ValueError, OSError) as exc:
        logger.warning("Processing failed for session %s: %s", session_id, exc)
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(
            status_code=422,
            detail="Unable to process this floor plan. Try a clearer, higher-contrast image.",
        ) from exc
    except Exception:  # pragma: no cover - unexpected failure safety net
        logger.exception("Unexpected error processing session %s", session_id)
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail="Unable to process this floor plan.") from None

    return JSONResponse(
        {
            "success": True,
            "session_id": session_id,
            "walls_detected": len(layout.get("walls", [])),
            "rooms_detected": len(layout.get("rooms", [])),
            "doors_detected": len(layout.get("doors", [])),
            "layout_path": f"runtime/{session_id}/layout.json",
            "obj_path": f"runtime/{session_id}/tenix_floorplan.obj",
            "viewer_url": f"/web/viewer.html?session={session_id}",
            "status": "Walkthrough ready",
        }
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Every error is plain JSON with a safe, user-facing message. No tracebacks leave the server."""
    return JSONResponse(status_code=exc.status_code, content={"success": False, "error": exc.detail})


# Static mounts (registered after the routes above so /api/process and / take priority).
app.mount("/output", StaticFiles(directory=str(OUTPUT_DIR)), name="output")
app.mount("/runtime", StaticFiles(directory=str(RUNTIME_DIR)), name="runtime")
app.mount("/web", StaticFiles(directory=str(WEB_DIR), html=True), name="web")

# Blueprint Navigator (additional feature, merged from the separate
# navigation-system project). Purely additive: guarded so the backend still
# starts cleanly even if `navigator/dist` hasn't been built yet (see
# navigator/README.md / the project README for the build command).
if NAVIGATOR_DIST_DIR.exists():
    app.mount("/navigator", StaticFiles(directory=str(NAVIGATOR_DIST_DIR), html=True), name="navigator")
else:  # pragma: no cover - only hit when the navigator hasn't been built yet
    logger.warning(
        "navigator/dist not found - Blueprint Navigator feature will 404 until "
        "you run `npm install && npm run build:merged` inside navigator/."
    )
