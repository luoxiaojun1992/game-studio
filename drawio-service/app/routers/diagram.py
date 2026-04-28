"""
Diagram management routes for Drawio Service.
"""

import os
import uuid
from fastapi import APIRouter, HTTPException, status

from app.schemas import (
    AddConnectorRequest,
    AddShapeRequest,
    ConnectorResponse,
    CreateDiagramRequest,
    DiagramCreateResponse,
    DiagramInfo,
    ShapeResponse,
    _validate_project_id,
)
from app.diagram_generator import (
    append_cell_to_xml,
    create_connector_xml,
    create_shape_xml,
    generate_initial_xml,
)

router = APIRouter(prefix="/api/diagrams", tags=["diagrams"])

PROJECTS_ROOT = "/app/data/projects"


def _project_path(project_id: str) -> str:
    return os.path.join(PROJECTS_ROOT, project_id)


def _diagram_path(project_id: str, diagram_id: str) -> str:
    return os.path.join(_project_path(project_id), f"{diagram_id}.drawio")


def _read_diagram_xml(project_id: str, diagram_id: str) -> str:
    """Read diagram XML from file, raise 404 if not found."""
    path = _diagram_path(project_id, diagram_id)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"Diagram not found: {diagram_id}")
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _write_diagram_xml(project_id: str, diagram_id: str, xml_content: str) -> None:
    """Write diagram XML to file."""
    project_dir = _project_path(project_id)
    os.makedirs(project_dir, exist_ok=True)
    path = _diagram_path(project_id, diagram_id)
    with open(path, "w", encoding="utf-8") as f:
        f.write(xml_content)


# ---------------------------------------------------------------------------
# Diagram CRUD
# ---------------------------------------------------------------------------

@router.post(
    "/{project_id}",
    response_model=DiagramCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new diagram",
)
async def create_diagram(project_id: str, req: CreateDiagramRequest):
    """Create a new diagram in the project directory."""
    validated_project = _validate_project_id(project_id)
    diagram_id = uuid.uuid4().hex[:12]
    xml_content = generate_initial_xml(req.name)
    _write_diagram_xml(validated_project, diagram_id, xml_content)
    return DiagramCreateResponse(diagram_id=diagram_id, name=req.name)


@router.get(
    "/{project_id}/{diagram_id}",
    response_model=DiagramInfo,
    summary="Get diagram info",
)
async def get_diagram(project_id: str, diagram_id: str) -> DiagramInfo:
    """Return whether the diagram exists."""
    validated_project = _validate_project_id(project_id)
    path = _diagram_path(validated_project, diagram_id)
    return DiagramInfo(
        diagram_id=diagram_id,
        name=diagram_id,  # TODO: extract from XML
        exists=os.path.isfile(path),
    )


@router.delete(
    "/{project_id}/{diagram_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a diagram (idempotent)",
)
async def delete_diagram(project_id: str, diagram_id: str) -> None:
    """Delete the diagram file. Idempotent: returns 204 even if not found."""
    validated_project = _validate_project_id(project_id)
    path = _diagram_path(validated_project, diagram_id)
    if os.path.isfile(path):
        os.remove(path)
    return None


# ---------------------------------------------------------------------------
# Shape operations
# ---------------------------------------------------------------------------

@router.post(
    "/{project_id}/{diagram_id}/shapes",
    response_model=ShapeResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a shape to a diagram",
)
async def add_shape(project_id: str, diagram_id: str, req: AddShapeRequest) -> ShapeResponse:
    """Add a shape (vertex) to an existing diagram."""
    validated_project = _validate_project_id(project_id)

    # Read existing diagram
    xml_content = _read_diagram_xml(validated_project, diagram_id)

    # Generate shape ID
    shape_id = f"shape_{uuid.uuid4().hex[:8]}"

    # Create shape XML
    shape_xml = create_shape_xml(
        shape_id=shape_id,
        shape_type=req.shape_type,
        label=req.label,
        x=req.x,
        y=req.y,
        width=req.width,
        height=req.height,
        style_override=req.style,
    )

    # Append to diagram
    xml_content = append_cell_to_xml(xml_content, shape_xml)

    # Write back
    _write_diagram_xml(validated_project, diagram_id, xml_content)

    return ShapeResponse(shape_id=shape_id)


# ---------------------------------------------------------------------------
# Connector operations
# ---------------------------------------------------------------------------

@router.post(
    "/{project_id}/{diagram_id}/connectors",
    response_model=ConnectorResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a connector between two shapes",
)
async def add_connector(project_id: str, diagram_id: str, req: AddConnectorRequest) -> ConnectorResponse:
    """Add a connector (edge) between two existing shapes."""
    validated_project = _validate_project_id(project_id)

    # Read existing diagram
    xml_content = _read_diagram_xml(validated_project, diagram_id)

    # Generate connector ID
    connector_id = f"edge_{uuid.uuid4().hex[:8]}"

    # Create connector XML
    connector_xml = create_connector_xml(
        connector_id=connector_id,
        from_id=req.from_shape_id,
        to_id=req.to_shape_id,
        label=req.label,
        connector_type=req.connector_type,
        arrow_start=req.arrow_start,
        arrow_end=req.arrow_end,
        style_override=req.style,
    )

    # Append to diagram
    xml_content = append_cell_to_xml(xml_content, connector_xml)

    # Write back
    _write_diagram_xml(validated_project, diagram_id, xml_content)

    return ConnectorResponse(connector_id=connector_id)
