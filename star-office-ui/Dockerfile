# Star Office UI Dockerfile
FROM python:3.11-slim

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    jq \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# 下载并解压 Star Office UI release zip
ARG STAR_OFFICE_UI_RELEASE_URL=https://github.com/Tencent/Star-Office-UI/releases/latest/download/star-office-ui.zip
RUN curl -fsSL "${STAR_OFFICE_UI_RELEASE_URL}" -o /tmp/star-office-ui.zip && \
    unzip -q /tmp/star-office-ui.zip -d /tmp/star-office-ui-src && \
    RELEASE_DIR="$(find /tmp/star-office-ui-src -mindepth 1 -maxdepth 4 -type f -name pyproject.toml -printf '%h\n' | head -n 1)" && \
    test -n "${RELEASE_DIR}" && \
    mkdir -p /app && \
    cp -a "${RELEASE_DIR}"/. /app/ && \
    rm -rf /tmp/star-office-ui.zip /tmp/star-office-ui-src

WORKDIR /app

# 安装 uv 和依赖
RUN pip install --no-cache-dir uv && \
    uv pip install --system -e .

# 创建数据目录
RUN mkdir -p data memory

# 创建启动脚本，支持动态生成 join-keys.json
RUN echo '#!/bin/bash\n\
JOIN_KEY="${STAR_OFFICE_JOIN_KEY:-ocj_example_team_01}"\n\
MAX_CONCURRENT="${STAR_OFFICE_MAX_CONCURRENT:-5}"\n\
\n\
# 生成 join-keys.json（单个 key 支持多个并发）\n\
cat > /app/join-keys.json << EOF\n\
{\n\
  "keys": [\n\
    {"key": "${JOIN_KEY}", "maxConcurrent": ${MAX_CONCURRENT}}\n\
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
