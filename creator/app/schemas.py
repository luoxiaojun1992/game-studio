"""
Pydantic schemas for the Creator API.

Validation rules:
  - project_id:  regex ^[a-zA-Z0-9_-]{1,64}$
  - filename:    regex ^[a-zA-Z0-9_.\\-]+$  (no path separators)
  - script:       max 10 KB
"""

import re
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

# ---------------------------------------------------------------------------
# Shared patterns
# ---------------------------------------------------------------------------
PROJECT_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
FILENAME_PATTERN = re.compile(r"^[a-zA-Z0-9_.\-]+$")

MESH_TYPES = Literal["cube", "sphere", "plane", "cylinder", "torus", "cone"]
EXPORT_FORMATS = Literal["glb", "fbx", "obj", "ply", "usd"]
BOOLEAN_OPS = Literal["UNION", "DIFFERENCE", "INTERSECT"]
MODIFIER_TYPES = Literal["SUBSURF", "BEVEL", "DISPLACEMENT", "SOLIDIFY"]


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
# Blender operation schemas
# ---------------------------------------------------------------------------

class CreateMeshRequest(BaseModel):
    mesh_type: MESH_TYPES
    name: str = Field(..., min_length=1, max_length=64)
    location: tuple[float, float, float] = (0.0, 0.0, 0.0)
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0)
    scale: tuple[float, float, float] = (1.0, 1.0, 1.0)


class AddMaterialRequest(BaseModel):
    object_name: str = Field(..., min_length=1, max_length=64)
    color: tuple[float, float, float] = Field(
        default=(0.8, 0.8, 0.8),
        description="RGB values 0-1",
    )
    metallic: float = Field(default=0.0, ge=0.0, le=1.0)
    roughness: float = Field(default=0.5, ge=0.0, le=1.0)
    emission: Optional[tuple[float, float, float]] = Field(
        default=None,
        description="RGB emission color 0-1",
    )
    emission_strength: float = Field(default=0.0, ge=0.0)


class BooleanRequest(BaseModel):
    object_a: str = Field(..., min_length=1, max_length=64)
    object_b: str = Field(..., min_length=1, max_length=64)
    operator: BOOLEAN_OPS
    result_name: str = Field(..., min_length=1, max_length=64)


class AddModifierRequest(BaseModel):
    object_name: str = Field(..., min_length=1, max_length=64)
    modifier_type: MODIFIER_TYPES
    levels: int = Field(default=2, ge=1, le=6)


class ExportRequest(BaseModel):
    object_name: str = Field(..., min_length=1, max_length=64)
    output_filename: str = Field(
        ...,
        min_length=1,
        max_length=128,
        description="Output filename including extension",
    )
    format: EXPORT_FORMATS = "glb"

    @field_validator("output_filename")
    @classmethod
    def validate_output_filename(cls, v: str) -> str:
        if "/" in v or "\\" in v:
            raise ValueError("output_filename must not contain path separators")
        return _validate_filename(v)


class BlenderOperationResponse(BaseModel):
    success: bool = True
    output: str = Field(default="", description="stdout from Blender")
    message: str = Field(default="Operation completed")


class BlenderObjectInfo(BaseModel):
    name: str = Field(..., description="Object name in Blender scene")
    type: str = Field(..., description="Object type (MESH, LIGHT, CAMERA, etc.)")
    location: list[float] = Field(..., description="[x, y, z] location")


class ListObjectsResponse(BaseModel):
    project_id: str
    objects: list[BlenderObjectInfo]
    total: int
    page: int
    page_size: int
