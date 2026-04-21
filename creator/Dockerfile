# Creator Service — Blender + FastAPI
FROM blenderai/blender:4.2.1

# Install Python dependencies for FastAPI
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy FastAPI app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

# Create projects data directory
RUN mkdir -p /app/data/projects

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

EXPOSE 8080

CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
