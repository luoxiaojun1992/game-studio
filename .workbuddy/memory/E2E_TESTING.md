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
- `submit_game` mock 缺 `project_id` 参数，zod 取默认值 `'default'`
- 工具 schema `project_id: z.string().optional().default('default')`，mock 没传时自动填充
- 后果：game 创建到 `default` 项目，SSE broadcast 到 `default` channel，前端在 `ui-007_xxx` 项目，永远收不到
- **教训**：optional + default 的参数，mock 必须显式传值
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
- **链路**：game_designer→ceo→architect→engineer，engineer 最后执行 submit_proposal + submit_game + save_memory + text
- **per-agent 路由**：mock server 通过 HTTP headers 中的 `(projectId, agentRole)` 路由到独立队列，无 FIFO 跨 agent 干扰

## UI-009 提案创建测试
- **手动提案流程**：切换策划案 tab → 点击创建按钮 → 填写表单（type/author/title/content）→ 提交
- **data-testid 链路**：`create-proposal-btn` → `proposal-type-select` → `proposal-author-select` → `proposal-title-input` → `proposal-content-textarea` → `proposal-submit-btn`
- **断言策略**：提交后按钮 disabled + 对话框关闭 + 列表数量增加 + 标题文本可见

## data-testid 完整对照表（21 个，覆盖率 100%）

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
| `proposal-submit-btn` | StudioPage | 提案提案确认按钮 |
| `handoff-card-*` | HandoffPanel | 交接卡片（ID 后缀） |
| `handoff-header` | HandoffPanel | 交接卡片头部（展开/折叠） |
| `handoff-accept-btn` | HandoffPanel | 接受交接按钮 |
| `handoff-confirm-btn` | HandoffPanel | 确认交接按钮 |
| `handoff-complete-btn` | HandoffPanel | 完成交接按钮（测试未用） |
| `proposal-item-*` | ProposalList | 提案列表项（ID 后缀） |
| `game-card-*` | GameList | 游戏卡片（ID 后缀） |

## 测试矩阵总览（9 个用例）

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

## Lint Framework 集成验证

- `submit_game` 调用链路：权限校验 → **lintGameContent()** → db.createGame()
- Mock HTML 内容已包含完整 DOCTYPE/html/head/body 骨架 + utf-8 charset，**天然通过 html-structure 全部 6 条规则**
- Mock HTML 不含 eval/innerHTML 等调用，**天然通过 js-security 全部 4 条规则**
- E2E 9/9 全通过 = lint 拦截点未误拦正常提交
