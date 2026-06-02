# 游戏成品提交与 Lint 功能变更计划

> **SPEC-006** | 状态：已实现

## 目标
- 游戏成品提交统一为**目录形式**（自动打包上传），不再区分 HTML 单文件模式。
- Lint 仅保留 SonarQube 质量扫描，移除其他内置检查器。
- 游戏成品新增并强制 `description`，作为前端展示与说明来源。
- Lint 运行入口统一、解压责任下沉到具体 checker。

## 约束
- 当前阶段**不做数据库迁移**，仅更新 DDL 与代码逻辑。
- 仅实现本计划中列出的变更项。

## 变更清单（对应需求）
1. 移除 HTML 模式游戏成品：去掉 `html_content` 字段、工具参数与提示词中相关描述。
2. 数据库移除 `html_content`，新增/强化 `description` 描述字段。
3. `submit_game` 新增必填 `description`：长度校验 + XSS 校验与转义，仅允许纯 HTML；抽象为可复用 util；提示词强调**禁止输出 JS 脚本**。
3b. 新增 `write_game_file` MCP 工具：engineer 先通过此工具写入游戏 HTML 到 output 目录，再调 `submit_game`；区别于 SDK 内置 `Write` 工具（CI 无运行时不可用）。
4. 前端游戏预览区域改为展示 `description`。
5. 仅保留 SonarQube lint checker。
6. 移除根据成品类型选择 lint 入口的策略；统一 lint 入口为一个。
7. Lint Runner 不负责解压 ZIP；是否解压由具体 checker 自行决定。
8. 更新 CodeBuddy UI 测试 mock：写入 HTML 到游戏成品输出目录，提交时传目录路径 + description。
9. 同步清理伴生代码：SSE 广播中的 `html_content` 残留、`POST /api/games` REST 端点、`hasContent` 字段、`GamePreview` 中 `/preview` 调用。

## 详细方案

### 1) 数据库与数据模型
- **DDL**：`games` 表删除 `html_content` 列；`description` 设置为必填字段（`TEXT NOT NULL`），新提交必须显式提供非空值。
- 读取路径不做兜底处理；写入路径仍强制校验非空字符串。
- **DB 层**：
  - `DbGame` 类型移除 `html_content`。
  - `createGame` / `updateGame` / `saveGameToFile` 等与 `html_content` 相关的校验与落盘逻辑移除或改为仅处理 `description`/文件存储信息。
  - `MIN_GAME_HTML_LENGTH` 等仅服务于 HTML 模式的常量移除或替换为 `MAX_DESCRIPTION_LENGTH = 2000` 等新约束 (默认上限 2000， 后续可按需求调整为配置项； 新提交必须非空且不超过上限)。
- **API 返回**：`/api/games`、`/api/games/:id` 不再返回 `html_content` 或 `hasContent` 相关字段。
- **SSE 广播**：以下 SSE 事件中移除 `html_content: undefined` 和 `hasContent` 字段：
  - SSE init 事件的 games 列表映射（`index.ts`）
  - `game_submitted` 事件（`tools.ts`）
  - `game_updated` 事件（`index.ts`）

### 2) submit_game 工具与提示词
- **工具参数**：
  - 移除 `html_content`。
  - `file_path` 必填，且**只接受目录**（不再接受单文件路径）；通过 `fs.statSync(...).isDirectory()` 强校验，若为文件则直接报错。
  - 新增/强化 `description` 为必填：非空、长度限制、XSS 校验/转义。
- **提示词/工具说明**：
  - 删除"单文件 HTML 模式"描述。
  - 明确 `description` 必填与校验规则。
  - 明确禁止输出/提交任何 JS 脚本到 `description`。
- **Agent 提示词**（`server/agents.ts`）：
  - 删除 engineer 提示词中关于 HTML 结构检查（DOCTYPE/head/body/charset）、HTTP 方法安全（fetch/XHR）、JS 安全（eval/Function/innerHTML）的 lint 描述。
  - 删除"HTML 模式"和"目录模式"二选一提交流程的描述。
  - 同步更新 `TOOLS_OVERVIEW` 中 `submit_game` 的功能描述，移除"HTML 模式"字样。
- **提交流程**：
  - 统一为：目录 → ZIP → lint → 上传 → 创建游戏记录。
  - 移除"按成品类型选择 lint 入口"的分支逻辑。

### 2b) 新增 write_game_file MCP 工具
- **背景**：`submit_game` 切为纯文件模式后，engineer 先在 output 目录写入游戏 HTML 文件，再调 `submit_game` 提交。
- **工具定位**：MCP 工具（通过 `createSdkMcpServer` 注册），**非 SDK 内置 `Write` 工具**。
- **原因**：CI/测试环境中只有 mock server（模拟 `/chat/completions`），无 CodeBuddy 运行时，内置 `Write`/`Bash` 等工具无法执行。MCP 工具由 agent-sdk 本地执行，不依赖 CodeBuddy 运行时。
- **参数**：
  - `path`（必填）：文件路径（相对于 `games/latest/`）。
  - `content`（必填）：文件内容。
- **写入路径**：`output/{projectId}/games/latest/{path}`，与 `submit_game` 读取路径一致。
- **权限**：仅 engineer 可用，自动放行。
- **注册位置**：
  - `server/tools.ts`：工具定义（`tool('write_game_file', ...)`）。
  - `server/agent-manager.ts`：`STUDIO_TOOL_NAMES` 列表 + `CAN_AUTO_ALLOW` 条件。
