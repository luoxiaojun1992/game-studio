# GitHub Actions CI Agent 规范

> **SPEC-013** | 状态：设计中

## 目标

为 agent 提供读取 GitHub Actions CI 执行情况、检查调试日志、判断 UI Test 是否通过、并自主修复代码直至 UI Test 全部成功的能力。

核心能力：
1. **PAT 凭证约定**：约定 GitHub Personal Access Token 的本地存储方式（环境变量 / 本地文件），不纳入 git 版本控制
2. **CI 状态读取**：通过 GitHub REST API 查询 workflow run 状态、job 列表、step 日志
3. **UI Test 调试循环**：agent 读取失败日志 → 定位问题 → 修改代码 → 推送 → 等待 CI → 循环，直至 UI Test 全部通过

## 背景

当前 UI Test 运行在 GitHub Actions（`ci.yml` 的 `ui-tests` job），需要 engineer agent 能够：
- 获取最近一次 PR / push 触发的 workflow run 状态
- 下载并检查 `allure-report` artifact 中的 Playwright 日志
- 读取 UI Test 失败的 step stdout/stderr
- 根据日志自主推断修复方向并迭代，直至绿灯

## 凭证约定

### 环境变量方式（推荐）

在本地 shell 配置（`~/.zshrc` / `~/.bashrc`）中写入，或通过 `.env.local` 文件加载：

```bash
export GITHUB_PAT="ghp_xxxxxxxxxxxx"
```

agent 读取时使用：

```typescript
const pat = process.env.GITHUB_PAT;
if (!pat) throw new Error('GITHUB_PAT 未配置，无法调用 GitHub API');
```

### 本地文件方式（备选）

将 PAT 写入项目根目录下的 `.github-pat` 文件：

```
ghp_xxxxxxxxxxxx
```

agent 读取优先级：`GITHUB_PAT` 环境变量 > `.github-pat` 文件。

### .gitignore 规则

以下条目必须加入 `.gitignore`，**不得纳入版本控制**：

```
# GitHub PAT 本地凭证文件
/.github-pat
```

> 环境变量不产生文件，无需特殊处理；`.env.local` 已由现有 `.gitignore` 的 `/.env` 条目覆盖，如使用不同名则需补充。

### 安全要求

- PAT 权限范围：`repo`（含 `actions:read`），最小化授权
- **禁止**将 PAT 写入任何被 git 追踪的文件（`.env`、`config.json`、`agents.ts` 等）
- 日志中禁止打印 PAT 明文；如需 debug 可打印前 4 位：`pat.slice(0, 4) + '****'`

## GitHub API 使用规范

所有 GitHub API 调用均使用 REST v3，base URL：`https://api.github.com`，鉴权头：

```
Authorization: Bearer <GITHUB_PAT>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

### 关键接口

#### 1. 列出 Workflow Runs

```
GET /repos/{owner}/{repo}/actions/runs
  ?branch={branch}
  &event=push|pull_request
  &per_page=5
  &status=completed|in_progress|queued
