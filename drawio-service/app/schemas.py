"""
Pydantic schemas for the Drawio API.
"""

import re
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

# ---------------------------------------------------------------------------
# Shared patterns
# ---------------------------------------------------------------------------
PROJECT_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
DIAGRAM_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")

SHAPE_TYPES = Literal[
    "rectangle", "ellipse", "diamond", "parallelogram",
    "hexagon", "cylinder", "cloud", "process",
    "decision", "document", "person", "database"
]
CONNECTOR_TYPES = Literal["straight", "orthogonal", "elbow", "curved"]
EXPORT_FORMATS = Literal["png", "svg", "pdf", "xml"]


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


def _validate_diagram_id(v: str) -> str:
    if not DIAGRAM_ID_PATTERN.match(v):
        raise ValueError(
            f"Invalid diagram_id: '{v}'. "
            "Only letters, numbers, underscore, hyphen allowed (max 64 chars)."
        )
    return v


# ---------------------------------------------------------------------------
# Project schemas
# ---------------------------------------------------------------------------

class ProjectCreateResponse(BaseModel):
    project_id: str = Field(..., description="The created project ID")


class ProjectInfo(BaseModel):
    project_id: str
    exists: bool = True


# ---------------------------------------------------------------------------
# Diagram schemas
# ---------------------------------------------------------------------------

class CreateDiagramRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Diagram name")


class DiagramInfo(BaseModel):
    diagram_id: str
    name: str
    exists: bool = True


class DiagramCreateResponse(BaseModel):
    diagram_id: str = Field(..., description="The created diagram ID")
    name: str


# ---------------------------------------------------------------------------
# Shape schemas
# ---------------------------------------------------------------------------

class AddShapeRequest(BaseModel):
    shape_type: SHAPE_TYPES
    label: str = Field(..., min_length=0, max_length=200)
    x: float = Field(..., description="X coordinate")
    y: float = Field(..., description="Y coordinate")
    width: float = Field(default=120.0, gt=0, description="Shape width")
    height: float = Field(default=60.0, gt=0, description="Shape height")
    style: Optional[dict] = Field(default=None, description="Style options")


class ShapeResponse(BaseModel):
    shape_id: str = Field(..., description="The created shape ID")


# ---------------------------------------------------------------------------
# Connector schemas
# ---------------------------------------------------------------------------

class AddConnectorRequest(BaseModel):
    from_shape_id: str = Field(..., min_length=1, max_length=64)
    to_shape_id: str = Field(..., min_length=1, max_length=64)
    label: str = Field(default="", max_length=200)
    connector_type: CONNECTOR_TYPES = "straight"
    arrow_start: bool = Field(default=False)
    arrow_end: bool = Field(default=True)
    style: Optional[dict] = Field(default=None)


class ConnectorResponse(BaseModel):
    connector_id: str = Field(..., description="The created connector ID")


# ---------------------------------------------------------------------------
# Export schemas
# ---------------------------------------------------------------------------

class ExportQuery(BaseModel):
    format: EXPORT_FORMATS = "png"
    scale: Optional[float] = Field(default=1.0, ge=0.1, le=10.0)
    transparent: Optional[bool] = Field(default=False)


# ---------------------------------------------------------------------------
# Element list schemas
# ---------------------------------------------------------------------------

class DiagramElement(BaseModel):
    element_id: str = Field(..., description="Element cell ID")
    element_type: str = Field(..., description="'shape' or 'connector'")
    label: str = Field(default="", description="Display label/value")
    style: str = Field(default="", description="mxGraph style string")
    # shape-specific geometry
    x: Optional[float] = Field(default=None, description="X coordinate (shape only)")
    y: Optional[float] = Field(default=None, description="Y coordinate (shape only)")
    width: Optional[float] = Field(default=None, description="Width (shape only)")
    height: Optional[float] = Field(default=None, description="Height (shape only)")
    # connector-specific references
    source_id: Optional[str] = Field(default=None, description="Source shape ID (connector only)")
    target_id: Optional[str] = Field(default=None, description="Target shape ID (connector only)")


class ListElementsResponse(BaseModel):
    diagram_id: str
    elements: list[DiagramElement]
    total: int
    page: int
    page_size: int
