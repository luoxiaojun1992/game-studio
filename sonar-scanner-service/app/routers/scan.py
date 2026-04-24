"""
Scan router — receives ZIP files and triggers sonar-scanner.

POST   /api/scans/{project_id}   Submit a ZIP file for scanning
GET    /api/scans/{project_id}   Poll scan status
DELETE /api/scans/{project_id}   Cancel / clean up scan (idempotent)
"""

import base64
import os
import shutil
import subprocess
import threading
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, status, UploadFile
from fastapi.responses import JSONResponse

from app.schemas import ScanResponse, ScanStatusResponse, ScanDeleteResponse, _validate_project_id

router = APIRouter(prefix="/api/scans", tags=["scans"])

SCANNER_ROOT = "/app/scanner"
SONAR_HOST = os.getenv("SONAR_HOST_URL", "http://sonarqube:9000")
SONAR_USER = os.getenv("SONAR_USER", "admin")
SONAR_PASSWORD = os.getenv("SONAR_PASSWORD", "admin")

# In-memory scan states: project_id -> {"status": ..., "exit_code": ..., "message": ...}
_scan_states: dict[str, dict] = {}


def _scan_dir(project_id: str) -> Path:
    return Path(SCANNER_ROOT) / project_id


def _zip_path(project_id: str) -> Path:
    return Path(SCANNER_ROOT) / project_id / "game.zip"


def _extract_dir(project_id: str) -> Path:
    return Path(SCANNER_ROOT) / project_id / "sources"


def _log_path(project_id: str) -> Path:
    return Path(SCANNER_ROOT) / project_id / "scan.log"


def _basic_auth(user: str, password: str) -> str:
    token = base64.b64encode(f"{user}:{password}".encode()).decode()
    return f"Basic {token}"


