# 游戏工程规范工具（Game Engineering Framework Tool）

> **SPEC-003** | 状态：已实现

## 目标
- 提供 MCP 工具供 Engineer Agent 查询游戏工程规范。
- Spec 存储在数据库中，支持运行时查询，新增/修改无需改代码。
- 支持查询已注册的游戏类型、根据游戏类型获取对应框架规范、获取公共规范。
- 工具参数需通过 **zod 枚举校验**，防止无效参数传入。

## 数据存储设计

### DB 表结构

```sql
CREATE TABLE IF NOT EXISTS game_engineering_specs (
  id TEXT PRIMARY KEY,                                -- UUID
  spec_key TEXT NOT NULL UNIQUE,                      -- 'common' | 'framework:h5'
  game_type TEXT,                                     -- NULL 表示公共规范，'h5' 等表示框架规范
  spec_type TEXT NOT NULL,                            -- 'common' | 'framework'
  title TEXT NOT NULL,                                -- 规范标题
  description TEXT,                                   -- 简短描述（游戏类型说明等）
  content TEXT NOT NULL,                              -- 完整的 Markdown 规范内容
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 初始种子数据

| spec_key | game_type | spec_type | title | description |
|----------|-----------|-----------|-------|-------------|
| `common` | NULL | `common` | 游戏工程规范 — 公共部分 | 所有游戏类型共享的公共规范 |
| `framework:h5` | `h5` | `framework` | H5 小游戏工程规范 | H5 小游戏（浏览器运行） |

- `content` 字段存储对应 `.md` 文件的完整 Markdown 内容。
- 运行 `db:seed` 或首次启动时自动从 `.md` 文件导入，后续可通过数据库管理工具直接修改。

### DB CRUD 函数

```typescript
// 获取所有已注册的游戏类型列表
export function getGameTypes(): Array<{ type: string; description: string }> {
  const rows = db.query('SELECT game_type, description FROM game_engineering_specs WHERE spec_type = ?', ['framework']);
  return rows.map(r => ({ type: r.game_type, description: r.description }));
}

// 根据 game_type 获取框架规范内容
export function getGameFrameworkSpec(gameType: string): string | null {
  const row = db.queryOne('SELECT content FROM game_engineering_specs WHERE spec_key = ?', [`framework:${gameType}`]);
  return row?.content || null;
}

// 获取公共规范内容
export function getCommonSpec(): string | null {
  const row = db.queryOne('SELECT content FROM game_engineering_specs WHERE spec_key = ?', ['common']);
  return row?.content || null;
}

// 校验 game_type 是否已注册（供枚举校验使用）
export function isValidGameType(gameType: string): boolean {
  const row = db.queryOne('SELECT 1 FROM game_engineering_specs WHERE spec_type = ? AND game_type = ?', ['framework', gameType]);
  return !!row;
}
```

### 种子数据导入（启动时）

在 `server/index.ts` 启动初始化阶段，若 `game_engineering_specs` 表为空，自动从 `.md` 文件导入：

```typescript
function seedGameEngineeringSpecs(): void {
  if (db.getGameTypes().length > 0) return; // 已有数据，跳过
  // 读取 spec 文件内容并写入 DB
  // ...
}
```

---

## 工具列表

| 工具名称 | 功能 | 参数 | 权限 |
|---------|------|------|------|
| `get_game_types` | 获取所有已注册的游戏类型列表 | 无 | **engineer**（无需授权） |
| `get_game_framework_spec` | 根据游戏类型获取对应的框架规范 | `game_type`（必填，枚举） | **engineer**（无需授权） |
| `get_common_spec` | 获取所有游戏类型共享的公共规范 | 无 | **engineer**（无需授权） |

---

## 1. `get_game_types`

**用途：** 返回当前系统支持的所有游戏类型。Engineer Agent 在开始开发前可调用此工具确认游戏类型是否受支持。

### 参数定义
无参数。

### 返回值格式
```json
{
  "game_types": [
    { "type": "h5", "description": "H5 小游戏（浏览器运行）" }
  ]
}
```

### 实现参考
```typescript
tool(
  'get_game_types',
  '获取所有已注册的游戏类型列表',
  {}, // 无参数
  async () => {
    const gameTypes = db.getGameTypes();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ game_types: gameTypes }, null, 2)
      }]
    };
  }
);
```

### 边界处理
- DB 中无数据 → 返回空数组 `{ "game_types": [] }`
- 数据源完全由 `game_engineering_specs` 表驱动，无需硬编码

---

## 2. `get_game_framework_spec`

**用途：** 根据游戏类型获取对应的框架规范文档内容。Engineer Agent MUST 在开发前调用此工具获取规范。

### 参数定义

| 参数 | 类型 | 必填 | 校验规则 | 描述 |
|------|------|------|---------|------|
| `game_type` | string | **是** | `z.enum()` — 枚举值由 DB 动态构建，仅允许已注册的游戏类型 | 目标游戏类型 |

### 枚举值动态构建

`game_type` 的枚举值不由代码硬编码，而是启动时从 DB 查询：

```typescript
// 在 createStudioToolsServer 时动态注入
const registeredTypes = db.getGameTypes().map(t => t.type);
// DB 无数据时枚举值为空列表，get_game_framework_spec 无法通过校验
// 调用方应优先调用 get_game_types 确认支持的类型
const gameTypeEnum = registeredTypes.length > 0
  ? z.enum(registeredTypes as [string, ...string[]])
  : z.enum([] as unknown as [string, ...string[]]); // 空枚举，任何值都通不过