```

返回最近几次 run，关注 `id`、`status`、`conclusion`（`success` / `failure` / `cancelled`）、`html_url`。

#### 2. 获取单次 Run 详情

```
GET /repos/{owner}/{repo}/actions/runs/{run_id}
```

#### 3. 列出 Run 的 Jobs

```
GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs
```

关注每个 job 的 `name`、`status`、`conclusion`、`steps[]`（含每步 `name`、`conclusion`、`number`）。

#### 4. 下载 Job 日志

```
GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs
```

返回 302 重定向到日志文件 URL（zip 格式），下载解压后得到文本日志。agent 应搜索 `FAILED`、`Error`、`✘` 等关键词定位失败点。

#### 5. 列出 Artifacts

```
GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts
```

关注 `name`（`allure-report`）、`id`、`size_in_bytes`、`expired`。

#### 6. 下载 Artifact

```
GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/zip
```

返回 302 重定向，需跟随跳转下载 zip，解压后读取：
- `tests/ui/artifacts/playwright-report/results.json` — 测试结果摘要
- `tests/ui/artifacts/allure-results/` — 详细 step 日志
- `tests/ui/artifacts/test-results/` — Playwright raw 输出

## MCP 工具设计

### 工具清单（6 个）

所有工具仅 **engineer** 可用，`ENGINEER_ALLOW` 自动放行，无需审批。

| 工具名 | 说明 |
|--------|------|
| `github_ci_list_runs` | 列出最近 N 次 workflow run（可按 branch / event 过滤） |
| `github_ci_get_run` | 获取指定 run 详情（状态、结论、触发分支、commit SHA） |
| `github_ci_list_jobs` | 列出指定 run 下所有 jobs 及 steps 状态 |
| `github_ci_get_job_logs` | 下载并返回指定 job 的文本日志（自动解压，截断至指定字符数） |
| `github_ci_list_artifacts` | 列出指定 run 的 artifacts |
| `github_ci_download_artifact` | 下载并解压 artifact 到本地临时目录，返回解压路径 |

### 工具参数规范

#### `github_ci_list_runs`

```typescript
{
  branch?: string;          // 可选，过滤分支（如 "main"、"feat/SPEC-013-xxx"）
  event?: 'push' | 'pull_request';
  status?: 'completed' | 'in_progress' | 'queued' | 'all';
  per_page?: number;        // 默认 5，最大 20
}
```

#### `github_ci_get_run`

```typescript
{
  run_id: number;
}
```

#### `github_ci_list_jobs`

```typescript
{
  run_id: number;
}
```

#### `github_ci_get_job_logs`

```typescript
{
  job_id: number;
  max_chars?: number;       // 默认 20000，截断过长日志（从尾部保留）
  filter_keyword?: string;  // 可选，只返回包含关键词的行（如 "FAILED"、"Error"）
}
```

#### `github_ci_list_artifacts`

```typescript
{
  run_id: number;
}
```

#### `github_ci_download_artifact`

```typescript
{
  artifact_id: number;
  output_dir?: string;      // 本地解压目录，默认 /tmp/ci-artifacts/{artifact_id}
}
```

### 输出格式

工具统一返回 JSON 字符串，包含 `success: boolean` 和数据字段：

```json
// github_ci_list_runs 成功示例
{
  "success": true,
  "runs": [
    {
      "id": 12345678,
      "status": "completed",
      "conclusion": "failure",
      "branch": "feat/SPEC-013-xxx",
      "commit_sha": "abc1234",
      "html_url": "https://github.com/xxx/yyy/actions/runs/12345678",
      "created_at": "2026-06-05T08:00:00Z",
      "updated_at": "2026-06-05T08:12:00Z"
    }
  ]
}

// 失败示例
{
  "success": false,
  "error": "GitHub API rate limit exceeded"
}
```

## 仓库配置约定

### 仓库信息读取

agent 从以下优先级读取仓库 owner/repo：
1. 环境变量 `GITHUB_REPO`（格式 `owner/repo`）
2. `git remote get-url origin` 解析
3. 工具参数中显式传入

### 默认 Workflow 名

CI workflow 名为 `CI`（对应 `ci.yml` 的 `name: CI`）；UI Test job 名为 `ui-tests`。agent 调用 `github_ci_list_jobs` 后应优先匹配 `ui-tests` job。

## UI Test 自动调试循环

### 循环流程

```
┌─────────────────────────────────────────────────────────────┐
│                   UI Test 调试循环                           │
│                                                             │
│  1. github_ci_list_runs(branch=current)                     │
│     └─> 找到最新 run_id                                      │
│                                                             │
│  2. github_ci_get_run(run_id)                               │
│     ├─> conclusion == "success" → 退出，UI Test 全通过       │
│     ├─> status == "in_progress" → 等待（轮询间隔 60s）       │
│     └─> conclusion == "failure" → 进入步骤 3                │
│                                                             │
│  3. github_ci_list_jobs(run_id)                             │
│     └─> 找到 ui-tests job_id 和失败 step                     │
│                                                             │
│  4. github_ci_get_job_logs(job_id, filter_keyword="FAILED") │
│     └─> 提取失败原因                                         │
│                                                             │
│  5. 可选：github_ci_download_artifact                        │
│     └─> 解压 allure-report，读取 results.json               │
│                                                             │
│  6. 分析日志 → 定位代码问题 → 修改代码 → git push           │
│                                                             │
│  7. 等待新 run 触发 → 回到步骤 1                             │
│                                                             │
│  最大迭代次数：10 次（防止无限循环）                          │
└─────────────────────────────────────────────────────────────┘
```

### 循环退出条件

| 条件 | 处理 |
|------|------|
| UI Test 全部通过（`conclusion == "success"`） | 正常退出，报告成功 |
| 超过最大迭代次数（10 次） | 退出循环，报告超次数，等待人工介入 |
| 连续 3 次相同错误无法修复 | 退出循环，输出错误摘要，请求人工介入 |
| `github_ci_get_run` 返回 `cancelled` / `skipped` | 退出循环，提示 CI 被手动取消 |

### 等待策略

- run 状态为 `queued` 或 `in_progress` 时，每 **60 秒**轮询一次
- 单次 run 超时上限：**45 分钟**（对应 `ci.yml` 中 `ui-tests` job 的 `timeout-minutes: 45`）
- 轮询时使用 `github_ci_get_run` 而非 `list_runs`，减少 API 调用量

### 日志分析要点

engineer agent 读取 job 日志时，应重点关注以下模式：

```
# Playwright 失败标志
✘ [UI-xxx] 测试名称
Error: ...
  at ...

