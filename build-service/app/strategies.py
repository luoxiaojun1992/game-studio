"""
GameEngineBuilder — reads metadata.json and dispatches to the correct build strategy.
"""

import json
import os
import shutil
from typing import Optional

from app.builder import run_build_step, save_build_log, BuildError
from app.schemas import SUPPORTED_GAME_TYPES


class BuildStrategy:
    """Base class for build strategies."""

    def __init__(self, project_dir: str):
        self.project_dir = project_dir

    def name(self) -> str:
        raise NotImplementedError

    def execute(self) -> str:
        """Execute the build. Returns combined build log."""
        raise NotImplementedError


class H5BuildStrategy(BuildStrategy):
    """Build an H5 game: npm install -> npm run build."""

    def name(self) -> str:
        return "h5"

    def execute(self) -> str:
        print(f"[DEBUG:strategies] H5 build START dir={self.project_dir}", flush=True)
        logs = []
        logs.append(run_build_step(self.project_dir, ["npm", "install", "--prefer-offline"], "npm install"))
        logs.append(run_build_step(self.project_dir, ["npm", "run", "build"], "npm run build"))
        combined = "\n".join(logs)
        save_build_log(self.project_dir, combined)
        print(f"[DEBUG:strategies] H5 build DONE", flush=True)
        return combined


class PhaserMobileBuildStrategy(BuildStrategy):
    """Build a Phaser Mobile game: npm install -> npm run build -> npx cap sync."""

    def name(self) -> str:
        return "phaser-mobile"

    def execute(self) -> str:
        print(f"[DEBUG:strategies] Phaser Mobile build START dir={self.project_dir}", flush=True)
        logs = []
        logs.append(run_build_step(self.project_dir, ["npm", "install", "--prefer-offline"], "npm install"))
        logs.append(run_build_step(self.project_dir, ["npm", "run", "build"], "npm run build"))

        # cap sync is optional (warning level)
        try:
            logs.append(run_build_step(self.project_dir, ["npx", "cap", "sync"], "npx cap sync"))
        except BuildError as e:
            print(f"[DEBUG:strategies] cap sync warning (non-fatal): {e}", flush=True)
            logs.append(f"[WARNING] cap sync failed (non-fatal): {e}")

        combined = "\n".join(logs)
        save_build_log(self.project_dir, combined)
        print(f"[DEBUG:strategies] Phaser Mobile build DONE", flush=True)
        return combined


# Strategy registry
_BUILD_STRATEGIES: dict[str, type[BuildStrategy]] = {
    "h5": H5BuildStrategy,
    "phaser-mobile": PhaserMobileBuildStrategy,
}


def read_metadata(project_dir: str) -> dict:
    """
    Read dist/metadata.json from the project directory.

    Returns:
        Parsed metadata dict.

    Raises:
        FileNotFoundError: If dist/metadata.json does not exist.
        json.JSONDecodeError: If the file contains invalid JSON.
    """
    metadata_path = os.path.join(project_dir, "dist", "metadata.json")
    if not os.path.isfile(metadata_path):
        raise FileNotFoundError(f"metadata.json not found in project: {metadata_path}")
    with open(metadata_path, "r") as f:
        return json.load(f)


def get_game_type(project_dir: str) -> str:
    """Extract game_type from metadata.json. Returns 'unknown' if not parseable."""
    try:
        meta = read_metadata(project_dir)
        return meta.get("game_type", "unknown")
    except Exception:
        return "unknown"


def select_strategy(project_dir: str) -> BuildStrategy:
    """
    Read metadata.json and select the appropriate build strategy.

    Returns:
        A BuildStrategy instance.

    Raises:
        FileNotFoundError: If metadata.json is missing.
        ValueError: If game_type is not supported.
    """
    meta = read_metadata(project_dir)
    game_type = meta.get("game_type")

    if not game_type or game_type not in SUPPORTED_GAME_TYPES:
        supported = ", ".join(sorted(SUPPORTED_GAME_TYPES))
        raise ValueError(
            f"Unknown game_type: {game_type}. Supported: {supported}"
        )

    strategy_cls = _BUILD_STRATEGIES[game_type]
    print(f"[DEBUG:strategies] Selected strategy '{game_type}' for dir={project_dir}", flush=True)
    return strategy_cls(project_dir)


def cleanup_node_modules(project_dir: str) -> None:
    """Remove old node_modules directory before fresh install."""
    nm = os.path.join(project_dir, "node_modules")
    if os.path.isdir(nm):
        print(f"[DEBUG:strategies] Removing old node_modules: {nm}", flush=True)
        shutil.rmtree(nm)


def build_project(project_dir: str) -> dict:
    """
    Full build pipeline: cleanup -> select strategy -> execute.

    Returns:
        dict with keys: success, build_log, game_type, strategy, output_dir, message, files.
    """
    print(f"[DEBUG:strategies] build_project START dir={project_dir}", flush=True)

    # Clean old node_modules for fresh install
    cleanup_node_modules(project_dir)

    # Read metadata and select strategy
    meta = read_metadata(project_dir)
    strategy = select_strategy(project_dir)

    # Execute build
    build_log = strategy.execute()

    # List dist output files
    dist_dir = os.path.join(project_dir, "dist")
    output_files = _list_files_recursive(dist_dir)

    result = {
        "success": True,
        "build_log": build_log,
        "game_type": meta.get("game_type", ""),
        "strategy": strategy.name(),
        "output_dir": "dist",
        "message": f"Build completed: {strategy.name()} game packaged successfully",
        "files": output_files,
    }
    print(f"[DEBUG:strategies] build_project DONE game_type={meta.get('game_type')} files={len(output_files)}", flush=True)
    return result


def _list_files_recursive(root: str) -> list[str]:
    """List files recursively under root, relative to root."""
    files = []
    if not os.path.isdir(root):
        return files
    for dirpath, _, filenames in os.walk(root):
        for fname in filenames:
            abs_path = os.path.join(dirpath, fname)
            rel_path = os.path.relpath(abs_path, root)
            files.append(rel_path)
    files.sort()
    return files
