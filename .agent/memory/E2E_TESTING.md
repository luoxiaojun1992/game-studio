# E2E 测试经验

## ⚠️ 工作红线
- **永远禁止 workaround！** 任何修改必须基于正确的根因分析，逻辑正确是底线
- 不允许为了"让测试通过"而放宽断言、加 fallback、或绕过正常流程
- 遇到问题必须先定位根因，再修复，不能猜测或碰运气

## E2E 测试选择器原则
- **UI 元素定位/断言不匹配时，正确做法是给前端元素添加确定的 `data-testid` 或 `data-agent-*` 属性**
- **核心思路**：选择器不匹配 → 前端加属性 → 测试用属性选 → 稳定可靠
- **错误做法**：用 `.game-entry`、`[class*="game"]` 等不稳定选择器 → DOM 变化就断

### 已验证案例
- Handoff 卡片：添加 `data-agent-from` / `data-agent-to` / `data-handoff-status` 属性 → 测试精确匹配
- Tab 名称：前端用 `label.zh` / `label.en` 双语标签 → 测试用 `/游戏库|Games/` 等双语正则

## UI-007/008 调试经验
- **acceptHandoffFor 必须先切换到「任务交接」Tab**——卡片只在交接面板可见
- **Accept 后 DOM re-render**：loadHandoffs 触发 state 更新，旧的 card locator 引用会 stale
- **handleAccept 修复**：先 setExpandedId 再 loadHandoffs，否则 setExpandedId 被覆盖
- **重复卡片问题**：同一 agent-to 有多张卡（accepted 旧卡 + pending 新卡），`.first()` 可能选到旧卡。解决方案：过滤 `[data-handoff-status="accepted"]` 后取 `.last()`
- **中间状态不要断言**：只检查最终结果
- **force: true 点击**：按钮被遮挡或 actionability check 失败时需要

## UI-007 Game Count = 0 根因
- `submit_game`/`create_handoff`/`save_memory` 等 mock 若 `toolCalls.arguments` 与当前 schema 不一致（如继续传 `project_id`），会被工具 schema 直接拒绝
- mock 若缺失当前 schema 的必填参数，同样会触发 zod 校验失败
- 后果：工具执行失败，流程中断，目标项目收不到预期变更与 SSE 更新
- **教训**：所有工具 mock 必须严格对齐当前工具 schema（含字段集与类型）
- **SSE reconnect bug**：`if (connectedRef.current) return;` 在 selectedProjectId 变化后阻止重连

## UI-007/008 测试结构
- `runFullWorkflowTest(page, opts)` 共享函数，接收 `WorkflowOptions: { testId, autopilot, gameName }`
- UI-007: `autopilot=false`，手动模式（循环内 accept+confirm），handoff mock ×2 per agent
- UI-008: `autopilot=true`，自动驾驶模式（后端自动处理交接），handoff mock ×1 per agent
- `tryAcceptHandoff` / `tryConfirmHandoff` 仅在 `!opts.autopilot` 时执行
- gameName 断言使用 `new RegExp(opts.gameName)` 动态匹配

## Docker 测试经验
- `docker compose -f docker-compose.ui-test.yml up --build -d` 启动完整测试环境
- 服务顺序：codebuddy-sdk-mock → star-office-ui → studio-backend → ui-app → ui-e2e
## 事件循环测试架构（UI-007/008 共享）
- **核心模式**：`runFullWorkflowTest()` — 目标状态驱动的事件循环，UI-007/008 共用
- **循环体 5 步**：check permission → accept handoff → confirm handoff → count cards → count games
- **退出条件**：`cardCount >= 3 && gameCount >= 1`
- **非阻塞设计**：每步 try/catch + 短 timeout，单次失败不中断循环
- **autopilot 区分**：manual 模式循环内执行 accept/confirm；autopilot 模式跳过步骤 2
- **超时机制**：`UI_TEST_LOOP_TIMEOUT_MS` 环境变量控制（默认 600s）

