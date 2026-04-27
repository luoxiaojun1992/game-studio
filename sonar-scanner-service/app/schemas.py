"""Pydantic schemas for the Sonar Scanner API."""

import re
from pydantic import BaseModel, Field, field_validator

# ---------------------------------------------------------------------------
# Shared patterns (same as creator service for consistency)
# ---------------------------------------------------------------------------
PROJECT_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


def _validate_project_id(v: str) -> str:
    if not PROJECT_ID_PATTERN.match(v):
        raise ValueError(
            f"Invalid project_id: '{v}'. "
            "Only letters, numbers, underscore, hyphen allowed (max 64 chars)."
        )
    return v


# ---------------------------------------------------------------------------
# Scan schemas
# ---------------------------------------------------------------------------

class ScanResponse(BaseModel):
    project_id: str
    status: str = Field(..., description="submitted | scanning | done | error")
    message: str = Field(default="")
    task_id: str | None = Field(default=None, description="SonarQube CE task ID if available")


class ScanStatusResponse(BaseModel):
    project_id: str
    status: str
    message: str
    task_id: str | None = None
    exit_code: int | None = None


class ScanDeleteResponse(BaseModel):
    project_id: str
    deleted: bool = True
