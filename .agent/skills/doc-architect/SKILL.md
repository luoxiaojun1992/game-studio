---
name: doc-architect
description: |
  Documentation architecture standardization skill. Analyzes, aligns, and initializes
  project documentation to a proven hub-and-spoke architecture with SSOT (Single Source of Truth),
  bilingual support, spec-driven development, and cross-reference integrity.
  Triggers: 文档架构、文档规范、对齐文档、初始化文档、doc architecture、align docs、
  init docs、README 结构、.agent 目录、spec 规范、文档模板、documentation standard。
  Modes: audit (analyze existing), align (fix gaps), init (create from scratch).
agent_created: true
---

# Doc Architect — Documentation Architecture Standard

## Overview

Defines a battle-tested, multi-layered documentation architecture and provides
the tools to audit, align, or initialize any project's docs to this standard.

The architecture is organized into three layers:

| Layer | Audience | Location | Purpose |
|-------|----------|----------|---------|
| **Public Entry** | All users | `README.md`, `docs/` | Project overview, quick start, architecture |
| **Agent Internal** | AI agents | `.agent/` | SSOT instructions, memory, specs, skills |
| **Workspace Runtime** | WorkBuddy session | `.workbuddy/` | Thin indexes pointing to `.agent/` |

> **Core principle**: `.agent/` is the **Single Source of Truth (SSOT)**.
> Every other instruction file (`.workbuddy/`, `.github/`, etc.) is a thin
> index that delegates to `.agent/`.

---

## The Documentation Architecture Standard

### 1. Directory Structure

```
{PROJECT_ROOT}/
├── README.md                          # Primary entry (English)
├── README.zh-CN.md                    # Chinese mirror (optional)
│
├── .agent/                            # SSOT — agent-facing documentation
│   ├── AI_AGENT_COMMON_INSTRUCTIONS.md # Central hub instruction file
│   ├── diagrams/
│   │   └── INDEX.md                   # Visual diagram index
│   ├── memory/                        # Long-term agent knowledge
│   │   ├── INDEX.md                   # Master index of all memory files
│   │   ├── MEMORY.md                  # Engineering decision journal (append-only)
│   │   ├── ARCHITECTURE.md            # Detailed system architecture
│   │   ├── CONVENTIONS.md             # Coding conventions, bug catalog, error log
│   │   ├── E2E_TESTING.md             # Test patterns, selectors, data-testid table
│   │   ├── REUSABLE_PATTERNS.md       # Code snippets and design patterns
│   │   └── {TOPIC}.md                 # Additional domain-specific memory files
│   ├── skills/                        # Agent skill definitions
│   │   └── {skill-name}/
│   │       └── SKILL.md               # Each skill = one directory + one SKILL.md
│   └── specs/                         # Technical specification documents
│       ├── INDEX.md                   # Master spec index (numbered, with status)
│       ├── {spec-name}.md             # Individual spec (flat or sub-directory)
│       └── {spec-group}/              # Optional sub-directory for grouped specs
│           └── {component}.md
│
├── docs/                              # External-facing documentation (public)
│   ├── ARCHITECTURE.md                # Architecture overview (English)
│   ├── ARCHITECTURE.zh-CN.md          # Architecture overview (Chinese)
│   ├── BRAND.md / BRAND.zh-CN.md      # Brand/visual guidelines
│   ├── DEVELOPMENT.md / DEVELOPMENT.zh-CN.md  # Development & extension guide
│   ├── README-Docker.md / README-Docker.zh-CN.md  # Deployment guide
│   └── images/                        # Visual assets (SVGs, PNGs, logos)
│       ├── architecture.svg
│       ├── architecture.png
│       └── ...
│
├── .workbuddy/                        # WorkBuddy runtime (thin index only)
│   └── AI_AGENT_INSTRUCTIONS.md       # Delegates to .agent/ as SSOT
│
└── .github/                           # GitHub-specific (thin index only)
    └── copilot-instructions.md        # Delegates to .agent/ as SSOT
```

### 2. Naming Conventions