### Mock 队列编排策略
- **预队列所有 mock**：在发送指令前一次性排队所有 agent 响应
- **链路**：game_designer→ceo→architect→engineer，engineer 执行游戏规范查询（get_game_types / get_game_framework_spec / get_common_spec）→ submit_proposal → write_game_file → **[image processing mocks]** → submit_game → save_memory → text
- **Image Processing (SPEC-008)**：在 engineer 阶段插入 image_create_project → image_info → image_resize → image_compress → image_convert → image_watermark → image_composite → image_sprite_sheet → image_download_file (×2) → image_delete_project，共 12 个额外 mock 步骤
- **per-agent 路由**：mock server 通过 HTTP headers 中的 `(projectId, agentRole)` 路由到独立队列，无 FIFO 跨 agent 干扰
- **游戏文件结构 mock**：必须使用 `dist/` 前缀（`dist/index.html`, `dist/metadata.json`, `dist/assets/manifest.json`）以通过 GameEngineeringChecker 验证
- **H5 生命周期 mock**：index.html 中必须包含 `<script>` 标签、6 个生命周期方法定义（init/start/pause/resume/resize/destroy）和 `window.__GAME__` 赋值

## UI-009 提案创建测试
- **手动提案流程**：切换策划案 tab → 点击创建按钮 → 填写表单（type/author/title/content）→ 提交
- **data-testid 链路**：`create-proposal-btn` → `proposal-type-select` → `proposal-author-select` → `proposal-title-input` → `proposal-content-textarea` → `proposal-submit-btn`
- **断言策略**：提交后按钮 disabled + 对话框关闭 + 列表数量增加 + 标题文本可见

## UI-010 问卷提案创建测试（SPEC-007）
- **问卷提案流程**：切换策划案 tab → 点击问卷提案按钮 → 填写核心信息（game_name/genre/one_liner/core_mechanic/target_audience/game_objectives）→ 下一步 → 填写扩展信息（可选）→ 提交
- **data-testid 链路**：`create-questionnaire-proposal-btn` → `q-game-name` → `q-game-genre` → `q-one-liner` → `q-core-mechanic` → `q-target-audience` → `q-game-objectives` → `q-next-step` → `q-level-design` → `q-tech-req` → `q-duration` → `q-submit`
- **断言策略**：提交后弹窗关闭 + 列表数量增加 + 标题文本可见 + 紫色"问卷"来源标签可见

## UI-011 Phaser Mobile 工作流测试（SPEC-010）
- **全流程**：game_designer→ceo→architect→engineer (phaser-mobile + manual mode)
- **特殊 mock**：Phaser game.js（包含 `new Phaser.Game()` + Scene preload/create 方法）、capacitor.config.json、metadata.json（game_type: phaser-mobile）

## UI-012 图片处理工作流测试（SPEC-008）
- **全流程**：标准 H5 工作流 + image service MCP 工具调用
- **Mock 链路**（engineer 阶段新增 16 步，含 write+upload 拆分）：
  1. `image_create_project`：创建图片 project（test mode → 固定 id=img-proj-001）
  2. `image_write_file`：写入 background_raw.png 到本地 images/ 目录（base64）
  3. `image_upload_file`：上传 background_raw.png 到 image service
  4. `image_write_file`：写入 ui_sprite.png 到本地
  5. `image_upload_file`：上传 ui_sprite.png
  6. `image_write_file`：写入 icon_a.png 到本地
  7. `image_upload_file`：上传 icon_a.png
  8. `image_write_file`：写入 icon_b.png 到本地
  9. `image_upload_file`：上传 icon_b.png
  10. `image_resize`：缩放 background_raw.png → 800×600 background.png
  11. `image_info`：查询 background.png 元信息（resize 之后才能查到）
  12. `image_compress`：压缩 ui_sprite.png → 质量 60
  13. `image_convert`：background.png → background.webp（需 libwebp）
  14. `image_watermark`：文字水印 "MyGame" → bg_watermarked.webp
  15. `image_composite`：合成 HUD 图层 → game_screen.webp
  16. `image_sprite_sheet`：拼合精灵图 → spritesheet.png（2×2 网格）
  17. `image_download_file`：下载 game_screen.webp 到本地
  18. `image_download_file`：下载 spritesheet.png 到本地
  19. `image_delete_project`：清理 image service 容器
