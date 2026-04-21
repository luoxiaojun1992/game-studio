# Creator Service — Blender + FastAPI
# Uses official Blender binary release (downloaded at build time)
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Install Blender dependencies + Python + curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    curl \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libx11-6 \
    libxrender1 \
    libxi6 \
    libxkbcommon0 \
    libxxf86vm1 \
    libopengl0 \
    libasound2t64 \
    libglvnd0 \
    && rm -rf /var/lib/apt/lists/*

# Download and install official Blender 4.2.1 binary (headless)
# Official releases are freely downloadable without authentication
RUN mkdir /opt/blender && \
    curl -fsSL "https://download.blender.org/release/Blender4.2/blender-4.2.1-linux-x64.tar.xz" \
    | tar xJf - -C /opt/blender --strip-components=1 && \
    ln -sf /opt/blender/blender /usr/local/bin/blender

WORKDIR /app

# Copy FastAPI app
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY app/ ./app/

# Create projects data directory
RUN mkdir -p /app/data/projects

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

EXPOSE 8080

CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]