def _ensure_sonar_project(project_key: str) -> None:
    """Create SonarQube project if it doesn't exist. Idempotent."""
    req = urllib.request.Request(
        f"{SONAR_HOST}/api/projects/create",
        data=f"name={project_key}&project={project_key}".encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    req.add_header("Authorization", _basic_auth(SONAR_USER, SONAR_PASSWORD))
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            r.read()
    except urllib.error.HTTPError as e:
        if e.code != 400:  # 400 = project already exists, ignore
            raise


def _run_scanner_bg(project_id: str) -> None:
    """Background thread: extract ZIP and run sonar-scanner."""
    project_key = f"game-{project_id}"
    sources_dir = _extract_dir(project_id)
    log_fp_path = _log_path(project_id)

    state = _scan_states.get(project_id, {})
    state["status"] = "scanning"
    state["message"] = "Extracting sources and starting scanner..."
    _scan_states[project_id] = state

    try:
        # Ensure SonarQube project exists
        _ensure_sonar_project(project_key)
        state["message"] = "SonarQube project ready, running scanner..."
        _scan_states[project_id] = state

        # Run sonar-scanner
        log_fp = open(log_fp_path, "w")
        proc = subprocess.Popen(
            [
                "sonar-scanner",
                f"-Dsonar.projectKey={project_key}",
                f"-Dsonar.sources={sources_dir}",
                "-Dsonar.sourceEncoding=UTF-8",
                f"-Dsonar.host.url={SONAR_HOST}",
                f"-Dsonar.login={SONAR_USER}",
                f"-Dsonar.password={SONAR_PASSWORD}",
            ],
            stdout=log_fp,
            stderr=subprocess.STDOUT,
        )
        exit_code = proc.wait()
        log_fp.close()

        _scan_states[project_id]["exit_code"] = exit_code
        if exit_code == 0:
            _scan_states[project_id]["status"] = "done"
            _scan_states[project_id]["message"] = "Scan completed successfully"
        else:
            _scan_states[project_id]["status"] = "error"
            _scan_states[project_id]["message"] = f"Scan failed with exit code {exit_code}"

        # 扫描结束后删除 game.zip、sources 目录和 scan.log
        try:
            zip_p = Path(_zip_path(project_id))
            src_p = Path(_extract_dir(project_id))
            log_p = Path(_log_path(project_id))
            if zip_p.exists():
                zip_p.unlink()
            if src_p.exists():
                shutil.rmtree(src_p)
            if log_p.exists():
                log_p.unlink()
        except Exception as cleanup_err:
            _scan_states[project_id]["message"] += f" (cleanup warning: {cleanup_err})"

    except Exception as ex:
        try:
            log_fp.close()
        except Exception:
            pass
        _scan_states[project_id]["status"] = "error"
        _scan_states[project_id]["message"] = f"Scanner exception: {ex}"
        _scan_states[project_id]["exit_code"] = -1


@router.post(
    "/{project_id}",
    response_model=ScanResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit a ZIP file for SonarQube scanning",
)
async def submit_scan(project_id: str, file: UploadFile = File(...)) -> ScanResponse:
    """
    Accepts a multipart/form-data upload with field name `file` (ZIP).

    Workflow:
    1. Save ZIP to /app/scanner/{project_id}/game.zip
    2. Extract to /app/scanner/{project_id}/sources/
    3. Launch sonar-scanner in background thread
    4. Return immediately with accepted status
    """
    validated_id = _validate_project_id(project_id)
    scan_dir = _scan_dir(validated_id)
    zip_path = _zip_path(validated_id)
    extract_dir = _extract_dir(validated_id)

    # Clean up any previous scan for this project
    if scan_dir.exists():
        shutil.rmtree(scan_dir)
    os.makedirs(scan_dir, exist_ok=True)

    # Save uploaded ZIP
    content = await file.read()
    with open(zip_path, "wb") as f:
        f.write(content)

    # Validate it's a valid ZIP
    try:
        with zipfile.ZipFile(zip_path) as zf:
            zf.validate_names()
    except zipfile.BadZipFile:
        shutil.rmtree(scan_dir)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is not a valid ZIP archive",
        )

    # Extract ZIP to sources directory
    extract_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(extract_dir)

    # Initialize state
    _scan_states[validated_id] = {
        "status": "submitted",
        "message": "ZIP saved and extracted, scanner starting...",
        "exit_code": None,
    }

    # Launch background scan
    threading.Thread(target=_run_scanner_bg, args=(validated_id,), daemon=True).start()

    return ScanResponse(
        project_id=validated_id,
        status="submitted",
        message="ZIP accepted, scan started in background",
    )


@router.get(
    "/{project_id}",
    response_model=ScanStatusResponse,
    summary="Poll scan status",
)
async def get_scan_status(project_id: str) -> ScanStatusResponse:
    """Return the current status of a scan."""
    validated_id = _validate_project_id(project_id)
    state = _scan_states.get(validated_id, {})
    log_path = _log_path(validated_id)

    if not state:
        if _scan_dir(validated_id).exists():
            return ScanStatusResponse(
                project_id=validated_id,
                status="unknown",
                message="Project directory exists but no scan has been submitted",
            )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No scan found for project_id={validated_id}",
        )

    message = state.get("message", "")
    if state.get("status") == "error" and log_path.exists():
        try:
            with open(log_path) as f:
                last_lines = f.readlines()[-5:]
            message += "\n" + "".join(last_lines)
        except Exception:
            pass

    return ScanStatusResponse(
        project_id=validated_id,
        status=state.get("status", "unknown"),
        message=message,
        task_id=None,
        exit_code=state.get("exit_code"),
    )


@router.delete(
    "/{project_id}",
    response_model=ScanDeleteResponse,
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Cancel / clean up scan (idempotent)",
)
async def delete_scan(project_id: str) -> None:
    """Remove the working directory for a project. Idempotent."""
    validated_id = _validate_project_id(project_id)
    scan_dir = _scan_dir(validated_id)
    if scan_dir.exists():
        shutil.rmtree(scan_dir)
    _scan_states.pop(validated_id, None)
    return None
