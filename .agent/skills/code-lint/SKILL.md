---
name: code-lint
description: |
  Static analysis lint tool for game-dev-studio codebase. Checks TypeScript/JavaScript
  files for common issues that slip through standard tooling. Current rules focus on
  unescaped backticks in template literals (a frequent bug in agent prompt files).
  Extensible to add new rules. Trigger when modifying server/agents.ts, any .agent/
  content, or when the user asks to run lint/代码检查 on the project.
agent_created: true
---

# Code Lint

## Overview

Project-specific lint checker for game-dev-studio. Runs fast static analysis on
TypeScript/JavaScript source files to catch errors that `tsc` would catch at build
time, before pushing to CI.

## When to Use

- After modifying `server/agents.ts` or any file that embeds markdown in template literals
- Before pushing a branch — as a pre-flight check
- When the user asks to "检查代码" or "run lint"

## Current Rules

### R1: Unescaped backtick in template literal

**What it catches**: Backticks appearing inside JS/TS template literal strings
that look like markdown inline code but are not escaped, e.g.:

```typescript
// BAD — the `video_*` backticks close the outer template literal early
const prompt = `
### 视频处理
使用 `video_*` 工具...
`;
```

This causes `tsc` errors: `TS1005: ',' expected`, `TS1443: Module declaration names...`.

**Fix**: Escape every `` ` `` inside the template literal as `` \` ``:

```typescript
// GOOD
const prompt = `
### 视频处理
使用 \`video_*\` 工具...
`;
```

**Heuristic**: The checker tracks template literal state and flags backticks that:
- Are preceded by a non-whitespace character (inline code before the backtick)
- Are followed by a non-whitespace character (content continuing after)
- Are NOT part of a triple-backtick code block (`` ``` ``) — those are legitimate
- Are NOT preceded by an odd number of backslashes (already escaped)

**Files skipped**: `.d.ts` (JSDoc code blocks are intentional there).

## How to Use

### Run the checker

```bash
# Check specific file(s)
python3 .agent/skills/code-lint/scripts/check_backticks.py server/agents.ts

# Check a directory
python3 .agent/skills/code-lint/scripts/check_backticks.py server/

# Check all agent-related files
python3 .agent/skills/code-lint/scripts/check_backticks.py server/agents.ts server/agent-manager.ts
```

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | No issues found |
| 1 | Issues found (fix them before pushing) |
| 2 | Usage/IO error |

## Adding New Rules

To add a new lint rule:

1. Create a new Python function in `scripts/` (or add to `scripts/check_backticks.py`)
2. Write a test case that triggers the bug and verify detection
3. Add a section to this SKILL.md under "Current Rules"
4. Update the `find_issues()` or `check_file()` function to call the new rule
5. Run `python3 .agent/skills/code-lint/scripts/check_backticks.py server/` to verify
   no false positives

Rule design principles:
- **Fast**: single-pass scanning, no AST parsing needed
- **Low false positives**: skip `.d.ts`, skip triple-backtick code blocks
- **Actionable output**: file:line:col + snippet showing the issue
