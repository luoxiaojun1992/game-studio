# Tool Call Chain — Agent 工具调用链可视化

> **SPEC-019** | 状态：设计中

## 目标

在 Agent 聊天界面（CommandPanel）中，以横向调用链的形式展示 Agent 最近使用的工具，仅显示工具名、不显示参数，数量可配置（默认 15，范围 10-20）。

## 背景

### 现状

当前 `CommandPanel.tsx` 将 Agent 的工具调用以**扁平日志行**形式渲染，每条日志包含时间戳、类型标签（TOOL/DONE/FAIL）、Agent 名、工具名和参数摘要：

```
12:13:46 TOOL engineer 🔧 search_file 搜索文件: search_tool.ts...
12:13:47 DONE engineer 结果: 找到 3 个文件...
12:13:48 TOOL engineer 🔧 read_file 读取文件: /path/to/file...
12:13:49 DONE engineer 结果: 文件内容...
```

**问题**：
1. **参数信息冗余且不可读**：`content` 字段包含参数摘要（如输入/输出），在日志行中占用大量空间但信息密度低
2. **无可视化工具链**：用户无法一眼看清 Agent 在当前交互中调用了哪些工具及其顺序
3. **工具调用与文本输出混杂**：`text` 类型的消息穿插在工具调用之间，工具调用模式被淹没

### 目标

在 `CommandPanel` 顶部或输出区上方新增一个**紧凑的工具调用链展示区**，仅显示工具名的线性序列：

```
🔧 search_file → read_file → bash → write_file → search_content → read_file → 共 6 个工具
```

## 设计方案

### 整体布局

```
┌─ CommandPanel ─────────────────────────────────────────┐
│  [Agent Selector Sidebar]  │  [Header: Agent + Model]  │
│                             │──────────────────────────│
│                             │  🆕 Tool Call Chain      │  ← 新增区域
│                             │  ┌────────────────────┐  │
│                             │  │ ① ② ③ ④ ⑤ ... N  │  │
│                             │  └────────────────────┘  │
│                             │──────────────────────────│
│                             │  [Log Output Area]        │  ← 现有日志
│                             │  12:13:46 TOOL ...       │
│                             │  12:13:47 DONE ...       │
│                             │──────────────────────────│
│                             │  [Input Area]             │
└─────────────────────────────────────────────────────────┘
```

### 工具链展示形式

**紧凑模式（推荐默认）**：单行横向滚动，每个工具名用圆角标签 + 箭头连接：

```
🔧 search_file → read_file → bash → write_file → search_content → read_file
```

标签样式：浅灰色背景 + 深色文字，工具名用等宽字体。链超过可视宽度时支持横向滚动。

**展开模式**（可选）：点击展开按钮后变为垂直列表，每个工具标注序号：

```
1. search_file     — 搜索 TypeScript 文件
2. read_file       — 读取 tools.ts 内容
3. bash            — 运行类型检查
4. write_file      — 写入变更
5. search_content  — 搜索引用
```

> 展开模式中 description 取自 `TOOL_META_DEFINITIONS`（SPEC-017 元数据分离成果），无需额外存储。

### 配置项

| 配置项 | 默认值 | 范围 | 说明 |
|--------|--------|------|------|
| `maxChainLength` | 15 | 10-20 | 最多显示的工具数量 |
| `chainDisplayMode` | `'compact'` | `'compact'` \| `'expanded'` | 显示模式 |
| `groupByTurn` | `false` | `boolean` | 是否按回合分组显示分隔线 |

配置存储：`localStorage` key `toolChainConfig`，UI 上在 CommandPanel 的 header 区域增加一个齿轮图标入口。

## 详细设计

### 1. 数据流

```
SSE 'stream_event' (type='tool')
  → StudioPage handleSSEEvent()
    → setLogs([...prev, newLog])          // 现有逻辑不变
      → CommandPanel 接收 logs prop
        → ToolCallChain 组件
          → logs.filter(l => l.log_type === 'tool')
            → .slice(-maxChainLength)
              → 渲染工具链
```

**核心逻辑**：`ToolCallChain` 从现有的 `logs` 数组中实时过滤 `log_type === 'tool'` 的条目，取最后 `maxChainLength` 个，按 `created_at` 排序展示。**不需要后端改动**，纯前端组件。

### 2. 新组件：ToolCallChain

**文件**：`src/components/ToolCallChain.tsx`

