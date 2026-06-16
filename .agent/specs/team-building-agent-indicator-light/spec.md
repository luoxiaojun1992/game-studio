# Team Building Agent 指示灯

> **SPEC-021** | 状态：设计中

## 目标

在 Game Dev Studio 控制台顶部 header 区域增加一个 team building agent（团队建设 Agent）指示灯，实时显示当前项目下 team_builder 是否正在执行后台总结/记忆沉淀任务，让用户无需切换到"团队建设"Tab 即可感知其工作状态。

## 背景

### 现状

- `team_builder` 是 6 个 Agent 中的特殊角色：不可手动指令、不参与交接流转、在每个 Agent 完成后自动触发总结和记忆沉淀
- 当前 UI 中，`team_builder` 仅在"团队建设"Tab 中可见，在其他 Tab 下用户完全感知不到它是否正在工作
- 顶部 header 已有"X 个 Agent 工作中"指示器，但它**刻意排除了 team_builder**（`overviewAgents = agents.filter(a => a.id !== 'team_builder')`）
- SSE 已在广播 `agent_status_changed` 事件，team_builder 的状态变化已通过现有数据流传输，前端只是没有使用

**问题**：
1. **不可见性**：用户在其他 Tab（如策划案、游戏成品）时，完全不知道 team_builder 正在运行
2. **状态黑洞**：team_builder 执行时间可能较长（多个 Agent 总结），用户会疑惑"系统是否还在工作"
3. **已有数据未利用**：SSE 数据已包含 team_builder 状态，前端只需增加一个小组件即可展示

## 设计方案

### 整体布局

在 header 右侧区域，现有的 `workingAgents` 指示器旁边，新增 team_builder 专用指示灯。位置位于 working agents 徽章之后、language switch 之前：

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 🎮 Game Dev Studio                           [待审批] [提案] [交接]          │
│    游戏开发 Agent 团队 · 观测控制台 · default  [3 个Agent工作中]              │
│                                              [🧠 Team Building 工作中] ← NEW  │
│                                              [中文|EN] [项目▼] [新建] [连接] │
├──────────────────────────────────────────────────────────────────────────────┤
│  [团队总览] [团队建设] [Studio] [策划案] ...                                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 展示形式

#### 状态与视觉对照

| team_builder 状态 | 指示灯样式 | 含义 |
|---|---|---|
| `idle` | 灰色圆点 + 灰色文字 "Team Building 空闲" / "团队建设 空闲" | 当前无总结任务，空闲中 |
| `working` | 绿色脉冲圆点 + 绿色文字 "Team Building 工作中" / "团队建设 工作中" | 正在执行总结/记忆沉淀 |
| `paused` | 黄色圆点 + 黄色文字 "Team Building 已暂停" / "团队建设 已暂停" | 已被暂停 |
| `error` | 红色脉冲圆点 + 红色文字 "Team Building 出错" / "团队建设 出错" | 执行出错 |

#### 设计风格

- 沿用现有 header 指示器的 pill/badge 样式（`rounded-full` + 半透明背景 + 彩色边框）
- `working` 和 `error` 状态下圆点使用 `animate-pulse` 动画
- `idle` 状态使用较低对比度（`opacity-60`），弱化视觉干扰
- 配色方案：
  - idle: `bg-gray-500/20 border-gray-500/40 text-gray-400`
  - working: `bg-emerald-500/20 border-emerald-500/40 text-emerald-300`
  - paused: `bg-yellow-500/20 border-yellow-500/40 text-yellow-300`
  - error: `bg-red-500/20 border-red-500/40 text-red-300`

### 配置项

无需配置项。指示灯直接跟随 team_builder 的运行时状态，不引入额外开关。

## 详细设计

### 1. 数据流

```
server/agent-manager.js  agent 状态变化
        │
        ▼
SSE broadcast: agent_status_changed 事件
  { type: 'agent_status_changed', agentId: 'team_builder', state: { status: 'working', ... } }
        │
        ▼
src/pages/StudioPage.tsx  handleSSEEvent()
  setAgents(prev => prev.map(...))   // 已有逻辑，无需改动
        │
        ▼
新增：提取 teamBuildingAgent 状态
  const tbAgent = agents.find(a => a.id === 'team_builder');
        │
        ▼
新增组件：TeamBuildingIndicator
  <TeamBuildingIndicator agent={tbAgent} />
```

