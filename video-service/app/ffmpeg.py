"""
FFmpeg CLI wrapper.

Uses `ffmpeg` and `ffprobe` CLI to execute video processing commands
inside a subprocess, capturing stdout/stderr and returning structured results.
"""

import subprocess
import os
from typing import Optional

FFMPEG_TIMEOUT_SEC = 300
CONCAT_TIMEOUT_SEC = 600
COMPRESS_VERYSLOW_TIMEOUT_SEC = 600
INFO_TIMEOUT_SEC = 30


class FFmpegError(Exception):
    """Raised when FFmpeg execution fails (non-zero exit or command error)."""

    def __init__(self, message: str, stderr: str = "", stdout: str = ""):
        super().__init__(message)
        self.stderr = stderr
        self.stdout = stdout


def execute(cmd: list[str], timeout: int = FFMPEG_TIMEOUT_SEC) -> str:
    """
    Execute an FFmpeg command via subprocess.

    Args:
        cmd: Command list, e.g. ['ffmpeg', '-i', 'input.mp4', 'output.mp4']
        timeout: Seconds before the subprocess is killed.

    Returns:
        stderr from FFmpeg (FFmpeg outputs info to stderr by design).

    Raises:
        FFmpegError: If FFmpeg exits non-zero or times out.
    """
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise FFmpegError(
            f"FFmpeg timed out after {timeout}s",
            stderr=f"Process killed after {timeout}s timeout",
        )
    except FileNotFoundError:
        raise FFmpegError(
            "FFmpeg executable not found. Is FFmpeg installed in this container?",
            stderr="ffmpeg: command not found",
        )

    if result.returncode != 0:
        raise FFmpegError(
            f"FFmpeg exited with code {result.returncode}",
            stderr=result.stderr,
            stdout=result.stdout,
        )

    # FFmpeg writes progress/log to stderr; stdout is typically empty
    return result.stderr


def ffprobe_info(input_path: str, timeout: int = INFO_TIMEOUT_SEC) -> str:
    """
    Run ffprobe to get video metadata as JSON.

    Args:
        input_path: Path to the input video file.
        timeout: Seconds before the subprocess is killed.

    Returns:
        JSON string from ffprobe stdout.

    Raises:
        FFmpegError: If ffprobe exits non-zero or times out.
    """
    cmd = [
        "ffprobe",
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        input_path,
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise FFmpegError(
            f"ffprobe timed out after {timeout}s",
            stderr=f"Process killed after {timeout}s timeout",
        )
    except FileNotFoundError:
        raise FFmpegError(
            "ffprobe not found. Is FFmpeg installed in this container?",
            stderr="ffprobe: command not found",
        )

    if result.returncode != 0:
        raise FFmpegError(
            f"ffprobe exited with code {result.returncode}",
            stderr=result.stderr,
            stdout=result.stdout,
        )

    return result.stdout
