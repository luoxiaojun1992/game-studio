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
docker compose up -d

# 查看日志
docker compose logs -f

# 查看特定服务日志
docker compose logs -f studio-backend
docker compose logs -f studio-frontend
docker compose logs -f star-office-ui
```

### 4. 访问服务

- **Game Dev Studio 前端**: http://localhost:5173
- **Game Dev Studio 后端 API**: http://localhost:3000
- **Star Office UI**: http://localhost:19000

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
└─────────────────┘     └──────────────────┘     └─────────────────┘
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
| `STAR_OFFICE_JOIN_KEY` | ocj_example_team_01 | Agent 注册密钥 |
| `STAR_OFFICE_MAX_CONCURRENT` | 5 | 每个密钥最大并发 Agent 数 |

## Star Office 并发配置

Star Office UI 使用 `join-keys.json` 管理 Agent 注册密钥和并发限制。

Docker 部署时会自动生成配置，支持通过环境变量自定义：

```bash
# 自定义密钥和并发数
STAR_OFFICE_JOIN_KEY=my_custom_key
STAR_OFFICE_MAX_CONCURRENT=10
```

生成的 `join-keys.json` 示例：
```json
{
  "keys": [
    {"key": "my_custom_key", "maxConcurrent": 10}
  ]
}
```

一个 key 的 `maxConcurrent` 设置决定了可以同时注册多少个 Agent。例如 `maxConcurrent=5` 可以支持 5 个 Agent（engineer, architect, game_designer, biz_designer, ceo）。

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
docker compose down
docker compose up -d
```

### 数据卷问题

如果需要完全重置数据：

```bash
docker compose down -v
docker compose up -d
```

## 开发模式

如需在开发模式下运行，建议使用原生的 `npm run dev` 命令，而不是 Docker。

Docker 模式主要用于生产部署或快速体验。