**关键点**：数据流完全复用现有 SSE 管道，不增加新的 API 端点、不增加新的 SSE 事件类型。

### 2. 组件设计

**文件**：`src/components/TeamBuildingIndicator.tsx`（新增）

```typescript
interface TeamBuildingIndicatorProps {
  agent: Agent | undefined;
}
```

组件职责：
1. 接收 team_builder 的 Agent 对象（可能为 undefined，如在加载中）
2. 根据 `agent.state.status` 渲染对应样式的指示灯
3. 处理 `agent` 为 `undefined` 的情况：不渲染（整个 badge 隐藏）

状态映射表：

```typescript
const STATUS_STYLE: Record<AgentStatus, { dot: string; bg: string; text: string; pulse: boolean }> = {
  idle:    { dot: 'bg-gray-500',  bg: 'bg-gray-500/20 border-gray-500/40',  text: 'text-gray-400', pulse: false },
  working: { dot: 'bg-emerald-400', bg: 'bg-emerald-500/20 border-emerald-500/40', text: 'text-emerald-300', pulse: true },
  paused:  { dot: 'bg-yellow-400', bg: 'bg-yellow-500/20 border-yellow-500/40', text: 'text-yellow-300', pulse: false },
  error:   { dot: 'bg-red-400',    bg: 'bg-red-500/20 border-red-500/40',    text: 'text-red-300',    pulse: true },
};
```

### 3. 样式设计

使用 Tailwind CSS，与现有 header badge 风格一致：

```html
<!-- idle 状态示例 -->
<div class="flex items-center gap-1.5 bg-gray-500/20 border border-gray-500/40 rounded-full px-3 py-1 text-xs text-gray-400 opacity-60">
  <span class="w-1.5 h-1.5 bg-gray-500 rounded-full inline-block" />
  <span>🧠 团队建设 空闲</span>
</div>

<!-- working 状态示例 -->
<div class="flex items-center gap-1.5 bg-emerald-500/20 border border-emerald-500/40 rounded-full px-3 py-1 text-xs text-emerald-300">
  <span class="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse inline-block" />
  <span>🧠 团队建设 工作中</span>
</div>
```

### 4. 交互行为

| 行为 | 描述 |
|------|------|
| **显示/隐藏** | team_builder agent 数据未加载时不渲染；加载后始终显示（idle 时半透明弱化） |
| **点击** | 单击跳转到"团队建设" Tab（`setActiveTab('team_building')`） |
| **状态切换动画** | 通过 React 状态更新自然过渡；idle ↔ working 切换在 1-2 秒内完成（由 SSE 推送驱动） |
| **语言切换** | 跟随全局 language 状态切换中文/英文文案 |

### 5. 集成点

在 `src/pages/StudioPage.tsx` 的 header 区域（第 456-461 行，`workingAgents` badge 之后）插入：

```tsx
{/* 现有: working agents badge */}
{workingAgents.length > 0 && (
  <div className="flex items-center gap-1.5 bg-green-500/20 ...">
    ...
  </div>
)}

{/* 新增: team_builder indicator */}
<TeamBuildingIndicator
  agent={teamBuildingAgent}
  onTabSwitch={setActiveTab}
/>

{/* 现有: language switch */}
<div className="flex items-center rounded-lg border ...">
```

**注意**：`teamBuildingAgent` 已在现有代码第 402 行提取：`const teamBuildingAgent = agents.find(a => a.id === 'team_builder');`，无需新增变量。

## 可行性分析

| 检查项 | 结论 |
|--------|------|
| 是否需要后端改动 | 否 — SSE `agent_status_changed` 事件已包含 team_builder 状态 |
| 数据是否已存在 | 是 — `agents` state 已包含 team_builder 的完整 Agent 对象 |
| 是否需要新 DB 表 | 否 |
| 是否影响现有功能 | 否 — 纯增量 UI 组件，不影响现有逻辑 |
| 性能影响 | 极低 — 仅增加一个条件渲染的 `<div>`，不增加额外 API 调用或 SSE 连接 |
| 是否需要新增 SSE 事件 | 否 |
| 是否需要 E2E 测试 | 是 — 需验证指示灯在不同状态下的显示和行为 |

