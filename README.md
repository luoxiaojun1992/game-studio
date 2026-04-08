# Game Dev Studio

A multi-agent game development workspace built on the CodeBuddy Agent SDK, providing team collaboration, proposal review, task boards, handoff workflows, game artifact management, runtime observability, and Star-Office-UI integration.

## Feature Overview

- Multi-role agent team (Engineer, Architect, Game Designer, Business Designer, CEO)
- Command center (assign tasks to specific agents with SSE streaming responses)
- Studio integration (embedded Star-Office-UI with two-way state sync)
- Task board (development/testing task breakdown and status flow)
- Task handoff (cross-role transfer, acceptance, execution confirmation, completion callback)
- Project settings (auto-handoff toggle)
- Proposal management (create, review, and human decision)
- Game artifact management (submit HTML artifacts, preview, and version status)
- Long-term agent memory (save/query/clear)
- Project isolation (data and observability streams isolated by `project_id`)

## UI Preview

![Team Overview](./docs/images/team.png)
![Studio Workspace](./docs/images/studio.png)
![Proposal](./docs/images/proposal.png)
![Task Board](./docs/images/task.png)
![Task Handoff](./docs/images/handoff.png)
![Game Artifact](./docs/images/artifact.png)
![Runtime Logs](./docs/images/log.png)
![Command Center](./docs/images/command.png)

## Tech Stack

- Backend: Node.js + Express + TypeScript
- Frontend: React 18 + TypeScript + Vite
- Database: SQLite (`better-sqlite3`)
- UI: TDesign React
- AI: `@tencent-ai/agent-sdk`

## Quick Start

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment variables (optional but recommended)

```bash
cp .env.example .env
```

- To enable model calls, set `CODEBUDDY_API_KEY` in `.env` (or inject `CODEBUDDY_AUTH_TOKEN` at runtime).
- Without credentials, the system can still start, but AI capabilities are limited.

### 3) Start development mode (frontend + backend)

```bash
npm run dev
```

- Frontend default: `http://localhost:5173`
- Backend default: `http://localhost:3000`

### 4) Build

```bash
npm run build
```

## Common Scripts

```bash
# Run frontend and backend together
npm run dev

# Backend only (direct run with tsx)
npm run dev:server

# Frontend only
npm run dev:client

# Production build
npm run build

# Preview frontend build output
npm run preview

# Start backend entry directly
npm run server
```

## Key Environment Variables (Local Development)

| Variable | Default | Description |
|---|---|---|
| `PORT` | 3000 | Backend service port |
| `VITE_API_BASE` | `http://localhost:3000` | Frontend API base URL |
| `VITE_STAR_OFFICE_UI_URL` | `http://127.0.0.1:19000` | Embedded Studio URL in frontend tab |
| `STAR_OFFICE_UI_URL` | `http://127.0.0.1:19000` | Backend sync service base URL |
| `STAR_OFFICE_SET_STATE_URL` | Derived from `STAR_OFFICE_UI_URL` | Override state sync endpoint |
| `STAR_OFFICE_AGENT_PUSH_URL` | Derived from `STAR_OFFICE_UI_URL` | Override agent push endpoint |
| `STAR_OFFICE_JOIN_KEY` | `ocj_example_team_01` | Agent registration key |
| `STAR_OFFICE_SYNC_DEBOUNCE_MS` | 300 | State sync debounce interval (ms) |
| `STAR_OFFICE_HEALTH_CHECK_INTERVAL_MS` | 10000 | Star Office health check interval (ms) |

## Docker Deployment

For containerized deployment, see [README-Docker.md](./README-Docker.md).

## Project Structure

```text
game-studio/
├── server/                 # Backend services and agent orchestration
│   ├── index.ts            # API and SSE entry
│   ├── agent-manager.ts    # Agent lifecycle and message dispatch
│   ├── tools.ts            # MCP custom tools
│   ├── agents.ts           # Team role definitions and system prompts
│   ├── star-office-sync.ts # Star-Office-UI sync service
│   └── db.ts               # SQLite schema and data access
├── src/                    # Frontend app
│   ├── pages/StudioPage.tsx
│   ├── components/         # Business panels
│   ├── config.ts           # API wrappers
│   └── types.ts            # Shared business types
├── star-office-ui/         # Star-Office-UI Docker build resources
├── docs/images/            # README preview images
├── data/                   # SQLite database files (runtime-generated)
├── output/                 # Proposal/game outputs (runtime-generated)
├── docker-compose.yml
├── README.md
├── README-Docker.md
└── DEVELOPMENT.md
```

## API Overview

Main endpoints (prefix `/api`):

- Basic: `/health` `/models` `/check-login` `/observe`
- Agents: `/agents` `/agents/:agentId/messages` `/agents/:agentId/command` `/agents/:agentId/pause` `/agents/:agentId/resume`
- Proposals: `/proposals` `/proposals/:id` `/proposals`(POST) `/proposals/:id/review` `/proposals/:id/decide`
- Games: `/games` `/games/:id` `/games`(POST) `/games/:id/preview` `/games/:id`(PATCH)
- Projects: `/projects`(GET/POST) `/projects/switch`(POST) `/projects/:id/settings`(GET/PATCH)
- Handoffs: `/handoffs` `/handoffs/pending` `/handoffs/:id/(accept|confirm|complete|reject|cancel)`
- Tasks: `/tasks` `/tasks/:id/status`
- Memory: `/agents/:agentId/memories`(GET/POST/DELETE) `/memories` `/memories/:id`
- Logs: `/projects/:projectId/logs`(GET/DELETE)
- Sessions and commands: `/agents/:agentId/messages`(DELETE) `/commands`
- Permission: `/permission-response`

## Project Data and Artifacts

- Supports multi-project isolation via `project_id`.
- Proposal/game submissions are also written to `output/{project_id}/...`.
- `/output` is served as static content (HTML returned with `text/html; charset=utf-8`).

## Extension Development

See [DEVELOPMENT.md](./DEVELOPMENT.md).
