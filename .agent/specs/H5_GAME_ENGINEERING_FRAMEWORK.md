# H5 小游戏工程规范

## 概述

本文档是 H5 游戏类型的工程规范，基于 [GAME_ENGINEERING_COMMON.md](./GAME_ENGINEERING_COMMON.md) 中的公共规范扩展。

**使用方式：**
1. Engineer Agent 先读取 `metadata.json` 中的 `game_type` 字段。
2. 若 `game_type === "h5"`，同时加载本规范和公共规范。
3. 公共规范中的规则自动生效，本规范中的规则附加生效。

## 适用范围
- `metadata.json` 中 `game_type` MUST 为 `"h5"`。
- 面向 H5 小游戏（浏览器运行、无服务端依赖）。
- 以 **单一 HTML + 资源包** 作为提交目标。
- 本文档中 **MUST** / **MUST NOT** / **SHOULD** 遵循 RFC 2119 定义。

## 框架选型（固定边界）

| 层级 | 选型 | 最低版本 |
|------|------|---------|
| 渲染 | PixiJS | >=7.4.0 |
| 物理（可选） | Matter.js | >=0.19.0 |
| 动画/补间 | @tweenjs/tween.js | >=20.0.0 |
| 音频 | Howler.js | >=2.2.4 |
| 输入 | Pointer/Keyboard API（原生） | — |
| 构建 | Vite + TypeScript | — |

## 目录结构

### 提交产物结构（lint checker 扫描目标）
```
dist/
  index.html          # MUST 存在
  metadata.json       # MUST 存在（game_type: "h5"）
  assets/
    manifest.json     # MUST 存在（H5 特有）
    ...               # 游戏资源文件
```

### 开发期目录结构（供 Engineer Agent 参考）
```
game/
  index.html
  metadata.json
  src/
    main.ts           # 框架入口（固定）
    engine/           # 框架层（固定边界）
    gameplay/         # 业务逻辑自由区
    ui/               # UI/Overlay（可选）
  assets/
    manifest.json     # 资源清单
```

## 生命周期契约

```ts
export interface GameConfig {
  width: number;
  height: number;
  resolution?: number;
  orientation?: 'landscape' | 'portrait';
  canvasId?: string;
  assetsManifest: string;
  [key: string]: unknown;
}

export interface GameApp {
  init(config: GameConfig): Promise<void> | void;
  start(): void;
  pause(): void;
  resume(): void;
  resize(width: number, height: number): void;
  destroy(): void;
}
```

## 非目标（明确不做）
- 不规定玩法、规则、关卡内容与复杂度。
- 不限制表现风格、主题、UI 设计。
- 不限制算法、AI、关卡生成方式。

---

## 附录 A：H5 特有可验证规则清单

以下规则仅在 `game_type === "h5"` 时生效。

### A.1 游戏框架契约检查器（game-lifecycle）

#### A.1.1 lifecycle-exports

| 属性 | 值 |
|------|-----|
| ruleId | `lifecycle-exports` |
| level | `error` |
| checker | game-lifecycle |
| 描述 | GameApp MUST 实现全部 6 个生命周期方法：init/start/pause/resume/resize/destroy |

