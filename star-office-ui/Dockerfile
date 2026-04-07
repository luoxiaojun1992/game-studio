# Star Office UI Dockerfile
FROM python:3.11-slim

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    curl \
    jq \
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
COPY *.py ./
COPY healthcheck.sh ./

# 创建数据目录
RUN mkdir -p data memory

# 创建启动脚本，支持动态生成 join-keys.json
RUN echo '#!/bin/bash\n\
JOIN_KEY="${STAR_OFFICE_JOIN_KEY:-ocj_example_team_01}"\n\
MAX_CONCURRENT="${STAR_OFFICE_MAX_CONCURRENT:-5}"\n\
\n\
# 生成 join-keys.json\n\
cat > /app/join-keys.json << EOF\n\
{\n\
  "keys": [\n\
    {"key": "${JOIN_KEY}", "maxConcurrent": ${MAX_CONCURRENT}},\n\
    {"key": "ocj_example_team_02", "maxConcurrent": ${MAX_CONCURRENT}},\n\
    {"key": "ocj_example_team_03", "maxConcurrent": ${MAX_CONCURRENT}},\n\
    {"key": "ocj_example_team_04", "maxConcurrent": ${MAX_CONCURRENT}},\n\
    {"key": "ocj_example_team_05", "maxConcurrent": ${MAX_CONCURRENT}}\n\
  ]\n\
}\n\
EOF\n\
\n\
echo "Generated join-keys.json with key: ${JOIN_KEY}, maxConcurrent: ${MAX_CONCURRENT}"\n\
\n\
# 启动应用\n\
exec python3 backend/app.py\n\
' > /app/start.sh && chmod +x /app/start.sh

# 暴露端口
EXPOSE 19000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:19000/health || exit 1

# 启动命令
CMD ["/app/start.sh"]
