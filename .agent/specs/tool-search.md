# Tool Search 功能规范

> **SPEC-017** | 状态：设计中

## 目标

1. 为 studio-tools MCP server 提供 `search_tools` 工具，支持按名称模糊搜索所有已注册 tool，返回 tool 的 name + description
2. 将 tool 的元数据定义（name / description / inputSchema）从实现（handler）中分离，方便维护和复用

## 背景

当前 `server/tools.ts` 共 2413 行，包含 **55 个 tool**，全部以 `tool(name, description, inputSchema, handler)` 的 inline 方式定义在 `createStudioToolsServer()` 函数内部。元数据和实现在同一个 `tool()` 调用中耦合，存在以下问题：

- **不可查询**：没有工具列表或搜索能力，AI Agent 无法动态发现可用工具
- **不可复用**：tool 元数据无法在 handler 外部访问（例如权限系统 `STUDIO_TOOL_NAMES` 需要手写第二份 tool name 列表，`agent-manager.ts` 第 496-532 行）
- **维护成本高**：新增 tool 需要同步更新 3 处：`tools.ts` 定义、`agent-manager.ts` 权限列表、`agent-manager.ts` `STUDIO_TOOL_NAMES` set

## 架构对比

### 现状（耦合）

```
tools.ts
├── tool('save_memory', 'desc', { schema }, handler)
├── tool('get_memories', 'desc', { schema }, handler)
├── ...
└── tool('get_common_spec', 'desc', { schema }, handler)
        ↑
        name / description / inputSchema / handler 全部 inline
```

### 目标（分离）

```
tools.ts
├── TOOL_META_DEFINITIONS (list)     ← 纯元数据，不含 handler
│   ├── { name: 'save_memory', description: '...', inputSchema: {...} }
│   ├── { name: 'get_memories', description: '...', inputSchema: {...} }
│   ├── ...
│   └── { name: 'search_tools', description: '...', inputSchema: {...} }
│
├── createStudioToolsServer()
│   ├── tool('save_memory', ...from TOOL_META_DEFINITIONS..., handler)
│   │        ↑ 引用元数据中的 name/description/inputSchema
│   ├── tool('get_memories', ...from TOOL_META_DEFINITIONS..., handler)
│   ├── ...
│   └── tool('search_tools', ...from TOOL_META_DEFINITIONS..., handler)
│                                 ↑ 自身也在 TOOL_META_DEFINITIONS 中
│
└── createStudioToolsServer() 返回值可重新引用 TOOL_META_DEFINITIONS
      ↑ agent-manager.ts 的权限系统和 STUDIO_TOOL_NAMES 可从这里读取
```

## 详细设计

### 1. ToolMeta 类型定义

在 `server/tools.ts` 顶部（`createStudioToolsServer` 函数外部）新增：

```typescript
import type { AnyZodRawShape } from 'zod';  // 或从 @tencent-ai/agent-sdk 导入

/**
 * 工具元数据——仅包含定义/描述信息，不包含 handler 实现。
 * 用于 search_tools 查询和权限系统引用。
 */
export interface ToolMeta<Schema extends AnyZodRawShape = AnyZodRawShape> {
  /** tool 唯一名称 */
  name: string;
  /** 工具用途描述（中文） */
  description: string;
  /** Zod inputSchema 定义 */
  inputSchema: Schema;
}
```

### 2. TOOL_META_DEFINITIONS 定义

在 `server/tools.ts` 中，`createStudioToolsServer()` 函数外部定义**纯元数据列表**：

```typescript
/**
 * 所有工具元数据列表，仅包含定义/描述信息。
 * 
 * 用途：
 * 1. search_tools 工具的查询数据源
 * 2. createStudioToolsServer() 内部引用以组装完整 tool()
 * 3. agent-manager.ts 权限系统和 STUDIO_TOOL_NAMES set 可直接从此导出读取
 * 
 * 注意：search_tools 自身的元数据也在此列表中。
 */
export const TOOL_META_DEFINITIONS: ToolMeta[] = [
  {
    name: 'save_memory',
    description: '保存一条长期记忆。在做出重要决策、获得经验教训、产出成果等关键时刻，你应该主动调用此工具保存信息。',
    inputSchema: {
      category: z.enum(['general','preference','decision','lesson','achievement'])
                .describe('记忆分类：general=通用, preference=用户偏好, decision=重要决策, lesson=经验教训, achievement=成果产出'),
      content: z.string().max(5000).describe('记忆内容，简明扼要，不超过5000字符'),
      importance: z.enum(['low','normal','high','critical']).optional().default('normal').describe('重要程度'),
      source_task: z.string().optional().describe('关联的任务名称')
    }
  },
  {
    name: 'get_memories',
    description: '获取你之前保存的长期记忆，帮助你回忆之前的决策、经验和成果。',
    inputSchema: {
      category: z.enum(['general','preference','decision','lesson','achievement']).optional().describe('按类别筛选，不填则返回全部'),
      keyword: z.string().trim().max(200).optional().describe('按关键词模糊搜索记忆内容，可选，最长 200 字符'),
      limit: z.number().min(1).max(50).optional().default(20).describe('返回条数上限')
    }
  },
  // ... 其余 52 个 tool 的元数据（不含 search_tools）
  {
    name: 'search_tools',
    description: '搜索可用的 studio 工具。支持按名称正则模糊匹配，不传或传空时返回所有工具描述。',
    inputSchema: {
      name: z.string().max(100).optional().describe(
        '工具名称关键词，支持正则模糊匹配（只要工具名包含此关键词即匹配）。不传或传空字符串时返回全部工具。'
      )
    }
  },
];
```

