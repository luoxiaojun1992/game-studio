# Image Service — ImageMagick + FastAPI
# Uses alpine:3.21 for minimal image size (~50MB)
FROM alpine:3.21

# Install Python + ImageMagick + curl + WebP support
RUN apk add --no-cache \
    python3 \
    py3-pip \
    curl \
    imagemagick \
    libwebp \
    font-noto

WORKDIR /app

# Copy FastAPI app
COPY requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

COPY app/ ./app/

# Create projects data directory
RUN mkdir -p /app/data/projects

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8089/health || exit 1

EXPOSE 8089

CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8089"]
