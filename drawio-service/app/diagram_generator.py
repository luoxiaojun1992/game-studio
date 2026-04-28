"""
Draw.io XML Diagram Generator.

Generates valid draw.io mxgraph XML for diagrams.
"""

import uuid
from typing import Optional

# ---------------------------------------------------------------------------
# Shape type to draw.io style mapping
# ---------------------------------------------------------------------------

SHAPE_STYLES = {
    "rectangle": "rounded=0;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;",
    "ellipse": "ellipse;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;",
    "diamond": "rhombus;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;",
    "parallelogram": "parallelogram;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;",
    "hexagon": "hexagon;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;",
    "cylinder": "cylinder;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;",
    "cloud": "cloud;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;",
    "process": "process;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d79b00;",
    "decision": "decision;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;",
    "document": "document;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#000000;",
    "person": "umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;fillColor=#ffffff;strokeColor=#000000;",
    "database": "shape=cylinder3;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;",
}

# Default style for unknown shape types
DEFAULT_SHAPE_STYLE = "rounded=0;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;"

# ---------------------------------------------------------------------------
# Connector style mapping
# ---------------------------------------------------------------------------

EDGE_STYLES = {
    "straight": "endArrow=none;html=1;",
    "orthogonal": "endArrow=none;html=1;rounded=0;",
    "elbow": "endArrow=none;html=1;rounded=0;elbow=1;",
    "curved": "endArrow=none;html=1;curved=1;",
}

DEFAULT_EDGE_STYLE = "endArrow=none;html=1;"


def _apply_style_overrides(base_style: str, style_override: Optional[dict]) -> str:
    """Apply style overrides to a base style string."""
    if not style_override:
        return base_style

    parts = base_style.rstrip(";").split(";")
    for key, value in style_override.items():
        if key == "fillColor":
            parts = [p for p in parts if not p.startswith("fillColor=")]
            parts.append(f"fillColor={value}")
        elif key == "strokeColor":
            parts = [p for p in parts if not p.startswith(("strokeColor=", "strokedecolor="))]
            parts.append(f"fillColor={value}")  # draw.io uses fillColor for edge stroke too in some cases
        elif key == "strokeWidth":
            parts = [p for p in parts if not p.startswith("strokeWidth=")]
            parts.append(f"strokeWidth={value}")

    return ";".join(parts) + ";"


def generate_initial_xml(diagram_name: str) -> str:
    """Generate the initial mxGraph XML document structure."""
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="DrawioService" modified="2024-01-01T00:00:00.000Z" agent="DrawioService/1.0" etag="1" version="21.0.0" type="device">
  <diagram name="{diagram_name}" id="diagram-1">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
'''


def create_shape_xml(
    shape_id: str,
    shape_type: str,
    label: str,
    x: float,
    y: float,
    width: float = 120.0,
    height: float = 60.0,
    style_override: Optional[dict] = None,
) -> str:
    """
    Generate draw.io XML for a shape (vertex).

    Args:
        shape_id: Unique ID for the shape cell
        shape_type: Type of shape (rectangle, ellipse, diamond, etc.)
        label: Text label displayed inside the shape
        x: X coordinate
        y: Y coordinate
        width: Shape width
        height: Shape height
        style_override: Optional style overrides (fillColor, strokeColor, strokeWidth)

    Returns:
        XML string for the mxCell element
    """
    base_style = SHAPE_STYLES.get(shape_type, DEFAULT_SHAPE_STYLE)
    style = _apply_style_overrides(base_style, style_override)

    # Escape XML special characters in label
    safe_label = (
        label.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )

    return f'''
    <mxCell id="{shape_id}" value="{safe_label}" style="{style}" vertex="1">
      <mxGeometry x="{x}" y="{y}" width="{width}" height="{height}" as="geometry"/>
    </mxCell>
    '''


def create_connector_xml(
    connector_id: str,
    from_id: str,
    to_id: str,
    label: str = "",
    connector_type: str = "straight",
    arrow_start: bool = False,
    arrow_end: bool = True,
    style_override: Optional[dict] = None,
) -> str:
    """
    Generate draw.io XML for a connector (edge).

    Args:
        connector_id: Unique ID for the connector cell
        from_id: Source shape cell ID
        to_id: Target shape cell ID
        label: Optional text label on the connector
        connector_type: Type of connector (straight, orthogonal, elbow, curved)
        arrow_start: Whether to add arrow at start
        arrow_end: Whether to add arrow at end
        style_override: Optional style overrides

    Returns:
        XML string for the mxCell element
    """
    base_style = EDGE_STYLES.get(connector_type, DEFAULT_EDGE_STYLE)

    # Handle arrows
    start_arrow = "none"
    end_arrow = "none"
    if arrow_start:
        start_arrow = "classic"
    if arrow_end:
        end_arrow = "classic"

    # Replace arrow settings in style
    parts = base_style.rstrip(";").split(";")
    parts = [p for p in parts if not p.startswith(("startArrow=", "endArrow="))]
    parts.append(f"startArrow={start_arrow}")
    parts.append(f"endArrow={end_arrow}")
    style = ";".join(parts) + ";"

    # Apply overrides
    style = _apply_style_overrides(style, style_override)

    # Escape XML special characters in label
    safe_label = (
        label.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )

    return f'''
    <mxCell id="{connector_id}" value="{safe_label}" style="{style}" edge="1" source="{from_id}" target="{to_id}">
      <mxGeometry as="geometry" relative="1"/>
    </mxCell>
    '''


def append_cell_to_xml(xml_content: str, cell_xml: str) -> str:
    """
    Append a cell XML snippet to existing diagram XML.

    Inserts the cell before the closing </root> tag.
    """
    # Find the position just before </root>
    closing_tag = "</root>"
    idx = xml_content.find(closing_tag)
    if idx == -1:
        raise ValueError("Invalid diagram XML: missing </root> tag")

    return xml_content[:idx] + cell_xml + "\n    " + closing_tag + xml_content[idx + len(closing_tag):]
