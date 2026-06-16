"""
FFmpeg command generators.

Each function returns the command list to be executed
via ffmpeg.execute().
"""

import os
from typing import Optional


# ---------------------------------------------------------------------------
# Video Operations
# ---------------------------------------------------------------------------

def video_info(input_path: str) -> list[str]:
    """Get video metadata via ffprobe (JSON)."""
    # This is handled directly by ffprobe_info in ffmpeg.py
    # We keep this as a placeholder for consistency
    return ["ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_format", "-show_streams", input_path]


def convert(
    input_path: str,
    output_path: str,
    target_format: str,
    video_codec: Optional[str] = None,
    audio_codec: Optional[str] = None,
) -> list[str]:
    """Convert video to a different format."""
    cmd = ["ffmpeg", "-y", "-i", input_path]

    # Video codec
    vc = video_codec or _default_video_codec(target_format)
    if vc:
        cmd.extend(["-c:v", _codec_name(vc)])

    # Audio codec
    ac = audio_codec or _default_audio_codec(target_format)
    if ac:
        cmd.extend(["-c:a", _codec_name(ac)])

    cmd.append(output_path)
    return cmd


def trim(
    input_path: str,
    output_path: str,
    start_time: float,
    duration: Optional[float] = None,
    end_time: Optional[float] = None,
) -> list[str]:
    """Trim a video segment."""
    cmd = ["ffmpeg", "-y"]
    cmd.extend(["-ss", _format_time(start_time)])
    cmd.extend(["-i", input_path])

    if duration is not None:
        cmd.extend(["-t", str(duration)])
    elif end_time is not None:
        cmd.extend(["-to", _format_time(end_time)])

    # Use copy codec for fast trimming (no re-encode)
    cmd.extend(["-c", "copy", output_path])
    return cmd


def concat(
    input_paths: list[str],
    output_path: str,
    work_dir: str,
) -> tuple[str, list[str]]:
    """
    Concatenate multiple videos.

    Returns:
        Tuple of (filelist_path, ffmpeg_command)
    """
    filelist_path = os.path.join(work_dir, "filelist.txt")
    # Build the command
    cmd = [
        "ffmpeg", "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", filelist_path,
        "-c", "copy",
        output_path,
    ]
    return filelist_path, cmd


def resize(
    input_path: str,
    output_path: str,
    width: int,
    height: int,
    keep_aspect: bool = True,
) -> list[str]:
    """Resize video to target dimensions."""
    if keep_aspect:
        vf = (
            f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2"
        )
    else:
        vf = f"scale={width}:{height}"

    return ["ffmpeg", "-y", "-i", input_path, "-vf", vf, output_path]


def compress(
    input_path: str,
    output_path: str,
    crf: int = 23,
    bitrate: Optional[str] = None,
    preset: str = "medium",
) -> list[str]:
    """Compress video using CRF or bitrate control."""
    cmd = ["ffmpeg", "-y", "-i", input_path]

    if bitrate:
        cmd.extend(["-b:v", bitrate])
    else:
        cmd.extend(["-crf", str(crf)])

    cmd.extend(["-preset", preset, output_path])
    return cmd


def crop(
    input_path: str,
    output_path: str,
    width: int,
    height: int,
    x: int,
    y: int,
) -> list[str]:
    """Crop a video region."""
    vf = f"crop={width}:{height}:{x}:{y}"
    return ["ffmpeg", "-y", "-i", input_path, "-vf", vf, output_path]


def rotate(
    input_path: str,
    output_path: str,
    angle: int,
) -> list[str]:
    """Rotate video by specified angle."""
    if angle == 90:
        vf = "transpose=1"
    elif angle == 180:
        vf = "transpose=2,transpose=2"
    elif angle == 270:
        vf = "transpose=2"
    else:
        # Use rotate filter for arbitrary angles
        vf = f"rotate={angle}*PI/180"

    return ["ffmpeg", "-y", "-i", input_path, "-vf", vf, output_path]


