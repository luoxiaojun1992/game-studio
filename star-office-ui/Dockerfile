# Star Office UI Dockerfile
FROM python:3.11-slim

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制依赖文件
COPY pyproject.toml uv.lock ./

# 安装 uv 和依赖
RUN pip install uv && \
    uv pip install --system -e .

# 复制应用代码
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY *.json ./
COPY *.py ./
COPY healthcheck.sh ./

# 创建数据目录
RUN mkdir -p data memory

# 暴露端口
EXPOSE 19000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:19000/health || exit 1

# 启动命令
CMD ["python3", "backend/app.py"]
