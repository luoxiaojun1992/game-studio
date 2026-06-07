"""
Image operation routes for Image Service.

All routes validate project_id before calling into ImageMagick.
"""

import os
import glob as glob_mod
from fastapi import APIRouter, HTTPException, status

from app.safe_path import resolve_safe_path
from app.schemas import (
    AddMarginRequest,
    BatchRequest,
    ImageOperationResponse,
    ColorAdjustRequest,
    CompositeRequest,
    CompressRequest,
    ConvertRequest,
    CropRequest,
    FlipRotateRequest,
    ImageInfoRequest,
    ResizeRequest,
    SpriteSheetRequest,
    WatermarkRequest,
    _validate_project_id,
    _validate_filename,
)
from app.imagemagick import ImageMagickError, execute, IMAGEMAGICK_TIMEOUT_SEC, BATCH_TIMEOUT_SEC
from app.operations import (
    resize,
    crop,
    convert_format,
    compress,
    watermark_text,
    watermark_image,
    composite,
    flip_rotate,
    add_margin,
    color_adjust,
    image_info,
    batch,
    sprite_sheet,
)

router = APIRouter(prefix="/api/image", tags=["image"])

PROJECTS_ROOT = "/app/data/projects"


def _project_path(project_id: str) -> str:
    """Resolve project directory with path traversal protection."""
    try:
        return resolve_safe_path(PROJECTS_ROOT, project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _safe_join(base: str, filename: str) -> str:
    """Join filename to base directory with path traversal protection."""
    try:
        return resolve_safe_path(base, filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _check_project_exists(project_path: str, project_id: str):
    """Raise 404 if project directory does not exist."""
    if not os.path.isdir(project_path):
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")


def _image_result(stdout: str, message: str = "Operation completed", output_file: str = None) -> ImageOperationResponse:
    return ImageOperationResponse(success=True, output=stdout, message=message, output_file=output_file)


def _image_error(exc: ImageMagickError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=f"ImageMagick error: {exc}\nSTDERR:\n{exc.stderr}",
    )


# ============================================================================
# Image Operations
# ============================================================================


@router.post(
    "/resize",
    response_model=ImageOperationResponse,
    summary="Resize an image",
)
async def image_resize(req: ResizeRequest, project_id: str) -> ImageOperationResponse:
    """Resize an image to the specified dimensions."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, req.input_filename)
    output_path = _safe_join(project_path, req.output_filename)

    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"Input file not found: {req.input_filename}")

    try:
        cmd = resize(input_path, output_path, req.width, req.height, req.keep_aspect)
        stdout = execute(cmd)
        return _image_result(stdout, f"Resized to {req.width}x{req.height}", req.output_filename)
    except ImageMagickError as e:
        raise _image_error(e)


@router.post(
    "/crop",
    response_model=ImageOperationResponse,
    summary="Crop an image",
)
async def image_crop(req: CropRequest, project_id: str) -> ImageOperationResponse:
    """Crop an image to the specified region."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, req.input_filename)
    output_path = _safe_join(project_path, req.output_filename)

    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"Input file not found: {req.input_filename}")

    try:
        cmd = crop(input_path, output_path, req.width, req.height, req.x, req.y)
        stdout = execute(cmd)
        return _image_result(stdout, f"Cropped to {req.width}x{req.height}+{req.x}+{req.y}", req.output_filename)
    except ImageMagickError as e:
        raise _image_error(e)


@router.post(
    "/convert",
    response_model=ImageOperationResponse,
    summary="Convert image format",
)
async def image_convert(req: ConvertRequest, project_id: str) -> ImageOperationResponse:
    """Convert an image to a different format (PNG/JPG/WEBP/AVIF/GIF/BMP)."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, req.input_filename)
    output_path = _safe_join(project_path, req.output_filename)

    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"Input file not found: {req.input_filename}")

    try:
        cmd = convert_format(input_path, output_path, req.target_format)
        stdout = execute(cmd)
        return _image_result(stdout, f"Converted to {req.target_format}", req.output_filename)
    except ImageMagickError as e:
        raise _image_error(e)


@router.post(
    "/compress",
    response_model=ImageOperationResponse,
    summary="Compress an image",
)
async def image_compress(req: CompressRequest, project_id: str) -> ImageOperationResponse:
    """Compress an image by adjusting quality (1-100)."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, req.input_filename)
    output_path = _safe_join(project_path, req.output_filename)

    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"Input file not found: {req.input_filename}")

    try:
        cmd = compress(input_path, output_path, req.quality)
        stdout = execute(cmd)
        return _image_result(stdout, f"Compressed at quality {req.quality}", req.output_filename)
    except ImageMagickError as e:
        raise _image_error(e)


