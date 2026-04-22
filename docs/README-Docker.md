# Game Dev Studio - Docker Deployment Guide

[中文文档 (Chinese)](./README-Docker.zh-CN.md)


## Quick Start

### 1. Prerequisites

Make sure Docker and Docker Compose are installed:

```bash
docker --version
docker compose version
```

### 2. Configure Environment Variables

Copy the example configuration file:

```bash
cp .env.example .env
```

Then update values in `.env` as needed.

### 3. Start Services

```bash
# Build and start all services
make compose-build

# Start all services (already built)
make compose-up

# Stop all services
make compose-down

# View logs
docker compose logs -f

# View logs for a specific service
docker compose logs -f studio-backend
docker compose logs -f studio-frontend
docker compose logs -f star-office-ui
docker compose logs -f creator
```

### 4. Access Services

- **Game Dev Studio Frontend**: http://localhost:5173
- **Game Dev Studio Backend API**: http://localhost:3000
- **Star Office UI**: http://localhost:19000
- **Creator Service Health**: http://localhost:8080/health

### 5. Stop Services

```bash
# Stop all services
make compose-down

# Stop services and remove volumes (use with caution)
docker compose down -v
```

## Service Architecture

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

## Data Persistence

Data is persisted using Docker volumes:

- `studio-data`: Game Dev Studio data (SQLite database)
- `studio-output`: Game output files
- `star-office-data`: Star Office UI data
- `creator-data`: Creator service Blender workspace data

Inspect volumes:

```bash
docker volume ls
docker volume inspect game-dev-studio_studio-data
```

## Environment Variables

| Variable | Default | Description |
|--------|--------|------|
| `STUDIO_BACKEND_PORT` | 3000 | Studio backend service port |
| `STUDIO_FRONTEND_PORT` | 5173 | Studio frontend service port |
| `STAR_OFFICE_PORT` | 19000 | Star Office UI service port |
| `CODEBUDDY_API_KEY` | empty | CodeBuddy SDK authentication key |
| `VITE_API_BASE` | `http://studio-backend:3000` | Frontend build-time API base URL |
| `VITE_STAR_OFFICE_UI_URL` | `http://star-office-ui:19000` | Frontend build-time Star Office URL |
| `STAR_OFFICE_JOIN_KEY` | ocj_example_team_01 | Agent registration key |
| `STAR_OFFICE_MAX_CONCURRENT` | 100 | Max concurrent agents per key |
| `STAR_OFFICE_SECRET` | `your-secret-key-here-min-24-chars` | Star Office backend secret |
| `ASSET_DRAWER_PASS` | `secure-pass-1234` | Star Office asset drawer password |
| `CREATOR_PORT` | 8080 | Creator service exposed port |
| `CREATOR_SERVICE_URL` | `http://creator:8080` | Backend-to-creator internal service URL |

## Star Office Concurrency Configuration

Star Office UI uses `join-keys.json` to manage agent registration keys and concurrency limits.

In Docker deployment, configuration is generated automatically and can be customized with environment variables:

```bash
# Customize key and concurrency
STAR_OFFICE_JOIN_KEY=my_custom_key
STAR_OFFICE_MAX_CONCURRENT=100
```

Generated `join-keys.json` example:
```json
{
  "keys": [
    {"key": "my_custom_key", "maxConcurrent": 100}
  ]
}
```

The `maxConcurrent` value for a key defines how many agents can register simultaneously. The current project includes six agents (`engineer`, `architect`, `game_designer`, `biz_designer`, `ceo`, `team_builder`). The default of `100` supports up to ~16 projects simultaneously. Adjust based on the number of concurrent projects.

For advanced setup, mount a custom `join-keys.json`:

```yaml
volumes:
  - ./custom-join-keys.json:/app/join-keys.json:ro
```

## Troubleshooting

### Services fail to start

```bash
# Check service status
docker compose ps

# Check detailed logs
docker compose logs --tail=100
```

### Port conflicts

Update port settings in `.env`, then restart:

```bash
make compose-down
make compose-up
```

### Volume issues

To fully reset data:

```bash
make compose-down
docker compose down -v
make compose-up
```

## Development Mode

For development, using native `npm run dev` is recommended over Docker.

Docker mode is mainly intended for production deployment or quick evaluation.
