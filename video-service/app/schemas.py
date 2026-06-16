"""
Pydantic schemas for the Video Service API.

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
TARGET_FORMATS = Literal["mp4", "webm", "mov", "gif", "avi", "mkv"]
VIDEO_CODECS = Literal["h264", "h265", "vp8", "vp9", "av1"]
AUDIO_CODECS = Literal["aac", "mp3", "opus", "vorbis", "copy"]
PRESETS = Literal["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"]
WATERMARK_POSITIONS = Literal["top-left", "top-right", "bottom-left", "bottom-right", "center"]


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
# Video operation response schemas
# ---------------------------------------------------------------------------

class VideoOperationResponse(BaseModel):
    success: bool = True
    output: str = Field(default="", description="stdout from FFmpeg")
    message: str = Field(default="Operation completed")
    output_file: Optional[str] = Field(default=None, description="Output filename")
    info: Optional[dict] = Field(default=None, description="Video metadata (for info endpoint)")

    class Config:
        json_encoders = {str: lambda v: v}


# ---------------------------------------------------------------------------
# Video operation request schemas
# ---------------------------------------------------------------------------

class VideoInfoRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("filename")
    @classmethod
    def validate_filename(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class ConvertRequest(BaseModel):
    input_filename: str = Field(..., min_length=1, max_length=128)
    target_format: TARGET_FORMATS
    output_filename: str = Field(..., min_length=1, max_length=128)
    video_codec: Optional[str] = Field(default=None, max_length=32)
    audio_codec: Optional[str] = Field(default=None, max_length=32)

    @field_validator("input_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class TrimRequest(BaseModel):
    input_filename: str = Field(..., min_length=1, max_length=128)
    start_time: float = Field(..., ge=0)
    duration: Optional[float] = Field(default=None, gt=0)
    end_time: Optional[float] = Field(default=None, gt=0)
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("input_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class ConcatRequest(BaseModel):
    input_filenames: list[str] = Field(..., min_length=2, max_length=64)
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("output_filename")
    @classmethod
    def validate_output_filename(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class ResizeRequest(BaseModel):
    input_filename: str = Field(..., min_length=1, max_length=128)
    width: int = Field(..., ge=1, le=7680)
    height: int = Field(..., ge=1, le=7680)
    keep_aspect: bool = Field(default=True, description="Maintain aspect ratio with padding")
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("input_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class CompressRequest(BaseModel):
    input_filename: str = Field(..., min_length=1, max_length=128)
    crf: Optional[int] = Field(default=23, ge=0, le=51)
    bitrate: Optional[str] = Field(default=None, max_length=16)
    preset: str = Field(default="medium", max_length=32)
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("input_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class CropRequest(BaseModel):
    input_filename: str = Field(..., min_length=1, max_length=128)
    width: int = Field(..., ge=1, le=7680)
    height: int = Field(..., ge=1, le=7680)
    x: int = Field(default=0, ge=0, le=7680)
    y: int = Field(default=0, ge=0, le=7680)
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("input_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class RotateRequest(BaseModel):
    input_filename: str = Field(..., min_length=1, max_length=128)
    angle: int = Field(..., ge=0, le=360)
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("input_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class ChangeSpeedRequest(BaseModel):
    input_filename: str = Field(..., min_length=1, max_length=128)
    speed: float = Field(..., ge=0.25, le=4.0)
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("input_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class ExtractFramesRequest(BaseModel):
    input_filename: str = Field(..., min_length=1, max_length=128)
    fps: Optional[int] = Field(default=1, ge=1, le=120)
    frame_count: Optional[int] = Field(default=None, ge=1, le=10000)
    output_pattern: str = Field(default="frame_%04d.png", min_length=1, max_length=128)
    format: Optional[str] = Field(default="png", max_length=16)

    @field_validator("input_filename")
    @classmethod
    def validate_input_filename(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class ExtractAudioRequest(BaseModel):
    input_filename: str = Field(..., min_length=1, max_length=128)
    output_filename: str = Field(..., min_length=1, max_length=128)
    format: Optional[str] = Field(default="mp3", max_length=16)

    @field_validator("input_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class AddAudioRequest(BaseModel):
    video_filename: str = Field(..., min_length=1, max_length=128)
    audio_filename: str = Field(..., min_length=1, max_length=128)
    output_filename: str = Field(..., min_length=1, max_length=128)
    mix: bool = Field(default=False, description="Mix with original audio (true) or replace (false)")

    @field_validator("video_filename", "audio_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class AddTextRequest(BaseModel):
    input_filename: str = Field(..., min_length=1, max_length=128)
    text: str = Field(..., min_length=1, max_length=512)
    x: int = Field(default=10, ge=0, le=7680)
    y: int = Field(default=10, ge=0, le=7680)
    font_size: int = Field(default=24, ge=8, le=256)
    color: str = Field(default="white", max_length=32)
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("input_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class AddWatermarkRequest(BaseModel):
    input_filename: str = Field(..., min_length=1, max_length=128)
    watermark_filename: str = Field(..., min_length=1, max_length=128)
    position: WATERMARK_POSITIONS = "bottom-right"
    opacity: float = Field(default=0.5, ge=0.0, le=1.0)
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("input_filename", "watermark_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class GenerateGifRequest(BaseModel):
    input_filename: str = Field(..., min_length=1, max_length=128)
    fps: int = Field(default=10, ge=1, le=60)
    width: Optional[int] = Field(default=480, ge=1, le=3840)
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("input_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class GifToVideoRequest(BaseModel):
    input_filename: str = Field(..., min_length=1, max_length=128)
    target_format: str = Field(default="mp4", max_length=16)
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("input_filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)


class CreateThumbnailRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=128)
    time: Optional[float] = Field(default=5.0, ge=0)
    width: Optional[int] = Field(default=320, ge=1, le=3840)
    output_filename: str = Field(..., min_length=1, max_length=128)

    @field_validator("filename", "output_filename")
    @classmethod
    def validate_filenames(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("filename must not contain path separators")
        return _validate_filename(v)