```typescript
interface ToolCallChainProps {
  logs: LogEntry[];                    // 全量日志
  maxLength: number;                   // 最大显示数量（10-20）
  displayMode?: 'compact' | 'expanded'; // 显示模式
  groupByTurn?: boolean;               // 是否按回合分组（初版可不实现）
}
```

**组件逻辑**：

```typescript
// 1. 过滤工具调用
const toolCalls = useMemo(() => {
  return logs
    .filter(l => l.log_type === 'tool' && l.tool_name)
    .slice(-maxLength);           // 取最后 N 个
}, [logs, maxLength]);

// 2. 渲染紧凑模式
const renderCompact = () => (
  <div className="tool-chain-compact">
    {toolCalls.map((tc, i) => (
      <React.Fragment key={tc.id}>
        {i > 0 && <span className="chain-arrow">→</span>}
        <span className="chain-badge" title={tc.tool_name!}>
          {tc.tool_name}
        </span>
      </React.Fragment>
    ))}
  </div>
);
```

### 3. 样式设计

使用 Tailwind CSS，保持与现有 UI 一致：

```css
/* 紧凑模式 */
.tool-chain-compact {
  @apply flex items-center gap-1 overflow-x-auto px-3 py-2;
  @apply bg-gray-900/30 border-b border-gray-700/50;
  @apply text-xs;
  scrollbar-width: thin;
}

.chain-badge {
  @apply px-1.5 py-0.5 rounded;
  @apply bg-gray-700/60 text-gray-300 font-mono;
  @apply whitespace-nowrap cursor-default;
  @apply hover:bg-gray-600/60 transition-colors;
}

.chain-arrow {
  @apply text-gray-600 mx-0.5 select-none;
}

/* 展开模式 */
.tool-chain-expanded {
  @apply flex flex-col gap-0.5 px-3 py-2;
  @apply bg-gray-900/30 border-b border-gray-700/50;
  @apply text-xs;
}

.chain-row {
  @apply flex items-center gap-2 px-1.5 py-0.5 rounded;
  @apply hover:bg-gray-700/30 transition-colors;
}

.chain-index {
  @apply text-gray-500 w-5 text-right tabular-nums;
}

.chain-name {
  @apply text-gray-300 font-mono;
}

.chain-desc {
  @apply text-gray-500 truncate;
}
```

### 4. 交互行为

| 行为 | 描述 |
|------|------|
| **实时更新** | 每次收到新 tool 事件时立即追加到链尾 |
| **自动滚动** | 链超出可视宽度时自动滚动到最新项 |
| **Tooltip** | hover 工具名显示完整 tool_name + 调用时间 |
| **模式切换** | Header 区齿轮 → 下拉菜单选择 compact/expanded |
| **数量调整** | Header 区齿轮 → 滑块或输入框调整 maxChainLength |
| **点击工具名** | 滚动到该工具调用在日志输出区的位置（方便溯源） |

### 5. 与现有日志输出的关系

- **不替代**：现有的日志输出区保持不变，用户仍可查看完整日志（含参数）
- **互补**：工具链提供"大局观"，日志提供"详细内容"
- **联动**：点击工具链中的工具名，日志区自动定位到对应行

### 6. 回合分组（可选增强）

当 `groupByTurn = true` 时，使用 `streamId`（已有但前端未使用）将工具调用按回合分组：

```
🔧 [Turn 1] search_file → read_file
🔧 [Turn 2] bash → write_file → search_content
```

> **初版可不实现**：`groupByTurn` 需要将 `streamId` 从 SSE stream_event 传递到 LogEntry 并暴露到前端。当前 LogEntry 类型无 `streamId` 字段。如果需要实现，改动范围涉及类型定义、SSE 处理、DB schema。建议作为后续迭代。

### 7. 与 ToolMeta 的联动（未来增强）

当 SPEC-017（Tool Search 元数据分离）完成后，展开模式可以自动关联 `TOOL_META_DEFINITIONS` 获取工具描述：

```typescript
// 未来：从 TOOL_META_DEFINITIONS 查找工具描述
const toolMeta = TOOL_META_DEFINITIONS.find(m => m.name === toolName);
const description = toolMeta?.description || '';
```

初版可以用静态文本或省略描述字段。

## 可行性分析