# Docker 容器启动失败
Error response from daemon: ...
container exited with code ...

# 依赖/编译错误
FAILED: ...
error TS...
```

## TS 客户端设计

### 文件结构

```
server/
├── github-ci.ts          # GitHub API 客户端（getPat、listRuns、getRun、listJobs、getJobLogs、listArtifacts、downloadArtifact）
├── github-ci.d.ts        # TypeScript 类型定义
└── tools.ts              # MCP 工具注册（github_ci_* 6 个工具）
```

### `github-ci.ts` 核心接口

```typescript
// PAT 读取（优先环境变量，次 .github-pat 文件）
export function getGithubPat(): string;

// 获取仓库 owner/repo（优先环境变量，次 git remote）
export async function getRepoInfo(): Promise<{ owner: string; repo: string }>;

// 核心 API 封装
export async function listWorkflowRuns(opts: ListRunsOptions): Promise<WorkflowRun[]>;
export async function getWorkflowRun(runId: number): Promise<WorkflowRun>;
export async function listRunJobs(runId: number): Promise<WorkflowJob[]>;
export async function getJobLogs(jobId: number, opts?: LogOptions): Promise<string>;
export async function listRunArtifacts(runId: number): Promise<Artifact[]>;
export async function downloadArtifact(artifactId: number, outputDir: string): Promise<string>;
```

### 类型定义

```typescript
interface WorkflowRun {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null;
  head_branch: string;
  head_sha: string;
  html_url: string;
  created_at: string;
  updated_at: string;
}

interface WorkflowJob {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null;
  steps: JobStep[];
}

interface JobStep {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null;
  number: number;
}

interface Artifact {
  id: number;
  name: string;
  size_in_bytes: number;
  expired: boolean;
  created_at: string;
}

interface ListRunsOptions {
  branch?: string;
  event?: 'push' | 'pull_request';
  status?: 'completed' | 'in_progress' | 'queued';
  per_page?: number;
}

