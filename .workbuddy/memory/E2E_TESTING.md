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

## Docker 测试经验
- `docker compose -f docker-compose.ui-test.yml up --build -d` 启动完整测试环境
- 服务顺序：codebuddy-sdk-mock → star-office-ui → studio-backend → ui-app → ui-e2e
- `~/.docker/config.json` 的 `proxies.default` 配置会被 Docker 构建过程读取
- 代理关闭后必须删除 proxies 字段，否则 Alpine CDN 构建失败
- 正确流程：构建时带 proxy，运行时去掉 proxy