def change_speed(
    input_path: str,
    output_path: str,
    speed: float,
) -> list[str]:
    """Change playback speed."""
    setpts = 1.0 / speed
    atempo = speed

    if atempo < 0.5:
        atempo_str = f"atempo=0.5,atempo={atempo / 0.5}"
    elif atempo > 2.0:
        atempo_str = f"atempo=2.0,atempo={atempo / 2.0}"
    else:
        atempo_str = f"atempo={atempo}"

    filter_complex = f"[0:v]setpts={setpts}*PTS[v];[0:a]{atempo_str}[a]"
    return [
        "ffmpeg", "-y", "-i", input_path,
        "-filter_complex", filter_complex,
        "-map", "[v]", "-map", "[a]",
        output_path,
    ]


def extract_frames(
    input_path: str,
    output_pattern: str,
    fps: int = 1,
    frame_count: Optional[int] = None,
    image_format: str = "png",
) -> list[str]:
    """Extract frames as image sequence."""
    vf = f"fps={fps}"
    cmd = ["ffmpeg", "-y", "-i", input_path, "-vf", vf]

    if frame_count is not None:
        cmd.extend(["-vframes", str(frame_count)])

    cmd.append(output_pattern)
    return cmd


def extract_audio(
    input_path: str,
    output_path: str,
    audio_format: str = "mp3",
) -> list[str]:
    """Extract audio track from video."""
    ac = _audio_format_codec(audio_format)
    cmd = ["ffmpeg", "-y", "-i", input_path, "-vn"]
    cmd.extend(["-c:a", ac])
    cmd.append(output_path)
    return cmd


def add_audio(
    video_path: str,
    audio_path: str,
    output_path: str,
    mix: bool = False,
) -> list[str]:
    """Add or replace audio track."""
    if mix:
        # Mix original audio with new audio
        filter_complex = (
            "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2[aout]"
        )
        return [
            "ffmpeg", "-y",
            "-i", video_path,
            "-i", audio_path,
            "-filter_complex", filter_complex,
            "-map", "0:v", "-map", "[aout]",
            "-c:v", "copy",
            "-shortest",
            output_path,
        ]
    else:
        # Replace audio
        return [
            "ffmpeg", "-y",
            "-i", video_path,
            "-i", audio_path,
            "-c:v", "copy",
            "-c:a", "aac",
            "-map", "0:v:0", "-map", "1:a:0",
            "-shortest",
            output_path,
        ]


def add_text(
    input_path: str,
    output_path: str,
    text: str,
    x: int = 10,
    y: int = 10,
    font_size: int = 24,
    color: str = "white",
) -> list[str]:
    """Add text overlay to video."""
    # Escape special characters in text for drawtext filter
    escaped_text = _escape_drawtext(text)
    vf = (
        f"drawtext=text='{escaped_text}':"
        f"fontsize={font_size}:"
        f"fontcolor={color}:"
        f"x={x}:y={y}"
    )
    return ["ffmpeg", "-y", "-i", input_path, "-vf", vf, output_path]


def add_watermark(
    input_path: str,
    watermark_path: str,
    output_path: str,
    position: str = "bottom-right",
    opacity: float = 0.5,
) -> list[str]:
    """Add image watermark overlay."""
    overlay_expr = _watermark_overlay(position)

    filter_complex = (
        f"[1:v]format=rgba,colorchannelmixer=aa={opacity}[wm];"
        f"[0:v][wm]overlay={overlay_expr}"
    )

    return [
        "ffmpeg", "-y",
        "-i", input_path,
        "-i", watermark_path,
        "-filter_complex", filter_complex,
        output_path,
    ]


