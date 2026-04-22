# Game Dev Studio - Docker 部署指南

[English](./README-Docker.md)

## 快速开始

### 1. 环境准备

确保已安装 Docker 和 Docker Compose：

```bash
docker --version
docker compose version
```

### 2. 配置环境变量

复制示例配置文件：

```bash
cp .env.example .env
```

根据需要修改 `.env` 文件中的配置。

### 3. 启动服务

```bash
# 构建并启动所有服务
make compose-build

# 启动所有服务（已构建）
make compose-up

# 停止所有服务
make compose-down

# 查看日志
docker compose logs -f

# 查看特定服务日志
docker compose logs -f studio-backend
docker compose logs -f studio-frontend
docker compose logs -f star-office-ui
docker compose logs -f creator
```

### 4. 访问服务

- **Game Dev Studio 前端**: http://localhost:5173
- **Game Dev Studio 后端 API**: http://localhost:3000
- **Star Office UI**: http://localhost:19000
- **Creator 服务健康检查**: http://localhost:8080/health

### 5. 停止服务

```bash
# 停止所有服务
docker compose down

# 停止并删除数据卷（谨慎使用）
docker compose down -v
```

## 服务架构

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  studio-frontend │────▶│  studio-backend  │────▶│  star-office-ui │
│    (Nginx)       │     │   (Node.js)      │     │   (Flask)       │
│    :5173         │     │    :3000         │     │    :19000       │
└─────────────────┘     └─────────┬────────┘     └─────────────────┘
                                   │
                                   ├──────────────▶ creator (FastAPI + Blender)
                                   │
                                   ▼
                            ┌──────────────┐
                            │   SQLite DB  │
                            │   (Volume)   │
                            └──────────────┘
```

## 数据持久化

数据通过 Docker Volumes 持久化：

- `studio-data`: Game Dev Studio 数据（SQLite 数据库）
- `studio-output`: 游戏输出文件
- `star-office-data`: Star Office UI 数据
- `creator-data`: Creator 服务 Blender 工作目录数据

查看数据卷：

```bash
docker volume ls
docker volume inspect game-dev-studio_studio-data
```

## 环境变量说明

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `STUDIO_BACKEND_PORT` | 3000 | Studio 后端服务端口 |
| `STUDIO_FRONTEND_PORT` | 5173 | Studio 前端服务端口 |
| `STAR_OFFICE_PORT` | 19000 | Star Office UI 服务端口 |
| `CODEBUDDY_API_KEY` | 空 | CodeBuddy SDK 鉴权密钥 |
| `VITE_API_BASE` | `http://studio-backend:3000` | 前端构建时 API 基地址 |
| `VITE_STAR_OFFICE_UI_URL` | `http://star-office-ui:19000` | 前端构建时 Star Office 地址 |
| `STAR_OFFICE_JOIN_KEY` | ocj_example_team_01 | Agent 注册密钥 |
| `STAR_OFFICE_MAX_CONCURRENT` | 100 | 每个密钥最大并发 Agent 数 |
| `STAR_OFFICE_SECRET` | `your-secret-key-here-min-24-chars` | Star Office 后端密钥 |
| `ASSET_DRAWER_PASS` | `secure-pass-1234` | Star Office 资源面板密码 |
| `CREATOR_PORT` | 8080 | Creator 服务对外端口 |
| `CREATOR_SERVICE_URL` | `http://creator:8080` | 后端访问 Creator 的内部服务地址 |

## Star Office 并发配置

Star Office UI 使用 `join-keys.json` 管理 Agent 注册密钥和并发限制。

Docker 部署时会自动生成配置，支持通过环境变量自定义：

```bash
# 自定义密钥和并发数
STAR_OFFICE_JOIN_KEY=my_custom_key
STAR_OFFICE_MAX_CONCURRENT=100
```

生成的 `join-keys.json` 示例：
```json
{
  "keys": [
    {"key": "my_custom_key", "maxConcurrent": 100}
  ]
}
```

一个 key 的 `maxConcurrent` 设置决定了可以同时注册多少个 Agent。当前项目包含 6 个 Agent（`engineer`、`architect`、`game_designer`、`biz_designer`、`ceo`、`team_builder`）。默认值为 `100`，可支撑约 16 个 project 同时注册。根据实际 project 数量调优即可。

如果需要更复杂的配置，可以挂载自定义的 `join-keys.json`：

```yaml
volumes:
  - ./custom-join-keys.json:/app/join-keys.json:ro
```

## 故障排查

### 服务无法启动

```bash
# 检查服务状态
docker compose ps

# 查看详细日志
docker compose logs --tail=100
```

### 端口冲突

修改 `.env` 文件中的端口配置，然后重启：

```bash
make compose-down
make compose-up
```

### 数据卷问题

如果需要完全重置数据：

```bash
make compose-down
docker compose down -v
make compose-up
```

## 开发模式

如需在开发模式下运行，建议使用原生的 `npm run dev` 命令，而不是 Docker。

Docker 模式主要用于生产部署或快速体验。
