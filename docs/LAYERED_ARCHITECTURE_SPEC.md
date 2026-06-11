# Layered Architecture Refactoring Spec

> **Status**: Draft | **Branch**: `docs/layered-architecture-refactor` | **Date**: 2026-06-11

## 1. Executive Summary

Refactor the game-dev-studio server from a monolithic flat-structure Express app into a clean **3-tier architecture**:

```
Data Layer (Pure CRUD) → Service Layer (Business Logic) → API/Tool Layer (Thin Handlers)
```

### Why

| Problem | Current State | Target |
|---------|---------------|--------|
| Monolithic DB file | `server/db.ts` at 1830 lines, mixes schema init, types, validation, and 80+ CRUD functions | 15 focused data modules, each ~50-150 lines |
| Flat API routes | `server/index.ts` at 1290 lines, all routes inline | 11 domain-specific router modules |
| Duplicated business logic | Task status transitions, handoff state machines, proposal validation duplicated between `tools.ts` and `index.ts` | Single source of truth in service layer |
| Direct DB access everywhere | Routes, tools, agent-manager, microservice clients all call `db.*` directly | All DB access goes through data layer; business logic through service layer |
| No testability | Impossible to unit test business logic without a real SQLite DB | Services receive data modules via DI, enabling mock-based unit tests |

## 2. Target Architecture

```
                    ┌─────────────────┐
                    │   db-connection  │  (creates better-sqlite3 instance)
                    └────────┬────────┘
                             │
       ┌─────────────────────┼─────────────────────┐
       ▼                     ▼                     ▼
┌─────────────┐     ┌─────────────┐       ┌─────────────┐
│  data/       │     │  data/       │       │  data/       │
│  handoffs.ts │     │  proposals.ts│       │  games.ts    │  ... (15 modules)
└──────┬───────┘     └──────┬───────┘       └──────┬───────┘
       │                    │                      │
       └────────────┬───────┴──────────┬───────────┘
                    │                  │
                    ▼                  ▼
          ┌──────────────────────────────────┐
          │         services/                 │
          │  handoff-service.ts               │
          │  proposal-service.ts              │
          │  game-service.ts                  │
          │  task-service.ts                  │
          │  blender-service.ts               │
          │  drawio-service.ts                │
          │  image-service.ts                 │
          │  ... (15 services)                │
          └──────────────┬───────────────────┘
                         │
             ┌───────────┼───────────┐
             ▼                       ▼
   ┌──────────────────┐    ┌──────────────────┐
   │     api/          │    │    tools.ts       │
   │  handoff-api.ts   │    │  (MCP handlers)   │
   │  proposal-api.ts  │    └──────────────────┘
   │  game-api.ts      │
   │  ... (11 routers) │
   └──────────────────┘

   ┌──────────────────┐
   │  agent-manager.ts │──► services (agent-session, log, task, project)
   │  (runtime state)  │
   └──────────────────┘
```

**Dependency rules**:
- `data/` → only imports `types.ts`, `validation.ts`, `constants.ts`, `better-sqlite3`
- `services/` → only imports `data/` modules and infrastructure (minio, SSE, external HTTP)
- `api/` → only imports `services/` and infrastructure
- `tools.ts` → only imports `services/` and infrastructure
- `agent-manager.ts` → only imports `services/` and infrastructure
- **No circular dependencies possible**

## 3. Data Layer Design

### 3.1 File Structure

```
server/data/
├── db-connection.ts          # Creates and exports better-sqlite3 Database instance
├── types.ts                  # All TypeScript interfaces (DbProposal, DbGame, etc.)
├── validation.ts             # Pure validation helpers (no DB dependency)
├── constants.ts              # Status enums, patterns, max lengths
├── index.ts                  # Barrel re-export (backward compat with old db.ts)
│
├── projects.ts               # projects + project_settings CRUD
├── proposals.ts              # proposals + proposal_attachments CRUD
├── games.ts                  # games CRUD
├── agent-sessions.ts         # agent_sessions CRUD
├── logs.ts                   # logs CRUD
├── commands.ts               # commands CRUD
├── permission-requests.ts    # permission_requests CRUD
├── handoffs.ts               # handoffs CRUD
├── agent-memories.ts         # agent_memories CRUD
├── task-board.ts             # task_board_tasks CRUD
├── file-storage.ts           # file_storages CRUD
├── blender-projects.ts       # blender_projects CRUD
├── drawio-projects.ts        # drawio_projects CRUD
├── image-projects.ts         # image_projects CRUD
├── game-engineering-specs.ts # game_engineering_specs CRUD + seed
└── file-helpers.ts           # resolveSafePath, ensureOutputDir, saveProposalToFile
```

### 3.2 Module Pattern

Every data module uses a factory function that receives `better-sqlite3.Database`:

