# Video Service -- FFmpeg + FastAPI
# Uses alpine:3.21 + FFmpeg (~120MB)
FROM alpine:3.21

# Install Python + FFmpeg + curl + fonts (for text overlay)
RUN apk add --no-cache \
    python3 \
    py3-pip \
    curl \
    ffmpeg \
    font-noto

WORKDIR /app

# Copy FastAPI app
COPY requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

COPY app/ ./app/

# Create projects data directory
RUN mkdir -p /app/data/projects

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8084/health || exit 1

EXPOSE 8084

CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8084"]