### 3. createStudioToolsServer() 重构

`createStudioToolsServer()` 内部，将原来的 inline `tool(...)` 调用改为引用 `TOOL_META_DEFINITIONS`：

```typescript
export function createStudioToolsServer(...): SdkMcpServerResult {
  // AGENT_ID_ENUM 已提至模块级别，供 create_handoff / get_tasks / get_proposals / get_pending_handoffs 的 schema 共用枚举校验

  // 将元数据列表转为 lookup map，方便按 name 定位
  const toolMetaMap = new Map(TOOL_META_DEFINITIONS.map(m => [m.name, m]));

  // 定义 handlers（原 handler 实现移到这里）
  const handlers: Record<string, Function> = {
    save_memory: async ({ category, content, importance, source_task }) => {
      // ... 现有实现不变 ...
    },
    get_memories: async ({ category, keyword, limit }) => {
      // ... 现有实现不变 ...
    },
    // ... 其余 handler ...
    search_tools: async ({ name }) => {
      // 搜索逻辑（见下一节）
    },
  };

  const server = createSdkMcpServer({
    name: 'studio-tools',
    version: '1.0.0',
    tools: TOOL_META_DEFINITIONS.map(meta =>
      tool(meta.name, meta.description, meta.inputSchema, handlers[meta.name])
    ),
  });

  return server;
}
```

### 4. search_tools 搜索逻辑

```typescript
search_tools: async ({ name: searchName }: { name?: string }) => {
  let results: Array<{ name: string; description: string }>;

  if (!searchName || searchName.trim() === '') {
    // 不传或传空 → 返回全部工具
    results = TOOL_META_DEFINITIONS.map(m => ({
      name: m.name,
      description: m.description,
    }));
  } else {
    // 正则匹配：只要 tool name 包含 searchName 即匹配
    // 使用 RegExp 支持特殊字符的正确转义
    const escapedName = searchName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedName, 'i');  // 不区分大小写
    results = TOOL_META_DEFINITIONS
      .filter(m => regex.test(m.name))
      .map(m => ({ name: m.name, description: m.description }));
  }

  if (results.length === 0) {
    return {
      content: [{
        type: 'text' as const,
        text: `未找到名称包含 "${searchName}" 的工具。`
      }]
    };
  }

  // 按 name 排序，方便阅读
  results.sort((a, b) => a.name.localeCompare(b.name));

  const text = [
    `找到 ${results.length} 个匹配的工具：`,
    '',
    ...results.map(r => `- **${r.name}**: ${r.description}`)
  ].join('\n');

  console.error(`[Tool] ${_tts()} search_tools DONE query="${searchName || ''}" results=${results.length}`);
  return {
    content: [{ type: 'text' as const, text }]
  };
},
```

**注意**：`search_tools` 自身也在 `TOOL_META_DEFINITIONS` 中，因此用 `search_tools` 搜索 `search` 会返回自己。这是正确的设计——让 AI Agent 知道有搜索工具可用。

### 5. agent-manager.ts 权限系统同步

`agent-manager.ts` 中当前手动维护的 `STUDIO_TOOL_NAMES` set 和权限分组（`ALWAYS_ALLOW` / `AUTOPILOT_ALLOW` / `ENGINEER_ALLOW`）可以改为从 `TOOL_META_DEFINITIONS` 派生，消除重复维护：

```typescript
// agent-manager.ts
import { TOOL_META_DEFINITIONS } from './tools.js';

// 所有 tool name 自动从元数据生成
const STUDIO_TOOL_NAMES = new Set<string>(
  TOOL_META_DEFINITIONS.map(m => m.name)
);
```