```typescript
// server/data/handoffs.ts
import type Database from 'better-sqlite3';
import type { DbHandoff } from './types.js';

export function createHandoffModule(db: Database) {
  return {
    create(handoff: DbHandoff): DbHandoff { /* INSERT */ },
    getById(id: string): DbHandoff | undefined { /* SELECT */ },
    getAll(projectId: string, limit?: number): DbHandoff[] { /* SELECT */ },
    getPending(projectId: string, toAgentId?: string): DbHandoff[] { /* SELECT */ },
    getForAgent(projectId: string, agentId: string): { incoming: DbHandoff[]; outgoing: DbHandoff[] } { /* SELECT */ },
    update(id: string, updates: Partial<DbHandoff>): boolean { /* UPDATE */ },
  };
}

export type HandoffModule = ReturnType<typeof createHandoffModule>;
```

### 3.3 Table-to-Module Mapping

| Tables | Data Module | Functions | Est. Lines |
|--------|-------------|-----------|------------|
| projects, project_settings | `projects.ts` | 7 | ~80 |
| proposals, proposal_attachments | `proposals.ts` | 8 | ~150 |
| games | `games.ts` | 6 | ~100 |
| agent_sessions | `agent-sessions.ts` | 4 | ~50 |
| logs | `logs.ts` | 3 | ~40 |
| commands | `commands.ts` | 4 | ~50 |
| permission_requests | `permission-requests.ts` | 4 | ~60 |
| handoffs | `handoffs.ts` | 6 | ~100 |
| agent_memories | `agent-memories.ts` | 5 | ~80 |
| task_board_tasks | `task-board.ts` | 4 | ~80 |
| file_storages | `file-storage.ts` | 5 | ~90 |
| blender_projects | `blender-projects.ts` | 4 | ~70 |
| drawio_projects | `drawio-projects.ts` | 4 | ~70 |
| image_projects | `image-projects.ts` | 4 | ~70 |
| game_engineering_specs | `game-engineering-specs.ts` | 5 | ~80 |

## 4. Service Layer Design

### 4.1 File Structure

```
server/services/
├── index.ts                   # Service container factory
├── project-service.ts         # Project CRUD + settings management
├── proposal-service.ts        # Proposal lifecycle: create, review, decide, questionnaire
├── game-service.ts            # Game submission, version management, lint
├── handoff-service.ts         # Handoff state machine, auto-handoff, notifications
├── task-service.ts            # Task state machine, status transitions, split dev/test
├── agent-session-service.ts   # Agent session orchestration
├── agent-memory-service.ts    # Long-term memory management
├── command-service.ts         # Command lifecycle
├── permission-service.ts      # Permission request lifecycle, expiration
├── log-service.ts             # Logging abstraction
├── blender-service.ts         # Blender project orchestration (wraps creator-service HTTP)
├── drawio-service.ts          # Draw.io project orchestration (wraps drawio-service HTTP)
├── image-service.ts           # Image project orchestration (wraps image-service HTTP)
├── game-spec-service.ts       # Game engineering spec queries
├── file-upload-service.ts     # File upload/download orchestration (wraps MinIO)
└── validation-service.ts      # Cross-entity validation (requires DB lookups)
```

### 4.2 Business Logic Migration

| Business Rule | Current Location(s) | New Location |
|---------------|---------------------|--------------|
| Task status flow validation | `index.ts`, `tools.ts` | `task-service.ts` |
| Handoff state machine | `index.ts` L624-751, `tools.ts` L247-297 | `handoff-service.ts` |
| Autopilot handoff dispatch | `index.ts` L587-621, `tools.ts` L253-288 | `handoff-service.ts` |
| Engineer task finish guard | `agent-manager.ts` L298-309 | `task-service.ts` |
| Handoff target validation | `tools.ts` L155-162 | `handoff-service.ts` |
| Proposal type-to-agent validation | `tools.ts` L464-474 | `proposal-service.ts` |
| Game version_number auto-increment | `db.ts` L739-741 | `game-service.ts` |
| Questionnaire proposal assembly | `index.ts` L960-1100 | `proposal-service.ts` |
| Content XSS sanitize | `index.ts` POST /proposals, `tools.ts` submit_proposal | `proposal-service.ts` |

### 4.3 Service Container (DI Wiring)

```typescript
// server/services/index.ts
export function createServiceContainer() {
  const db = createDbConnection();

  // Data modules
  const handoffData = createHandoffModule(db);
  const projectData = createProjectModule(db);
  // ... all 15 data modules

  // Services (each receives its data dependencies + cross-service deps as needed)
  const handoffService = createHandoffService({
    handoffs: handoffData,
    projects: projectData,
    logs: logData,
    sessions: sessionData,
  });
  // ... all 15 services

  return {
    data: { handoffs: handoffData, projects: projectData, /* ... */ },
    handoff: handoffService,
    proposal: proposalService,
    game: gameService,
    task: taskService,
    // ... all services
  };
}
```

## 5. API Layer Design

### 5.1 Router Modules

