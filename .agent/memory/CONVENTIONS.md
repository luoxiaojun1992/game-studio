# 项目约定与 Bug 修复

## ⚠️ 工作红线
- **永远禁止 workaround！** 任何修改必须基于正确的根因分析，逻辑正确是底线
- 不允许为了"让测试通过"而放宽断言、加 fallback、或绕过正常流程
- 遇到问题必须先定位根因，再修复，不能猜测或碰运气
- 验收标准中明确，提交代码前必须跑通ui test。如遇网络或依赖问题，可临时修改代码解决网络问题，但禁止提交为了解决网络依赖问题所做的变更。
- **编写 Spec 规范**：设计新功能时遵循 `.agent/skills/spec-writer/SKILL.md` 中定义的标准化 spec 编写流程和章节模板
- **主动添加 UI Test**：新增前端交互功能（按钮、表单、弹窗、面板等）时，必须同步编写对应的 E2E 测试用例，并更新以下文档：
  1. `tests/ui/e2e/studio.spec.ts` — 添加测试用例（分配下一个 UI-XXX 编号）
  2. `.agent/memory/E2E_TESTING.md` — 更新测试矩阵、testid 对照表、测试经验
  3. `.agent/specs/` 下对应的 spec 文档 — 更新测试策略章节
  4. `.agent/specs/INDEX.md` — 如有新 spec 则更新索引

- **主动更新所有相关文档**：实现新功能或做重大修改后，必须主动检查并更新所有受影响的文档，而非仅更新直接相关文件。架构图维护可使用 `.agent/skills/architecture-diagram/SKILL.md` 技能。完整检查清单：
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
  - **不相关的文档不需要修改**（如 LINT.md 与问卷提案无关则不更新）
- **UI Test 编号规则**：`UI-XXX` 从现有最大编号 +1 递增，测试文件中用 `[UI-XXX]` 作为 test 名称前缀
- **前端组件 data-testid 规范**：新组件必须添加 `data-testid` 属性供 E2E 测试使用，命名采用 `{功能缩写}-{元素}` 格式（如 `q-game-name`）

- **添加详细 debug 日志以方便 UI Test 调试**：新增前端交互功能、后端 API 路由、E2E 测试用例时，必须同步添加 `console.log` / `process.stderr.write` debug 日志，方便测试失败时快速定位问题：
  1. **后端 API 路由**：在路由入口、校验步骤（PASS/FAIL）、关键操作（DB 写入、SSE 广播）处添加 `console.log('[DEBUG:路由名] stepN: ...')` 格式日志
  2. **前端组件**：在关键生命周期（mount）、用户操作（表单填写、校验、提交）、API 请求/响应处添加 `console.log('[DEBUG:ComponentName] ...')` 格式日志
  3. **SSE 事件处理**：在 `handleSSEEvent` 的 case 分支中添加日志，记录事件类型和关键数据
  4. **E2E 测试用例**：参照 UI-007/008 的 `log()` helper 模式，每个操作步骤添加 `process.stderr.write('[UI-XXX] step: ...')` 日志，包含结构化 extra 数据
  - **日志格式统一**：`[DEBUG:模块名] stepN: 描述` 或 `[UI-XXX] stepN: 描述`，关键数据以 JSON extra 输出
  - **日志粒度**：关键路径全覆盖，但避免在循环/高频回调中输出日志

## 6 个 Bug 修复记录
1. CommandPanel 历史记录丢失
2. 产出持久化失败
3. 交接确认流程缺失
4. 清除聊天功能无效
5. 长期记忆未生效
6. 产出目录配置错误