| Category | Convention | Examples |
|----------|-----------|---------|
| **Spec numbers** | `{PREFIX}-XXX` (3-digit, incrementing) | `SPEC-001`, `FEAT-042` |
| **Spec filenames** | `kebab-case-description.md` | `image-service.md`, `tool-call-chain.md` |
| **Spec sub-directories** | `kebab-case-name/` with internal files | `game-framework-spec/`, `opentelemetry-tracing/` |
| **Memory files** | `UPPER_SNAKE_CASE.md` | `ARCHITECTURE.md`, `E2E_TESTING.md` |
| **Skill names** | `kebab-case` (frontmatter `name:` field) | `spec-writer`, `doc-sync` |
| **Skill directories** | `kebab-case/` each with `SKILL.md` | `.agent/skills/spec-writer/SKILL.md` |
| **Test case IDs** | `{PREFIX}-XXX` (3-digit) | `UI-001`, `API-005` |
| **README i18n** | `README.md` (primary), `README.{locale}.md` | `README.zh-CN.md`, `README.ja.md` |
| **docs/ i18n** | `{NAME}.md` + `{NAME}.{locale}.md` | `ARCHITECTURE.md` + `ARCHITECTURE.zh-CN.md` |
| **Branch names** | `{type}/{description}` or `{type}/{PREFIX}-XXX-{desc}` | `feat/auth-module`, `docs/readme-update` |
| **Commit messages** | Conventional Commits | `feat: add X`, `fix: resolve Y`, `docs: update Z` |
| **data-testid** | `{component}-{element}` (kebab-case) | `nav-login-btn`, `chart-revenue` |

### 3. Cross-Reference Architecture (Hub-and-Spoke)

```
AI_AGENT_COMMON_INSTRUCTIONS.md  ← SSOT HUB
  │
  ├── referenced by: .workbuddy/AI_AGENT_INSTRUCTIONS.md (thin index)
  ├── referenced by: .github/copilot-instructions.md (thin index)
  │
  ├── references: .agent/memory/INDEX.md
  │   ├── .agent/memory/ARCHITECTURE.md
  │   ├── .agent/memory/CONVENTIONS.md
  │   ├── .agent/memory/E2E_TESTING.md
  │   ├── .agent/memory/MEMORY.md
  │   └── .agent/memory/{TOPIC}.md
  │
  ├── references: .agent/specs/INDEX.md
  │   └── .agent/specs/{spec-name}.md
  │
  ├── references: .agent/skills/ (project skills)
  │   └── {skill-name}/SKILL.md
  │
  └── README.md references:
      ├── docs/ARCHITECTURE.md
      ├── docs/DEVELOPMENT.md
      └── .agent/specs/INDEX.md (roadmap source)
```

**Rules**:
1. `AI_AGENT_COMMON_INSTRUCTIONS.md` is the SSOT — always update this first.
2. Thin index files (`.workbuddy/`, `.github/`) MUST NOT duplicate content; only point to `.agent/`.
3. `memory/INDEX.md` is the secondary hub within the memory subsystem.
4. Every cross-reference uses **relative paths** from the referencing file.
5. Spec states in `README.md` roadmap must mirror `.agent/specs/INDEX.md`.

### 4. Architecture Philosophy

1. **SSOT (Single Source of Truth)**: One canonical location for each fact. Thin indexes delegate, never duplicate.
2. **Hub-and-Spoke**: Central instruction file → specialized sub-documents. No circular references.
3. **Process-Over-Content**: Skills abstract *how* to do things, not just *what* to know.
4. **Enforced Sync**: Every spec and skill includes mandatory doc-update checklists. Code change = doc change.
5. **Error Catalog**: `CONVENTIONS.md` maintains a table of past mistakes → corrections for institutional learning.
6. **Bilingual by Default**: Public-facing docs have locale mirrors. Internal docs default to project primary language.
7. **SPEC-Driven**: All features tracked as numbered specs with lifecycle status (`设计中` → `已实现`).
8. **Test-First**: `data-testid` is the selector contract. Test matrices are always up-to-date with actual case counts.

---

## When to Use

**Mandatory triggers:**
- User says "初始化文档" / "建立文档架构" / "init docs"
- User says "对齐文档" / "align docs" / "规范化文档"
- User says "检查文档架构" / "audit docs"
- Creating a new project from scratch
- Inheriting a project with messy or missing docs

**Optional triggers:**
- After merging a major feature branch
- When onboarding new team members
- When documentation drift is suspected

---

## Workflow

The skill has four phases. Always start from Phase 1, even for "init" mode
(you need to know what already exists).

### Phase 1: Audit — Analyze Current State

Scan the project root and produce a gap analysis.

#### Step 1.1: Discover existing docs

