"""
Safe path resolution utilities for Drawio Service.

Provides a pure function to safely resolve user-supplied path segments
within a trusted base directory, preventing path traversal attacks.
"""

import os


def resolve_safe_path(base: str, user_path: str) -> str:
    """
    Resolve a user-supplied path segment within a trusted base directory.

    The function normalises both paths and checks that the resolved result
    stays within the base directory. If the user_path tries to escape
    (via '../' or symlinks), a ValueError is raised.

    Args:
        base: Trusted absolute base directory path.
        user_path: User-supplied path segment (e.g. project_id, diagram_id).

    Returns:
        The resolved, safe absolute path.

    Raises:
        ValueError: If the resolved path is not contained within base.
    """
    root = os.path.realpath(base)
    candidate = os.path.realpath(os.path.join(root, user_path))
    if os.path.commonpath([root, candidate]) != root:
        raise ValueError(
            f"Path traversal detected: '{user_path}' resolves outside '{base}'"
        )
    return candidate