## Agent 选择状态持久化
- 状态在 `StudioPage.commandTargetAgent` 与 `CommandPanel.selectedAgent` 之间采用“双向协同（两条单向更新链路）”
- `StudioPage.commandTargetAgent` = 跨面板目标（页面级“全局当前指令目标 Agent”），用于总览卡片跳转到指令中心时透传
- `CommandPanel.selectedAgent` = 指令中心面板内当前选中 Agent
- localStorage key 格式: `commandPanel_lastAgent_${projectId}`
- 切换项目时会按项目键自动恢复保存的 Agent；无效值会回退到可指令 Agent 默认值
- `team_builder` 会被过滤，不作为指令中心可选目标 Agent（其职责是系统触发的总结/记忆沉淀）
- 关键实现位置：`src/pages/StudioPage.tsx`、`src/components/CommandPanel.tsx`
- 同步方向说明：
  - `StudioPage -> CommandPanel`：从总览卡片“发送指令”跳转或项目切换恢复时，通过 `selectedAgentId` 驱动 CommandPanel 同步并写回 localStorage。
  - `CommandPanel -> StudioPage`：用户在指令中心左侧切换 Agent 时，通过 `onAgentChange` 回传同步 `commandTargetAgent`。
  - 冲突处理：
    - 若两路几乎同时发生，最终以“最后一次状态写入”为准（React 状态 + localStorage 都遵循最后写入覆盖）
    - 项目切换属于更高优先级上下文切换，会先重载新项目存储并覆盖旧项目选择

## 交接默认行为
- `auto_handoff_enabled` 表默认值应为 1（交接无需人工确认，自动放行）

## 工程师任务同步规则
- 工程师同时持有"开发"和"测试"两种任务状态，两者必须同步更新
- systemPrompt 中有强制规则要求双任务状态同步

## project_id 架构原则
- 工具 schema 已移除 `project_id` 入参
- `createStudioToolsServer(projectId, ...)` 在创建时注入 `scopedProjectId`
- 工具运行时统一使用 `scopedProjectId`，拒绝跨项目访问
- 受影响工具: `split_dev_test_tasks`、`get_tasks`、`submit_proposal`、`submit_game`
- 与 `create_handoff`、`get_logs`、`get_proposals`、`get_pending_handoffs` 保持一致
- `enforceProject` 已成死代码，已删除

## Mock 数据契约对齐（测试 ↔ 工具层）
- 测试中 `setMockExpectation` 的 `toolCalls.arguments` 必须与 `tools.ts` 中 zod schema 完全匹配
- `submit_proposal` 的 `type` 必须是 `db.PROPOSAL_TYPES` 枚举值之一
- **禁止在 UI 测试中直接写入后端文件系统**：Playwright 测试与后端服务不在同一容器/进程，`fs.mkdirSync` + `fs.writeFileSync` 写入的文件后端无法读取。
- **禁止 mock 中模拟 SDK 内置工具（Write/Bash）**：CI 环境中仅部署 mock server，无 CodeBuddy 运行时，内置工具无法执行。必须通过 mock 返回 MCP 工具调用（如 `write_game_file`），由 agent-sdk 本地执行。
- **经验**：工具 schema 变更后，同步检查测试 mock 数据，否则运行时报 zod 校验错误

## 被纠正的错误做法汇总