```
1. List all *.md files recursively (exclude node_modules, .git, dist, build)
2. Check for README.md, README.*.md
3. Check for .agent/ directory and its sub-structure
4. Check for docs/ directory
5. Check for .github/copilot-instructions.md
6. Check for .workbuddy/AI_AGENT_INSTRUCTIONS.md
```

#### Step 1.2: Classify each file

| Category | Criteria |
|----------|----------|
| **Public Entry** | `README.md`, `docs/*.md` |
| **Agent Internal** | `.agent/**/*.md` |
| **Thin Index** | `.workbuddy/AI_AGENT_INSTRUCTIONS.md`, `.github/copilot-instructions.md` |
| **Orphan** | Any `.md` not in above categories (e.g., `CHANGELOG.md` at root) |

#### Step 1.3: Generate gap report

Output a structured gap report:

```markdown
## Documentation Audit: {PROJECT_NAME}

### Layer 1: Public Entry
| File | Status | Notes |
|------|--------|-------|
| README.md | ✅ Present / ❌ Missing / ⚠️ Needs alignment | ... |
| README.zh-CN.md | ... | ... |
| docs/ARCHITECTURE.md | ... | ... |
| ... | ... | ... |

### Layer 2: Agent Internal
| File | Status | Notes |
|------|--------|-------|
| .agent/AI_AGENT_COMMON_INSTRUCTIONS.md | ... | ... |
| .agent/memory/INDEX.md | ... | ... |
| ... | ... | ... |

### Layer 3: Thin Indexes
| File | Status | Notes |
|------|--------|-------|
| .workbuddy/AI_AGENT_INSTRUCTIONS.md | ... | ... |
| .github/copilot-instructions.md | ... | ... |

### Cross-Reference Health
- [ ] AI_AGENT_COMMON_INSTRUCTIONS.md cross-references memory, specs, skills
- [ ] Thin indexes delegate (don't duplicate)
- [ ] README roadmap mirrors specs/INDEX.md
- [ ] No broken relative links

### Summary
- Missing: N files
- Needs alignment: N files
- OK: N files
```

---

### Phase 2: Plan — Generate Alignment Plan

Based on the gap report, produce a prioritized action plan.

#### Priority Levels

| Priority | Condition | Action |
|----------|-----------|--------|
| **P0** | Missing SSOT hub (`AI_AGENT_COMMON_INSTRUCTIONS.md`) | Create immediately — everything depends on it |
| **P0** | Missing `README.md` | Create from template |
| **P1** | Missing key memory files (`INDEX.md`, `ARCHITECTURE.md`, `CONVENTIONS.md`) | Create with project specifics |
| **P1** | Thin indexes duplicating content (not delegating) | Slim down to index-only |
| **P2** | Missing spec system (`specs/INDEX.md` + at least one spec) | Bootstrap with existing features |
| **P2** | Missing bilingual mirrors | Create `.zh-CN.md` copies |
| **P3** | Missing optional docs (`BRAND.md`, `DEVELOPMENT.md`) | Create if project needs them |
| **P3** | Orphan `.md` files at root | Migrate to appropriate layer |

#### Plan Output Format

```markdown
## Alignment Plan: {PROJECT_NAME}

### P0 — Immediate (blocking)
1. [ ] Create `.agent/AI_AGENT_COMMON_INSTRUCTIONS.md`
2. [ ] ...

### P1 — High Priority
1. [ ] Create `.agent/memory/INDEX.md`
2. [ ] ...

### P2 — Medium Priority
1. [ ] ...

### P3 — Nice to Have
1. [ ] ...
```

**After generating the plan, present it to the user for approval before executing.**

---

### Phase 3: Execute — Create / Align Documents

