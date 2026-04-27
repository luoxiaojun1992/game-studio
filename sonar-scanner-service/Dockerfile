# Sonar Scanner Service — FastAPI + SonarScanner CLI
# Receives ZIP via API, runs sonar-scanner, returns scan status
FROM sonarsource/sonar-scanner-cli:latest

USER root

# Install Python + FastAPI dependencies
RUN python3 -m pip install --quiet --no-cache-dir --break-system-packages \
    fastapi>=0.115.0 \
    uvicorn[standard]>=0.30.0 \
    python-multipart>=0.0.9 \
    && python3 -m pip cache purge

# Create scanner working directory
RUN mkdir -p /app/scanner

WORKDIR /app

# Copy FastAPI app
COPY requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

COPY app/ ./app/

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8081/health || exit 1

EXPOSE 8081

CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8081"]
