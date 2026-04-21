"""
Project management routes.
"""

import os
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import JSONResponse

from app.schemas import ProjectCreateResponse, ProjectInfo, _validate_project_id

router = APIRouter(prefix="/api/projects", tags=["projects"])

PROJECTS_ROOT = "/app/data/projects"


def _project_path(project_id: str) -> str:
    return os.path.join(PROJECTS_ROOT, project_id)


@router.post(
    "/{project_id}",
    response_model=ProjectCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a project directory",
)
async def create_project(project_id: str) -> ProjectCreateResponse:
    """Create an empty project directory inside /app/data/projects/{project_id}."""
    validated = _validate_project_id(project_id)
    path = _project_path(validated)
    if os.path.isdir(path):
        # Idempotent: if already exists, return 200 instead of error
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"project_id": validated, "message": "already exists"},
        )
    os.makedirs(path, exist_ok=True)
    return ProjectCreateResponse(project_id=validated)


@router.get(
    "/{project_id}",
    response_model=ProjectInfo,
    summary="Check if a project exists",
)
async def get_project(project_id: str) -> ProjectInfo:
    """Return whether the project directory exists."""
    validated = _validate_project_id(project_id)
    return ProjectInfo(project_id=validated, exists=os.path.isdir(_project_path(validated)))


@router.delete(
    "/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a project directory (idempotent)",
)
async def delete_project(project_id: str) -> None:
    """
    Recursively delete the project directory.
    Idempotent: returns 204 even if the directory does not exist.
    """
    validated = _validate_project_id(project_id)
    path = _project_path(validated)
    if os.path.isdir(path):
        import shutil

        shutil.rmtree(path)
    # Always return 204
    return None
