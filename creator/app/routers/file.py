"""
File management routes (list / download / delete model files).
"""

import os
from datetime import datetime
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse, JSONResponse

from schemas import FileItem, FileListResponse, _validate_project_id

router = APIRouter(prefix="/api/files", tags=["files"])

PROJECTS_ROOT = "/app/data/projects"


def _safe_join(base: str, filename: str) -> str:
    """Join base and filename, then verify result is inside base (path traversal guard)."""
    base = os.path.realpath(base)
    result = os.path.realpath(os.path.join(base, filename))
    if not result.startswith(base + os.sep):
        raise HTTPException(status_code=400, detail="Invalid filename (path traversal detected)")
    return result


@router.get(
    "/{project_id}",
    response_model=FileListResponse,
    summary="List files in a project",
)
async def list_files(project_id: str) -> FileListResponse:
    """Return the list of files in the project directory."""
    validated_pid = _validate_project_id(project_id)
    project_path = os.path.join(PROJECTS_ROOT, validated_pid)
    if not os.path.isdir(project_path):
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    files: list[FileItem] = []
    for entry in os.scandir(project_path):
        if entry.is_file():
            stat = entry.stat()
            files.append(
                FileItem(
                    filename=entry.name,
                    size_bytes=stat.st_size,
                    modified_at=datetime.fromtimestamp(stat.st_mtime).isoformat(),
                )
            )
    return FileListResponse(project_id=validated_pid, files=files)


@router.get(
    "/{project_id}/{filename}",
    summary="Download a model file",
    response_class=FileResponse,
)
async def download_file(project_id: str, filename: str) -> FileResponse:
    """Download a file from the project directory."""
    validated_pid = _validate_project_id(project_id)
    project_path = os.path.join(PROJECTS_ROOT, validated_pid)
    if not os.path.isdir(project_path):
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    # Validate filename to prevent path traversal
    safe_path = _safe_join(project_path, filename)
    if not os.path.isfile(safe_path):
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")

    media_type_map = {
        ".glb": "model/gltf-binary",
        ".gltf": "model/gltf+json",
        ".fbx": "application/octet-stream",
        ".obj": "text/plain",
        ".ply": "application/octet-stream",
        ".usd": "application/octet-stream",
    }
    _, ext = os.path.splitext(filename.lower())
    media_type = media_type_map.get(ext, "application/octet-stream")

    return FileResponse(
        path=safe_path,
        filename=filename,
        media_type=media_type,
    )


@router.delete(
    "/{project_id}/{filename}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a file (idempotent)",
)
async def delete_file(project_id: str, filename: str) -> None:
    """
    Delete a file from the project directory.
    Idempotent: returns 204 even if the file does not exist.
    """
    validated_pid = _validate_project_id(project_id)
    project_path = os.path.join(PROJECTS_ROOT, validated_pid)
    if not os.path.isdir(project_path):
        # Treat missing project as already deleted
        return None

    safe_path = _safe_join(project_path, filename)
    if os.path.isfile(safe_path):
        os.remove(safe_path)
    return None
