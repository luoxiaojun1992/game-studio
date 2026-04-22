# Game Dev Studio Architecture

[中文文档 (Chinese)](./ARCHITECTURE.zh-CN.md)

This document describes the current architecture of Game Dev Studio from system boundaries to module responsibilities and key runtime flows.

## 1. System Scope

Game Dev Studio is a multi-agent game development workspace:

- Frontend web app for collaboration and observability
- Backend API/SSE service for orchestration and persistence
- Agent runtime integration based on `@tencent-ai/agent-sdk`
- Optional Star-Office-UI bidirectional state synchronization

## 2. High-Level Architecture

```text
Browser (React + Vite)
  ├─ HTTP/REST  ───────────────┐
  └─ SSE (/api/observe) ───────┤
                                ▼
Backend (Express + TypeScript)
  ├─ Agent Manager / Tool Runtime
  ├─ Project + Proposal + Task + Handoff APIs
  ├─ Game Artifact APIs
  ├─ Creator Service Client (Blender API bridge)
  ├─ Log/Event Broadcasting (SSE)
  ├─ SQLite Persistence
  └─ Star-Office Sync Service
                 │                    │
      ┌──────────┴─────────┐          ▼
      ▼                    ▼   Creator Service (FastAPI + Blender)
data/studio.db     output/{project_id}/...
```

## 3. Runtime Components

### 3.1 Frontend (`src/`)

- Main shell: `src/pages/StudioPage.tsx`
- Functional panels in `src/components/*`
- API wrapper layer in `src/config.ts`
- Shared business/event types in `src/types.ts`
- Consumes SSE events to keep UI state synchronized with backend runtime

### 3.2 Backend (`server/`)

- `index.ts`: API entry, SSE endpoint, route wiring, static output serving
- `agent-manager.ts`: agent lifecycle, command dispatch, stream events
- `tools.ts`: MCP custom tool definitions and role constraints
- `file-storage.ts`: shared file storage APIs/internal upload helpers
- `minio-client.ts`: MinIO object operations and presigned URL helpers
- `creator-service.ts`: creator HTTP client, Blender project lifecycle/model file operations, and safe-path validation
- `lint/`: extensible lint framework (LintRunner, pluggable checkers, zero external dependencies)
- `agents.ts`: role declarations, prompts, and handoff constraints
- `db.ts`: SQLite schema (DDL-first initialization) and read/write operations
- `sse-broadcaster.ts`: SSE client management and event broadcast
- `star-office-sync.ts`: Star-Office registration/state sync/health checks

## 4. Core Business Domains

- **Projects**: project lifecycle, project switching context, settings
- **Agents**: role-based collaboration and command execution
- **Proposals**: creation, review workflow, decision states
- **Tasks**: development/testing decomposition and status transitions
- **Handoffs**: cross-role ownership transfer and confirmation flow
- **Games**: HTML artifact submission or packaged artifact submission, listing, preview, and file download
- **Modeling**: Blender project management, mesh/material/export/script execution, and model file pullback
- **Lint/Quality**: extensible static analysis framework with pluggable checkers (HTML structure, JS security, etc.)
- **Memories**: long-term memory records scoped by role/project
- **Logs/Observability**: runtime logs and stream events
- **Permissions**: tool execution approval lifecycle and response callbacks

## 5. Data and Storage

- Primary persistence: SQLite (`data/studio.db`)
- Main tables include:
  - `projects`
  - `project_settings`
  - `agent_sessions`, `agent_messages`
  - `proposals`
  - `task_board_tasks`
  - `handoffs`
  - `games`
  - `blender_projects`
  - `file_storages`
  - `agent_memories`
  - `logs`
  - `commands`
  - `permission_requests`
- Proposal artifacts and HTML-mode game artifacts are written under `output/{project_id}/...`
- Packaged game artifacts are uploaded to MinIO and linked through `games.file_storage_id`
- Data and outputs are isolated by `project_id`

## 6. Communication Model

### 6.1 Request/Response

- Frontend invokes backend APIs under `/api/*`
- Backend validates, updates state, persists records, and returns normalized payloads

### 6.2 Event Streaming

- Frontend subscribes to `/api/observe` (SSE)
- Backend pushes domain events such as:
  - agent status/log/stream events
  - proposal/task/handoff/game lifecycle updates

## 7. Integration Architecture (Star-Office-UI)

- Frontend embeds Star-Office-UI in an isolated panel
- Backend performs server-side sync with Star-Office endpoints
- Supports debounced sync, health monitoring, and all-project synchronization
- Endpoints are derived from `STAR_OFFICE_UI_URL` (`/set_state`, `/agent-push`, `/join-agent`, `/agents`, `/health`)
- `/api/projects/switch` no longer drives Star-Office agent sync transitions; agent sync is maintained continuously across projects

## 8. Security and Isolation Considerations

- Project-level isolation via `project_id` in data and event paths
- Tool calls enforce `project_id` as required input and reject mismatches against session scope
- SSE broadcaster skips emission when `projectId` is missing to avoid cross-project event leakage
- Model file download/delete enforces safe-path constraints inside `output/{project_id}/models`
- Controlled route namespaces under `/api/*`
- Output files are constrained to managed output directories
- Tool usage is constrained by role and workflow rules

## 9. Deployment Topology

- Local development: single-node backend + frontend dev server
- Docker deployment: frontend/backend + creator service containerized (see `README-Docker.md`)
- Runtime directories:
  - `data/` for SQLite DB
  - `output/` for generated artifacts

## 10. Extension Principles

- Keep API, data model, and SSE events aligned when adding features
- Preserve project isolation semantics for any new domain object
- Update role prompts/tool constraints when changing agent workflows
- Maintain backward compatibility for persisted data and output paths