| 检查项 | 结论 |
|--------|------|
| 是否需要后端改动 | **否**，纯前端组件 |
| 数据是否已存在 | **是**，`logs` 数组中 `log_type === 'tool'` 条目已包含 `tool_name` |
| 是否需要新 DB 表 | **否** |
| 是否影响现有功能 | **否**，新增组件不影响现有日志渲染 |
| 性能影响 | **极低**，`useMemo` + `slice(-N)` 操作 O(1) |
| 是否需要新增 SSE 事件 | **否** |
| 是否需要 E2E 测试 | **是**，新增前端 UI 交互 |

### 结论

**方案极简可行，零后端改动，纯前端组件**。所有需要的数据已存在于当前的 SSE 数据流中。

## 相关文件

| 文件 | 角色 | 变更幅度 |
|------|------|---------|
| `src/components/ToolCallChain.tsx` | **新建**：工具链展示核心组件 | 新增 |
| `src/components/CommandPanel.tsx` | 集成 ToolCallChain 组件 + 配置状态管理 | 低（~30 行新增） |
| `src/types.ts` | 无改动（如实现回合分组需加 `streamId`） | 初版无改动 |

## 测试策略

1. **组件单元测试**：
   - `toolCalls` 为空时渲染空状态
   - `toolCalls` 少于 `maxLength` 时显示全部
   - `toolCalls` 多于 `maxLength` 时截断到 `maxLength`
   - compact 模式和 expanded 模式切换
   - 点击工具名触发滚动回调

2. **集成测试**：
   - SSE 推送 tool 事件后 ToolCallChain 实时更新
   - 切换到不同 Agent 后工具链刷新
   - localStorage 配置持久化

3. **E2E 测试**：
   - 参考 UI-007/008 事件循环模式编写新用例（UI-011）
   - 验证工具链在 mock toolCall 后的渲染
   - 验证配置面板的交互

## UI Test 验收规则

提交代码前必须跑通 ui test。
如遇网络或依赖问题，可临时修改代码解决网络问题，但禁止提交为了解决网络依赖问题所做的变更。

## 主动补全 UI Test 规范

新增前端交互功能时，必须同步编写对应的 E2E 测试用例，并更新以下文档：
1. `tests/ui/e2e/studio.spec.ts` — 添加 UI-011 测试用例
2. `.agent/memory/E2E_TESTING.md` — 更新测试矩阵、testid 对照表、测试经验
3. `.agent/specs/tool-call-chain.md` — 更新本文档测试策略章节
4. `.agent/specs/INDEX.md` — 新增 SPEC-019 索引条目

## 详细 Debug 日志规范

### 前端组件日志

ToolCallChain 组件：
```
[DEBUG:ToolCallChain] init: maxLength=15 displayMode=compact
[DEBUG:ToolCallChain] render: toolCount=12 visibleCount=12
[DEBUG:ToolCallChain] modeChange: compact→expanded
[DEBUG:ToolCallChain] configChange: maxLength=15→20
```

CommandPanel 集成：
```
[DEBUG:CommandPanel] ToolCallChainConfig: {maxLength: 15, displayMode: 'compact'}
```

### E2E 测试日志

UI-011 测试用例：
```
[UI-011] step1: 页面加载完成，等待 ToolCallChain 渲染
[UI-011] step2: mock toolCall 事件推送 3 个工具
[UI-011] step3: 验证工具链显示 search_file → read_file → bash
[UI-011] step4: 继续推送 15 个工具，验证截断到 maxLength=15
[UI-011] step5: 切换展开模式
[UI-011] step6: 切换回紧凑模式
[UI-011] step7: 调整 maxLength 到 10
```

## 验证标准

1. 页面加载后 ToolCallChain 渲染，无 tool 时为空白或显示"暂无工具调用"
2. 每次收到 `type: 'tool'` 的 SSE 事件后，工具链末尾追加新工具名
3. 工具链超过 `maxChainLength` 时，只显示最后 N 个
4. 切换 Agent 后，工具链刷新为该 Agent 的工具调用记录
5. 点击工具名能定位到日志输出区对应行
6. 配置项变更（maxLength/displayMode）持久化到 localStorage
7. 页面刷新后恢复之前的配置
8. 不展示任何工具参数（content 字段不使用）

## 注意事项

- **不显示参数**：工具链仅用 `tool_name` 字段，不接触 `content` 字段
- **与日志输出独立**：不修改现有 `renderLog()` 逻辑
- **配置默认值**：maxLength 默认 15，不在 localStorage 中时使用默认值
- **空状态处理**：无工具调用时不报错，优雅降级
- **性能**：`useMemo` 避免每次 render 重新计算
- **国际化**：工具链中"共 N 个工具"等文案使用现有 `l()` 函数
