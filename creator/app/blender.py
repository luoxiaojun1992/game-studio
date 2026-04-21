"""
Blender Python CLI wrapper.

Uses `blender --background --python-expr` to execute Blender Python scripts
inside a subprocess, capturing stdout/stderr and returning structured results.
"""

import subprocess
import sys
import os
from typing import Optional

BLENDER_TIMEOUT_SEC = 120


class BlenderError(Exception):
    """Raised when Blender execution fails (non-zero exit or script error)."""

    def __init__(self, message: str, stderr: str = "", stdout: str = ""):
        super().__init__(message)
        self.stderr = stderr
        self.stdout = stdout


def validate_project_path(project_path: str) -> str:
    """Ensure project_path exists and is inside /app/data/projects/. Returns resolved path."""
    resolved = os.path.realpath(project_path)
    projects_root = os.path.realpath("/app/data/projects")
    if not resolved.startswith(projects_root + os.sep):
        raise BlenderError(f"Path escape attempt detected: {project_path}")
    if not os.path.isdir(resolved):
        raise BlenderError(f"Project directory does not exist: {project_path}")
    return resolved


def execute_script(
    script_code: str,
    project_path: str,
    timeout: int = BLENDER_TIMEOUT_SEC,
) -> str:
    """
    Execute a Blender Python script in --background mode.

    Args:
        script_code: Blender Python code to execute.
        project_path: Absolute path to the project directory inside the container.
        timeout: Seconds before the subprocess is killed.

    Returns:
        stdout from Blender (captured).

    Raises:
        BlenderError: If Blender exits non-zero or times out.
    """
    safe_path = validate_project_path(project_path)

    # Build the full python expression:
    # The script may contain triple-quoted strings so we pass it via sys.argv[1]
    # to avoid quoting issues inside --python-expr.
    cmd = [
        "blender",
        "--background",
        "--python-expr",
        script_code,
        "--",
        safe_path,
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=safe_path,
        )
    except subprocess.TimeoutExpired:
        raise BlenderError(
            f"Blender timed out after {timeout}s",
            stderr=f"Process killed after {timeout}s timeout",
        )
    except FileNotFoundError:
        raise BlenderError(
            "Blender executable not found. Is Blender installed in this container?",
            stderr="blender: command not found",
        )

    if result.returncode != 0:
        raise BlenderError(
            f"Blender exited with code {result.returncode}",
            stderr=result.stderr,
            stdout=result.stdout,
        )

    # Blender scripts output errors to stderr even on success in some cases;
    # surface it in the return so callers can decide.
    return result.stdout
