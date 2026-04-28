"""
Export routes for Drawio Service.

Exports diagrams using the draw.io export server.
"""

import os
from fastapi import APIRouter, HTTPException, Query, Response
import httpx

from app.schemas import _validate_project_id
from app.routers.diagram import _diagram_path, _read_diagram_xml

router = APIRouter(prefix="/api/export", tags=["export"])

PROJECTS_ROOT = "/app/data/projects"
DRAWIO_EXPORT_URL = os.getenv("DRAWIO_EXPORT_URL", "http://drawio-export:8080/export")


@router.get(
    "/{project_id}/{diagram_id}",
    summary="Export diagram to PNG/SVG/PDF",
)
async def export_diagram(
    project_id: str,
    diagram_id: str,
    format: str = Query("png", regex="^(png|svg|pdf|xml)$"),
    scale: float = Query(1.0, ge=0.1, le=10.0),
    transparent: bool = Query(False),
):
    """
    Export a diagram using the draw.io export server.

    Args:
        project_id: Draw.io project ID
        diagram_id: Diagram ID
        format: Export format (png, svg, pdf, xml)
        scale: Scale factor for raster formats (PNG)
        transparent: Use transparent background for PNG

    Returns:
        The exported file content
    """
    validated_project = _validate_project_id(project_id)

    # Read diagram XML
    try:
        xml_content = _read_diagram_xml(validated_project, diagram_id)
    except HTTPException:
        raise HTTPException(status_code=404, detail=f"Diagram not found: {diagram_id}")

    # Build export URL with query params
    params = f"format={format}&scale={scale}&transparent={transparent}"
    export_url = f"{DRAWIO_EXPORT_URL}?{params}"

    # Call draw.io export server
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                export_url,
                content=xml_content.encode("utf-8"),
                headers={"Content-Type": "application/xml"},
            )
    except httpx.ConnectError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Cannot connect to draw.io export server: {e}"
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Export server returned {response.status_code}: {response.text[:500]}"
        )

    # Determine content type
    content_types = {
        "png": "image/png",
        "svg": "image/svg+xml",
        "pdf": "application/pdf",
        "xml": "application/xml",
    }
    content_type = content_types.get(format, "application/octet-stream")

    return Response(content=response.content, media_type=content_type)
