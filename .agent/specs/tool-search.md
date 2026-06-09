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
  // ... 现有初始化代码（validateAgentPermission、AGENT_ID_ENUM 等）不变 ...

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

## 可行性分析

### 现状确认

| 检查项 | 结论 |
|--------|------|
| `tool()` 签名 | `tool(name, description, inputSchema, handler)` → 元数据前三个参数可独立提取 |
| `inputSchema` 可独立定义 | Zod schema 对象（`z.object({...})` 字面量）是纯 JS 对象，可在函数外部定义 |
| `handler` 可独立定义 | 目前 handler 闭包依赖 `scopedProjectId` / `agentId` / `log` 等局部变量，但 handler 本身逻辑不受元数据提取影响 |
| 元数据中是否含 handler 依赖 | **不含**。name/description/inputSchema 均为静态值，不依赖 `createStudioToolsServer()` 的作用域 |
| `TOOL_META_DEFINITIONS` 导出后权限系统可用 | ✅ `agent-manager.ts` 已 import `createStudioToolsServer`，可同时 import `TOOL_META_DEFINITIONS` |

### 已知风险

| 风险 | 缓解 |
|------|------|
| R1: `inputSchema` 中使用了局部变量（如 `AGENT_ID_ENUM`） | `AGENT_ID_ENUM`（第 163 行）依赖 `AGENT_IDS`（import from agents.js），非 `createStudioToolsServer()` 局部变量。如需在函数外部定义元数据，需把 `AGENT_ID_ENUM` 也提到函数外部或用 `z.enum(AGENT_IDS)` 直接替代 |
| R2: `get_game_framework_spec` 的 schema 使用 IIFE 动态生成 | 该 tool（第 2346 行）的 inputSchema 通过 `(() => { ... })()` 动态从 DB 拉取 game types 生成 enum。解决方案：元数据中仅存 `{ game_type: z.string().describe('游戏类型') }`（不限定 enum），或者在 `ToolMeta` 中标记此 schema 为"运行时生成"，search_tools 返回描述即可 |
| R3: 某些 inputSchema 使用了自定义 transformer（如 `singleLineTitleSchema`） | 这些 transformer 是纯函数，在函数外部可以用；不需要依赖作用域内的变量 |
| R4: 重构后 handler 的闭包依赖 | handler 继续在 `createStudioToolsServer()` 内部定义，对 `scopedProjectId` / `agentId` 等变量的访问不变——重构不影响 handler 的逻辑 |

### 结论

**方案可行**。核心原因是 `tool()` 的前三个参数（name、description、inputSchema）都是静态值，不依赖 `createStudioToolsServer()` 的作用域，可以安全提取到函数外部。

## 相关文件

| 文件 | 角色 | 变更幅度 |
|------|------|---------|
| `server/tools.ts` | 核心重构：新增 `ToolMeta` 类型 + `TOOL_META_DEFINITIONS` + `search_tools` handler + 重构 `createStudioToolsServer()` | **高**（结构变更） |
| `server/agent-manager.ts` | `STUDIO_TOOL_NAMES` 改为从 `TOOL_META_DEFINITIONS` 派生 | 低（3行改动） |

## 验证标准

1. `search_tools` 不传 `name` → 返回全部 56 个（含自身）tool 的 name + description
2. `search_tools name: "image"` → 返回所有 name 中包含 "image" 的工具（`image_resize`, `image_crop` 等，含 `search_t` 不匹配此例）
3. `search_tools name: "search"` → 返回 `search_tools` 自身
4. `search_tools name: "nonexistent"` → 返回 "未找到" 提示
5. 所有现有 55 个 tool 的 handler 行为不变（功能回归）
6. `TOOL_META_DEFINITIONS` 中元数据与原 inline 定义一致（description / inputSchema 逐字段核对）
7. `agent-manager.ts` `STUDIO_TOOL_NAMES` set 与 `TOOL_META_DEFINITIONS` name 集合一致
