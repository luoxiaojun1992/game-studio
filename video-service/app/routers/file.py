"""
File management routes (list / download / upload / delete video files).
"""
import base64
import os
from datetime import datetime
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator

from app.safe_path import resolve_safe_path
from app.schemas import FileItem, FileListResponse, _validate_project_id, _validate_filename

router = APIRouter(prefix="/api/files", tags=["files"])

PROJECTS_ROOT = "/app/data/projects"


def _project_path(project_id: str) -> str:
    """Resolve project directory with path traversal protection."""
    try:
        return resolve_safe_path(PROJECTS_ROOT, project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _safe_join(base: str, filename: str) -> str:
    """Join base and filename, then verify result is inside base (path traversal guard)."""
    try:
        return resolve_safe_path(base, filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/{project_id}",
    response_model=FileListResponse,
    summary="List files in a video project",
)
async def list_files(project_id: str) -> FileListResponse:
    """Return the list of files in the project directory."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
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
    summary="Download a video file",
    response_class=FileResponse,
)
async def download_file(project_id: str, filename: str) -> FileResponse:
    """Download a file from the project directory."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    if not os.path.isdir(project_path):
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    safe_path = _safe_join(project_path, filename)
    if not os.path.isfile(safe_path):
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")

    media_type_map = {
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mov": "video/quicktime",
        ".avi": "video/x-msvideo",
        ".mkv": "video/x-matroska",
        ".gif": "image/gif",
        ".mp3": "audio/mpeg",
        ".aac": "audio/aac",
        ".ogg": "audio/ogg",
        ".opus": "audio/opus",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }
    _, ext = os.path.splitext(filename.lower())
    media_type = media_type_map.get(ext, "application/octet-stream")

    return FileResponse(
        path=safe_path,
        filename=filename,
        media_type=media_type,
    )


@router.post(
    "/{project_id}/{filename}",
    status_code=status.HTTP_201_CREATED,
    summary="Upload a video file (base64 encoded)",
)
async def upload_file(project_id: str, filename: str, body: dict) -> dict:
    """
    Upload a file to the project directory.

    Request body:
        - content (str): Base64-encoded file content

    The file is decoded from base64 and written to the project directory.
    Video files have a 500MB size limit.
    """
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    if not os.path.isdir(project_path):
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    content_b64 = body.get("content", "")
    if not content_b64:
        raise HTTPException(status_code=400, detail="Missing required field: content (base64)")

    # Validate filename
    _validate_filename(filename)
    safe_path = _safe_join(project_path, filename)

    # Decode base64 and write
    try:
        raw_bytes = base64.b64decode(content_b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64 content: {str(e)}")

    # Size limit: 500MB (video files are larger)
    max_size = 500 * 1024 * 1024
    if len(raw_bytes) > max_size:
        raise HTTPException(
            status_code=400,
            detail=f"File too large: {len(raw_bytes)} bytes (max {max_size} bytes)"
        )

    with open(safe_path, "wb") as f:
        f.write(raw_bytes)

    return {
        "success": True,
        "filename": filename,
        "size_bytes": len(raw_bytes),
        "message": f"File uploaded: {filename} ({len(raw_bytes)} bytes)",
    }


@router.delete(
    "/{project_id}/{filename}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a file (idempotent)",
)
async def delete_file(project_id: str, filename: str) -> None:
    """Delete a file from the project directory. Idempotent."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    if not os.path.isdir(project_path):
        return None

    safe_path = _safe_join(project_path, filename)
    if os.path.isfile(safe_path):
        os.remove(safe_path)
    return None