- **安全校验**：路径越权检查（确保写入路径在 `output/{projectId}` 下），文件名路径穿越防护。
- **注意事项**：该工具在 MCP 服务端注册总数受 CLI 工具列表容量限制（当前约 55 个工具上限），工具名应避免字母靠后导致被截断。

### 3) XSS 校验与转义（可复用 util）
- 新增 `sanitizeHtml` / `validateHtmlSafe` 工具（`server/utils/*`）， **优先使用成熟 HTML 清洗库**（推荐 sanitize-html 等服务端库； 如需 DOMPurify + JSDOM， 必须禁用脚本执行与外部资源加载， 并明确配置 `runScripts: 'outside-only'` 等安全选项）并采用 allowlist 策略：
  - `validateHtmlSafe` 负责校验与报错（识别禁止标签/属性/URL）； `sanitizeHtml` 负责实际清洗并返回可存储的 HTML。
  - **允许标签**：`p`、`br`、`strong`、`em`、`ul`、`ol`、`li`、`code`、`pre`、`a`、`span`、`div`。
  - **允许属性**：仅 `a[href|title|target|rel]`； 其余标签不允许 `style`/`on*`/`src` 等属性。`href` 仅允许 `http://` / `https://`， 协议匹配需大小写不敏感， 明确禁止 `javascript:` / `data:` / `vbscript:` / `file:`。若 `target="_blank"`， 必须强制 `rel` 含 `noopener noreferrer`。
  - 禁止 `<script>` 标签、`on*` 事件属性、`javascript:`/`data:text/javascript` URL 等高危内容，明确禁止内联事件处理器。
  - 校验阶段返回**明确错误信息**（例如“禁止 script 标签/事件处理器/JS URL”）； 随后对通过的内容执行清洗/转义并保存。
  - 若清洗库发现并移除不安全内容，应返回带原因的校验错误与提示，而非无提示拒绝或静默通过。
  - 该 util 在 `submit_game` 与 DB 校验中复用，便于未来扩展。

### 4) Lint 框架调整
- **检查器注册**：`builtInCheckers` 仅保留 `sonarqube`。
- **统一 lint 入口**：
  - 新增/改造单一入口（例如 `lintGameArtifact`） ， 统一供 `submit_game` 调用。
  - 入口仅传递 `zipBuffer`/context， 不区分 HTML/ZIP。
- **解压职责下沉**：
  - 移除 `lintZipBuffer` 中的 unzip 逻辑。
  - 如果未来有需要解析文件的 checker，由 checker 自行解压/读取。

### 5) API 与前端展示
- **后端**：
  - `POST /api/games`（REST 端点）同步移除 `html_content` 参数与相关校验逻辑；与 `submit_game` 工具保持一致。
  - `/api/games/:id/preview` 失去 HTML 来源，**明确移除该接口**；前端不再使用该 endpoint。移除后返回 404，并在更新说明中标注为破坏性变更。
  - `GamePreview` 相关接口字段调整为 `description` 与文件下载信息。
- **前端**：
  - `GamePreview` 去掉 iframe 预览与源码展示；改为渲染 `description`。
  - `GamePreview` 移除对 `api.getGamePreviewUrl(game.id)` 的调用（因为 `/api/games/:id/preview` 端点已移除）。
  - `Game` 类型移除 `html_content` 和 `hasContent?` 字段，保持 `description` 为必填展示字段。
  - `description` 为空时直接展示为空，不做兜底补值。

### 6) UI 测试与 Mock
- 更新 `tests/ui/e2e/studio.spec.ts`：
  - engineer mock sequence：`submit_proposal` → `write_game_file` → `submit_game` → `save_memory` → text。
  - `write_game_file` mock 传 `path` + `content`（写入 `games/latest/`）。
  - `submit_game` mock 传 `description`（不需要 `game_name`，从 `games/latest/` 读取）。
  - 确保 mock `toolCalls.arguments` 与工具 schema 完全一致。
- **注意**：不可 mock SDK 内置工具（`Write`/`Bash`），CI 中无 CodeBuddy 运行时执行；必须使用 MCP 工具（如 `write_game_file`），由 agent-sdk 本地执行。

## 验收标准
- `submit_game` 只接受目录路径 + 必填 `description`，不再接受 `html_content`。
- `games` 表无 `html_content` 字段，`description` 必填。
- Lint 仅运行 SonarQube，且只有一个统一入口。
- 任何 ZIP 解压不再发生在 Lint Runner 层。
- 前端不再显示 HTML 预览，改为展示 `description`。
- 前端 `Game` 类型无 `html_content` 和 `hasContent` 字段。
- SSE 广播事件中无 `html_content` 或 `hasContent` 相关字段。
- engineer Agent 提示词无 HTML 模式或已移除 checker 的描述。
- UI E2E mock 按新 schema 可顺利提交游戏成品（`write_game_file` + `submit_game` 串联）。
- CI/测试环境中 MCP 工具（`write_game_file`）可正常注册（无内置工具依赖），工具列表包含 `mcp__studio_tools__write_game_file`。
- 提交代码前必须跑通 UI test。优先通过环境/依赖配置修复问题。仅为解决网络/依赖导致测试无法运行而做的临时代码改动属于 workaround，提交前必须回滚；修复业务逻辑或测试缺陷的正式改动应一并提交。