- **断言策略**：成功完成标准工作流（3 handoffs + 1 game），图片处理不影响游戏 count 断言

## UI-013 视频处理工作流测试（SPEC-009）
- **全流程**：标准 H5 工作流 + video service MCP 工具调用
- **Test mode**：固定 ID `vid-proj-001`（`VIDEO_SERVICE_TEST_MODE=true`）
- **Mock 链路**（engineer 阶段新增 10 步）：
  1. `video_create_project`：创建视频 project（test mode → 固定 id=vid-proj-001）
  2. `video_write_file`：写入 test_input.png 到本地 videos/ 目录（1x1 PNG）
  3. `video_upload_file`：上传到 video service
  4. `video_info`：查询视频元信息
  5. `video_create_thumbnail`：生成缩略图 thumbnail.png（160px）
  6. `video_convert`：转换为 webm 格式
  7. `video_generate_gif`：生成 GIF（5fps, 80px 宽）
  8. `video_add_text`：添加文字叠加 "TestOverlay"
  9. `video_download_file`：下载 thumbnail.png 到本地
  10. `video_delete_project`：清理 video service 容器
- **测试输入**：使用 1x1 红色 PNG base64 作为轻量测试素材，验证 video service 全链路操作（缩略图、格式转换、GIF 生成、文字叠加）
- **断言策略**：成功完成标准工作流（3 handoffs + 1 game），视频处理不影响游戏 count 断言


## data-testid 完整对照表（36 个，覆盖率 100%）

| testid | 所在组件 | 用途 |
|:---|:---|:---|
| `project-name-input` | StudioPage | 项目名输入框 |
| `project-create-btn` | StudioPage | 创建项目按钮 |
| `project-select` | StudioPage | 项目选择器 |
| `tab-*` | StudioPage | Tab 导航（动态生成 `tab-${tab.key}`） |
| `permission-card` | StudioPage | 权限请求卡片 |
| `permission-allow-btn` / `permission-deny-btn` | StudioPage | 权限允许/拒绝 |
| `create-proposal-btn` | StudioPage | 创建提案按钮 |
| `proposal-type-select` | StudioPage | 提案类型选择 |
| `proposal-author-select` | StudioPage | 提案作者选择 |
| `proposal-title-input` | StudioPage | 提案标题输入 |
| `proposal-content-textarea` | StudioPage | 提案内容文本区 |
| `proposal-submit-btn` | StudioPage | 提交提案确认按钮 |
| `create-questionnaire-proposal-btn` | StudioPage | 创建问卷提案按钮（SPEC-007） |
| `q-game-name` | QuestionnaireForm | 问卷：游戏名称 |
| `q-game-type` | QuestionnaireForm | 问卷：游戏工程类型下拉 |
| `q-game-genre` | QuestionnaireForm | 问卷：游戏类型下拉 |
| `q-one-liner` | QuestionnaireForm | 问卷：一句话描述 |
| `q-core-mechanic` | QuestionnaireForm | 问卷：核心玩法 |
| `q-target-audience` | QuestionnaireForm | 问卷：目标受众 |
| `q-game-objectives` | QuestionnaireForm | 问卷：游戏目标 |
| `q-next-step` | QuestionnaireForm | 问卷：下一步按钮 |
| `q-level-design` | QuestionnaireForm | 问卷：关卡设计（步骤1） |
| `q-ui-ux` | QuestionnaireForm | 问卷：UI/UX 设计要点 |
| `q-tech-req` | QuestionnaireForm | 问卷：技术需求 |
| `q-duration` | QuestionnaireForm | 问卷：预期开发周期 |
| `q-ref-games` | QuestionnaireForm | 问卷：参考竞品 |
| `q-monetization` | QuestionnaireForm | 问卷：商业化方向 |
| `q-submit` | QuestionnaireForm | 问卷：提交按钮 |
| `handoff-card-*` | HandoffPanel | 交接卡片（ID 后缀） |
| `handoff-header` | HandoffPanel | 交接卡片头部（展开/折叠） |
| `handoff-accept-btn` | HandoffPanel | 接受交接按钮 |
| `handoff-confirm-btn` | HandoffPanel | 确认交接按钮 |
| `handoff-complete-btn` | HandoffPanel | 完成交接按钮（测试未用） |
| `proposal-item-*` | ProposalList | 提案列表项（ID 后缀） |
| `game-card-*` | GameList | 游戏卡片（ID 后缀） |
| `tool-call-chain` | ToolCallChain | 工具链可视化容器 |
| `tool-chain-mode-toggle` | ToolCallChain | 紧凑/展开模式切换按钮 |
| `tool-chain-config-btn` | ToolCallChain | 配置面板开关按钮 |
| `tool-chain-max-length` | ToolCallChain | 最大显示长度滑块 |