@router.post(
    "/watermark",
    response_model=ImageOperationResponse,
    summary="Add watermark to an image",
)
async def image_watermark(req: WatermarkRequest, project_id: str) -> ImageOperationResponse:
    """Add a text or image watermark overlay."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, req.input_filename)
    output_path = _safe_join(project_path, req.output_filename)

    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"Input file not found: {req.input_filename}")

    # content and text are aliases
    actual_content = req.content or req.text or ""

    try:
        if req.type == "text":
            cmd = watermark_text(input_path, output_path, actual_content, req.position, req.opacity)
        else:
            overlay_path = _safe_join(project_path, actual_content)
            if not os.path.isfile(overlay_path):
                raise HTTPException(status_code=404, detail=f"Overlay image not found: {actual_content}")
            cmd = watermark_image(input_path, overlay_path, output_path, req.position, req.opacity)

        stdout = execute(cmd)
        return _image_result(stdout, f"Watermark applied", req.output_filename)
    except ImageMagickError as e:
        raise _image_error(e)


@router.post(
    "/composite",
    response_model=ImageOperationResponse,
    summary="Composite two images",
)
async def image_composite(req: CompositeRequest, project_id: str) -> ImageOperationResponse:
    """Overlay one image on top of another."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    base_path = _safe_join(project_path, req.base_filename)
    overlay_path = _safe_join(project_path, req.overlay_filename)
    output_path = _safe_join(project_path, req.output_filename)

    if not os.path.isfile(base_path):
        raise HTTPException(status_code=404, detail=f"Base file not found: {req.base_filename}")
    if not os.path.isfile(overlay_path):
        raise HTTPException(status_code=404, detail=f"Overlay file not found: {req.overlay_filename}")

    try:
        cmd = composite(base_path, overlay_path, output_path, req.gravity, req.x, req.y)
        stdout = execute(cmd)
        return _image_result(stdout, f"Composited {req.overlay_filename} onto {req.base_filename}", req.output_filename)
    except ImageMagickError as e:
        raise _image_error(e)


@router.post(
    "/flip-rotate",
    response_model=ImageOperationResponse,
    summary="Flip or rotate an image",
)
async def image_flip_rotate(req: FlipRotateRequest, project_id: str) -> ImageOperationResponse:
    """Flip (horizontal/vertical) or rotate an image."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, req.input_filename)
    output_path = _safe_join(project_path, req.output_filename)

    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"Input file not found: {req.input_filename}")

    try:
        cmd = flip_rotate(input_path, output_path, req.mode, req.angle)
        stdout = execute(cmd)
        return _image_result(stdout, f"{req.mode} applied", req.output_filename)
    except ImageMagickError as e:
        raise _image_error(e)


@router.post(
    "/add-margin",
    response_model=ImageOperationResponse,
    summary="Add margin around an image",
)
async def image_add_margin(req: AddMarginRequest, project_id: str) -> ImageOperationResponse:
    """Add a colored margin/border around an image."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, req.input_filename)
    output_path = _safe_join(project_path, req.output_filename)

    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"Input file not found: {req.input_filename}")

    try:
        cmd = add_margin(input_path, output_path, req.top, req.right, req.bottom, req.left, req.color)
        stdout = execute(cmd)
        return _image_result(stdout, f"Margin added", req.output_filename)
    except ImageMagickError as e:
        raise _image_error(e)


