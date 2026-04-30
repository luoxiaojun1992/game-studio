"""
Blender operation routes.

All routes validate project_id before calling into Blender.
"""

import os
from fastapi import APIRouter, HTTPException, Query, status

from app.safe_path import resolve_safe_path

from app.schemas import (
    AddMaterialRequest,
    AddModifierRequest,
    BlenderObjectInfo,
    BlenderOperationResponse,
    BooleanRequest,
    CreateMeshRequest,
    ExportRequest,
    ListObjectsResponse,
    _validate_project_id,
)
from app.blender import BlenderError, execute_script
from app.operations import (
    add_material,
    add_modifier,
    boolean_operation,
    create_mesh,
    export_model,
    list_objects,
)

router = APIRouter(prefix="/api/blender", tags=["blender"])

PROJECTS_ROOT = "/app/data/projects"


def _project_path(project_id: str) -> str:
    """Resolve project directory with path traversal protection."""
    try:
        return resolve_safe_path(PROJECTS_ROOT, project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _blender_result(stdout: str, message: str = "Operation completed") -> BlenderOperationResponse:
    return BlenderOperationResponse(success=True, output=stdout, message=message)


def _blender_error(exc: BlenderError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=f"Blender error: {exc.message}\nSTDERR:\n{exc.stderr}",
    )


@router.post(
    "/create_mesh",
    response_model=BlenderOperationResponse,
    summary="Create a primitive mesh",
)
async def blender_create_mesh(req: CreateMeshRequest, project_id: str) -> BlenderOperationResponse:
    """Create a primitive mesh (cube / sphere / plane / cylinder / torus / cone)."""
    validated_pid = _validate_project_id(project_id)
    path = _project_path(validated_pid)
    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    try:
        script = create_mesh(
            mesh_type=req.mesh_type,
            object_name=req.name,
            location=req.location,
            rotation=req.rotation,
            scale=req.scale,
        )
        stdout = execute_script(script, path)
        return _blender_result(stdout, f"Mesh '{req.name}' created")
    except BlenderError as e:
        raise _blender_error(e)


@router.post(
    "/add_material",
    response_model=BlenderOperationResponse,
    summary="Add a PBR material to an object",
)
async def blender_add_material(req: AddMaterialRequest, project_id: str) -> BlenderOperationResponse:
    """Add or replace a PBR material on an existing object."""
    validated_pid = _validate_project_id(project_id)
    path = _project_path(validated_pid)
    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    try:
        script = add_material(
            object_name=req.object_name,
            color=req.color,
            metallic=req.metallic,
            roughness=req.roughness,
            emission=req.emission,
            emission_strength=req.emission_strength,
        )
        stdout = execute_script(script, path)
        return _blender_result(stdout, f"Material applied to '{req.object_name}'")
    except BlenderError as e:
        raise _blender_error(e)


@router.post(
    "/boolean",
    response_model=BlenderOperationResponse,
    summary="Apply a boolean operation between two objects",
)
async def blender_boolean(req: BooleanRequest, project_id: str) -> BlenderOperationResponse:
    """Apply boolean UNION / DIFFERENCE / INTERSECT between two mesh objects."""
    validated_pid = _validate_project_id(project_id)
    path = _project_path(validated_pid)
    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    try:
        script = boolean_operation(
            object_a=req.object_a,
            object_b=req.object_b,
            operator=req.operator,
            result_name=req.result_name,
        )
        stdout = execute_script(script, path)
        return _blender_result(stdout, f"Boolean {req.operator} result: {req.result_name}")
    except BlenderError as e:
        raise _blender_error(e)


@router.post(
    "/add_modifier",
    response_model=BlenderOperationResponse,
    summary="Add a modifier to an object",
)
async def blender_add_modifier(req: AddModifierRequest, project_id: str) -> BlenderOperationResponse:
    """Add a modifier (SUBSURF / BEVEL / DISPLACEMENT / SOLIDIFY) to an object."""
    validated_pid = _validate_project_id(project_id)
    path = _project_path(validated_pid)
    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    try:
        script = add_modifier(
            object_name=req.object_name,
            modifier_type=req.modifier_type,
            levels=req.levels,
        )
        stdout = execute_script(script, path)
        return _blender_result(stdout, f"Modifier {req.modifier_type} added to '{req.object_name}'")
    except BlenderError as e:
        raise _blender_error(e)


@router.post(
    "/export",
    response_model=BlenderOperationResponse,
    summary="Export an object to a file",
)
async def blender_export(req: ExportRequest, project_id: str) -> BlenderOperationResponse:
    """Export an object to GLB / FBX / OBJ / PLY / USD format."""
    validated_pid = _validate_project_id(project_id)
    path = _project_path(validated_pid)
    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    try:
        # Build output path inside project directory
        output_filename = req.output_filename
        # Double-check no path separators
        if "/" in output_filename or "\\" in output_filename:
            raise HTTPException(status_code=400, detail="output_filename must not contain path separators")
        output_path = os.path.join(path, output_filename)

        script = export_model(
            object_name=req.object_name,
            output_path=output_path,
            format=req.format,
        )
        stdout = execute_script(script, path)
        return _blender_result(stdout, f"Exported '{req.object_name}' to {req.output_filename}")
    except BlenderError as e:
        raise _blender_error(e)


@router.get(
    "/list_objects",
    response_model=ListObjectsResponse,
    summary="List all objects in the Blender scene",
)
async def blender_list_objects(
    project_id: str,
    page: int = Query(default=1, ge=1, description="Page number (1-based)"),
    page_size: int = Query(default=20, ge=1, le=100, description="Items per page"),
    object_type: str | None = Query(default=None, description="Filter by object type, e.g. MESH"),
) -> ListObjectsResponse:
    """List all objects in the current Blender scene with type and location."""
    validated_pid = _validate_project_id(project_id)
    path = _project_path(validated_pid)
    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")

    try:
        script = list_objects()
        stdout = execute_script(script, path)

        # Parse JSON from stdout
        all_objects: list[dict] = []
        for line in stdout.splitlines():
            if line.startswith("LIST_OBJECTS="):
                payload = line[len("LIST_OBJECTS="):]
                import json
                data = json.loads(payload)
                all_objects = data.get("objects", [])
                break

        # Filter by type
        if object_type:
            all_objects = [o for o in all_objects if o.get("type") == object_type]

        total = len(all_objects)
        offset = (page - 1) * page_size
        page_objects = all_objects[offset:offset + page_size]

        return ListObjectsResponse(
            project_id=project_id,
            objects=[BlenderObjectInfo(**o) for o in page_objects],
            total=total,
            page=page,
            page_size=page_size,
        )
    except BlenderError as e:
        raise _blender_error(e)