### 结论

方案完全可行，纯前端增量改动，无后端修改、无新 API、无新 SSE 事件。数据已就绪，风险极低。

## 相关文件

| 文件 | 角色 | 变更幅度 |
|------|------|---------|
| `src/components/TeamBuildingIndicator.tsx` | 新增指示灯组件 | 新增（~60行） |
| `src/pages/StudioPage.tsx` | 集成指示灯到 header | 低（~5行） |
| `src/types.ts` | 无需修改（已有 AgentRole/AgentStatus 类型） | 无 |
| `tests/ui/e2e/studio.spec.ts` | 新增 UI-011 测试用例 | 中（~80行） |

## 测试策略

1. **单元测试**：
   - `TeamBuildingIndicator` 四种状态渲染正确性
   - `agent` 为 `undefined` 时不渲染

2. **E2E 测试**：
   - UI-011：team_builder 空闲状态 — 指示灯显示灰色 "空闲"
   - UI-011：team_builder 工作状态 — 指示灯显示绿色 "工作中" + 脉冲动画
   - UI-011：点击指示灯跳转到团队建设 Tab

## UI Test 验收规则

提交代码前必须跑通 ui test。
如遇网络或依赖问题，可临时修改代码解决网络问题，但禁止提交为了解决网络依赖问题所做的变更。

## 主动补全 UI Test 规范

新增前端交互功能时，必须同步编写对应的 E2E 测试用例，并更新以下文档：
1. `tests/ui/e2e/studio.spec.ts` — 添加 UI-XXX 测试用例
2. `.agent/memory/E2E_TESTING.md` — **必须同步更新以下 3 处**：
   - 测试矩阵标题数字（如 `12 个用例` → `13 个用例`）
   - 测试矩阵表格（新增 UI-XXX 行）
   - ui-coverage 覆盖率引用（如有）
3. `tests/ui/coverage/cases.json` — 追加 UI-XXX 到 `requiredCaseIds` 数组
4. `.agent/specs/team-building-agent-indicator-light.md` — 更新本文档测试策略章节
5. `.agent/specs/INDEX.md` — 新增 SPEC-021 索引条目

## 详细 Debug 日志规范

### 前端组件日志

组件名：`TeamBuildingIndicator`

```
[DEBUG:TeamBuildingIndicator] render: status=idle
[DEBUG:TeamBuildingIndicator] render: status=working
[DEBUG:TeamBuildingIndicator] render: agent=undefined (hidden)
```

### E2E 测试日志

UI-011 测试用例：

```
[UI-011] step1: 验证 team_builder 空闲状态指示灯存在且显示灰色
[UI-011] step2: 通过 Mock Server 触发 team_builder 状态切换为 working
[UI-011] step3: 验证指示灯变为绿色脉冲状态
[UI-011] step4: 点击指示灯，验证跳转到团队建设 Tab
```

## 验证标准

1. team_builder `idle` 时，header 显示灰色半透明指示灯，文案"团队建设 空闲"
2. team_builder `working` 时，header 显示绿色脉冲指示灯，文案"团队建设 工作中"
3. team_builder `paused` 时，header 显示黄色指示灯，文案"团队建设 已暂停"
4. team_builder `error` 时，header 显示红色脉冲指示灯，文案"团队建设 出错"
5. 点击指示灯跳转到"团队建设"Tab
6. 切换语言（中/英）后指示灯文案正确切换
7. 页面初始加载、team_builder 数据未就绪时不渲染（不出现空 badge）
8. 其他 Tab 下正常工作（如游戏成品、策划案 Tab）

## 注意事项

- **不混入 workingAgents 计数**：team_builder 的指示灯独立于"X 个 Agent 工作中"，后者仍保持排除 team_builder 的逻辑
- **不增加 tooltip/hover 效果**：保持简洁，指示灯本身已足够自解释
- **idle 状态不隐藏**：使用低透明度弱化而非完全隐藏，保持 UI 结构稳定，避免布局跳动
- **不使用 cursor-pointer 以外的点击反馈**：保持轻量
