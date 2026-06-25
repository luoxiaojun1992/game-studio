"""
Pydantic request / response models for Build Service.
"""
import re
from typing import Optional
from pydantic import BaseModel, Field


PROJECT_ID_RE = re.compile(r'^[a-zA-Z0-9_-]{1,64}$')
SUPPORTED_GAME_TYPES = {"h5", "phaser-mobile"}


def _validate_project_id(project_id: str) -> str:
    """Validate project_id format. Returns the validated string or raises ValueError."""
    if not project_id or not PROJECT_ID_RE.match(project_id):
        raise ValueError(f"Invalid project_id: '{project_id}'. Must match {PROJECT_ID_RE.pattern}")
    return project_id


# ---------------------------------------------------------------------------
# Project
# ---------------------------------------------------------------------------

class ProjectCreateResponse(BaseModel):
    project_id: str
    message: str = "created"


class ProjectInfo(BaseModel):
    project_id: str
    exists: bool
    game_type: Optional[str] = None
    build_status: Optional[str] = None
    file_count: int = 0


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

class UploadResponse(BaseModel):
    success: bool = True
    message: str
    file_count: int = 0


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

class BuildTriggerResponse(BaseModel):
    success: bool = True
    build_log: str = ""
    game_type: str = ""
    strategy: str = ""
    output_dir: str = "dist"
    message: str = ""
    files: list[str] = Field(default_factory=list)


class BuildErrorResponse(BaseModel):
    detail: str


class BuildStatusResponse(BaseModel):
    project_id: str
    build_status: str  # "pending" | "building" | "completed" | "failed"
    game_type: Optional[str] = None
    build_log: Optional[str] = None
    output_files: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# File Management
# ---------------------------------------------------------------------------

class FileInfo(BaseModel):
    filename: str
    type: str  # "file" or "dir"
    size_bytes: Optional[int] = None


class FileListResponse(BaseModel):
    project_id: str
    files: list[FileInfo] = Field(default_factory=list)


class FileUploadResponse(BaseModel):
    success: bool = True
    filename: str
    size_bytes: int = 0
    message: str = "uploaded"


# ---------------------------------------------------------------------------
# Metadata (parsed from dist/metadata.json)
# ---------------------------------------------------------------------------

class GameMetadata(BaseModel):
    title: str = ""
    version: str = ""
    game_type: str = ""
    resolution: Optional[dict] = None
    orientation: str = ""
    entry: str = "index.html"