@router.post(
    "/color-adjust",
    response_model=ImageOperationResponse,
    summary="Adjust image colors",
)
async def image_color_adjust(req: ColorAdjustRequest, project_id: str) -> ImageOperationResponse:
    """Adjust brightness, contrast, saturation, and hue."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, req.input_filename)
    output_path = _safe_join(project_path, req.output_filename)

    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"Input file not found: {req.input_filename}")

    try:
        cmd = color_adjust(
            input_path, output_path,
            req.brightness, req.contrast,
            req.saturation, req.hue,
        )
        stdout = execute(cmd)
        return _image_result(stdout, "Color adjusted", req.output_filename)
    except ImageMagickError as e:
        raise _image_error(e)


@router.get(
    "/info",
    summary="Get image information",
)
async def image_get_info(filename: str, project_id: str) -> dict:
    """Get detailed information about an image file."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, filename)
    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")

    try:
        cmd = image_info(input_path)
        stdout = execute(cmd)

        # Parse key info from verbose output
        info = {
            "filename": filename,
            "size_bytes": os.path.getsize(input_path),
        }

        for line in stdout.splitlines():
            line = line.strip()
            if line.startswith("Geometry:"):
                info["geometry"] = line.split(":")[1].strip()
            elif line.startswith("Format:"):
                info["format"] = line.split(":", 1)[1].strip().split(" ")[0]
            elif line.startswith("Type:"):
                info["type"] = line.split(":")[1].strip()
            elif line.startswith("Colorspace:"):
                info["colorspace"] = line.split(":")[1].strip()
            elif line.startswith("Channel depth:"):
                info["channel_depth"] = line.split(":")[1].strip()
            elif line.startswith("Resolution:"):
                info["resolution"] = line.split(":")[1].strip()

        return info
    except ImageMagickError as e:
        raise _image_error(e)


@router.post(
    "/batch",
    response_model=ImageOperationResponse,
    summary="Batch process images",
)
async def image_batch(req: BatchRequest, project_id: str) -> ImageOperationResponse:
    """Batch process multiple images with the same operation."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    # Resolve input pattern
    if "," in req.input_pattern:
        input_files = [f.strip() for f in req.input_pattern.split(",")]
    else:
        # Glob pattern
        pattern_path = _safe_join(project_path, req.input_pattern)
        matched = glob_mod.glob(pattern_path)
        input_files = [os.path.basename(f) for f in matched]

    if not input_files:
        raise HTTPException(status_code=400, detail="No input files matched")

    input_paths = [_safe_join(project_path, f) for f in input_files]

    # Ensure output dir
    output_dir_name = req.output_dir or "batch_output"
    output_dir = _safe_join(project_path, output_dir_name)
    os.makedirs(output_dir, exist_ok=True)

    try:
        commands = batch(input_paths, output_dir, req.operation, req.operation_params)
        results = []
        for cmd in commands:
            stdout = execute(cmd, timeout=BATCH_TIMEOUT_SEC)
            results.append(stdout)
        output_text = "\n".join(results)
        return _image_result(output_text, f"Batch {req.operation} completed ({len(input_files)} files)")
    except ImageMagickError as e:
        raise _image_error(e)


@router.post(
    "/sprite-sheet",
    response_model=ImageOperationResponse,
    summary="Create a sprite sheet",
)
async def image_sprite_sheet(req: SpriteSheetRequest, project_id: str) -> ImageOperationResponse:
    """Combine multiple images into a sprite sheet grid."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_paths = []
    for f in req.files:
        fp = _safe_join(project_path, f.strip())
        if not os.path.isfile(fp):
            raise HTTPException(status_code=404, detail=f"File not found: {f}")
        input_paths.append(fp)

    output_path = _safe_join(project_path, req.output_filename)

    try:
        cmd = sprite_sheet(input_paths, output_path, req.columns, req.rows)
        stdout = execute(cmd)
        return _image_result(stdout, f"Sprite sheet created ({req.columns}x{req.rows})", req.output_filename)
    except ImageMagickError as e:
        raise _image_error(e)