def generate_gif(
    input_path: str,
    output_path: str,
    fps: int = 10,
    width: Optional[int] = 480,
) -> list[str]:
    """Convert video segment to GIF."""
    vf_parts = [f"fps={fps}"]
    if width:
        vf_parts.append(f"scale={width}:-1:flags=lanczos")
    vf = ",".join(vf_parts)

    # Use palettegen+paletteuse for better quality
    filter_complex = (
        f"[0:v]{vf},split[a][b];"
        f"[a]palettegen[palette];"
        f"[b][palette]paletteuse"
    )

    return [
        "ffmpeg", "-y",
        "-i", input_path,
        "-filter_complex", filter_complex,
        "-loop", "0",
        output_path,
    ]


def gif_to_video(
    input_path: str,
    output_path: str,
    target_format: str = "mp4",
) -> list[str]:
    """Convert GIF to video format."""
    vc = _default_video_codec(target_format)
    cmd = ["ffmpeg", "-y", "-i", input_path]

    if vc:
        cmd.extend(["-c:v", _codec_name(vc)])

    cmd.extend(["-pix_fmt", "yuv420p", output_path])
    return cmd


def create_thumbnail(
    input_path: str,
    output_path: str,
    time: float = 5.0,
    width: Optional[int] = 320,
) -> list[str]:
    """Generate a thumbnail image from video."""
    vf_parts = []
    if width:
        vf_parts.append(f"scale={width}:-1")

    cmd = ["ffmpeg", "-y"]
    cmd.extend(["-ss", _format_time(time)])
    cmd.extend(["-i", input_path])
    cmd.extend(["-vframes", "1"])

    if vf_parts:
        cmd.extend(["-vf", ",".join(vf_parts)])

    cmd.append(output_path)
    return cmd


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _format_time(seconds: float) -> str:
    """Format seconds to HH:MM:SS.mmm."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def _default_video_codec(target_format: str) -> Optional[str]:
    """Get default video codec for a given format."""
    codecs = {
        "mp4": "h264",
        "webm": "vp9",
        "mov": "h264",
        "avi": "h264",
        "mkv": "h264",
        "gif": None,
    }
    return codecs.get(target_format)


def _default_audio_codec(target_format: str) -> Optional[str]:
    """Get default audio codec for a given format."""
    codecs = {
        "mp4": "aac",
        "webm": "opus",
        "mov": "aac",
        "avi": "mp3",
        "mkv": "aac",
        "gif": None,
    }
    return codecs.get(target_format)


def _codec_name(codec: str) -> str:
    """Map codec name to FFmpeg encoder name."""
    mapping = {
        "h264": "libx264",
        "h265": "libx265",
        "vp8": "libvpx",
        "vp9": "libvpx-vp9",
        "av1": "libaom-av1",
        "aac": "aac",
        "mp3": "libmp3lame",
        "opus": "libopus",
        "vorbis": "libvorbis",
        "copy": "copy",
    }
    return mapping.get(codec, codec)


def _audio_format_codec(audio_format: str) -> str:
    """Map audio format to FFmpeg codec."""
    mapping = {
        "mp3": "libmp3lame",
        "aac": "aac",
        "ogg": "libvorbis",
        "opus": "libopus",
        "wav": "pcm_s16le",
    }
    return mapping.get(audio_format, "copy")


def _escape_drawtext(text: str) -> str:
    """Escape special chars for FFmpeg drawtext filter."""
    # Escape single quotes, colons, and backslashes
    text = text.replace("\\", "\\\\")
    text = text.replace("'", "\\'")
    text = text.replace(":", "\\:")
    return text


def _watermark_overlay(position: str) -> str:
    """Generate FFmpeg overlay expression for watermark position."""
    positions = {
        "top-left": "10:10",
        "top-right": "main_w-overlay_w-10:10",
        "bottom-left": "10:main_h-overlay_h-10",
        "bottom-right": "main_w-overlay_w-10:main_h-overlay_h-10",
        "center": "(main_w-overlay_w)/2:(main_h-overlay_h)/2",
    }
    return positions.get(position, "main_w-overlay_w-10:main_h-overlay_h-10")
