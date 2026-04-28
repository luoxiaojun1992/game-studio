"""
Drawio Service — FastAPI entry point.

Mounts all routers and exposes a /health check endpoint.
"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import diagram, export, project


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure projects root exists
    os.makedirs("/app/data/projects", exist_ok=True)
    yield
    # Shutdown: nothing to clean up


app = FastAPI(
    title="Drawio Service",
    description="Draw.io diagram micro-service for game-studio",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS: allow studio-backend to call this service
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(project.router)
app.include_router(diagram.router)
app.include_router(export.router)


@app.get("/health", tags=["health"])
async def health_check():
    """Liveness probe for the healthcheck."""
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("DRAWIO_SERVICE_PORT", "8082"))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=False)
