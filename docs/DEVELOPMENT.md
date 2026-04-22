# Game Dev Studio Development Guide

[中文文档 (Chinese)](./DEVELOPMENT.zh-CN.md)


This guide is based on the current repository implementation and focuses on real code structure and extension points.

## 1. Architecture Overview

### 1.1 Runtime Model

- Frontend: React + Vite (`src/`)
- Backend: Express (`server/index.ts`)
- AI orchestration: `agent-manager.ts` + `tools.ts` + Agent SDK
- Studio integration: `star-office-sync.ts` (agent registration, state sync, health checks)
- 3D modeling integration: `creator-service.ts` + `creator/` (Blender FastAPI service)
- Data layer: SQLite (`server/db.ts`)
- Static analysis: extensible Lint framework (`server/lint/`)
- Real-time observability: SSE (`/api/observe` + `sse-broadcaster.ts`)

### 1.2 Key Design Principles

- **Project isolation**: most business entities include `project_id`
- **Event-driven UI**: backend broadcasts events and frontend consumes `SSEEvent`
- **Custom agent tools**: studio-specific tools injected through MCP Server
- **Artifact persistence**: proposals and games are written to `output/{project_id}`

## 2. Code Structure

```text
server/
  index.ts               # REST API + SSE + static artifact hosting
  agent-manager.ts       # Agent states, message sending, permission requests
  tools.ts               # MCP custom tool definitions and permission rules
  creator-service.ts     # Creator service integration for Blender modeling tools
  lint/                  # Extensible Lint framework (LintRunner, pluggable checkers)
  agents.ts              # Role definitions, system prompts, tool usage constraints
  star-office-sync.ts    # Star-Office-UI registration and state sync
  db.ts                  # Table creation (DDL-first), query, and write logic
  sse-broadcaster.ts     # SSE client management and event broadcast

src/
  pages/StudioPage.tsx   # Main page and SSE event dispatching
  components/            # Team/studio/proposal/task/handoff/game/log/command panels
  config.ts              # API wrapper utilities
  types.ts               # Business models and SSE event types
```

## 3. Data Model (SQLite)

Core tables (`server/db.ts`):

- `projects`: project metadata
- `project_settings`: project-level configuration (including `autopilot_enabled`)
- `agent_sessions` / `agent_messages`: agent sessions and messages
- `proposals`: proposals and approval states
- `games`: game artifacts (`html_content` or `file_storage_id`)
- `blender_projects`: Blender modeling project records (`project_id` ↔ `blender_project_id`)
- `file_storages`: packaged artifact metadata for MinIO objects
- `logs`: unified logs (system + agent output, distinguished by `log_type`)
- `commands`: command execution records
- `permission_requests`: tool permission requests and responses
- `handoffs`: task handoffs
- `task_board_tasks`: task board entries (development/testing)
- `agent_memories`: long-term memory

Recommendations:

- When adding or removing fields, update `CREATE TABLE` DDL in `server/db.ts` first so fresh databases are correct.
- Use migration scripts only for legacy data backfill/compatibility scenarios when truly needed.
- Add indexes for high-frequency query fields.

## 4. APIs and Events

### 4.1 Common APIs (Backend Entry: `server/index.ts`)

- System: `GET /api/health`, `GET /api/models`, `GET /api/check-login`
- Observability: `GET /api/observe` (SSE)
- Agents: query, message query/clear, pause/resume, command send (team_builder cannot pause/resume or receive manual commands)
- Proposals: create, query, review, user decision
- Games: submit, query, preview, status update
- Tasks: create, query, status update
- Handoffs: create, accept, confirm, complete, reject, cancel
- Memory: query/add/delete by agent or project
- Projects: create/query, switch (`POST /api/projects/switch`), settings read/update (`autopilot_enabled`)
- Logs: `GET/DELETE /api/projects/:projectId/logs`
- Commands: `GET /api/commands`
- Permissions: `POST /api/permission-response`

### 4.2 SSE Events (Consumed in `StudioPage.tsx`)

Key events:

- `init`
- `agent_status_changed`
- `stream_event` (including text stream and permission requests)
- `agent_paused` / `agent_resumed`
- `proposal_created` / `proposal_reviewed` / `proposal_decided`
- `game_submitted` / `game_updated`
- `handoff_created` / `handoff_updated`
- `task_created` / `task_updated`
- `logs_cleared`

## 5. Agents and MCP Custom Tools

### 5.1 Team Roles

Defined in `server/agents.ts`:

- `engineer`
- `architect`
- `game_designer`
- `biz_designer`
- `ceo`
- `team_builder`

Each role includes:

- Responsibilities and system prompt
- Available handoff targets (`handoffTargets`)
- Tool usage process constraints (especially the engineer workflow)

### 5.2 Current Tool Set (`server/tools.ts`)

- `save_memory`
- `get_memories`
- `create_handoff`
- `split_dev_test_tasks`
- `get_tasks`
- `update_task_status`
- `submit_proposal`
- `submit_game`
- `get_agent_logs`
- `get_agents`
- `get_proposals`
- `get_pending_handoffs`
- `get_games`
- `get_game_info`
- `blender_create_project`
- `blender_list_projects`
- `blender_delete_project`
- `blender_create_mesh`
- `blender_add_material`
- `blender_export_model`
- `blender_download_model_file`
- `blender_delete_model_file`
- `get_project_latest_info` (team_builder only)

