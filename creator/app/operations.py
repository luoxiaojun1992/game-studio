"""
Pre-built atomic Blender operations.

Each function returns the Blender Python script string to be executed
via blender.execute_script().
"""

from typing import Literal

# ---------------------------------------------------------------------------
# Mesh types
# ---------------------------------------------------------------------------
MESH_TYPES = Literal["cube", "sphere", "plane", "cylinder", "torus", "cone"]
EXPORT_FORMATS = Literal["glb", "fbx", "obj", "ply", "usd"]
BOOLEAN_OPS = Literal["UNION", "DIFFERENCE", "INTERSECT"]
MODIFIER_TYPES = Literal["SUBSURF", "BEVEL", "DISPLACEMENT", "SOLIDIFY"]

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _ensure_object(script_lines: list[str], obj_name: str) -> None:
    script_lines.append(
        f"obj = bpy.data.objects.get('{obj_name}')\n"
        f"if obj is None:\n"
        f"    raise RuntimeError(f\"Object '{obj_name}' not found in scene\")\n"
    )


def _location_tuple(loc: tuple[float, float, float] | list[float]) -> str:
    return f"({loc[0]}, {loc[1]}, {loc[2]})"


def _scale_tuple(scale: tuple[float, float, float] | list[float]) -> str:
    return f"({scale[0]}, {scale[1]}, {scale[2]})"


# ---------------------------------------------------------------------------
# Operations
# ---------------------------------------------------------------------------


def create_mesh(
    mesh_type: MESH_TYPES,
    object_name: str,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    scale: tuple[float, float, float] = (1.0, 1.0, 1.0),
) -> str:
    """
    Create a primitive mesh in the Blender scene.

    Args:
        mesh_type: One of cube / sphere / plane / cylinder / torus / cone.
        object_name: Name for the new object.
        location: (x, y, z) coordinates.
        rotation: (x, y, z) Euler angles in radians.
        scale: (x, y, z) scale factors.
    """
    location_str = _location_tuple(location)
    rotation_str = _location_tuple(rotation)
    scale_str = _scale_tuple(scale)

    script = f"""
import bpy

# Remove existing object with the same name if present
if bpy.data.objects.get('{object_name}'):
    bpy.data.objects.remove(bpy.data.objects['{object_name}'], do_unlink=True)

# Create mesh primitive
mesh_type = '{mesh_type}'
if mesh_type == 'cube':
    bpy.ops.mesh.primitive_cube_add(location={location_str}, rotation={rotation_str})
elif mesh_type == 'sphere':
    bpy.ops.mesh.primitive_uv_sphere_add(location={location_str}, rotation={rotation_str}, segments=32, ring_count=16)
elif mesh_type == 'plane':
    bpy.ops.mesh.primitive_plane_add(location={location_str}, rotation={rotation_str}, size=2.0)
elif mesh_type == 'cylinder':
    bpy.ops.mesh.primitive_cylinder_add(location={location_str}, rotation={rotation_str}, depth=2.0, radius=1.0)
elif mesh_type == 'torus':
    bpy.ops.mesh.primitive_torus_add(location={location_str}, rotation={rotation_str})
elif mesh_type == 'cone':
    bpy.ops.mesh.primitive_cone_add(location={location_str}, rotation={rotation_str}, cap_end=True)

obj = bpy.context.active_object
obj.name = '{object_name}'
obj.scale = {scale_str}

bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
print(f"CREATED_OBJECT={{'{{'}}obj.name{{'}}'}}")
"""
    return script.strip()


def add_material(
    object_name: str,
    color: tuple[float, float, float] = (0.8, 0.8, 0.8),
    metallic: float = 0.0,
    roughness: float = 0.5,
    emission: tuple[float, float, float] | None = None,
    emission_strength: float = 0.0,
) -> str:
    """
    Add or replace a PBR material on an object.

    Args:
        object_name: Target object name.
        color: RGB (0–1).
        metallic: Metallic value 0–1.
        roughness: Roughness value 0–1.
        emission: Optional emission RGB (0–1).
        emission_strength: Emission intensity.
    """
    emission_str = f"({emission[0]}, {emission[1]}, {emission[2]})" if emission else "(0.0, 0.0, 0.0)"
    script = f"""
import bpy

obj = bpy.data.objects.get('{object_name}')
if obj is None:
    raise RuntimeError("Object not found: {object_name}")

# Create or replace material
mat_name = '{object_name}_Mat'
if mat_name in bpy.data.materials:
    mat = bpy.data.materials[mat_name]
    mat.use_nodes = True
else:
    mat = bpy.data.materials.new(name=mat_name)
    mat.use_nodes = True

nodes = mat.node_tree.nodes
bsdf = nodes.get('Principled BSDF')
if bsdf is None:
    bsdf = nodes.new(type='ShaderNodeBsdfPrincipled')

bsdf.inputs['Base Color'].default_value = ({color[0]}, {color[1]}, {color[2]}, 1.0)
bsdf.inputs['Metallic'].default_value = {metallic}
bsdf.inputs['Roughness'].default_value = {roughness}
bsdf.inputs['Emission Color'].default_value = {emission_str}
bsdf.inputs['Emission Strength'].default_value = {emission_strength}

# Assign material to object
if obj.data.materials:
    obj.data.materials[0] = mat
else:
    obj.data.materials.append(mat)

print(f"MATERIAL_ASSIGNED={{'{{'}}mat.name{{'}}'}}")
"""
    return script.strip()