> **可选优化**（非本 spec 范围）：在 `ToolMeta` 中增加 `permission` 字段，让权限分组也从元数据中导出，彻底消除 agent-manager.ts 中的硬编码分组。

### 6. ToolMeta 新增 permission 字段（可选扩展）

如果后续需要在 `ToolMeta` 中统一管理权限，可在 `ToolMeta` 接口中增加可选字段：

```typescript
export interface ToolMeta<Schema extends AnyZodRawShape = AnyZodRawShape> {
  name: string;
  description: string;
  inputSchema: Schema;
  /** 权限分组（可选，暂不实现，留给未来扩展） */
  permission?: 'always_allow' | 'autopilot_allow' | 'engineer_allow' | 'engineer_autopilot_allow';
}
```

本 spec **不要求**在本次实现 `permission` 字段。本次仅做元数据分离 + `search_tools` 工具，`agent-manager.ts` 的权限数组暂时保持不变（但 `STUDIO_TOOL_NAMES` 可改为自动派生）。

### 7. `get_game_types` 分页参数对齐（附带修复）

`get_game_types`（tools.ts line 2332）是项目中唯一有列表返回但缺少 `limit` 参数的工具，与其他 10 个 tool 的分页模式不一致。

**现状对比**：

| 特征 | 其他 10 个 listing tool | `get_game_types` |
|------|------------------------|-------------------|
| `limit` 参数 | `z.number().min(1).max(X).optional().default(Y).describe('返回条数上限')` | **无** |
| DB 函数签名 | 接受 `limit` 参数 | `getGameTypes()` 无参数 |

**改动**：

`db.ts` line 1739：
```typescript
// 改前
export function getGameTypes(): Array<{ type: string; description: string }> {
  const stmt = db.prepare('SELECT game_type, description FROM game_engineering_specs WHERE spec_type = ?');
  const rows = stmt.all('framework') ...;
}

// 改后
export function getGameTypes(limit?: number): Array<{ type: string; description: string }> {
  const sql = limit
    ? 'SELECT game_type, description FROM game_engineering_specs WHERE spec_type = ? LIMIT ?'
    : 'SELECT game_type, description FROM game_engineering_specs WHERE spec_type = ?';
  const stmt = db.prepare(sql);
  const rows = limit ? stmt.all('framework', limit) : stmt.all('framework') ...;
}
```

`tools.ts` line 2332：
```typescript
// schema 从 {} 改为
{
  limit: z.number().min(1).max(50).optional().default(20).describe('返回条数上限')
}
// handler 改为 async ({ limit }) => { db.getGameTypes(limit); }
```

> `search_tools` 不添加分页——`TOOL_META_DEFINITIONS` 为静态数组，规模固定（~56 项），无需 `limit`。

## 可行性分析

### 现状确认

| 检查项 | 结论 |
|--------|------|
| `tool()` 签名 | `tool(name, description, inputSchema, handler)` → 元数据前三个参数可独立提取 |
| `inputSchema` 可独立定义 | Zod schema 对象（`z.object({...})` 字面量）是纯 JS 对象，可在函数外部定义 |
| `handler` 可独立定义 | 目前 handler 闭包依赖 `scopedProjectId` / `agentId` / `log` 等局部变量，但 handler 本身逻辑不受元数据提取影响 |
| 元数据中是否含 handler 依赖 | **不含**。name/description/inputSchema 均为静态值，不依赖 `createStudioToolsServer()` 的作用域 |
| `TOOL_META_DEFINITIONS` 导出后权限系统可用 | ✅ `agent-manager.ts` 已 import `createStudioToolsServer`，可同时 import `TOOL_META_DEFINITIONS` |

### 已知风险与对策

| 风险 | 结论 | 对策 |
|------|------|------|
| R1: `inputSchema` 中使用了局部变量 `AGENT_ID_ENUM` | ✅ 已解决 | 保留 `AGENT_ID_ENUM = z.enum(AGENT_IDS)` 枚举校验，提至模块级（`AGENT_IDS` 为静态 import）。4 个依赖 tool（`create_handoff`、`get_tasks`、`get_proposals`、`get_pending_handoffs`）的 schema 继续引用，`get_agents` 提供 agent ID 查询能力，枚举值与 `get_agents` 返回的 id 对齐。 |
| R2: `get_game_framework_spec` 的 schema 使用 IIFE 动态生成 enum | ✅ 已解决 | 已有 `get_game_types` 工具供 agent 获取 game type 列表，schema 改用 `z.string()` 即可。Agent 先调 `get_game_types`，再拿着结果调 `get_game_framework_spec`。Handler 中"未找到"的返回已覆盖无效类型，无需 SDK 层 enum 校验。`TOOL_META_DEFINITIONS` 保持纯静态数组。 |
| R3: 某些 inputSchema 使用了自定义 transformer（如 `singleLineTitleSchema`） | — | 这些 transformer 是纯函数，在函数外部可以用；不需要依赖作用域内的变量 |
| R4: 重构后 handler 的闭包依赖 | — | handler 继续在 `createStudioToolsServer()` 内部定义，对 `scopedProjectId` / `agentId` 等变量的访问不变——重构不影响 handler 的逻辑 |

