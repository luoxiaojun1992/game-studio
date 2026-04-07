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
ARG STAR_OFFICE_UI_RELEASE_VERSION=v1.0.0
ARG STAR_OFFICE_UI_RELEASE_URL
RUN echo "${STAR_OFFICE_UI_RELEASE_VERSION}" | grep -Eq '^[A-Za-z0-9._-]+$' || (echo "Error: invalid STAR_OFFICE_UI_RELEASE_VERSION format"; exit 1) && \
    RELEASE_URL="${STAR_OFFICE_UI_RELEASE_URL:-https://codeload.github.com/ringhyacinth/Star-Office-UI/zip/refs/tags/${STAR_OFFICE_UI_RELEASE_VERSION}}" && \
    case "${RELEASE_URL}" in \
      https://codeload.github.com/ringhyacinth/Star-Office-UI/zip/refs/tags/*|https://api.github.com/repos/ringhyacinth/Star-Office-UI/zipball/*) ;; \
      *) echo "Error: unsupported release URL. Please use official ringhyacinth/Star-Office-UI release zip URL."; exit 1 ;; \
    esac && \
    curl -fsSL "${RELEASE_URL}" -o /tmp/star-office-ui.zip && \
    unzip -q /tmp/star-office-ui.zip -d /tmp/star-office-ui-src && \
    RELEASE_ROOT_DIRS="$(find /tmp/star-office-ui-src -mindepth 1 -maxdepth 1 -type d)" && \
    ROOT_DIR_COUNT="$(printf '%s\n' "${RELEASE_ROOT_DIRS}" | awk 'NF{c++} END{print c+0}')" && \
    test "${ROOT_DIR_COUNT}" -eq 1 || (printf 'Error: expected exactly one root directory in release zip, got %s\n' "${ROOT_DIR_COUNT}" && exit 1) && \
    RELEASE_DIR="$(printf '%s\n' "${RELEASE_ROOT_DIRS}" | head -n 1)" && \
    test -n "${RELEASE_DIR}" || (echo "Error: no root directory found after unzipping release zip" && exit 1) && \
    test -f "${RELEASE_DIR}/backend/requirements.txt" || (echo "Error: backend/requirements.txt not found in release zip" && exit 1) && \
    mkdir -p /app && \
    cp -a "${RELEASE_DIR}"/. /app/ && \
    rm -rf /tmp/star-office-ui.zip /tmp/star-office-ui-src

WORKDIR /app

# 安装 Python 依赖
RUN pip install --no-cache-dir -r backend/requirements.txt

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
