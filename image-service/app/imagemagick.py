"""
ImageMagick CLI wrapper.

Uses `magick` (ImageMagick 7) CLI to execute image processing commands
inside a subprocess, capturing stdout/stderr and returning structured results.
"""

import subprocess
import os
from typing import Optional

IMAGEMAGICK_TIMEOUT_SEC = 60
BATCH_TIMEOUT_SEC = 300


class ImageMagickError(Exception):
    """Raised when ImageMagick execution fails (non-zero exit or command error)."""

    def __init__(self, message: str, stderr: str = "", stdout: str = ""):
        super().__init__(message)
        self.stderr = stderr
        self.stdout = stdout


def execute(cmd: list[str], timeout: int = IMAGEMAGICK_TIMEOUT_SEC) -> str:
    """
    Execute an ImageMagick command via subprocess.

    Args:
        cmd: Command list, e.g. ['magick', 'input.png', '-resize', '256x256', 'output.png']
        timeout: Seconds before the subprocess is killed.

    Returns:
        stdout from ImageMagick (captured).

    Raises:
        ImageMagickError: If ImageMagick exits non-zero or times out.
    """
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise ImageMagickError(
            f"ImageMagick timed out after {timeout}s",
            stderr=f"Process killed after {timeout}s timeout",
        )
    except FileNotFoundError:
        raise ImageMagickError(
            "ImageMagick executable not found. Is ImageMagick installed in this container?",
            stderr="magick: command not found",
        )

    if result.returncode != 0:
        raise ImageMagickError(
            f"ImageMagick exited with code {result.returncode}",
            stderr=result.stderr,
            stdout=result.stdout,
        )

    return result.stdout
