"""
Sonar Scanner Service — FastAPI entry point.

Receives ZIP files via API, saves them to /app/scanner/{project_id}/,
extracts sources, and runs sonar-scanner against SonarQube.
"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import scan


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure scanner root directory exists
    os.makedirs("/app/scanner", exist_ok=True)
    yield


app = FastAPI(
    title="Sonar Scanner Service",
    description="SonarQube scan micro-service for game-studio",
    version="1.0.0",
    lifespan=lifespan,
)

# Allow studio-backend (any origin in internal network) to call this service
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(scan.router)


@app.get("/health", tags=["health"])
async def health_check():
    """Liveness probe for the healthcheck."""
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("SCANNER_PORT", "8081"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
