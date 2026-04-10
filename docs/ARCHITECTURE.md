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
                       ├─ Log/Event Broadcasting (SSE)
                       ├─ SQLite Persistence
                       └─ Star-Office Sync Service
                                │
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
      data/studio.db                        output/{project_id}/...
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
- `agents.ts`: role declarations, prompts, and handoff constraints
- `db.ts`: SQLite schema, migrations, read/write operations
- `sse-broadcaster.ts`: SSE client management and event broadcast
- `star-office-sync.ts`: Star-Office registration/state sync/health checks

## 4. Core Business Domains

- **Projects**: project lifecycle, current project switching, settings
- **Agents**: role-based collaboration and command execution
- **Proposals**: creation, review workflow, decision states
- **Tasks**: development/testing decomposition and status transitions
- **Handoffs**: cross-role ownership transfer and confirmation flow
- **Games**: HTML artifact submission, listing, and preview
- **Memories**: long-term memory records scoped by role/project
- **Logs/Observability**: runtime logs and stream events

## 5. Data and Storage

- Primary persistence: SQLite (`data/studio.db`)
- Main tables include:
  - `projects`
  - `agent_sessions`, `agent_messages`
  - `proposals`
  - `task_board_tasks`
  - `handoffs`
  - `games`
  - `agent_memories`
  - `logs`
  - `commands`
- Game/proposal artifacts are written under `output/{project_id}/...`
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
- Supports debounced sync and health monitoring
- URL endpoints can be derived from `STAR_OFFICE_UI_URL` or overridden by explicit environment variables

## 8. Security and Isolation Considerations

- Project-level isolation via `project_id` in data and event paths
- Controlled route namespaces under `/api/*`
- Output files are constrained to managed output directories
- Tool usage is constrained by role and workflow rules

## 9. Deployment Topology

- Local development: single-node backend + frontend dev server
- Docker deployment: frontend/backend containerized (see `README-Docker.md`)
- Runtime directories:
  - `data/` for SQLite DB
  - `output/` for generated artifacts

## 10. Extension Principles

- Keep API, data model, and SSE events aligned when adding features
- Preserve project isolation semantics for any new domain object
- Update role prompts/tool constraints when changing agent workflows
- Maintain backward compatibility for persisted data and output paths