Key constraints:

- Tool schemas no longer require a `project_id` parameter; project scope is injected when creating the tool server and enforced internally via `scopedProjectId`.
- `update_task_status` only accepts full UUID `task_id`
- Task state transitions are constrained (`todo -> developing -> testing -> done`, including `blocked` branch)
- Handoff targets are role-whitelisted
- Handoff chain is role-constrained: `game_designer -> ceo -> architect -> engineer -> biz_designer`
- `submit_game` supports two input modes: `html_content` or `file_path` (resolved under `output/{project_id}` only)
- `get_games` returns current-project game entries in reverse chronological order with optional `limit` (`1..100`)
- `get_game_info` returns full HTML for HTML-mode games, or MinIO presigned download URL for file-mode games
- Blender tools (`blender_*`) are available only to `engineer`
- Blender model file download/delete validates safe path under `output/{project_id}/models` to prevent traversal

### 5.3 Star Office Sync Mechanism (`server/star-office-sync.ts`)

- Registers all project agents at startup (including `team_builder`, managed by `project_id`)
- Supports debounced state sync (`STAR_OFFICE_SYNC_DEBOUNCE_MS`)
- Includes health checks and online status polling (`STAR_OFFICE_HEALTH_CHECK_INTERVAL_MS`)
- Derives endpoint URLs from `STAR_OFFICE_UI_URL` for `/set_state`, `/agent-push`, `/join-agent`, `/agents`, `/health`

## 6. Frontend Extension Points

### 6.1 Add a New Panel

1. Extend `TabKey` and related types in `src/types.ts`
2. Add a tab in `TABS` inside `StudioPage.tsx`
3. Create `src/components/*.tsx`
4. Wire rendering and event handling in `StudioPage.tsx`

Built-in tabs already include `pixel_studio` (`StarOfficeStudio.tsx`). Reuse this integration pattern for new tabs.

### 6.2 Add a New API Call

1. Add backend route in `server/index.ts`
2. Add frontend API wrapper in `src/config.ts`
3. If real-time updates are needed, add SSE broadcasts and frontend event branches

## 7. Backend Extension Points

### 7.1 Add a New REST Endpoint

- Keep endpoints under `/api/*`
- Add input validation and consistent error responses
- Ensure all project-related data follows `project_id` isolation

### 7.2 Add a New Custom Tool

1. Add `tool(...)` definition in `server/tools.ts`
2. Add role permission checks when needed
3. Broadcast SSE events when UI real-time updates are required
4. Update tool guidance in `server/agents.ts`

### 7.3 Add a New Lint Checker

The lint framework uses a **pluggable registration architecture** (`server/lint/`):

1. Create a new file in `server/lint/checkers/*.ts`
2. Implement the `LintChecker` interface (id, name, description, `check()` method)
3. Register it in `server/lint/checkers/index.ts` (add to `builtInCheckers` array)
4. Built-in checkers: `html-structure` (6 error rules) + `http-method` (HTTP method safety, error-level) + `js-security` (4 warn rules)
5. Error-level issues **block** `submit_game`; warn-level issues are logged only
6. HTML mode checks `html_content`; ZIP mode checks every HTML file inside the package and stops on the first error

## 8. Local Development and Build

```bash
# Install dependencies
npm install

# Run frontend + backend in dev mode
npm run dev

# Build (tsc + vite)
npm run build
```

### 8.1 Recommended Environment Variables

- Model auth: `CODEBUDDY_API_KEY` (or runtime `CODEBUDDY_AUTH_TOKEN`)
- Frontend API base: `VITE_API_BASE` (default `http://localhost:3000`)
- Studio page URL: `VITE_STAR_OFFICE_UI_URL`
- Backend sync URL: `STAR_OFFICE_UI_URL` (default `http://127.0.0.1:19000`)
- Agent join key: `STAR_OFFICE_JOIN_KEY`
- Creator service URL: `CREATOR_SERVICE_URL` (default `http://localhost:8080`)

## 9. Debugging Tips

- API debugging: inspect endpoint implementation and parameter sources in `server/index.ts`
- SSE debugging: check `/api/observe` EventStream in browser Network panel
- Data debugging: inspect corresponding tables in `data/studio.db`
- Tool flow debugging: inspect validation branches and log outputs in `server/tools.ts`
- Studio integration debugging: inspect iframe load state and URL validation hints in `src/components/StarOfficeStudio.tsx`

## 10. Common Notes

- `agent-manager.ts` injects a "current project context" section in system prompt so agents always know active `project_id`
- When changing task board logic, update both frontend and backend status definitions/flow (`todo -> developing -> testing -> done`, plus `blocked`)
- When adding events, update `SSEEvent` union type in `src/types.ts`
- Game preview endpoints return HTML directly; keep content secure and source controlled
- Artifact write logic is in `db.ts`; keep backward compatibility if you change path rules
- `/api/projects/switch` only switches project context; Star Office sync is maintained continuously across projects