### 结论

**方案可行，所有已知风险已解决**。核心原因是 `tool()` 的前三个参数（name、description、inputSchema）都是静态值或可转为静态值，不依赖 `createStudioToolsServer()` 的作用域，可以安全提取到函数外部。

## 相关文件

| 文件 | 角色 | 变更幅度 |
|------|------|---------|
| `server/tools.ts` | 核心重构：新增 `ToolMeta` 类型 + `TOOL_META_DEFINITIONS` + `search_tools` handler + 提取 `AGENT_ID_ENUM` 到模块级 + 重构 `createStudioToolsServer()` + `get_game_types` 补 `limit` 参数 | **高**（结构变更） |
| `server/db.ts` | `getGameTypes()` 加上可选的 `limit` 参数 | 低（5行改动） |
| `server/agent-manager.ts` | `STUDIO_TOOL_NAMES` 改为从 `TOOL_META_DEFINITIONS` 派生 | 低（3行改动） |

## 测试策略

1. **单元测试**：`search_tools` handler 独立逻辑测试（正则匹配、空参数、无结果场景）
2. **集成测试**：验证 `createStudioToolsServer()` 正确组装所有 56 个 tool，`TOOL_META_DEFINITIONS` 和 handler 一一对应
3. **UI Test**：通过 engineer agent 的 mock toolCall 调用 `search_tools`，验证搜索返回结果格式
4. **回归测试**：所有 55 个现有 tool（不含 `search_tools`）行为不变，通过现有 E2E 测试套件验证

## UI Test 验收规则

提交代码前必须跑通 ui test。
如遇网络或依赖问题，可临时修改代码解决网络问题，但禁止提交为了解决网络依赖问题所做的变更。

## 主动补全 UI Test 规范

新增前端交互功能（按钮、表单、弹窗、面板等）时，必须同步编写对应的 E2E 测试用例，并更新以下文档：
1. `tests/ui/e2e/studio.spec.ts` — 添加测试用例（分配下一个 UI-XXX 编号）
2. `.agent/memory/E2E_TESTING.md` — **必须同步更新以下 3 处**：
   - 测试矩阵标题数字（如 `12 个用例` → `13 个用例`）
   - 测试矩阵表格（新增 UI-XXX 行）
   - ui-coverage 覆盖率引用（如有）
3. `tests/ui/coverage/cases.json` — 追加 UI-XXX 到 `requiredCaseIds` 数组
4. `.agent/specs/` 下对应的 spec 文档 — 更新测试策略章节
5. `.agent/specs/INDEX.md` — 如有新 spec 则更新索引

> 本次 tool-search 重构**不涉及前端 UI 变更**，无需新增 E2E 测试用例。但需验证重构后所有现有 UI test 仍通过（回归测试）。

## 主动更新所有相关文档规范

实现新功能或做重大修改后，必须主动检查并更新所有受影响的文档，而非仅更新直接相关文件。完整检查清单：
1. `README.md` + `README.zh-CN.md` — 功能概览、API 概览、目录结构（如有新工具对外暴露）
2. `docs/ARCHITECTURE.md` + `docs/ARCHITECTURE.zh-CN.md` — 业务域、数据模型、运行时组件
3. `.agent/memory/ARCHITECTURE.md` — 架构关键点、关键模块详解
4. `.agent/memory/INDEX.md` — 快速参考
5. `.agent/memory/E2E_TESTING.md` — 测试矩阵、testid 对照表（如 testid 有变化）
6. `.agent/memory/CONVENTIONS.md` — 工作约定（如有新规范）
7. `.agent/memory/MEMORY.md` — 长期记忆（工程决策记录）
8. `.agent/specs/` 下相关 spec 文档 — 状态、测试策略
9. `.agent/specs/INDEX.md` — spec 索引状态（本次 SPEC-017 状态变更）
10. `.agent/AI_AGENT_COMMON_INSTRUCTIONS.md` — 关键文件位置、API 概览
- **文档更新禁止添加日期和敏感信息**
- **不相关的文档不需要修改**（如 LINT.md 与本功能无关则不更新）
- **实现后强制使用 doc-sync skill 执行全量文档检查**：加载 `.agent/skills/doc-sync/SKILL.md` 按 A→G 区域遍历检查所有文档一致性

