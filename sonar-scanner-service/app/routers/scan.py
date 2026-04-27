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
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, status, UploadFile
from fastapi.responses import JSONResponse, Response

from app.schemas import ScanResponse, ScanStatusResponse, ScanDeleteResponse, _validate_project_id

router = APIRouter(prefix="/api/scans", tags=["scans"])

SCANNER_ROOT = "/app/scanner"
SONAR_HOST = os.getenv("SONAR_HOST_URL", "http://sonarqube:9000")
SONAR_USER = os.getenv("SONAR_USER", "admin")
SONAR_PASSWORD = os.getenv("SONAR_PASSWORD", "admin")

# Token TTL: 24h in ms, refresh 1 minute before expiry
_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
_TOKEN_REFRESH_BEFORE_MS = 60 * 1000  # refresh 1 min before expiry

_cached_token: str | None = None
_cached_token_expire_at: float = 0.0
_token_lock = threading.Lock()


def _basic_auth(user: str, password: str) -> str:
    token = base64.b64encode(f"{user}:{password}".encode()).decode()
    return f"Basic {token}"


def _ensure_token() -> str:
    """Thread-safe token getter with auto-refresh before TTL expiry."""
    global _cached_token, _cached_token_expire_at
    now = time.time() * 1000
    if _cached_token and now < (_cached_token_expire_at - _TOKEN_REFRESH_BEFORE_MS):
        return _cached_token

    with _token_lock:
        # Double-check after acquiring lock
        now = time.time() * 1000
        if _cached_token and now < (_cached_token_expire_at - _TOKEN_REFRESH_BEFORE_MS):
            return _cached_token

        # Generate new token via SonarQube API (Basic Auth)
        token_name = f"scanner-token-{int(time.time() * 1000)}"
        req = urllib.request.Request(
            f"{SONAR_HOST}/api/user_tokens/generate",
            data=urllib.parse.urlencode({"name": token_name, "type": "USER_TOKEN"}).encode(),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        req.add_header("Authorization", _basic_auth(SONAR_USER, SONAR_PASSWORD))
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"Failed to generate SonarQube token: {e.code} {e.reason}")

        import json
        parsed = json.loads(data)
        if "token" not in parsed:
            raise RuntimeError(f"SonarQube token response missing 'token' field: {parsed}")

        _cached_token = parsed["token"]
        _cached_token_expire_at = time.time() * 1000 + _TOKEN_TTL_MS
        print(f"[scanner] SonarQube token generated, ttl={_TOKEN_TTL_MS}ms")
        return _cached_token

# In-memory scan states: project_id -> {"status": ..., "exit_code": ..., "message": ...}
_scan_states: dict[str, dict] = {}


def _safe_scan_path(*parts: str) -> Path:
    """
    Build a path under SCANNER_ROOT and ensure it cannot escape the root.
    """
    root = Path(SCANNER_ROOT).resolve()
    candidate = (root / Path(*parts)).resolve()
    if candidate != root and root not in candidate.parents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid project path",
        )
    return candidate


def _scan_dir(project_id: str) -> Path:
    return _safe_scan_path(project_id)


def _zip_path(project_id: str) -> Path:
    return _safe_scan_path(project_id, "game.zip")


def _extract_dir(project_id: str) -> Path:
    return _safe_scan_path(project_id, "sources")


def _log_path(project_id: str) -> Path:
    return _safe_scan_path(project_id, "scan.log")


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

    print(f"[scanner-bg] START project_id={project_id} project_key={project_key} sources_dir={sources_dir}", flush=True)

    state = _scan_states.get(project_id, {})
    state["status"] = "scanning"
    state["message"] = "Extracting sources and starting scanner..."
    _scan_states[project_id] = state

    try:
        # Ensure SonarQube project exists
        print(f"[scanner-bg] Ensuring SonarQube project project_key={project_key}", flush=True)
        _ensure_sonar_project(project_key)
        state["message"] = "SonarQube project ready, running scanner..."
        _scan_states[project_id] = state

        # Get or refresh token before running scanner
        scanner_token = _ensure_token()
        print(f"[scanner-bg] Token ready, launching sonar-scanner project_key={project_key}", flush=True)

        # Run sonar-scanner
        log_fp = open(log_fp_path, "w")
        proc = subprocess.Popen(
            [
                "sonar-scanner",
                f"-Dsonar.projectKey={project_key}",
                f"-Dsonar.sources={sources_dir}",
                "-Dsonar.sourceEncoding=UTF-8",
                f"-Dsonar.host.url={SONAR_HOST}",
                f"-Dsonar.token={scanner_token}",
            ],
            stdout=log_fp,
            stderr=subprocess.STDOUT,
        )
        exit_code = proc.wait()
        log_fp.close()

        print(f"[scanner-bg] sonar-scanner finished project_key={project_key} exit_code={exit_code}", flush=True)

        _scan_states[project_id]["exit_code"] = exit_code
        if exit_code == 0:
            _scan_states[project_id]["status"] = "done"
            _scan_states[project_id]["message"] = "Scan completed successfully"
        else:
            # 读取 scan.log 内容，拼到 message 里供调用方查看
            log_p = Path(_log_path(project_id))
            log_excerpt = ""
            if log_p.exists():
                try:
                    log_content = log_p.read_text(errors="replace")
                    # 只取最后 20 行，避免 message 过长
                    log_lines = log_content.strip().splitlines()
                    log_excerpt = " | " + " | ".join(log_lines[-20:])
                except Exception:
                    log_excerpt = ""
            _scan_states[project_id]["status"] = "error"
            _scan_states[project_id]["message"] = f"Scan failed with exit code {exit_code}{log_excerpt}"

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
        print(f"[scanner-bg] EXCEPTION project_key={project_key} error={ex}", flush=True)

    print(f"[scanner-bg] END project_id={project_id} final_status={_scan_states[project_id]['status']}", flush=True)


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

    print(f"[scan-submit] RECEIVED project_id={validated_id} zip_size={file.size if hasattr(file, 'size') else 'unknown'}", flush=True)

    # Clean up any previous scan for this project
    if scan_dir.exists():
        print(f"[scan-submit] Cleaning up previous scan dir for project_id={validated_id}", flush=True)
        shutil.rmtree(scan_dir)
    os.makedirs(scan_dir, exist_ok=True)

    # Save uploaded ZIP
    content = await file.read()
    with open(zip_path, "wb") as f:
        f.write(content)
    print(f"[scan-submit] ZIP saved project_id={validated_id} size={len(content)}", flush=True)

    # Validate it's a valid ZIP
    try:
        with zipfile.ZipFile(zip_path) as zf:
            file_list = zf.namelist()
            print(f"[scan-submit] ZIP contents project_id={validated_id} files={file_list}", flush=True)
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
    print(f"[scan-submit] Launching background scan project_id={validated_id}", flush=True)
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
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Cancel / clean up scan (idempotent)",
)
async def delete_scan(project_id: str) -> Response:
    """Remove the working directory for a project. Idempotent."""
    validated_id = _validate_project_id(project_id)
    scan_dir = _scan_dir(validated_id)
    if scan_dir.exists():
        shutil.rmtree(scan_dir)
    return Response(status_code=204)
    _scan_states.pop(validated_id, None)
    return None