| 错误做法 | 正确做法 | 影响 |
|:---|:---|:---|
| 删除迁移代码前未确认 DDL 是否已包含所有必要列 | 删除迁移代码时必须审查 DDL（CREATE TABLE）是否已包含迁移所添加的全部列 | 迁移删了但 DDL 没列 → submit_game 等静默报错，数据无法持久化 |
| 推送前未 commit，直接 `git push -u origin branch` | 每次 push 前必须 `git status` 确认改动已 commit | 避免空分支 PR |
| mock 继续传已移除的 `project_id` 或漏传新必填参数 | 让 `toolCalls.arguments` 与当前 zod schema 严格一致（不要再传 `project_id`） | 避免参数校验失败导致工具不执行 |
| Docker 构建时基础镜像包名写错（如 `libxi-6` 而非 `libxi6`） | Ubuntu 24.04 包名无横杠，且部分包已更名（如 `libasound2` → `libasound2t64`）| 构建失败 |
| `uvicorn app.main:app` 启动时，用相对包名 `from schemas import` | 必须用完整包名 `from app.schemas import`，因为解释器工作目录是 `/app` 而非 `app/` 上级 | ModuleNotFoundError |
| 使用第三方 Blender Docker 镜像（`blenderai/blender` 等）| Blender 官方 `download.blender.org` 提供稳定公开二进制，用 `ubuntu:24.04 + 官方tarball` 自建更可控 | 镜像不存在或失联导致构建失败 |
| 逐步等待固定时间（waitForTimeout 链式调用） | 目标状态驱动的事件循环 + 非阻塞轮询 | 测试更稳定、更快 |
| UI-007/008 各写独立测试逻辑 | 抽取 `runFullWorkflowTest()` 共享函数 + WorkflowOptions 参数化 | 消除重复代码，降低维护成本 |
| 手动模式下在循环外 accept/confirm | 循环体内每轮尝试 tryAcceptAnyPending + tryConfirmAnyAccepted | 适应异步事件到达时序不确定性 |
| MCP server 采用按角色拆分的独立 server/工具集并行注册，导致非工程角色也暴露多余建模工具 | 使用单一 studio-tools server，但按角色选择性放行：`blender_*` 仅给 engineer | 降低非工程角色工具噪音，避免 handoff 流程与 mock 期望错乱 |
| 模型文件下载/删除直接拼接路径 | 下载/删除前必须做 safe path 校验（限制在 `output/{project_id}/models`） | 防止路径穿越导致越权读写 |
| 引入外部服务（如 SonarQube）后未配置 `depends_on` 和健康检查 | docker-compose 中新增有 API 依赖的服务（如 sonarqube），studio-backend 必须 `depends_on` 并设 `condition: service_healthy` | studio-backend 启动时依赖服务未就绪 → 认证/扫描请求直接失败 |
| SonarQube JDBC URL 格式写成 `postgresql://...` | 必须为 `jdbc:postgresql://...`，JDBC driver 要求 `jdbc:` 前缀 | 启动时 `Bad format of JDBC URL` 错误 |
| 新增 docker compose 服务未检查端口冲突 | 添加服务前先 `docker ps -a --format '{{.Ports}}'` 确认端口未被占用 | `Bind for 0.0.0.0:9000 failed: port is already allocated` |
| SonarQube 开发环境使用 PostgreSQL 外部依赖 | 开发/测试环境直接用 SonarQube 内置 H2 数据库，不挂 PostgreSQL | 减少运维复杂度，H2 对单实例够用 |
| health check 的 `start_period` 设置过短 | 新服务初始化时间可能很长（如 SonarQube H2 初始化需 120-300s），`start_period` 应设 300s 并配合 `retries` 重试 | `start_period` 不足导致 health check 直接失败，服务被标记 unhealthy |
| SonarQube health check 用 `wget` 而非 `curl` | sonarqube:community 镜像默认不带 `wget`，带 `curl`；应统一用 `curl -sf http://localhost:9000/api/system/status | grep -q '"status":"UP"' || exit 1` | health check 永远 fail，依赖服务无法启动 |
| SonarQube health check 路径用 `/api/system/health`（需认证，永远 403） | `/api/system/health` 需要 SonarQube token 认证，匿名请求永远 403；应改为公开的 `/api/system/status` 并验证 `status=UP` | health check 永远失败（403 Forbidden），与 UP/STARTING 状态无关 |
| 遇到问题时先自己尝试而非查官方文档 | Docker/SonarQube 等开源软件的配置问题，官方文档和 GitHub issue 才是最准确的信息源 | 自己试错耗时且容易踩坑，官方文档一句话就能解决（如 SonarQube health check API 路径、`jdbc:` 前缀要求） |
| 新增 async 类型 checker 但未修改 LintRunner.run() 为 async | 若 checker.check() 返回 Promise，LintRunner.run() 必须改为 async 并用 `await` 等待结果 | 异步 checker 直接返回 Promise 但同步调用方拿不到正确结果 |
| ZIP 模式传给检查器前先解压再重压缩 | checker 统一通过 `LintContext.submitDir` 获取目录路径，自行决定处理方式（SonarQube checker 从目录打包 ZIP、GameEngineeringChecker 直接读文件） | 浪费 CPU，且 SonarQube 接收的是重新压缩后的包（与原始提交不符） |
| sonar-scanner 退出码 0 不等于质量门通过 | scanner 退出码 0 只表示"分析跑完了"，质量门是否通过需要单独调 `/api/qualitygates/project_status?project=xxx` 判断；若 `status != OK` 必须主动 `exit 1` | CI 流程误认为 scanner 成功 = 质量门通过，漏拦截不合格代码 |
| GitHub Actions 中 `docker exec <container>` 必须用 `docker compose exec -T <service>` | `docker compose` 环境下容器名带项目前缀，硬编码容器名会失败；`exec -T` 禁用 TTY 交互 | `exec <container_name>` 找不到容器，health check 和质量门查询都失败 |
| sonar-scanner CLI 容器与 SonarQube 网络隔离 | scanner Docker 容器与 SonarQube 容器不在同一网络时无法解析 `sonarqube:9000`；SonarQube 端口已映射到宿主 `9000:9000`，scanner 直接用 `--network host` + `sonar.host.url=http://localhost:9000` 更简单 | scanner 无法连接 SonarQube，扫描直接失败 |
| Docker Hub 镜像标签与 GitHub release 版本不对应 | 不能把 GitHub release 版本号（如 `7.3.0.5189`）直接当作 Docker Hub 镜像标签使用；Docker Hub `sonarsource/sonar-scanner-cli` 实际只有 `latest`、`5`、`5.0` 可用；必须用 `docker pull <tag>` 验证标签是否真实存在 | 用了不存在的镜像标签导致 `manifest unknown` 错误 |
| parse_report.py 以 scanner-cli 用户运行，`/report` 目录无写权限 | sonarqube:community 镜像以 `scanner-cli`（UID 1000）非 root 用户运行，匿名挂载的 volume 或目录可能无写权限；entrypoint.sh 应在开始时用 root 创建并 `chmod 777 /report`，或 compose 中显式 `user: root` | PermissionError 导致 report 写失败，CI 无法上传 artifacts |
| SonarQube 默认密码是 `admin:admin`，不是 `admin:sonarpass` | SonarQube 首次启动默认 credentials 是 `admin:admin`；`admin:sonarpass` 是 SonarQube 旧版本的默认值，容易混淆 | API 认证一直 401 Unauthorized，误以为是 network 或 token 问题 |
| `/api/user_tokens/generate` 的 `type` 参数值必须是 `USER_TOKEN` | 官方文档或旧经验可能写成 `USER_API_TOKEN`，SonarQube 26.x 实际只接受 `USER_TOKEN`、`GLOBAL_ANALYSIS_TOKEN`、`PROJECT_ANALYSIS_TOKEN` | 一直报 type 参数校验错误，不提示正确枚举值 |
| `/api/projects/show` 在 SonarQube 26.x 已被移除 | SonarQube 新版废弃了多个 `api/projects/*` 端点；获取项目信息应改用 `report-task.txt` 直接读取 taskId，或调 `/api/navigation/component` | 404 Unknown url，parse_report.py 无法获取项目信息 |
| `git add -A` 前未检查暂存内容，导致构建产物被提交 | 以下文件类型**永远禁止提交**，必须确保已在 `.gitignore` 中覆盖：`__pycache__/`、`*.pyc`、`*.pyo`、`.scannerwork/`、`scanner-report/`、`.tsbuildinfo`、临时 zip 文件等。`git add -A` 前先 `git status --short` / `git diff --cached --stat` 确认只暂存目标文件。若已误提交，用 `git rm --cached` 取消跟踪 + 更新 `.gitignore`，并提醒 reviewer 注意 | 构建产物污染 commit 历史，后续 `git revert` 或 `git log` 都夹杂无效文件，增加维护成本 |
| SonarQube 双认证路径混淆 | studio-backend 的 `SonarQubeClient` 用 `SONARQUBE_USER/PASSWORD`（调 REST API）；scanner 微服务用 `SONAR_USER/PASSWORD`（调 scanner CLI + token generate）；两者 env var 名不同，不可混用 | scanner 或 backend 一侧认证失败，导致扫描中断或 issues 拉取失败 |
| SonarQube 扫描异常被静默吞掉 | `sonarqubeChecker.check()` 的 catch 块若 `return []` 会静默跳过所有错误（含 auth 失败）；必须 `throw err` 让 LintRunner 转为 error issue 阻断提交 | sonar auth 失败但游戏仍提交成功，质量问题漏过 |
| SonarQube Web 分析器非确定性检测 | 相同 HTML 在不同 projectKey 下扫描，SonarQube Web 规则（如 `Web:S5254`）可能随机报 issue；mock HTML 应添加 `lang` 属性消除不确定性 | UI-007/008 相同 HTML 但扫描结果不一致，测试 flaky |
| `sonarqube:community` 优于硬编码版本 | `sonarqube:community`（无版本号）指向最新 LTS，优于 `10.6-community` 等硬编码；`wget` 不在镜像中，healthcheck 必须用 `curl -sf` | 镜像版本过时或 healthcheck 永远失败 |
| `scannedProjects` 防重复扫描 | Module 级内存 Set 避免同一 projectKey 重复触发扫描；首次扫描后通过 `extraPayloads` 复用报告（进程重启或 `resetSonarScanHistory` 会清空） | 避免 ZIP 模式重复扫描同一项目 |
| `sonar_storage_id` 持久化到 games 表 | 扫描完成后将 Sonar 报告上传 MinIO，并在 `games` 表记录 `sonar_storage_id` | 支持后续查询和展示扫描报告 |
| 在前端组件中直接使用 `fetch('/api/...')` 调用后端 API | 必须使用 `config.ts` 中 `api.*` 封装函数（如 `api.getModels()`），它们通过 `VITE_API_BASE` 解析到正确的后端地址 | 生产构建（nginx）中 `/api/*` 被当作静态文件请求，返回 404 |
| UI 测试中 `fs.mkdirSync` + `fs.writeFileSync` 直接写入后端 `output/` 目录 | 通过 mock 返回 MCP 工具调用（如 `write_game_file`），由 agent-sdk 本地执行 | 测试与后端不在同一容器/进程，本地写入的文件后端无法读取 |
| mock 模拟 `Write`/`Bash` 等 SDK 内置工具 | CI 中无 CodeBuddy 运行时，内置工具不可执行；必须使用 MCP 工具 | 工具调用静默失败，测试流程卡住 |
| TS 模板字符串内写 Markdown 行内代码时用反引号包裹 | 模板字符串内的 Markdown 反引号会提前终止字符串，必须转义为 \\\` 或去掉反引号用纯文本 | TS 编译报 TS1005/TS1003 错误（Docker 构建失败） |

## Session ↔ Project 关系
- **Session 不会跨 project**：每次 `sendMessage(projectId, agentId, ...)` 都会创建全新的 SDK session，session 与 project 一一对应
- `scopedProjectId` 在 `createStudioToolsServer` 注册时被闭包捕获是安全的，因为 session 不会跨越 project 边界
- 当前通过"每次 sendMessage 重新创建 server 实例"实现多 project 隔离，而非单实例多 project context 动态隔离
- 如果未来需要同一 session 内跨 project 操作，需要改用动态 project context 而非硬捕获 `scopedProjectId`

## Lint Framework 约定
- **新增检查器必须实现 `LintChecker` 接口**，注册到 `checkers/index.ts` 的 `builtInCheckers` 数组
- **error = 阻断提交**，**warn = 仅记录日志**，不设 info 级别
- **checker 内部异常由 LintRunner catch 并降级为 error issue**，不会中断其他 checker 执行
- **submit_game 是唯一调用点**（tools.ts 权限校验后、db.createGame() 前），API 层和 DB 层不接入 lint
- **零外部依赖**：检查器使用纯正则/字符串分析，不引入 DOM parser 或 AST 库
- **GameEngineeringChecker 目录模式**：直接读取 `submitDir/dist/*` 文件，SonarQube checker 也从 `submitDir` 自行打包 ZIP，两者使用同一 `LintContext.submitDir`
- **submitDir 传递**：`submit_game` 调用 lint 时传入 `{ submitDir: targetPath, projectId: scopedProjectId }` context 已是必填参数

## CI 调试约定（SPEC-014）

### 标准开发循环

```
开发 → push 分支 → 晓军创建 PR → 轮询 CI 状态（120s 间隔）
  ├─ 全部通过 → 完成
  └─ ui-tests 失败 → 下载日志分析 → 修复代码 → push → 继续轮询
```

> 晓军负责创建 PR，agent 负责 push 后轮询 CI、分析失败、修复代码。

### PAT 凭证读取优先级

coding agent 通过以下优先级读取 GitHub PAT：

1. **环境变量 `GITHUB_PAT`**（推荐）：通过 `process.env.GITHUB_PAT` 或 `echo $GITHUB_PAT` 读取
2. **本地文件 `.github-pat`**（备选）：项目根目录下的纯文本文件，仅包含 PAT 字符串

### `gh` CLI 使用规范

- `gh api` 自动读取 `GITHUB_PAT` 环境变量鉴权，无需额外传参
- `gh api` 自动跟随 302 重定向（日志/artifact 下载）
- 仓库信息通过 `git remote get-url origin` 解析：`git@github.com:{owner}/{repo}.git` → `{owner}/{repo}`

### 调试循环安全退出条件

| 条件 | 处理 |
|------|------|
| 全体 UI Test 通过（`conclusion == "success"`） | 正常退出，报告成功 |
| 超过最大迭代次数（10 次） | 退出，输出失败摘要，等待用户介入 |
| 连续 3 次相同错误无法修复 | 退出，输出错误摘要和已尝试修复，请求用户介入 |
| run 状态为 `cancelled` / `skipped` | 退出，提示 CI 被取消/跳过 |

### 调试循环参数

- 轮询间隔：**60 秒**
- 单次 run 超时：**45 分钟**（与 `ci.yml` 中 `timeout-minutes: 45` 对齐）
- 最大迭代：**10 次**

### push 前检查

在执行 `git push` 之前，agent 应确认：
1. 代码已通过本地编译或无明显语法错误
2. 修改有针对性，不是盲目试探
3. commit message 遵循 Conventional Commits 规范

### push 后跟踪

push 后 agent 应：
1. 立即获取远端最新 run（use `gh api .../actions/runs?branch=<分支>`）
2. 进入等待 → 轮询循环，按 60s 间隔查询 run 状态
3. **不要在等待期间执行其他代码修改**（避免冲突）

### 日志分析重点

下载 job 日志后，重点搜索失败模式：
- `✘ [UI-xxx]` — Playwright 测试失败
- `Error:` — Playwright error message
- `Error response from daemon` — Docker 容器启动失败
- `error TS...` — 编译/类型错误
- `npm ERR!` / `ECONNREFUSED` — 依赖安装/网络失败

### 禁止行为（红线）

- **禁止修改 `ci.yml` 绕过 CI 失败**：不允许禁用 job、将测试标记为 skip、或缩短 timeout
- **禁止在日志中打印 PAT 明文**：如需 debug 可打印前 4 位 + `****`
- **禁止将 PAT 写入任何被 git 追踪的文件**
- **日志清理**：调试循环结束后清理 `/tmp/ci-job-*/`、`/tmp/ci-artifact-*/`

### PAT 安全

- `.github-pat` 文件权限设为 `chmod 600`
- PAT 权限范围：`repo`（含 `actions:read`），最小化授权
- `.github-pat` 已在 `.gitignore` 中，不得纳入版本控制

## 游戏工程规范约定
- **统一 `dist/` 前缀**：所有游戏类型的提交产物以 `submitDir/dist/` 为根目录，`dist/index.html` = 入口文件，`dist/metadata.json` = 元信息
- **H5 特有结构**：额外需要 `dist/assets/manifest.json` 资源清单
- **3 个查询工具**仅 engineer 可用、无需授权：`get_game_types`、`get_game_framework_spec`、`get_common_spec`
- **种子数据**嵌入在 `server/specs/*.ts` 中，不依赖运行时 `.md` 文件
- **新增游戏类型**：在 `rules/` 下创建对应目录 + 规则文件，在 `server/specs/` 添加种子数据，在 `game-engineering/index.ts` 注册规则

---

## 打日志调试（Console Debug）

### 日志输出位置

在 Node.js 后端代码中，使用 `console.error()` 输出调试日志到 stderr：

```typescript
// ✅ 正确：使用 console.error 输出调试日志
console.error(`[DEBUG tool_name] START agentId=${agentId} projectId=${projectId}`);

// ❌ 错误：使用 console.log（可能被 stdout 缓冲）
console.log(`DEBUG: something`);
```

### 日志关键字命名规范

| 日志类型 | 关键字格式 | 示例 |
|---------|-----------|------|
| 调试日志 | `[DEBUG 模块名]` | `[DEBUG submit_game]`, `[DEBUG write_game_file]` |
| Mock 日志 | `[mock-debug]` | `[mock-debug] queued for`, `[mock-debug] consumed exp` |
| Agent 日志 | `[DEBUG agent-*]` | `[DEBUG agent-tool-call]`, `[DEBUG agent-tool-result]` |
| 错误日志 | `[ERROR 模块名]` | `[ERROR submit_game] file not found` |

### 日志内容规范

日志应包含关键变量信息，便于定位问题：

```typescript
// ✅ 好日志：包含关键上下文
console.error(`[DEBUG submit_game] START projectId=${scopedProjectId} resolvedPath=${resolvedFilePath}`);
console.error(`[DEBUG submit_game] targetPath=${targetPath} exists=${exists} isDirectory=${isDirectory}`);

// ❌ 差日志：信息不足或冗余
console.error("DEBUG: starting submit_game");
```

### 在 GitHub Actions 中排查日志

```bash
# 搜索特定模块的调试日志
grep "\[DEBUG submit_game\]" workflow-logs.txt
# 搜索 Mock 相关日志
grep "\[mock-debug\]" workflow-logs.txt
# 搜索 Agent 工具调用
grep "\[DEBUG agent-tool" workflow-logs.txt
```

### 典型问题排查清单

#### Mock 期望顺序问题
- **症状**：`[mock-debug] NO expectation for engineer`
- **原因**：Engineer 的 mock 期望被其他 LLM 决策提前消耗
- **排查**：检查 LLM 是否按预期顺序调用工具

#### 文件操作失败
- **症状**：`[DEBUG submit_game] targetPath=... exists=false`
- **原因**：前置工具（如 write_game_file）未成功执行
- **排查**：检查 `[DEBUG write_game_file]` 日志

#### 前端 SSE 事件未接收
- **症状**：`game_submitted` 广播后前端没有更新
- **原因**：前端 `selectedProjectId` 与事件中的 `project_id` 不匹配
- **排查**：检查 `project_id` 值是否一致

---

## Playwright E2E 测试调试

### 测试日志输出

Playwright 测试中的 `console.log` 和 `process.stderr.write` 会在测试输出中显示：

```typescript
const log = (step: string, extra?: Record<string, unknown>) => {
  let payload = '';
  if (extra) try { payload = ` ${JSON.stringify(extra)}` } catch { payload = ` ${String(extra)}` }
  process.stderr.write(`${debugPrefix} ${new Date().toISOString()} ${step}${payload}\n`);
};
```

### 常用调试命令

```bash
# 运行单个测试
npx playwright test --grep "UI-007"
# 显示 UI 截图
npx playwright test --ui
```

---

## 日志级别使用指南

| 级别 | 用途 | 示例 |
|-----|------|------|
| `console.error()` | 调试日志、错误 | `[DEBUG ...]`, `[ERROR ...]` |
| `log()` (项目日志) | 正常操作日志 | `log(agentId, '提交游戏', '游戏已提交', 'success')` |
| `console.warn()` | 警告信息 | `console.warn('[WARN] deprecated API')` |

---

## UI 授权弹窗调试（Permission Request）

### 背景

当 Agent 调用某些工具时，后端会检查 `CAN_AUTO_ALLOW` 列表。如果工具不在列表中或需要额外验证，会触发 `permission_request` 事件，前端弹出授权对话框。

### 权限配置位置和分组

权限配置在 `server/agent-manager.ts` 中，使用分组管理：

```typescript
// 1. 始终允许的工具（所有 Agent）
const ALWAYS_ALLOW = ['save_memory', 'get_tasks', ...];

// 2. 受 autopilot 控制（autopilot 开启时所有 Agent 可用）
const AUTOPILOT_ALLOW = ['create_handoff', 'submit_proposal'];

// 3. 仅 engineer 允许（autopilot 开启时可用）
const ENGINEER_AUTOPILOT_ALLOW = ['submit_game'];

// 4. 仅 engineer 允许（无需 UI 授权）
const ENGINEER_ALLOW = ['write_game_file', 'blender_*', ...];

// 合并最终允许列表
const CAN_AUTO_ALLOW = [
  ...ALWAYS_ALLOW,
  ...(autopilotEnabled ? AUTOPILOT_ALLOW : []),
  ...(autopilotEnabled && isEngineer ? ENGINEER_AUTOPILOT_ALLOW : []),
  ...(isEngineer ? ENGINEER_ALLOW : []),
];
```

### 工具分类

| 类型 | 条件 | 示例 |
|------|------|------|
| 始终允许 | 无条件 | `save_memory`, `get_tasks` |
| Autopilot 控制 | autopilot 开启（不限 role） | `submit_proposal`, `create_handoff` |
| Engineer + Autopilot | autopilot 开启 + engineer | `submit_game` |
| Engineer 允许 | engineer | `write_game_file`, `blender_*` |

### 添加新授权工具的规则

1. **确定调用权限**：哪些 Agent 可以调用（检查 `isEngineer` 等条件）
2. **确定授权方式**：
   - 受 autopilot 控制（不限 role）：加入 `AUTOPILOT_ALLOW`
   - 受 autopilot + engineer 控制：加入 `ENGINEER_AUTOPILOT_ALLOW`
   - 仅 engineer 可用：加入 `ENGINEER_ALLOW`
3. **在 `STUDIO_TOOL_NAMES` 中注册**：确保工具名被识别

### 调试授权问题

**症状**：Action 日志中缺少 `[DEBUG tool_name]` 日志，但测试应该调用了该工具。

**可能原因**：
1. 工具不在 `CAN_AUTO_ALLOW` 列表中，触发了授权弹窗
2. E2E 测试没有正确处理授权弹窗，导致 Agent 等待超时
3. 调用 Agent 不是工具允许的角色（如 `isEngineer` 检查）

**排查步骤**：
1. 检查 Action 日志中是否有 `[permission]` 日志
2. 确认工具是否在 `CAN_AUTO_ALLOW` 列表中
3. 确认调用 Agent 是否符合权限条件
4. 如果工具不需要授权但仍在等待，检查是否在 `STUDIO_TOOL_NAMES` 中注册

```bash
grep "\[permission\]" workflow-logs.txt
```

### 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 测试挂起，Agent 不响应 | 授权弹窗未处理 | 在测试中添加授权弹窗处理逻辑 |
| `[DEBUG tool]` 日志未出现 | 工具需要授权但测试未批准 | 将工具加入 `CAN_AUTO_ALLOW` 或确保测试批准授权 |
| "权限不足" 错误 | 调用 Agent 不是允许的角色 | 确认工具的 `isEngineer` 等条件 |

---

## 添加新调试日志的最佳实践

1. **明确目的**：每条日志都应有明确的调试目的
2. **包含上下文**：打印关键变量值
3. **使用统一格式**：`[DEBUG 模块名] 操作 关键信息`
4. **结束时打印**：标注操作成功或失败
5. **不泄露敏感信息**：不要在日志中打印密码、token 等

```typescript
// 完整示例
console.error(`[DEBUG submit_game] START projectId=${projectId} resolvedPath=${resolvedFilePath}`);

try {
  console.error(`[DEBUG submit_game] checking path=${targetPath}`);
  writeFileSync(targetPath, content);
  console.error(`[DEBUG submit_game] SUCCESS wrote ${content.length} bytes`);
} catch (err) {
  console.error(`[DEBUG submit_game] ERROR ${err}`);
  throw err;
}
```
