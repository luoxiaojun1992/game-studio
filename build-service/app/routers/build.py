"""
Build trigger routes for Build Service.

Accepts build requests, validates project state, and executes the build pipeline.
"""
import os
from fastapi import APIRouter, HTTPException

from app.safe_path import resolve_safe_path
from app.schemas import BuildTriggerResponse, _validate_project_id
from app.strategies import build_project, select_strategy
from app.builder import BuildError

router = APIRouter(prefix="/api/build", tags=["build"])

PROJECTS_ROOT = "/app/data/projects"

# Track in-flight builds: one build per project_id at a time
_building: set[str] = set()


def _project_path(project_id: str) -> str:
    """Resolve project directory with path traversal protection."""
    try:
        return resolve_safe_path(PROJECTS_ROOT, project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/{project_id}",
    response_model=BuildTriggerResponse,
    summary="Trigger a game build",
)
async def trigger_build(project_id: str) -> BuildTriggerResponse:
    """
    Trigger a build for the given project.

    Reads metadata.json → selects strategy → executes build → returns result.
    Also saves build.log in the project directory.
    """
    validated = _validate_project_id(project_id)
    path = _project_path(validated)

    # Check project exists
    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail=f"Project not found: {validated}")

    # Check metadata.json exists
    metadata_path = os.path.join(path, "dist", "metadata.json")
    if not os.path.isfile(metadata_path):
        raise HTTPException(
            status_code=422,
            detail=f"metadata.json not found in project: {metadata_path}",
        )

    # Concurrency guard: only one build at a time per project
    if validated in _building:
        raise HTTPException(
            status_code=409,
            detail=f"Build already in progress for project: {validated}",
        )

    _building.add(validated)
    print(f"[DEBUG:build] trigger_build START project_id={validated} path={path}", flush=True)

    try:
        # Validate strategy exists (will raise ValueError if game_type unknown)
        select_strategy(path)

        # Execute full build pipeline
        result = build_project(path)
        print(f"[DEBUG:build] trigger_build SUCCESS project_id={validated} game_type={result['game_type']}", flush=True)
        return BuildTriggerResponse(**result)

    except FileNotFoundError as e:
        print(f"[DEBUG:build] trigger_build METADATA_MISSING project_id={validated}: {e}", flush=True)
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        print(f"[DEBUG:build] trigger_build INVALID_GAME_TYPE project_id={validated}: {e}", flush=True)
        raise HTTPException(status_code=422, detail=str(e))
    except BuildError as e:
        print(f"[DEBUG:build] trigger_build BUILD_ERROR project_id={validated}: {e}", flush=True)
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        print(f"[DEBUG:build] trigger_build UNEXPECTED_ERROR project_id={validated}: {e}", flush=True)
        raise HTTPException(status_code=500, detail=f"Build error: {str(e)}")
    finally:
        _building.discard(validated)


@router.get(
    "/{project_id}/status",
    summary="Get build status for a project",
)
async def get_build_status(project_id: str):
    """Return current build status. Also returns stored build log if available."""
    validated = _validate_project_id(project_id)
    path = _project_path(validated)

    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail=f"Project not found: {validated}")

    # Determine status
    is_building = validated in _building

    # Check if dist/ exists (build completed)
    dist_dir = os.path.join(path, "dist")
    has_dist = os.path.isdir(dist_dir)

    # Check build.log
    log_path = os.path.join(path, "build.log")
    build_log = None
    if os.path.isfile(log_path):
        with open(log_path, "r") as f:
            build_log = f.read()[-50000:]  # Last 50KB

    # Read game_type if available
    game_type = None
    try:
        from app.strategies import get_game_type
        game_type = get_game_type(path)
    except Exception:
        pass

    # List output files
    output_files = []
    if has_dist:
        from app.strategies import _list_files_recursive
        output_files = _list_files_recursive(dist_dir)

    # Determine status string
    if is_building:
        build_status = "building"
    elif has_dist:
        build_status = "completed"
    elif build_log:
        build_status = "failed"
    else:
        build_status = "pending"

    return {
        "project_id": validated,
        "build_status": build_status,
        "game_type": game_type,
        "build_log": build_log,
        "output_files": output_files,
    }