```

### 返回值格式
```
（框架规范 content，即对应 game_type 的 Markdown 全文内容）
```

> **说明**：`get_game_framework_spec` **仅返回框架规范内容**，不拼接公共规范。调用方如需公共规范可单独调用 `get_common_spec` 获取。两个工具职责分离，避免冗余。

### 实现参考
```typescript
tool(
  'get_game_framework_spec',
  '根据游戏类型获取对应的工程框架规范。Engineer Agent 在开发前 MUST 调用此工具',
  {
    game_type: gameTypeEnum.describe('游戏类型，从 get_game_types 获取当前支持的类型'),
  },
  async ({ game_type }) => {
    const frameworkContent = db.getGameFrameworkSpec(game_type);

    if (!frameworkContent) {
      return {
        content: [{ type: 'text', text: `未找到游戏类型 "${game_type}" 的规范。请先调用 get_game_types 确认支持的类型。` }]
      };
    }

    return {
      content: [{ type: 'text', text: frameworkContent }]
    };
  }
);
```

### 边界处理
- `game_type` 传入未注册的值 → zod `z.enum()` 自动拒绝
- DB 中查询不到框架规范 → 返回明确错误消息，提示先调用 `get_game_types`

---

## 3. `get_common_spec`

**用途：** 获取所有游戏类型共享的公共工程规范文档内容。

### 参数定义
无参数。

### 返回值格式
```
（GAME_ENGINEERING_COMMON.md 全文内容）
```

### 实现参考
```typescript
tool(
  'get_common_spec',
  '获取所有游戏类型共享的公共工程规范',
  {}, // 无参数
  async () => {
    const content = db.getCommonSpec();
    if (!content) {
      return {
        content: [{ type: 'text', text: '公共规范暂未配置。' }]
      };
    }
    return {
      content: [{ type: 'text', text: content }]
    };
  }
);
```

---

## 参数校验规则

| 规则 | 说明 |
|------|------|
| **必填校验** | 标记为"是"的参数 MUST 传入；未传入时 zod 抛出 `Required` 错误 |
| **枚举校验** | `game_type` 使用 `z.enum()` 限制可选值；枚举值由 DB 动态构建，启动时从 `game_engineering_specs` 表查询 |
| **DB 无数据** | 枚举构建时若 DB 无数据，枚举值为空列表，`get_game_framework_spec` 因无合法枚举值而无法通过校验，`get_game_types` 返回空数组 |
| **数据一致性** | `get_game_types` 和 `get_game_framework_spec` 共享同一数据源，保证列表和查询结果始终一致 |

## 与 Checker 的关系

| 组件 | 职责 | 数据源 | 调用方 |
|------|------|--------|--------|
| **Framework Tool**（本工具） | 开发前供 Engineer Agent 查询规范 | `game_engineering_specs` 表 | Engineer Agent |
| **Framework Checker** | 提交后校验产物是否符合规范 | `game_engineering_specs` 表（同表） | `submit_game` + LintRunner |

- Tool 和 Checker **共享同一数据源**，保证规范与验证规则一致。
- Checker 是一个**统一检查器**，内部注册多条规则（规则分为通用和游戏类型特定）。Tool 查询到的规范文档决定了 checker 中规则的具体校验内容。
- 修改 DB 中的 spec 内容后，Tool 和 Checker 均立即生效。

## 新增游戏类型的步骤（DB 方式）

1. **添加种子数据**：在 `game_engineering_specs` 表中插入新记录（`spec_key='framework:xxx'`, `game_type='xxx'`, `spec_type='framework'`）。
2. **提供规范内容**：将 `content` 字段填充为完整的 Markdown 规范文档。
3. **工具自动生效**：`get_game_types` 自动返回新类型，`get_game_framework_spec` 自动支持新类型查询。
4. **同步更新 Checker**：在 `GAME_ENGINEERING_FRAMEWORK_CHECKER.md` 的规则选择逻辑中注册新类型的 checker。
5. **无需修改工具代码**（除非需要新增字段或修改枚举校验逻辑）。

## UI Test 验收规则（tool 功能验收）

提交代码前必须跑通 ui test。
如遇网络或依赖问题，可临时修改代码解决网络问题，但禁止提交为了解决网络依赖问题所做的变更。