## 详细 Debug 日志规范

新增前端交互功能、后端 API 路由、E2E 测试用例时，必须同步添加 `console.log` / `process.stderr.write` debug 日志，方便测试失败时快速定位问题：

1. **后端 API 路由**：在路由入口、校验步骤（PASS/FAIL）、关键操作（DB 写入、SSE 广播）处添加 `console.log('[DEBUG:路由名] stepN: ...')` 格式日志
2. **前端组件**：在关键生命周期（mount）、用户操作（表单填写、校验、提交）、API 请求/响应处添加 `console.log('[DEBUG:ComponentName] ...')` 格式日志
3. **SSE 事件处理**：在 `handleSSEEvent` 的 case 分支中添加日志，记录事件类型和关键数据
4. **E2E 测试用例**：参照 UI-007/008 的 `log()` helper 模式，每个操作步骤添加 `process.stderr.write('[UI-XXX] step: ...')` 日志，包含结构化 extra 数据
   - **日志格式统一**：`[DEBUG:模块名] stepN: 描述` 或 `[UI-XXX] stepN: 描述`，关键数据以 JSON extra 输出
   - **日志粒度**：关键路径全覆盖，但避免在循环/高频回调中输出日志

**本次 `search_tools` handler 日志要求**：
- 工具调用入口：`[Tool] TIMESTAMP search_tools START query="<name>" agentId=<agentId>`
- 搜索结果：`[Tool] TIMESTAMP search_tools DONE query="<name>" results=<count>`
- 格式与现有 tool（如 `save_memory`、`get_game_types`）保持一致，使用 `_tts()` timestamp helper

## 注意事项

- **`search_tools` 自身可搜索**：`search_tools` 在 `TOOL_META_DEFINITIONS` 中，搜索 `"search"` 会返回自身，让 agent 发现搜索功能。
- **元数据一致性**：新增 tool 时必须同步在 `TOOL_META_DEFINITIONS` 中添加元数据条目，否则 `search_tools` 无法返回该 tool。
- **`AGENT_ID_ENUM` 模块级定义**：提至模块级后，确保 `AGENT_IDS` 的 import 在 `AGENT_ID_ENUM` 之前（已在顶部 import）。Zod 的 `z.enum()` 在模块加载时立即执行，`AGENT_IDS` 必须已可用。
- **`get_game_framework_spec` schema 降级**：从 `z.enum()` 降为 `z.string()` 后，handler 中的 `db.getGameFrameworkSpec(game_type)` 返回 null 时的"未找到"错误提示保持不变，agent 行为无影响。
- **`get_game_types` 分页向后兼容**：`limit` 为可选参数默认 20，现有不传 `limit` 的调用方行为不变。
- **handler 提取风险**：handler 如果引用 `TOOL_META_DEFINITIONS` 之外的局部变量（如 `uuidv4`、`sseBroadcaster`、`log`、`_tts`），必须确保这些变量在 handler 闭包中可访问——即 handler 仍在 `createStudioToolsServer()` 内部定义，不受元数据外提影响。
- **TypeScript 类型安全**：`handlers` 对象的类型应为 `Record<string, ToolHandler<AnyZodRawShape>>`，确保 `TOOL_META_DEFINITIONS.map()` 中的 `handlers[meta.name]` 类型匹配。

## 验证标准

1. `search_tools` 不传 `name` → 返回全部 56 个（含自身）tool 的 name + description
2. `search_tools name: "image"` → 返回所有 name 中包含 "image" 的工具（`image_resize`, `image_crop` 等，含 `search_t` 不匹配此例）
3. `search_tools name: "search"` → 返回 `search_tools` 自身
4. `search_tools name: "nonexistent"` → 返回 "未找到" 提示
5. `get_game_types` 不传 `limit` → 返回最多 20 个（默认值）
6. `get_game_types limit: 5` → 返回最多 5 个
7. 所有现有 55 个 tool 的 handler 行为不变（功能回归）
8. `TOOL_META_DEFINITIONS` 中元数据与原 inline 定义一致（description / inputSchema 逐字段核对）
9. `agent-manager.ts` `STUDIO_TOOL_NAMES` set 与 `TOOL_META_DEFINITIONS` name 集合一致
