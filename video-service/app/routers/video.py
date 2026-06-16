"""
Video operation routes for Video Service.

All routes validate project_id before calling into FFmpeg.
"""

import json
import os
from fastapi import APIRouter, HTTPException, status

from app.safe_path import resolve_safe_path
from app.schemas import (
    AddAudioRequest,
    AddTextRequest,
    AddWatermarkRequest,
    ChangeSpeedRequest,
    CompressRequest,
    ConcatRequest,
    ConvertRequest,
    CreateThumbnailRequest,
    CropRequest,
    ExtractAudioRequest,
    ExtractFramesRequest,
    GenerateGifRequest,
    GifToVideoRequest,
    ResizeRequest,
    RotateRequest,
    TrimRequest,
    VideoInfoRequest,
    VideoOperationResponse,
    _validate_project_id,
    _validate_filename,
)
from app.ffmpeg import (
    FFmpegError,
    execute,
    ffprobe_info,
    FFMPEG_TIMEOUT_SEC,
    CONCAT_TIMEOUT_SEC,
    COMPRESS_VERYSLOW_TIMEOUT_SEC,
    INFO_TIMEOUT_SEC,
)
from app.operations import (
    video_info,
    convert,
    trim,
    concat,
    resize,
    compress,
    crop,
    rotate,
    change_speed,
    extract_frames,
    extract_audio,
    add_audio,
    add_text,
    add_watermark,
    generate_gif,
    gif_to_video,
    create_thumbnail,
)

router = APIRouter(prefix="/api/video", tags=["video"])

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
        import sys
        print(f"[DEBUG:video] _check_project_exists 404 project_id={project_id} path={project_path} PROJECTS_ROOT={PROJECTS_ROOT} dirs={os.listdir(PROJECTS_ROOT) if os.path.isdir(PROJECTS_ROOT) else 'ROOT_MISSING'}", flush=True)
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")


def _video_result(stdout: str, message: str = "Operation completed", output_file: str = None, info: dict = None) -> VideoOperationResponse:
    return VideoOperationResponse(success=True, output=stdout, message=message, output_file=output_file, info=info)


def _video_error(exc: FFmpegError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=f"FFmpeg error: {exc}\nSTDERR:\n{exc.stderr}",
    )


# ============================================================================
# Video Info
# ============================================================================

@router.get(
    "/info",
    summary="Get video information",
)
async def get_video_info(filename: str, project_id: str) -> dict:
    """Get detailed metadata about a video file using ffprobe."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, filename)
    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")

    try:
        raw_json = ffprobe_info(input_path)
        probe_data = json.loads(raw_json)

        # Extract key info
        fmt = probe_data.get("format", {})
        video_stream = None
        audio_stream = None
        for s in probe_data.get("streams", []):
            if s.get("codec_type") == "video" and video_stream is None:
                video_stream = s
            elif s.get("codec_type") == "audio" and audio_stream is None:
                audio_stream = s

        info = {
            "filename": filename,
            "size_bytes": os.path.getsize(input_path),
            "duration": float(fmt.get("duration", 0)),
            "format_name": fmt.get("format_name", ""),
            "bitrate": fmt.get("bit_rate", ""),
        }

        if video_stream:
            info["width"] = video_stream.get("width")
            info["height"] = video_stream.get("height")
            info["codec"] = video_stream.get("codec_name")
            fps_str = video_stream.get("r_frame_rate", "0/1")
            try:
                num, den = fps_str.split("/")
                info["fps"] = round(float(num) / float(den), 2) if float(den) != 0 else 0
            except (ValueError, ZeroDivisionError):
                info["fps"] = 0

        info["has_audio"] = audio_stream is not None

        return info
    except FFmpegError as e:
        raise _video_error(e)


# ============================================================================
# Convert
# ============================================================================

@router.post(
    "/convert",
    response_model=VideoOperationResponse,
    summary="Convert video format",
)
async def video_convert(req: ConvertRequest, project_id: str) -> VideoOperationResponse:
    """Convert a video to a different format (MP4/WebM/MOV/GIF/AVI/MKV)."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, req.input_filename)
    output_path = _safe_join(project_path, req.output_filename)

    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"Input file not found: {req.input_filename}")

    try:
        cmd = convert(input_path, output_path, req.target_format, req.video_codec, req.audio_codec)
        stdout = execute(cmd)
        return _video_result(stdout, f"Converted to {req.target_format}", req.output_filename)
    except FFmpegError as e:
        raise _video_error(e)