Execute the approved plan. For each document, use the templates in the
[Templates Library](#templates-library) section below.

#### Rules for creating documents:

1. **Never overwrite** existing content without user confirmation. If a file exists
   but needs alignment, describe what needs to change and ask.
2. **Fill in placeholders** (`{PROJECT_NAME}`, `{DESCRIPTION}`, etc.) from
   project analysis (read `package.json`, existing docs, code structure).
3. **Cross-reference correctly** — all paths relative to the referencing file.
4. **Keep it minimal** — only include sections that apply. Don't add placeholder
   sections "for later".

#### Rules for aligning documents:

1. **Preserve existing content** that is still accurate. Only fix what's broken.
2. **Update cross-references** when files move or are renamed.
3. **Sync statuses** — if a feature is implemented, its spec and README must say so.
4. **Remove duplication** — if content appears in both a thin index and the SSOT,
   remove it from the thin index and add a link.

---

### Phase 4: Verify — Quality Checklist

After execution, run this checklist:

```
□ SSOT exists: .agent/AI_AGENT_COMMON_INSTRUCTIONS.md
□ README.md has all standard sections (feature overview, tech stack, quick start,
  project structure, roadmap, API overview)
□ .agent/memory/INDEX.md cross-references all memory files
□ .agent/memory/MEMORY.md exists (even if empty — appendix for future decisions)
□ .agent/memory/ARCHITECTURE.md covers modules, data flow, key files
□ .agent/memory/CONVENTIONS.md has at minimum: coding style, commit convention,
  forbidden actions
□ .agent/specs/INDEX.md has at least one entry (existing features documented)
□ docs/ARCHITECTURE.md covers system overview and tech stack
□ Thin indexes (.workbuddy/, .github/) delegate to .agent/
□ No broken relative links (verify with grep for ](./ patterns)
□ Bilingual mirrors exist for all public-facing docs (if project needs i18n)
□ README roadmap mirrors spec INDEX statuses
```

---

## Alignment Strategies

### Strategy A: New Project (from scratch)

1. Run Phase 1 (Audit) — result will be mostly "❌ Missing"
2. Generate a "Create All" plan
3. Execute in order: SSOT hub → README → memory core → specs seed → docs → thin indexes
4. For the first spec, document the *current state* of the project as SPEC-001
   (e.g., "Project Initialization")

### Strategy B: Existing Project (partial docs)

1. Run Phase 1 (Audit) — identify what exists and what's missing
2. Generate a plan with P0-P3 priorities
3. For existing docs that need alignment, show a **diff plan** (old → new) before modifying
4. Migrate orphan `.md` files into the appropriate layer (e.g., `CHANGELOG.md` → `docs/CHANGELOG.md`)
5. Run Phase 4 (Verify) after alignment

### Strategy C: Project with Competing Standards

If the project already has a different doc standard (e.g., `wiki/`, `doc/`, `design/`):

1. **Do NOT automatically migrate** — present the audit side-by-side with the target standard
2. Ask the user which standard to adopt
3. If adopting this standard:
   - Map old paths → new paths
   - Migrate content with cross-reference updates
   - Leave a `MIGRATION.md` note in the old location (if not deleting)
4. If keeping the old standard — abort and document the decision

---

## Templates Library

### Template: README.md

```markdown
<p align="center">
  <!-- Project logo here -->
</p>

# {PROJECT_NAME}

{ONE_LINE_DESCRIPTION}

## Feature Overview

- **{Feature 1}**: {Brief description}
- **{Feature 2}**: {Brief description}
- **{Feature 3}**: {Brief description}

## UI Preview

<!-- Screenshots or GIFs here -->

## Tech Stack

| Layer | Technology |
|-------|-----------|
| {Layer} | {Tech} |

## Quick Start

```bash
# 1. Install dependencies
{install_command}

# 2. Configure environment
cp .env.example .env

# 3. Start
{start_command}
```

## Common Scripts

```bash
{script_1}   # {description}
{script_2}   # {description}
```

## Key Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `{VAR}` | `{default}` | {description} |

## Project Structure

\`\`\`
{project_root}/
├── src/
│   ├── components/    # UI components
│   ├── pages/         # Route pages
│   └── ...
├── server/            # Backend
├── tests/             # Test suites
└── ...
\`\`\`

## API Overview

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/{resource}` | {description} |

## Roadmap

| Spec | Feature | Status |
|------|---------|--------|
| SPEC-001 | {Feature name} | ✅ 已实现 |
| SPEC-002 | {Feature name} | 🚧 设计中 |

## Architecture Documentation

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture.

## Testing

\`\`\`bash
{test_command}
\`\`\`
```

### Template: README.zh-CN.md

Mirror of README.md in Chinese. Maintain identical structure and section order.
Only translate natural language; keep code, paths, and commands in English.

### Template: .agent/AI_AGENT_COMMON_INSTRUCTIONS.md

```markdown
# {PROJECT_NAME} - AI Agent Common Instructions

> This document is the **Single Source of Truth (SSOT)** for all AI agent instructions.
> `.workbuddy/` and `.github/` instruction files are thin indexes that reference this file.

## Project Overview

{2-3 sentences describing the project, its purpose, and key capabilities.}

## Tech Stack

| Layer | Technology |
|-------|-----------|
| {Layer} | {Tech} |

## Architecture Core Principles

### 1. {Principle Name}
- {Key rule 1}
- {Key rule 2}

### 2. Key File Locations

| Function | File Path |
|----------|-----------|
| {Function} | `{path}` |

## Coding Conventions

### Code of Conduct

**1. Think First, Act Second**
- Don't assume, don't hide confusion — surface assumptions and doubts
- When multiple interpretations exist, present them before picking one

**2. Simplicity First**
- Write only the code needed to solve the problem
- Don't create abstractions for single-use code
- Don't introduce unrequested features

**3. Precise Changes**
- Only change what must be changed
- Match existing style conventions
- Clean up orphaned code (unused imports, variables, functions)

**4. Goal-Driven Execution**
- Turn tasks into verifiable goals
- Multi-step tasks: brief plan first, verify each step

### Technology-Specific Rules

{Language/framework-specific conventions here}

## Modification Constraints

### ⚠️ Do Not Modify

1. **{Protected Area}**: {Why it's protected}
2. **{Protected Area}**: {Why it's protected}

### ✅ Safe to Modify

1. **{Flexible Area}**: {Scope of changes allowed}
2. **{Flexible Area}**: {Scope of changes allowed}

### ⚠️ Red Lines (Mandatory)

- **No workarounds**: Root cause analysis required for every fix
- **No test bypasses**: Never relax assertions to make tests pass
- **Contract integrity**: Tool parameter contracts must match current schema

## Test Specifications

### E2E Testing

\`\`\`bash
{test_commands}
\`\`\`

### Mock Server

- Path: `{mock_endpoint}`
- Admin endpoints: `{admin_endpoints}`

## Common Tasks

### {Task Name}
1. {Step 1}
2. {Step 2}

## Troubleshooting

### {Symptom}
- Check {thing to check}
- Verify {verification step}

## Commit Convention

\`\`\`bash
feat: add xxx feature
fix: resolve xxx issue
docs: update xxx documentation
test: add xxx test case
\`\`\`

## Memory Index

> All paths relative to repository root.

| Document | Content |
|----------|---------|
| `.agent/memory/INDEX.md` | Master experience index |
| `.agent/memory/ARCHITECTURE.md` | Detailed architecture |
| `.agent/memory/CONVENTIONS.md` | Conventions & bug catalog |
| `.agent/memory/E2E_TESTING.md` | Testing experience |
| `.agent/memory/MEMORY.md` | Engineering decision journal |

## Built-in Skills

| Skill | Purpose |
|-------|---------|
| `{skill-name}` | {Description} |

> **Important**: On startup, always read `.agent/` memory files first to
> understand project context, rather than relying on model built-in knowledge.
```

### Template: .agent/memory/INDEX.md

```markdown
# {PROJECT_NAME} - Working Memory Index

> Master index for all memory documents. Each dimension is split into a dedicated file.

## Document Index

| Document | Content |
|----------|---------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture, key files, module interactions |
| [CONVENTIONS.md](./CONVENTIONS.md) | Coding conventions, red lines, bug fix records |
| [E2E_TESTING.md](./E2E_TESTING.md) | E2E test patterns, selectors, data-testid table |
| [MEMORY.md](./MEMORY.md) | Engineering decision journal (dated entries) |
| [REUSABLE_PATTERNS.md](./REUSABLE_PATTERNS.md) | Code snippets and design patterns |

<!-- Add skill references if applicable -->
<!-- [../skills/{skill-name}/SKILL.md](../skills/{skill-name}/SKILL.md) -->

<!-- Add spec references if applicable -->
<!-- [../../specs/{spec-name}.md](../../specs/{spec-name}.md) -->

## Quick Reference

### Core Architecture
- {Key fact 1}
- {Key fact 2}

### E2E Testing Key Points
- {Key testing rule 1}
- {Key testing rule 2}

### Red Lines
- **No workarounds** — root cause analysis required
```

### Template: .agent/memory/MEMORY.md

```markdown
# {PROJECT_NAME} - Engineering Decision Log

> Journal-style log of dated engineering decisions.
> Append new entries at the top, newest first.

## {YYYY-MM-DD}: {Decision Summary}

- **Context**: {What led to this decision}
- **Decision**: {What was decided}
- **Rationale**: {Why this choice}
- **Alternatives Considered**: {What else was considered and why rejected}
```

### Template: .agent/memory/ARCHITECTURE.md

```markdown
# {PROJECT_NAME} - Architecture

## System Overview

{High-level description of system architecture.}

## Module Breakdown

### {Module Name}
- **Path**: `{path}`
- **Responsibility**: {what it does}
- **Key Files**:
  - `{file}`: {role}
- **Dependencies**: {what it depends on}

### {Module Name}
...

## Data Flow

{Describe how data flows through the system. ASCII diagram or list.}

## Directory Structure

\`\`\`
{project}/
├── src/          # Frontend source
├── server/       # Backend source
├── tests/        # Test suites
└── ...
\`\`\`

## Database

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `{table}` | {purpose} | `{columns}` |

## External Services

| Service | Port | Purpose |
|---------|------|---------|
| `{service}` | `{port}` | {purpose} |

## Docker Compose Services

| Service | Image | Port | Depends On |
|---------|-------|------|------------|
| `{name}` | `{image}` | `{port}` | `{deps}` |
```

### Template: .agent/memory/CONVENTIONS.md

```markdown
# {PROJECT_NAME} - Conventions

## Coding Style

- **Language**: {TypeScript / Python / etc.}
- **Module System**: {ES Module / CommonJS}
- **Linter**: {ESLint / Ruff / etc.}
- **Formatter**: {Prettier / Black / etc.}

### Specific Rules

1. {Rule description}
2. {Rule description}

## Commit Convention

\`\`\`
{type}: {description}

Types: feat, fix, docs, test, refactor, chore, style
\`\`\`

## Branch Naming

| Branch Type | Pattern | Example |
|-------------|---------|---------|
| Feature | `feat/{description}` | `feat/auth-module` |
| Bug Fix | `fix/{description}` | `fix/login-error` |
| Docs | `docs/{description}` | `docs/api-update` |
| Chore | `chore/{description}` | `chore/deps-upgrade` |

## Red Lines (Forbidden Actions)

| # | What | Why |
|---|------|-----|
| 1 | Workarounds without root cause analysis | Masks real bugs |
| 2 | Relaxing test assertions to pass CI | Defeats purpose of testing |
| 3 | Modifying protected code without approval | Documented in AI_AGENT_COMMON_INSTRUCTIONS.md |
| 4 | ... | ... |

## Corrected Mistakes

> Record past mistakes and their fixes for institutional learning.

| # | Date | Wrong Approach | Correct Approach | Impact |
|---|------|---------------|-----------------|--------|
| 1 | {date} | {what was done wrong} | {correct way} | {consequence} |
```

### Template: .agent/specs/INDEX.md

```markdown
# Spec Index

Central registry of all design specification documents with unique numbering.

## Numbering Rules

- Format: `{PREFIX}-XXX`, three digits, incrementing from `001`
- Each independent design document gets one number, lifetime-immutable
- Sub-directories under a spec group share the same functional domain

---

## Index Table

| Number | Title | File Path | Status |
|--------|-------|-----------|--------|
| {PREFIX}-001 | {Title} | [{file}.md]({file}.md) | 设计中 / 已实现 |

---

## Adding a New Spec

1. Allocate the next available number from the index table
2. Create the `.md` file with the header format:

\`\`\`markdown
# {Title}

> **{PREFIX}-XXX** | Status: 设计中

## Goal
...
\`\`\`

3. Update this index table with title, path, and status
```

### Template: .agent/specs/{spec-name}.md

```markdown
# {Title in Primary Language}

> **{PREFIX}-XXX** | Status: 设计中 / 已实现

## Goal

{1-3 sentences: what problem this spec solves, what it achieves.}

## Background

{Conditional — current state, problems, motivation. Omit for greenfield features.}

## Architecture Overview

{Conditional — file tree, comparison table. Omit for pure frontend specs.}

## Design Plan

{Conditional — layout diagram, display modes, configuration. UI specs only.}

## Detailed Design

{Conditional — data flow, component design, interaction behavior.}

## Feasibility Analysis

| Check Item | Conclusion |
|------------|------------|
| Backend changes needed? | Yes/No + details |
| Data already exists? | Yes/No + details |
| New DB table needed? | Yes/No + details |
| Affects existing features? | Yes/No + details |
| Performance impact | {assessment} |
| E2E tests needed? | Yes/No + details |

### Conclusion

{One-sentence summary of feasibility and risks.}

## Related Files

| File | Role | Change Magnitude |
|------|------|-----------------|
| `path/to/file.ts` | {role} | New / Low (~N lines) / Medium / High |

## Test Strategy

{Conditional — when code changes are involved.}

1. **Unit Tests**: {scenarios}
2. **Integration Tests**: {scenarios}
3. **E2E Tests**: {scenarios}

## Verification Criteria

1. {Quantifiable, specific criterion}
2. {Quantifiable, specific criterion}
```

### Template: .agent/skills/{skill-name}/SKILL.md

```yaml
---
name: {skill-name}
description: |
  {Full description with trigger words and use cases.}
  Triggers: {keyword list in primary language}.
agent_created: true
---
```

```markdown
# {Skill Title}

## Overview

{What this skill does and why it exists.}

## When to Use

{Trigger conditions — when to load this skill.}

## Workflow

### Step 1: {Step Name}

{Detailed instructions.}

### Step 2: {Step Name}

{Detailed instructions.}

## Scripts

{If applicable — scripts bundled with the skill.}

## References

{Cross-links to other .agent/ files or skills.}
```

### Template: docs/ARCHITECTURE.md

```markdown
# {PROJECT_NAME} — Architecture

## Overview

{High-level architecture description for external audience.}

## System Diagram

<!-- Architecture diagram reference -->
![Architecture](images/architecture.png)

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| {Layer} | {Tech} | {Version} |

## Services

| Service | Port | Description |
|---------|------|-------------|
| `{name}` | `{port}` | {description} |

## Data Flow

{How data flows between services.}

## Key Design Decisions

1. **{Decision}**: {Rationale}
2. **{Decision}**: {Rationale}

## Directory Structure

{Abbreviated tree — key directories only.}
```

### Template: docs/ARCHITECTURE.zh-CN.md

Chinese mirror of `docs/ARCHITECTURE.md`. Identical structure, translated content.
Keep code references and paths in English.

### Template: Thin Index Files

#### .workbuddy/AI_AGENT_INSTRUCTIONS.md

```markdown
# AI Agent Instructions

> **This is a thin index file. The Single Source of Truth is `.agent/AI_AGENT_COMMON_INSTRUCTIONS.md`.**

Please read the following in order:

1. `.agent/AI_AGENT_COMMON_INSTRUCTIONS.md` — Core instructions, conventions, and constraints
2. `.agent/memory/INDEX.md` — Working memory index (architecture, testing, conventions)
3. `.agent/specs/INDEX.md` — Design specification registry

All project-specific rules, architecture details, and coding conventions are
maintained in `.agent/`. This file should not be modified directly — update
`.agent/AI_AGENT_COMMON_INSTRUCTIONS.md` instead.
```

#### .github/copilot-instructions.md

```markdown
# GitHub Copilot Instructions

> **This is a thin index file. The Single Source of Truth is `.agent/AI_AGENT_COMMON_INSTRUCTIONS.md`.**

Please follow the instructions in `.agent/AI_AGENT_COMMON_INSTRUCTIONS.md`
for project conventions, architecture, and constraints.
```

---

## Cross-Reference Validation Rules

After any doc creation or alignment, verify these rules:

1. **Every `](path)` link must resolve** to an existing file (relative to the referencing file).
2. **README roadmap entries must match** `.agent/specs/INDEX.md` statuses exactly.
3. **`AI_AGENT_COMMON_INSTRUCTIONS.md` must reference** all memory files in `.agent/memory/`.
4. **`memory/INDEX.md` must list** every `.md` file in `.agent/memory/`.
5. **`specs/INDEX.md` must list** every spec file in `.agent/specs/`.
6. **Thin indexes must NOT contain** substantive content — only paths to `.agent/`.

---

## Format Conventions

| Context | Language | Notes |
|---------|----------|-------|
| `.agent/memory/` files | Project primary language (Chinese for CN projects) | Internal docs |
| `README.md`, `docs/*.md` | English | Public-facing |
| `README.zh-CN.md`, `docs/*.zh-CN.md` | Chinese | Bilingual mirror |
| Code, paths, commands | English | Always original |
| Commit messages | English | `docs: {brief description}` |

---

## References

This standard is derived from the production documentation architecture of a
multi-agent development workspace with 20+ specs, 8+ skills, and 10+ memory files.
See the `doc-sync` skill for the companion skill that enforces documentation
synchronization after code changes.