interface LogOptions {
  maxChars?: number;
  filterKeyword?: string;
}
```

## 数据模型

本功能为纯 API 调用，**不新增 SQLite 表**，无需持久化。

## 集成要点

### 环境变量

在 `docker-compose.yml` 和本地 `.env` 中均**不需要**写入 PAT（PAT 只在宿主机 shell 或本地文件中，不随容器启动注入）。

agent 执行调试循环时运行在宿主机 node 进程（MCP server），可直接读取宿主机环境变量。

### .gitignore 新增条目

```
# GitHub PAT 本地凭证文件
/.github-pat
```

### 无需新增 Docker 服务

本功能不涉及新微服务容器，仅在现有 MCP server（`server/tools.ts`）中注册新工具。

## 输入校验规则

| 字段 | 规则 |
|------|------|
| `run_id` / `job_id` / `artifact_id` | 正整数，> 0 |
| `per_page` | 正整数，1-20 |
| `max_chars` | 正整数，1000-100000 |
| `filter_keyword` | 非空字符串，长度 ≤ 200 |
| `output_dir` | 绝对路径，通过 `resolveSafePath` 校验不越出 `/tmp/ci-artifacts/` |
| `branch` | 正则 `/^[a-zA-Z0-9._/\-]{1,200}$/` |

## 相关文件

| 文件 | 角色 |
|------|------|
| `server/github-ci.ts` | GitHub API HTTP 客户端 |
| `server/github-ci.d.ts` | TypeScript 类型定义 |
| `server/tools.ts` | 6 个 MCP 工具注册 |
| `server/agent-manager.ts` | `ENGINEER_ALLOW` 权限 |
| `server/agents.ts` | TOOLS_OVERVIEW + 系统提示词 |
| `.gitignore` | 新增 `/.github-pat` |
| `.github/workflows/ci.yml` | 只读参考，不修改 |

## 测试策略

1. **单元测试**：mock GitHub API 响应，验证 `getPat()` 读取优先级、`getRepoInfo()` 解析逻辑、日志截断和关键词过滤逻辑
2. **集成测试**：使用真实 PAT 调用 GitHub API，验证 `listWorkflowRuns`、`getJobLogs`（带 302 重定向跟随）、`downloadArtifact`（zip 解压）
3. **UI Test**：通过 engineer agent 调用 `github_ci_list_runs` → `github_ci_get_job_logs`，验证全链路可用

## UI Test 验收规则

提交代码前必须跑通 ui test。
如遇网络或依赖问题，可临时修改代码解决网络问题，但禁止提交为了解决网络依赖问题所做的变更。

## 主动补全 UI Test 规范

新增前端交互功能（按钮、表单、弹窗、面板等）时，必须同步编写对应的 E2E 测试用例，并更新以下文档：
1. `tests/ui/e2e/studio.spec.ts` — 添加测试用例（分配下一个 UI-XXX 编号）
2. `.agent/memory/E2E_TESTING.md` — 更新测试矩阵、testid 对照表、测试经验
3. `.agent/specs/` 下对应的 spec 文档 — 更新测试策略章节
4. `.agent/specs/INDEX.md` — 如有新 spec 则更新索引

## 主动更新所有相关文档规范

实现新功能或做重大修改后，必须主动检查并更新所有受影响的文档，而非仅更新直接相关文件。完整检查清单：
1. `README.md` + `README.zh-CN.md` — 功能概览、API 概览、目录结构
2. `docs/ARCHITECTURE.md` + `docs/ARCHITECTURE.zh-CN.md` — 业务域、数据模型、运行时组件
3. `.agent/memory/ARCHITECTURE.md` — 架构关键点、关键模块详解
4. `.agent/memory/INDEX.md` — 快速参考
5. `.agent/memory/E2E_TESTING.md` — 测试矩阵、testid 对照表（如有新测试）
6. `.agent/memory/CONVENTIONS.md` — 工作约定（如有新规范）
7. `.agent/memory/MEMORY.md` — 长期记忆（工程决策记录）
8. `.agent/specs/` 下相关 spec 文档 — 状态、测试策略
9. `.agent/specs/INDEX.md` — spec 索引状态
10. `.agent/AI_AGENT_COMMON_INSTRUCTIONS.md` — 关键文件位置、API 概览
- **文档更新禁止添加日期和敏感信息**
- **不相关的文档不需要修改**（如 LINT.md 与本功能无关则不更新）

## 详细 Debug 日志规范

新增前端交互功能、后端 API 路由、E2E 测试用例时，必须同步添加 `console.log` / `process.stderr.write` debug 日志，方便测试失败时快速定位问题：

1. **后端 API 路由**：在路由入口、校验步骤（PASS/FAIL）、关键操作处添加 `console.log('[DEBUG:路由名] stepN: ...')` 格式日志
2. **前端组件**：在关键生命周期、用户操作、API 请求/响应处添加 `console.log('[DEBUG:ComponentName] ...')` 格式日志
3. **SSE 事件处理**：在 `handleSSEEvent` 的 case 分支中添加日志，记录事件类型和关键数据
4. **E2E 测试用例**：参照 UI-007/008 的 `log()` helper 模式，每个操作步骤添加 `process.stderr.write('[UI-XXX] step: ...')` 日志

## 注意事项

- **API Rate Limit**：GitHub REST API 每小时 5000 次（PAT 鉴权），调试循环内不得每秒高频轮询；等待策略 60s 间隔足够
- **日志大小**：job 日志可能超过 100MB（zip 压缩后约 5-20MB），下载后 `max_chars` 截断，从**尾部**保留（失败信息通常在最后）
- **302 跳转**：`GET /actions/jobs/{id}/logs` 和 artifact 下载均返回 302，HTTP 客户端需设置 `followRedirects: true`（或手动跟随，注意跳转 URL 不含鉴权头）
- **PAT 环境变量不注入容器**：PAT 只在宿主机 MCP server 进程中使用，不应出现在任何 docker-compose `environment` 配置中
- **`.github-pat` 文件权限**：建议设置 `chmod 600 .github-pat`，防止其他用户读取
- **Artifact 有效期**：GitHub Actions artifact 默认保留 90 天，调试时注意 `expired` 字段