# ============================================================================
# Trim
# ============================================================================

@router.post(
    "/trim",
    response_model=VideoOperationResponse,
    summary="Trim a video segment",
)
async def video_trim(req: TrimRequest, project_id: str) -> VideoOperationResponse:
    """Trim a video to the specified time range."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, req.input_filename)
    output_path = _safe_join(project_path, req.output_filename)

    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"Input file not found: {req.input_filename}")

    try:
        cmd = trim(input_path, output_path, req.start_time, req.duration, req.end_time)
        stdout = execute(cmd)
        return _video_result(stdout, f"Trimmed from {req.start_time}s", req.output_filename)
    except FFmpegError as e:
        raise _video_error(e)


# ============================================================================
# Concat
# ============================================================================

@router.post(
    "/concat",
    response_model=VideoOperationResponse,
    summary="Concatenate multiple videos",
)
async def video_concat(req: ConcatRequest, project_id: str) -> VideoOperationResponse:
    """Concatenate multiple video files into one."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_paths = []
    for f in req.input_filenames:
        fp = _safe_join(project_path, f.strip())
        if not os.path.isfile(fp):
            raise HTTPException(status_code=404, detail=f"Input file not found: {f}")
        input_paths.append(fp)

    output_path = _safe_join(project_path, req.output_filename)

    try:
        filelist_path, cmd = concat(input_paths, output_path, project_path)

        # Write filelist.txt
        with open(filelist_path, "w") as f:
            for p in input_paths:
                f.write(f"file '{p}'\n")

        stdout = execute(cmd, timeout=CONCAT_TIMEOUT_SEC)

        # Clean up filelist
        if os.path.isfile(filelist_path):
            os.remove(filelist_path)

        return _video_result(stdout, f"Concatenated {len(input_paths)} videos", req.output_filename)
    except FFmpegError as e:
        raise _video_error(e)


# ============================================================================
# Resize
# ============================================================================

@router.post(
    "/resize",
    response_model=VideoOperationResponse,
    summary="Resize a video",
)
async def video_resize(req: ResizeRequest, project_id: str) -> VideoOperationResponse:
    """Resize video to the specified dimensions."""
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
        return _video_result(stdout, f"Resized to {req.width}x{req.height}", req.output_filename)
    except FFmpegError as e:
        raise _video_error(e)


# ============================================================================
# Compress
# ============================================================================

@router.post(
    "/compress",
    response_model=VideoOperationResponse,
    summary="Compress a video",
)
async def video_compress(req: CompressRequest, project_id: str) -> VideoOperationResponse:
    """Compress video using CRF or bitrate control."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, req.input_filename)
    output_path = _safe_join(project_path, req.output_filename)

    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"Input file not found: {req.input_filename}")

    timeout = COMPRESS_VERYSLOW_TIMEOUT_SEC if req.preset in ("veryslow", "slower") else FFMPEG_TIMEOUT_SEC

    try:
        cmd = compress(input_path, output_path, req.crf, req.bitrate, req.preset)
        stdout = execute(cmd, timeout=timeout)
        return _video_result(stdout, f"Compressed (crf={req.crf})", req.output_filename)
    except FFmpegError as e:
        raise _video_error(e)


# ============================================================================
# Crop
# ============================================================================

@router.post(
    "/crop",
    response_model=VideoOperationResponse,
    summary="Crop a video",
)
async def video_crop(req: CropRequest, project_id: str) -> VideoOperationResponse:
    """Crop video to the specified region."""
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
        return _video_result(stdout, f"Cropped to {req.width}x{req.height}+{req.x}+{req.y}", req.output_filename)
    except FFmpegError as e:
        raise _video_error(e)


# ============================================================================
# Rotate
# ============================================================================

@router.post(
    "/rotate",
    response_model=VideoOperationResponse,
    summary="Rotate a video",
)
async def video_rotate(req: RotateRequest, project_id: str) -> VideoOperationResponse:
    """Rotate video by specified angle."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, req.input_filename)
    output_path = _safe_join(project_path, req.output_filename)

    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"Input file not found: {req.input_filename}")

    try:
        cmd = rotate(input_path, output_path, req.angle)
        stdout = execute(cmd)
        return _video_result(stdout, f"Rotated {req.angle}°", req.output_filename)
    except FFmpegError as e:
        raise _video_error(e)


