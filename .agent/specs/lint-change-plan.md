# Lint 功能变更计划

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
4. 前端游戏预览区域改为展示 `description`。
5. 仅保留 SonarQube lint checker。
6. 移除根据成品类型选择 lint 入口的策略；统一 lint 入口为一个。
7. Lint Runner 不负责解压 ZIP；是否解压由具体 checker 自行决定。
8. 更新 CodeBuddy UI 测试 mock：写入 HTML 到游戏成品输出目录，提交时传目录路径 + description。

## 详细方案

### 1) 数据库与数据模型
- **DDL**：`games` 表删除 `html_content` 列；`description` 设置为必填字段（`TEXT NOT NULL`），新提交必须显式提供非空值。
- **旧库兼容**：不做迁移的前提下，读取路径需对缺失/空值做兜底（例如读取时视为空描述），但写入路径仍强制校验非空。
- **DB 层**：
  - `DbGame` 类型移除 `html_content`。
  - `createGame` / `updateGame` / `saveGameToFile` 等与 `html_content` 相关的校验与落盘逻辑移除或改为仅处理 `description`/文件存储信息。
  - `MIN_GAME_HTML_LENGTH` 等仅服务于 HTML 模式的常量移除或替换为 `MAX_GAME_DESCRIPTION_LENGTH = 2000` 等新约束 (新提交必须非空且不超过 2000 字符)。
- **API 返回**：`/api/games`、`/api/games/:id` 不再返回 `html_content` 或 `hasContent` 相关字段。

### 2) submit_game 工具与提示词
- **工具参数**：
  - 移除 `html_content`。
  - `file_path` 必填，且**只接受目录**（不再接受单文件路径）；通过 `fs.statSync(...).isDirectory()` 强校验，若为文件则直接报错。
  - 新增/强化 `description` 为必填：非空、长度限制、XSS 校验/转义。
- **提示词/工具说明**：
  - 删除“单文件 HTML 模式”描述。
  - 明确 `description` 必填与校验规则。
  - 明确禁止输出/提交任何 JS 脚本到 `description`。
- **提交流程**：
  - 统一为：目录 → ZIP → lint → 上传 → 创建游戏记录。
  - 移除“按成品类型选择 lint 入口”的分支逻辑。

### 3) XSS 校验与转义（可复用 util）
- 新增 `sanitizeHtml` / `validateHtmlSafe` 工具（`server/utils/*`）， **优先使用成熟 HTML 清洗库**（如 sanitize-html / DOMPurify + JSDOM）并采用 allowlist 策略：
  - 禁止 `<script>` 标签、`on*` 事件属性、`javascript:`/`data:text/javascript` URL 等高危内容，明确禁止内联事件处理器。
  - 校验阶段返回**明确错误信息**（例如“禁止 script 标签/事件处理器/JS URL”）；随后对通过的内容执行清洗/转义并保存。
  - 若清洗库发现并移除不安全内容，应返回带原因的校验错误与提示，而非无提示拒绝或静默通过。
  - 该 util 在 `submit_game` 与 DB 校验中复用，便于未来扩展。

### 4) Lint 框架调整
- **检查器注册**：`builtInCheckers` 仅保留 `sonarqube`。
- **统一 lint 入口**：
  - 新增/改造单一入口（例如 `lintGameArtifact`），统一供 `submit_game` 调用。
  - 入口仅传递 `zipBuffer`/context， 不区分 HTML/ZIP。
- **解压职责下沉**：
  - 移除 `lintZipBuffer` 中的 unzip 逻辑。
  - 如果未来有需要解析文件的 checker，由 checker 自行解压/读取。

### 5) API 与前端展示
- **后端**：
  - `/api/games/:id/preview` 失去 HTML 来源，可移除或改为返回说明内容。
  - `GamePreview` 相关接口字段调整为 `description` 与文件下载信息。
- **前端**：
  - `GamePreview` 去掉 iframe 预览与源码展示；改为渲染 `description`。
  - `Game` 类型移除 `html_content`，保持 `description` 为必填展示字段。

### 6) UI 测试与 Mock
- 更新 `tests/mock-server/codebuddy-sdk-mock-server.mjs` 或 UI 测试用例：
  - 在测试执行时将 HTML 写入 `output/<projectId>/games/<gameName>/index.html`。
  - `submit_game` mock 改为传 `file_path`（目录）+ `description`。
  - 确保 mock `toolCalls.arguments` 与工具 schema 完全一致。

## 验收标准
- `submit_game` 只接受目录路径 + 必填 `description`，不再接受 `html_content`。
- `games` 表无 `html_content` 字段，`description` 必填。
- Lint 仅运行 SonarQube，且只有一个统一入口。
- 任何 ZIP 解压不再发生在 Lint Runner 层。
- 前端不再显示 HTML 预览，改为展示 `description`。
- UI E2E mock 按新 schema 可顺利提交游戏成品。
