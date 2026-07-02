"""
Build executor — handles subprocess invocation for npm/vite/capacitor.

All build commands execute inside the project directory with restricted
environment, timeout, and no shell=True for security.
"""

import os
import subprocess
import time

BUILD_TIMEOUT_SECONDS = 600


class BuildError(Exception):
    """Raised when a build step fails."""


def run_build_step(cwd: str, cmd: list[str], step_name: str) -> str:
    """
    Execute a build step (npm install / npm run build / npx cap sync).

    Args:
        cwd: Working directory (project root).
        cmd: Command as list of strings (no shell=True).
        step_name: Human-readable step name for logging.

    Returns:
        Combined stdout output.

    Raises:
        BuildError: On timeout or non-zero exit.
    """
    print(f"[DEBUG:builder] Step '{step_name}' START cwd={cwd}", flush=True)
    start = time.time()
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=BUILD_TIMEOUT_SECONDS,
            stdin=subprocess.DEVNULL,
            env={
                "PATH": "/usr/local/bin:/usr/bin:/bin",
                "HOME": "/root",
                "npm_config_cache": "/root/.npm",
            },
        )
    except subprocess.TimeoutExpired as e:
        elapsed = time.time() - start
        raise BuildError(
            f"Build timeout after {elapsed:.0f}s: {step_name}"
        )

    elapsed = time.time() - start
    stdout = result.stdout or ""
    stderr = result.stderr or ""

    print(f"[DEBUG:builder] Step '{step_name}' DONE rc={result.returncode} elapsed={elapsed:.1f}s", flush=True)

    if result.returncode != 0:
        raise BuildError(
            f"{step_name} failed (exit {result.returncode})\nSTDERR:\n{stderr[-2000:]}"
        )

    return stdout


def save_build_log(cwd: str, log_text: str) -> str:
    """Save build log to build.log in the project directory."""
    log_path = os.path.join(cwd, "build.log")
    with open(log_path, "w") as f:
        f.write(log_text)
    print(f"[DEBUG:builder] Build log saved to {log_path}", flush=True)
    return log_path