# ============================================================================
# Change Speed
# ============================================================================

@router.post(
    "/change-speed",
    response_model=VideoOperationResponse,
    summary="Change playback speed",
)
async def video_change_speed(req: ChangeSpeedRequest, project_id: str) -> VideoOperationResponse:
    """Change video playback speed (0.25x to 4x)."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, req.input_filename)
    output_path = _safe_join(project_path, req.output_filename)

    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"Input file not found: {req.input_filename}")

    try:
        cmd = change_speed(input_path, output_path, req.speed)
        stdout = execute(cmd)
        return _video_result(stdout, f"Speed changed to {req.speed}x", req.output_filename)
    except FFmpegError as e:
        raise _video_error(e)


# ============================================================================
# Extract Frames
# ============================================================================

@router.post(
    "/extract-frames",
    response_model=VideoOperationResponse,
    summary="Extract frames as images",
)
async def video_extract_frames(req: ExtractFramesRequest, project_id: str) -> VideoOperationResponse:
    """Extract frames from video as image sequence."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, req.input_filename)
    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"Input file not found: {req.input_filename}")

    output_pattern_path = _safe_join(project_path, req.output_pattern)

    try:
        cmd = extract_frames(input_path, output_pattern_path, req.fps, req.frame_count, req.format)
        stdout = execute(cmd)
        return _video_result(stdout, f"Frames extracted at {req.fps}fps", req.output_pattern)
    except FFmpegError as e:
        raise _video_error(e)


# ============================================================================
# Extract Audio
# ============================================================================

@router.post(
    "/extract-audio",
    response_model=VideoOperationResponse,
    summary="Extract audio track",
)
async def video_extract_audio(req: ExtractAudioRequest, project_id: str) -> VideoOperationResponse:
    """Extract audio track from video file."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, req.input_filename)
    output_path = _safe_join(project_path, req.output_filename)

    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"Input file not found: {req.input_filename}")

    try:
        cmd = extract_audio(input_path, output_path, req.format)
        stdout = execute(cmd)
        return _video_result(stdout, f"Audio extracted to {req.format}", req.output_filename)
    except FFmpegError as e:
        raise _video_error(e)


# ============================================================================
# Add Audio
# ============================================================================

@router.post(
    "/add-audio",
    response_model=VideoOperationResponse,
    summary="Add or replace audio track",
)
async def video_add_audio(req: AddAudioRequest, project_id: str) -> VideoOperationResponse:
    """Add or replace the audio track of a video."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    video_path = _safe_join(project_path, req.video_filename)
    audio_path = _safe_join(project_path, req.audio_filename)
    output_path = _safe_join(project_path, req.output_filename)

    if not os.path.isfile(video_path):
        raise HTTPException(status_code=404, detail=f"Video file not found: {req.video_filename}")
    if not os.path.isfile(audio_path):
        raise HTTPException(status_code=404, detail=f"Audio file not found: {req.audio_filename}")

    try:
        cmd = add_audio(video_path, audio_path, output_path, req.mix)
        stdout = execute(cmd)
        action = "Mixed" if req.mix else "Replaced"
        return _video_result(stdout, f"{action} audio track", req.output_filename)
    except FFmpegError as e:
        raise _video_error(e)