## 测试矩阵总览（14 个用例）

| 用例 ID | 类别 | 是否需要 Mock | 核心验证 |
|:---|:---|:---:|:---|
| UI-001 | 页面加载 | 否 | 标题 + 团队总览可见 |
| UI-002 | 语言切换 | 否 | 中英文切换 |
| UI-003 | 自动驾驶 | 否 | Toggle 开关 |
| UI-004 | 项目管理 | 否 | 创建 + 切换项目 |
| UI-005 | Tab 导航 | 否 | 8 个 Tab 全部可点击 |
| UI-006 | Star-Office 集成 | 否 | iframe 加载 + Agent 状态同步 |
| UI-007 | 完整工作流（手动） | ✅ | 3 handoffs + 1 game |
| UI-008 | 完整工作流（自动） | ✅ | 同上 + autopilot |
| UI-009 | 手动创建提案 | ✅ | 表单填写 + SSE 更新 |
| UI-010 | 问卷提案创建 | ✅ | 分步表单 + SSE 更新 + 来源标签 |
| UI-011 | Phaser Mobile 工作流 | ✅ | SPEC-010: phaser-mobile game type + manual mode |
| UI-012 | 图片处理工作流 (SPEC-008) | ✅ | image_create → write_file→upload_file×4 → resize→info→compress→convert→watermark→composite→sprite-sheet → download_file×2 → delete_project |
| UI-013 | 视频处理工作流 (SPEC-009) | ✅ | video_create → write_file→upload_file → info→thumbnail→convert→gif→add_text → download_file → delete_project |
| UI-014 | 工具链可视化 (SPEC-019) | ✅ | ToolCallChain 渲染 + SSE 实时追加 + 模式切换 + 配置调整 |

## Lint Framework 集成验证

- `submit_game` 调用链路：权限校验 → 打包 ZIP → **lintGameArtifact(zipBuffer, { submitDir, projectId })**
  - **SonarQube checker**：从 `submitDir` 自行打包 ZIP → scanner 微服务 → sonar-scanner CLI → SonarQube API
  - **GameEngineeringChecker**：从 `submitDir` 直接读取 `submitDir/dist/*` 文件 → 20 条规则验证
- 两个 checker 并行工作，任一返回 error 即阻断提交
- Mock 游戏文件必须同时满足：
  - **公共规则（8 条）**：DOCTYPE、html/head/body 标签、charset、body 非空、metadata.json 字段完整
  - **H5 特有规则（6 条）**：6 个生命周期方法、`window.__GAME__`、`<script>` 标签、manifest.json、资源相对路径
  - **Phaser Mobile 特有规则（6 条）**：`new Phaser.Game()`、`preload()`、`create()`、`<script>` 标签、资源相对路径、capacitor.config（warning）
- 当前 H5 mock 文件结构：`dist/index.html` + `dist/metadata.json` + `dist/assets/manifest.json`，全部 14 条 H5 规则通过