**判定逻辑：**
```typescript
const REQUIRED_METHODS = ['init', 'start', 'pause', 'resume', 'resize', 'destroy'];
const RE_METHOD = new RegExp(`\\b(${REQUIRED_METHODS.join('|')})\\s*\\(`, 'g');
const found = new Set(sanitized.match(RE_METHOD)?.map(m => m.replace(/\s*\($/, '')) || []);
const missing = REQUIRED_METHODS.filter(m => !found.has(m));
```

**通过示例（任意一种均可）：**
```javascript
const app = { init(c){}, start(){}, pause(){}, resume(){}, resize(w,h){}, destroy(){} };
```
```javascript
class MyGame { init(c){}, start(){}, pause(){}, resume(){}, resize(w,h){}, destroy(){} }
```

**失败示例：** 缺少任意一个方法。

**边界：**
- 仅做文本扫描，不做 AST。方法出现在对象字面量、class、全局函数均计入。
- 方法体是否为空不验证。
- 6 个方法缺失任意一个即报告 error。

**错误消息：** `缺少 GameApp 生命周期方法：{missing}。GameApp MUST 实现全部 6 个方法。`

---

#### A.1.2 lifecycle-window-global

| 属性 | 值 |
|------|-----|
| ruleId | `lifecycle-window-global` |
| level | `error` |
| checker | game-lifecycle |
| 描述 | GameApp 实例 MUST 挂载到 `window.__GAME__` |

**判定逻辑：** `/window\.__GAME__\s*=/`

**通过示例：** `window.__GAME__ = new MyGame();`

**失败示例：** 缺失 `window.__GAME__` 赋值。

**错误消息：** `缺少 window.__GAME__ 挂载。GameApp 实例 MUST 赋值给 window.__GAME__。`

---

#### A.1.3 lifecycle-script-tag

| 属性 | 值 |
|------|-----|
| ruleId | `lifecycle-script-tag` |
| level | `error` |
| checker | game-lifecycle |
| 描述 | index.html MUST 包含 `<script>` 标签加载游戏脚本 |

**判定逻辑：** `/<script[\s>]/i`

**通过示例：** `<script src="game.js"></script>`

**错误消息：** `缺少 <script> 标签。HTML MUST 包含 <script> 标签加载游戏脚本。`

---

### A.2 资源与配置检查器（game-asset）— H5 扩展

#### A.2.1 manifest-exists

| 属性 | 值 |
|------|-----|
| ruleId | `manifest-exists` |
| level | `error` |
| checker | game-asset |
| 描述 | `assets/manifest.json` MUST 存在于提交产物目录 |

**判定逻辑：** `fs.existsSync(path.join(submitDir, 'assets', 'manifest.json'))`

**错误消息：** `缺少 assets/manifest.json。`

---

#### A.2.2 manifest-schema

| 属性 | 值 |
|------|-----|
| ruleId | `manifest-schema` |
| level | `error` |
| checker | game-asset |
| 描述 | manifest.json MUST 是合法 JSON 且包含 resources 数组 |

**判定逻辑：**
```typescript
const data = JSON.parse(content);
if (!Array.isArray(data?.resources)) { /* 失败 */ }
for (const item of data.resources) {
  if (typeof item.path !== 'string' || item.path.length === 0) { /* 失败 */ }
  if (typeof item.type !== 'string' || item.type.length === 0) { /* 失败 */ }
}
```

**通过示例：** `{ "resources": [{"path": "a.png", "type": "image"}] }`

**失败示例：** `{}`、`{"resources": []}`、`{"resources": [{}]}`

**错误消息：**
- `assets/manifest.json 不是合法 JSON 格式。`
- `assets/manifest.json 缺少 resources 数组。`
- `assets/manifest.json resources[{index}] 缺少 "path" 或 "type"。`

---

#### A.2.3 resource-relative-path

| 属性 | 值 |
|------|-----|
| ruleId | `resource-relative-path` |
| level | `error` |
| checker | game-asset |
| 描述 | index.html 中引用的资源路径 MUST 使用相对路径 |

**判定逻辑：** `/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi`

**通过示例：** `<script src="game.js">`、`<img src="assets/a.png">`

**失败示例：** `<script src="https://cdn.example.com/lib.js">`

**错误消息：** `检测到绝对路径资源引用：{url}。所有资源 MUST 使用相对路径。`

---

## 附录 B：规则总览表

| ruleId | checker | level | 来源 | 描述 |
|--------|---------|-------|------|------|
| `html-doctype` | html-structure | error | 公共 | MUST 包含 `<!DOCTYPE html>` |
| `html-root` | html-structure | error | 公共 | MUST 包含 `<html>` 根标签 |
| `html-head` | html-structure | error | 公共 | MUST 包含 `<head>` 标签 |
| `html-body` | html-structure | error | 公共 | MUST 包含 `<body>` 标签 |
| `html-charset` | html-structure | error | 公共 | `<head>` 中 MUST 包含 `<meta charset="utf-8">` |
| `html-body-not-empty` | html-structure | error | 公共 | `<body>` MUST 有可见内容 |
| `js-eval` | js-security | warn | 公共 | MUST NOT 使用 `eval()` |
| `js-function-constructor` | js-security | warn | 公共 | MUST NOT 使用 `new Function()` |
| `js-js-url` | js-security | warn | 公共 | MUST NOT 使用 `javascript:` 协议 URL |
| `js-inner-html-write` | js-security | warn | 公共 | MUST NOT 使用 `innerHTML` 写入 |
| `http-fetch-method` | http-method | error | 公共 | MUST NOT 使用 POST/PUT/DELETE/PATCH |
| `http-xhr-method` | http-method | error | 公共 | MUST NOT 使用 POST/PUT/DELETE/PATCH |
| `metadata-exists` | game-asset | error | 公共 | MUST 存在 `metadata.json` |
| `metadata-schema` | game-asset | error | 公共 | metadata.json MUST 完整且 game_type 已注册 |
| `js-document-write` | js-security-ext | error | 公共 | MUST NOT 使用 `document.write()` |
| `js-dynamic-script` | js-security-ext | error | 公共 | MUST NOT 动态创建远程 `<script>` |
| `lifecycle-exports` | game-lifecycle | error | H5 特有 | MUST 实现 GameApp 全部 6 个生命周期方法 |
| `lifecycle-window-global` | game-lifecycle | error | H5 特有 | MUST 挂载 GameApp 实例到 `window.__GAME__` |
| `lifecycle-script-tag` | game-lifecycle | error | H5 特有 | index.html MUST 包含 `<script>` 标签 |
| `manifest-exists` | game-asset | error | H5 特有 | MUST 存在 `assets/manifest.json` |
| `manifest-schema` | game-asset | error | H5 特有 | manifest.json MUST 合法且含 resources |
| `resource-relative-path` | game-asset | error | H5 特有 | 资源路径 MUST 使用相对路径 |

---

## 附录 C：规范工具与检查器路由架构

### 整体流程

```
┌─────────────────────────────────────────────────────────┐
│                    Engineer Agent                        │
│  1. 读取 metadata.json 获取 game_type                    │
│  2. 调用 get_game_spec(game_type) 获取规范               │
│  3. 按规范开发                                            │
│  4. 调用 submit_game 提交成品                              │
└──────────────┬──────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────┐
│                    submit_game (tools.ts)                 │
│  1. 解析 metadata.json → game_type                       │
│  2. 将 game_type 传入 lintGameContent()                   │
└──────────────┬──────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────┐
│                    LintRunner                             │
│  1. 公共 checkers（html-structure, js-security,           │
│     http-method, game-asset(部分), js-security-ext）     │
│     → 无条件运行                                          │
│  2. H5 checkers（game-lifecycle, asset扩展）              │
│     → 仅在 game_type === "h5" 时运行                     │
└─────────────────────────────────────────────────────────┘
```

### 1. 规范工具：`get_game_spec`

向 Engineer Agent 暴露的 MCP 工具，用于在开发前获取工程规范。

```typescript
// tools.ts 中的工具定义
tool(
  'get_game_spec',
  '获取指定游戏类型的工程规范文档，Engineer Agent 在开发前 MUST 调用此工具',
  {
    game_type: z.string().describe('游戏类型，如 "h5"'),
  },
  async ({ game_type }) => {
    const SPEC_FILES: Record<string, string> = {
      'h5': '.agent/specs/H5_GAME_ENGINEERING_FRAMEWORK.md',
    };
    const specFile = SPEC_FILES[game_type] || '.agent/specs/GAME_ENGINEERING_COMMON.md';
    const specContent = await fs.promises.readFile(path.resolve(__dirname, '..', specFile), 'utf-8');
    const commonContent = await fs.promises.readFile(
      path.resolve(__dirname, '..', '.agent/specs/GAME_ENGINEERING_COMMON.md'), 'utf-8'
    );
    return {
      content: [
        { type: 'text', text: `# 公共规范\n\n${commonContent}\n\n# 类型规范\n\n${specContent}` }
      ]
    };
  }
);
```

**Engineer Agent 行为约束：**
- 收到新游戏开发任务后，MUST 先调用 `get_game_spec` 获取规范。
- 按规范中的 MUST / MUST NOT 约束开发。
- 提交前确保所有规则通过。

### 2. metadata.json game_type 字段

```json
{
  "title": "Snake Game",
  "version": "1.0.0",
  "game_type": "h5",
  "resolution": { "width": 800, "height": 600 },
  "orientation": "landscape",
  "entry": "index.html"
}
```

- `game_type` 是公共规范中 metadata-schema 的必填字段。
- 注册的游戏类型列表维护在公共规范的表格中。

### 3. submit_game 传递 game_type

```typescript
// submit_game 工具，在 tools.ts 中
// 从 metadata.json 解析 game_type 传给 lint 检查器
async ({ /* ... */ }) => {
  // ...获取 metadata.json
  const metadata = JSON.parse(metadataContent);
  const gameType = metadata.game_type || 'h5';

  // 传入 lintGameContent
  const lintResult = await lintGameContent(htmlContent, {
    gameType,
    zipBuffer: zipBuffer,
    // ...
  });
}
```

### 4. LintRunner 按 game_type 选择规则

```typescript
export interface LintContext {
  // ... 现有字段
  gameType?: string;  // 新增：用于规则选择
}
```

**规则选择逻辑（在 LintRunner 中）：**

| Checker | 条件 | 说明 |
|---------|------|------|
| html-structure | 始终运行 | 公共规则 |
| js-security | 始终运行 | 公共规则 |
| http-method | 始终运行 | 公共规则 |
| js-security-ext | 始终运行 | 公共规则 |
| metadata-exists | 始终运行 | 公共规则 |
| metadata-schema | 始终运行 | 公共规则 |
| game-lifecycle | `gameType === "h5"` 时运行 | H5 特有 |
| manifest-exists | `gameType === "h5"` 时运行 | H5 特有 |
| manifest-schema | `gameType === "h5"` 时运行 | H5 特有 |
| resource-relative-path | `gameType === "h5"` 时运行 | H5 特有 |

**新增游戏类型的步骤：**
1. 在公共规范中注册新的 `game_type` 值。
2. 创建对应的 `<GAMETYPE>_GAME_ENGINEERING_FRAMEWORK.md`，放入 `specs/` 目录，引用公共规范。
3. 在 `get_game_spec` 工具的 `SPEC_FILES` 映射中添加新类型。
4. 在 LintRunner 的规则选择逻辑中，为 `gameType` 注册新的 checkers。

### 5. Engineer Agent 提示词更新

在 `agents.ts` 中 engineer 的 system prompt 中新增：

```
## 游戏工程规范
在开始开发前，MUST 调用 get_game_spec 工具获取当前游戏类型的工程规范。
开发过程中必须遵守规范中的所有 MUST / MUST NOT 约束。
提交前确保 metadata.json 中的 game_type 字段正确设置。
```
