"""
Project management routes for Image Service.
"""
import os
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import JSONResponse

from app.safe_path import resolve_safe_path
from app.schemas import ProjectCreateResponse, ProjectInfo, _validate_project_id

router = APIRouter(prefix="/api/projects", tags=["projects"])

PROJECTS_ROOT = "/app/data/projects"


def _project_path(project_id: str) -> str:
    """Resolve project directory with path traversal protection."""
    try:
        return resolve_safe_path(PROJECTS_ROOT, project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/{project_id}",
    response_model=ProjectCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create an image project directory",
)
async def create_project(project_id: str) -> ProjectCreateResponse:
    """Create an empty project directory inside /app/data/projects/{project_id}."""
    import sys
    validated = _validate_project_id(project_id)
    path = _project_path(validated)
    print(f"[DEBUG:project] create_project START project_id={validated} path={path}", flush=True)
    print(f"[DEBUG:project] PROJECTS_ROOT={PROJECTS_ROOT} exists={os.path.isdir(PROJECTS_ROOT)}", flush=True)
    if os.path.isdir(path):
        print(f"[DEBUG:project] create_project ALREADY_EXISTS project_id={validated}", flush=True)
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"project_id": validated, "message": "already exists"},
        )
    try:
        os.makedirs(path, exist_ok=True)
        print(f"[DEBUG:project] create_project CREATED project_id={validated} path={path} dir_exists={os.path.isdir(path)}", flush=True)
    except Exception as e:
        print(f"[DEBUG:project] create_project ERROR project_id={validated} error={str(e)}", flush=True)
        raise HTTPException(status_code=500, detail=f"Failed to create project: {str(e)}")
    return ProjectCreateResponse(project_id=validated)


@router.get(
    "/{project_id}",
    response_model=ProjectInfo,
    summary="Check if an image project exists",
)
async def get_project(project_id: str) -> ProjectInfo:
    """Return whether the project directory exists."""
    validated = _validate_project_id(project_id)
    return ProjectInfo(project_id=validated, exists=os.path.isdir(_project_path(validated)))


@router.delete(
    "/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an image project directory (idempotent)",
)
async def delete_project(project_id: str) -> None:
    """Recursively delete the project directory. Idempotent."""
    validated = _validate_project_id(project_id)
    path = _project_path(validated)
    if os.path.isdir(path):
        import shutil
        shutil.rmtree(path)
    return None
