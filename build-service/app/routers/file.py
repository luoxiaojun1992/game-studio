"""
File management routes for Build Service.

Supports listing, downloading, and deleting files within a project directory.
"""
import os
import shutil
import tarfile
import io
import base64
import json
from fastapi import APIRouter, HTTPException, status, Request
from fastapi.responses import StreamingResponse

from app.safe_path import resolve_safe_path
from app.schemas import (
    FileInfo,
    FileListResponse,
    FileUploadResponse,
    _validate_project_id,
)

router = APIRouter(prefix="/api/files", tags=["files"])

PROJECTS_ROOT = "/app/data/projects"


def _project_path(project_id: str) -> str:
    """Resolve project directory with path traversal protection."""
    try:
        return resolve_safe_path(PROJECTS_ROOT, project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _safe_join(base: str, filename: str) -> str:
    """Safely join a filename to a base directory."""
    try:
        return resolve_safe_path(base, filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/{project_id}",
    response_model=FileListResponse,
    summary="List files in a project (recursive)",
)
async def list_files(project_id: str) -> FileListResponse:
    """Recursively list all files in the project directory."""
    validated = _validate_project_id(project_id)
    path = _project_path(validated)

    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail=f"Project not found: {validated}")

    files = []
    for dirpath, dirnames, filenames in os.walk(path):
        for dname in dirnames:
            files.append(FileInfo(filename=dname, type="dir"))
        for fname in filenames:
            full = os.path.join(dirpath, fname)
            size = os.path.getsize(full)
            files.append(FileInfo(filename=fname, type="file", size_bytes=size))

    return FileListResponse(project_id=validated, files=files)


@router.get(
    "/{project_id}/download",
    summary="Download entire project as tar.gz",
)
async def download_project(project_id: str):
    """Package the entire project directory as a tar.gz and stream it."""
    validated = _validate_project_id(project_id)
    path = _project_path(validated)

    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail=f"Project not found: {validated}")

    # Create tar.gz in memory
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for dirpath, _, filenames in os.walk(path):
            for fname in filenames:
                full_path = os.path.join(dirpath, fname)
                arcname = os.path.relpath(full_path, path)
                tar.add(full_path, arcname=arcname)

    buf.seek(0)
    print(f"[DEBUG:file] download_project project_id={validated} size={buf.getbuffer().nbytes}", flush=True)

    return StreamingResponse(
        buf,
        media_type="application/gzip",
        headers={
            "Content-Disposition": f'attachment; filename="{validated}.tar.gz"',
        },
    )


@router.get(
    "/{project_id}/{filename:path}",
    summary="Download a single file",
)
async def download_file(project_id: str, filename: str):
    """Download a single file from the project directory."""
    validated = _validate_project_id(project_id)
    path = _project_path(validated)
    file_path = _safe_join(path, filename)

    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")

    # Determine media type
    media_type = "application/octet-stream"
    if filename.endswith(".log"):
        media_type = "text/plain"

    file_size = os.path.getsize(file_path)

    def file_stream():
        with open(file_path, "rb") as f:
            while chunk := f.read(65536):
                yield chunk

    return StreamingResponse(
        file_stream(),
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{os.path.basename(filename)}"',
            "Content-Length": str(file_size),
        },
    )


@router.post(
    "/{project_id}/{filename:path}",
    response_model=FileUploadResponse,
    summary="Upload a single file to the project",
)
async def upload_file(project_id: str, filename: str, request: Request) -> FileUploadResponse:
    """
    Upload a single file to the project directory.

    Body: JSON with "content" field (base64 encoded).
    """
    validated = _validate_project_id(project_id)
    path = _project_path(validated)
    file_path = _safe_join(path, filename)

    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail=f"Project not found: {validated}")

    raw_body = await request.body()
    try:
        data = json.loads(raw_body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    content = data.get("content", "")
    if not content:
        raise HTTPException(status_code=400, detail="Missing 'content' field")

    try:
        decoded = base64.b64decode(content)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 content")

    # Create parent directories if needed
    os.makedirs(os.path.dirname(file_path), exist_ok=True)

    with open(file_path, "wb") as f:
        f.write(decoded)

    print(f"[DEBUG:file] upload_file project_id={validated} filename={filename} size={len(decoded)}", flush=True)
    return FileUploadResponse(
        success=True,
        filename=filename,
        size_bytes=len(decoded),
        message="uploaded",
    )


@router.delete(
    "/{project_id}/{filename:path}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a file (idempotent)",
)
async def delete_file(project_id: str, filename: str) -> None:
    """Delete a file from the project. Idempotent."""
    validated = _validate_project_id(project_id)
    path = _project_path(validated)
    file_path = _safe_join(path, filename)

    if os.path.isfile(file_path):
        os.remove(file_path)
        print(f"[DEBUG:file] delete_file project_id={validated} filename={filename}", flush=True)
    elif os.path.isdir(file_path):
        shutil.rmtree(file_path)
        print(f"[DEBUG:file] delete_dir project_id={validated} filename={filename}", flush=True)
    return None


@router.delete(
    "/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete project directory (idempotent)",
)
async def delete_project_dir(project_id: str) -> None:
    """Delete the entire project directory. Idempotent."""
    validated = _validate_project_id(project_id)
    path = _project_path(validated)
    if os.path.isdir(path):
        shutil.rmtree(path)
        print(f"[DEBUG:file] delete_project project_id={validated}", flush=True)
    return None
