FROM python:3.11-slim

WORKDIR /app

# Install dependencies first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ ./app/

# Create data directory
RUN mkdir -p /app/data/projects

ENV DRAWIO_SERVICE_PORT=8082
ENV DRAWIO_EXPORT_URL=http://drawio-export:8080/export

EXPOSE 8082

CMD ["python", "-m", "app.main"]