def boolean_operation(
    object_a: str,
    object_b: str,
    operator: BOOLEAN_OPS,
    result_name: str,
) -> str:
    """
    Apply a boolean modifier between two mesh objects.

    Args:
        object_a: The object the modifier will be applied to (kept).
        object_b: The cutting/capping object (removed after operation).
        operator: UNION | DIFFERENCE | INTERSECT.
        result_name: Name for the resulting object.
    """
    script = f"""
import bpy

obj_a = bpy.data.objects.get('{object_a}')
obj_b = bpy.data.objects.get('{object_b}')
if obj_a is None:
    raise RuntimeError("Object not found: {object_a}")
if obj_b is None:
    raise RuntimeError("Object not found: {object_b}")

# Apply boolean modifier
bpy.context.view_layer.objects.active = obj_a
obj_a.select_set(True)
obj_b.select_set(True)

bpy.ops.object.modifier_add(type='BOOLEAN')
bool_mod = obj_a.modifiers.active
bool_mod.operation = '{operator}'
bool_mod.object = obj_b
bpy.ops.object.modifier_apply(modifier=bool_mod.name)

# Remove object_b
bpy.data.objects.remove(obj_b, do_unlink=True)
obj_a.name = '{result_name}'

print(f"BOOLEAN_RESULT={{'{{'}}obj_a.name{{'}}'}}")
"""
    return script.strip()


def add_modifier(
    object_name: str,
    modifier_type: MODIFIER_TYPES,
    levels: int = 2,
) -> str:
    """
    Add a modifier to an object.

    Args:
        object_name: Target object.
        modifier_type: SUBSURF | BEVEL | DISPLACEMENT | SOLIDIFY.
        levels: Subdivision levels or bevel segments.
    """
    script = f"""
import bpy

obj = bpy.data.objects.get('{object_name}')
if obj is None:
    raise RuntimeError("Object not found: {object_name}")

mod = obj.modifiers.new(name='{modifier_type}', type='{modifier_type}')

if '{modifier_type}' == 'SUBSURF':
    mod.levels = {levels}
    mod.render_levels = {levels}
elif '{modifier_type}' == 'BEVEL':
    mod.segments = {levels}
    mod.limit_method = 'ANGLE'
elif '{modifier_type}' == 'SOLIDIFY':
    mod.thickness = 0.1

bpy.ops.object.modifier_apply(modifier=mod.name)
print(f"MODIFIER_ADDED={{'{{'}}mod.name{{'}}'}}")
"""
    return script.strip()


def export_model(
    object_name: str,
    output_path: str,
    format: EXPORT_FORMATS = "glb",
) -> str:
    """
    Export an object to a file.

    Args:
        object_name: Object to export.
        output_path: Full path (including filename) for the output file.
        format: glb | fbx | obj | ply | usd.
    """
    script = f"""
import bpy
import os

obj = bpy.data.objects.get('{object_name}')
if obj is None:
    raise RuntimeError("Object not found: {object_name}")

# Ensure output directory exists
out_dir = os.path.dirname('{output_path}')
os.makedirs(out_dir, exist_ok=True)

# Select only the object for export
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.context.view_layer.objects.active = obj

fmt = '{format}'
path = '{output_path}'

if fmt == 'glb':
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB')
elif fmt == 'fbx':
    bpy.ops.export_scene.fbx(filepath=path)
elif fmt == 'obj':
    bpy.ops.wm.obj_export(filepath=path)
elif fmt == 'ply':
    bpy.ops.export_mesh.ply(filepath=path)
elif fmt == 'usd':
    bpy.ops.wm.usd_export(filepath=path)

    print(f"EXPORTED={{'{{'}}path{{'}}'}}")
"""
    return script.strip()


def list_objects() -> str:
    """
    List all objects in the current Blender scene with type and location.
    Outputs JSON to stdout for parsing.
    """
    return '''
import bpy
import json

objects = []
for obj in bpy.data.objects:
    loc = obj.location
    objects.append({
        "name": obj.name,
        "type": obj.type,
        "location": [loc.x, loc.y, loc.z],
    })
print("LIST_OBJECTS=" + json.dumps({"objects": objects}))
'''
    return script.strip()
