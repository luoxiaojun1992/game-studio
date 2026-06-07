"""
Pydantic schemas for the Image Service API.

Validation rules:
  - project_id:  regex ^[a-zA-Z0-9_-]{1,64}$
  - filename:    regex ^[a-zA-Z0-9_.\\-]+$  (no path separators)
"""

import re
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

# ---------------------------------------------------------------------------
# Shared patterns
# ---------------------------------------------------------------------------
PROJECT_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
FILENAME_PATTERN = re.compile(r"^[a-zA-Z0-9_.\-]+$")

# Types
TARGET_FORMATS = Literal["png", "jpg", "webp", "avif", "gif", "bmp"]
GRAVITIES = Literal[
    "center", "north", "south", "east", "west",
    "northeast", "northwest", "southeast", "southwest"
]
FLIP_ROTATE_MODES = Literal["flip", "flop", "rotate", "transpose", "transverse"]
WATERMARK_TYPES = Literal["text", "image"]


# ---------------------------------------------------------------------------
# Validators
# ---------------------------------------------------------------------------

def _validate_project_id(v: str) -> str:
    if not PROJECT_ID_PATTERN.match(v):
        raise ValueError(
            f"Invalid project_id: '{v}'. "
            "Only letters, numbers, underscore, hyphen allowed (max 64 chars)."
        )
    return v


def _validate_filename(v: str) -> str:
    if not FILENAME_PATTERN.match(v):
        raise ValueError(
            f"Invalid filename: '{v}'. "
            "No path separators or special characters allowed."
        )
    return v


# ---------------------------------------------------------------------------
# Project schemas
# ---------------------------------------------------------------------------

class ProjectCreateResponse(BaseModel):
    project_id: str = Field(..., description="The created project ID (UUID)")

class ProjectInfo(BaseModel):
    project_id: str
    exists: bool = True


# ---------------------------------------------------------------------------
# File schemas
# ---------------------------------------------------------------------------

class FileItem(BaseModel):
    filename: str
    size_bytes: int
    modified_at: str  # ISO 8601

class FileListResponse(BaseModel):
    project_id: str
    files: list[FileItem]


# ---------------------------------------------------------------------------
# Image operation schemas
# ---------------------------------------------------------------------------

class ImageOperationResponse(BaseModel):
    success: bool = True
    output: str = Field(default="", description="stdout from ImageMagick")
    message: str = Field(default="Operation completed")
    output_file: Optional[str] = Field(default=None, description="Output filename")

    class Config:
        json_encoders = {str: lambda v: v}


class ResizeRequest(BaseModel):
    input_filename: str = Field(..., min_length=1, max_length=128)
    width: int = Field(..., ge=1, le=16384)
    height: int = Field(..., ge=1, le=16384)
    keep_aspect: bool = Field(default=True, description="Maintain aspect ratio")
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("input_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class CropRequest(BaseModel):
    input_filename: str = Field(..., min_length=1, max_length=128)
    width: int = Field(..., ge=1, le=16384)
    height: int = Field(..., ge=1, le=16384)
    x: int = Field(default=0, ge=0, le=16384)
    y: int = Field(default=0, ge=0, le=16384)
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("input_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class ConvertRequest(BaseModel):
    input_filename: str = Field(..., min_length=1, max_length=128)
    target_format: TARGET_FORMATS
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("input_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class CompressRequest(BaseModel):
    input_filename: str = Field(..., min_length=1, max_length=128)
    quality: int = Field(..., ge=1, le=100)
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("input_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class WatermarkRequest(BaseModel):
    input_filename: str = Field(..., min_length=1, max_length=128)
    type: WATERMARK_TYPES = "text"
    content: Optional[str] = Field(default=None, max_length=256, description="Text content or overlay image filename")
    text: Optional[str] = Field(default=None, max_length=256, description="Watermark text (alias for content)")
    position: str = Field(default="southeast", description="Gravity position")
    opacity: float = Field(default=0.5, ge=0.0, le=1.0)
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("input_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class CompositeRequest(BaseModel):
    base_filename: str = Field(..., min_length=1, max_length=128)
    overlay_filename: str = Field(..., min_length=1, max_length=128)
    gravity: GRAVITIES = "center"
    x: int = Field(default=0, ge=-16384, le=16384)
    y: int = Field(default=0, ge=-16384, le=16384)
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("base_filename", "overlay_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class FlipRotateRequest(BaseModel):
    input_filename: str = Field(..., min_length=1, max_length=128)
    mode: FLIP_ROTATE_MODES
    angle: int = Field(default=90, ge=0, le=360, description="Rotation angle (for rotate mode)")
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("input_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class AddMarginRequest(BaseModel):
    input_filename: str = Field(..., min_length=1, max_length=128)
    top: int = Field(default=0, ge=0, le=4096)
    right: int = Field(default=0, ge=0, le=4096)
    bottom: int = Field(default=0, ge=0, le=4096)
    left: int = Field(default=0, ge=0, le=4096)
    color: str = Field(default="transparent", max_length=32, description="Border color (name, #hex, transparent)")
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("input_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class ColorAdjustRequest(BaseModel):
    input_filename: str = Field(..., min_length=1, max_length=128)
    brightness: int = Field(default=0, ge=-100, le=100)
    contrast: int = Field(default=0, ge=-100, le=100)
    saturation: int = Field(default=100, ge=0, le=200, description="100=original")
    hue: int = Field(default=100, ge=0, le=200, description="100=original")
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("input_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class ImageInfoRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("filename")
    @classmethod
    def validate_filename(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class BatchRequest(BaseModel):
    input_pattern: str = Field(..., min_length=1, max_length=256, description="Glob pattern or comma-separated filenames")
    operation: str = Field(..., min_length=1, max_length=32, description="resize/convert/compress")
    operation_params: dict = Field(default_factory=dict, description="Operation-specific parameters")
    output_dir: str = Field(default="batch_output", min_length=1, max_length=128)

    @field_validator("output_dir")
    @classmethod
    def validate_output_dir(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("output_dir must not contain path separators")
        return _validate_filename(v)


class SpriteSheetRequest(BaseModel):
    files: list[str] = Field(..., min_length=1, max_length=256, description="List of filenames")
    columns: int = Field(..., ge=1, le=64)
    rows: int = Field(..., ge=1, le=64)
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("output_filename")
    @classmethod
    def validate_output_filename(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)