# ============================================================================
# Add Text
# ============================================================================

@router.post(
    "/add-text",
    response_model=VideoOperationResponse,
    summary="Add text overlay",
)
async def video_add_text(req: AddTextRequest, project_id: str) -> VideoOperationResponse:
    """Add a text overlay to video."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, req.input_filename)
    output_path = _safe_join(project_path, req.output_filename)

    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"Input file not found: {req.input_filename}")

    try:
        cmd = add_text(input_path, output_path, req.text, req.x, req.y, req.font_size, req.color)
        stdout = execute(cmd)
        return _video_result(stdout, f"Text overlay added: '{req.text[:50]}'", req.output_filename)
    except FFmpegError as e:
        raise _video_error(e)


# ============================================================================
# Add Watermark
# ============================================================================

@router.post(
    "/add-watermark",
    response_model=VideoOperationResponse,
    summary="Add image watermark",
)
async def video_add_watermark(req: AddWatermarkRequest, project_id: str) -> VideoOperationResponse:
    """Add an image watermark overlay to video."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, req.input_filename)
    watermark_path = _safe_join(project_path, req.watermark_filename)
    output_path = _safe_join(project_path, req.output_filename)

    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"Input file not found: {req.input_filename}")
    if not os.path.isfile(watermark_path):
        raise HTTPException(status_code=404, detail=f"Watermark file not found: {req.watermark_filename}")

    try:
        cmd = add_watermark(input_path, watermark_path, output_path, req.position, req.opacity)
        stdout = execute(cmd)
        return _video_result(stdout, f"Watermark added at {req.position}", req.output_filename)
    except FFmpegError as e:
        raise _video_error(e)


# ============================================================================
# Generate GIF
# ============================================================================

@router.post(
    "/generate-gif",
    response_model=VideoOperationResponse,
    summary="Generate GIF from video",
)
async def video_generate_gif(req: GenerateGifRequest, project_id: str) -> VideoOperationResponse:
    """Convert video segment to an animated GIF."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, req.input_filename)
    output_path = _safe_join(project_path, req.output_filename)

    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"Input file not found: {req.input_filename}")

    try:
        cmd = generate_gif(input_path, output_path, req.fps, req.width)
        stdout = execute(cmd)
        return _video_result(stdout, f"GIF generated at {req.fps}fps", req.output_filename)
    except FFmpegError as e:
        raise _video_error(e)


# ============================================================================
# GIF to Video
# ============================================================================

@router.post(
    "/gif-to-video",
    response_model=VideoOperationResponse,
    summary="Convert GIF to video",
)
async def video_gif_to_video(req: GifToVideoRequest, project_id: str) -> VideoOperationResponse:
    """Convert a GIF file to video format."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, req.input_filename)
    output_path = _safe_join(project_path, req.output_filename)

    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"Input file not found: {req.input_filename}")

    try:
        cmd = gif_to_video(input_path, output_path, req.target_format)
        stdout = execute(cmd)
        return _video_result(stdout, f"GIF converted to {req.target_format}", req.output_filename)
    except FFmpegError as e:
        raise _video_error(e)


# ============================================================================
# Create Thumbnail
# ============================================================================

@router.post(
    "/create-thumbnail",
    response_model=VideoOperationResponse,
    summary="Create video thumbnail",
)
async def video_create_thumbnail(req: CreateThumbnailRequest, project_id: str) -> VideoOperationResponse:
    """Generate a thumbnail image from a video at the specified time."""
    validated_pid = _validate_project_id(project_id)
    project_path = _project_path(validated_pid)
    _check_project_exists(project_path, validated_pid)

    input_path = _safe_join(project_path, req.filename)
    output_path = _safe_join(project_path, req.output_filename)

    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail=f"File not found: {req.filename}")

    try:
        cmd = create_thumbnail(input_path, output_path, req.time, req.width)
        stdout = execute(cmd)
        return _video_result(stdout, f"Thumbnail created at {req.time}s", req.output_filename)
    except FFmpegError as e:
        raise _video_error(e)
