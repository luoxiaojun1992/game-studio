# Build Service -- Node.js 22 + FastAPI
# Uses alpine:3.21 + Node.js 22 + npm (~180MB)
FROM alpine:3.21

# Install Node.js 22 + npm + curl (healthcheck) + Python3 (FastAPI)
RUN apk add --no-cache \
    nodejs=22~ \
    npm \
    curl \
    python3 \
    py3-pip

# Global install capacitor CLI (phaser-mobile builds need it)
RUN npm install -g @capacitor/cli @capacitor/core

# Pre-install common game engines to npm global cache, speed up builds
RUN npm install -g vite phaser pixi.js matter-js

WORKDIR /app

# Python FastAPI dependencies
COPY requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# Create data directories
RUN mkdir -p /app/data /app/data/projects

COPY app/ ./app/

# Configure npm cache directory
ENV NPM_CACHE=/root/.npm
ENV npm_config_cache=/root/.npm

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:8085/health || exit 1

EXPOSE 8085

CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8085"]