```
server/api/
├── index.ts               # Creates Express app, mounts all routers
├── agent-api.ts           # /api/agents, /api/agents/:id/pause|resume|command
├── proposal-api.ts        # /api/proposals, /api/proposals/:id/*
├── game-api.ts            # /api/games, /api/games/:id
├── handoff-api.ts         # /api/handoffs, /api/handoffs/:id/*
├── task-api.ts            # /api/tasks, /api/tasks/:id/status
├── project-api.ts         # /api/projects, /api/projects/:id/settings
├── memory-api.ts          # /api/memories, /api/agents/:id/memories
├── log-api.ts             # /api/projects/:id/logs
├── command-api.ts         # /api/commands
├── observation-api.ts     # /api/observe (SSE)
├── file-storage-api.ts    # /api/file-storage/*
├── middleware.ts           # CORS, JSON parsing, error handling
└── validators.ts          # Request validation helpers
```

### 5.2 Route Pattern

Every route follows: **parse request → call service → format response**

```typescript
// server/api/handoff-api.ts
export function createHandoffRouter(services: ServiceContainer) {
  const router = Router();

  router.post('/api/handoffs', async (req, res) => {
    try {
      const handoff = await services.handoff.createHandoff(req.body);
      res.json({ handoff });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/api/handoffs/:id/accept', async (req, res) => {
    try {
      const handoff = await services.handoff.acceptHandoff(req.params.id);
      res.json({ handoff });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}
```

## 6. Agent Manager Decoupling

`agent-manager.ts` mixes runtime state management with DB access. After refactoring:

**Stays in agent-manager.ts** (pure runtime):
- In-memory agent states (Maps)
- In-memory pending permissions (Maps)
- Active stream tracking
- Pause/resume management
- SSE event emission
- Permission handler

**Moves to services** (DB access):
| DB Call | Replacement |
|---------|-------------|
| `db.addLog()` | `logService.add()` |
| `db.getAgentSession()` / `db.upsertAgentSession()` | `agentSessionService.getOrCreate()` |
| `db.getTaskBoardTasks()` (finish guard) | `taskService.canEngineerFinish()` |
| `db.getProjectSettings()` | `projectService.getSettings()` |

## 7. Migration Strategy

### Incremental, backward-compatible, 5 phases

```
Phase 0  →  Phase 1  →  Phase 2  →  Phase 3  →  Phase 4  →  Phase 5
Foundation  Data Layer  Services    API Routes   AgentMgr    Cleanup
(0 changes) (15 modules)(15 svcs)   (11 routers) (DI)       (remove old)
```

### Phase 0: Foundation
- Extract `types.ts`, `constants.ts`, `validation.ts` from `db.ts`
- Create `db-connection.ts` and `index.ts` barrel
- `db.ts` imports from new files, re-exports everything
- **Zero behavior change, all existing imports continue working**

### Phase 1: Data Layer (15 modules, least-to-most coupled)
Extract modules in order: game-engineering-specs → blender → drawio → image → file-storage → commands → permissions → logs → agent-memories → agent-sessions → task-board → games → proposals → projects → handoffs.

After each module: add to barrel, remove from db.ts, build, commit.

### Phase 2: Service Layer (15 services)
Create services that wrap data modules. Migrate business logic from index.ts and tools.ts. After each service: update callers, verify behavior, commit.

### Phase 3: API Routes
Extract routes from index.ts into domain-specific router modules.

### Phase 4: Agent Manager
Inject services via constructor DI. Replace all db.* calls with service calls.

### Phase 5: Cleanup
Remove old db.ts, duplicated validation, commit.

## 8. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Breaking E2E tests | Barrel exports maintain identical signatures; run tests after each module |
| Circular dependencies | Strict unidirectional: data → services → api |
| Performance regressions | Same `better-sqlite3` instance, no abstraction overhead |
| Agent manager breakage | Keep runtime state in agent-manager, only DB access moves to services |
| Tool handler regression | Zod schemas unchanged; verify response format per tool |
| Build failures | `.js` extensions already in use for NodeNext resolution |

## 9. File Inventory

### Created (new)
- `server/data/types.ts`, `constants.ts`, `validation.ts`, `db-connection.ts`, `index.ts`
- `server/data/*.ts` (15 module files)
- `server/data/file-helpers.ts`
- `server/services/index.ts`, `server/services/*.ts` (17 service files)
- `server/api/index.ts`, `server/api/*.ts` (11 router files)
- `server/api/middleware.ts`, `server/api/validators.ts`

### Modified
- `server/db.ts` → thin re-export barrel → deleted in Phase 5
- `server/index.ts` → thin app assembler
- `server/tools.ts` → service calls replace db calls
- `server/agent-manager.ts` → DI of services
- `server/file-storage.ts` → split into data module + API router
- `server/creator-service.ts` → merged into `services/blender-service.ts`
- `server/drawio-service.ts` → merged into `services/drawio-service.ts`
- `server/image-service.ts` → merged into `services/image-service.ts`
- `server/proposal-attachments-api.ts` → merged into `api/proposal-api.ts`

### Untouched
- `server/minio-client.ts`, `server/sse-broadcaster.ts`, `server/agents.ts`
- `server/star-office-sync.ts`, `server/lint/`, `server/utils/`, `server/specs/`
- `tsconfig.server.json`, all frontend (`src/`)
