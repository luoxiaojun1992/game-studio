# H5 小游戏工程规范

> **SPEC-005** | 状态：已实现

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
  index.html          # MUST 存在。H5 类型下 entry 固定为 dist/index.html
  metadata.json       # MUST 存在（game_type: "h5"），其中 entry 字段须填写 "index.html"
  assets/
    manifest.json     # MUST 存在（H5 特有）
    ...               # 游戏资源文件
```

> **说明**：metadata.json 中的 `entry` 字段在 H5 类型下语义为**相对提交产物根目录**的入口路径。由于 H5 框架规范固定入口为 `dist/index.html`，checker 实际检查 `{submitDir}/dist/index.html`。但 `entry` 作为公共必填字段仍须填写，值为 `"index.html"`。

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

### A.1 游戏框架契约规则组（lifecycle- 前缀）

#### A.1.1 lifecycle-exports

| 属性 | 值 |
|------|-----|
| ruleId | `lifecycle-exports` |
| level | `error` |
| 规则组 | lifecycle |
| 描述 | GameApp MUST 实现全部 6 个生命周期方法：init/start/pause/resume/resize/destroy |

**判定逻辑：**
```typescript
const REQUIRED_METHODS = ['init', 'start', 'pause', 'resume', 'resize', 'destroy'];
// 使用 negative lookbehind 防止误匹配（如 reinitialize → init 被误判）
const RE_METHOD = new RegExp(
  REQUIRED_METHODS.map(m => `(?<![\\w$.])${m}\\s*\\(`).join('|'), 'g'
);
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
| 规则组 | lifecycle |
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
| 规则组 | lifecycle |
| 描述 | index.html MUST 包含 `<script>` 标签加载游戏脚本 |

**判定逻辑：** `/<script[\s>]/i`

**通过示例：** `<script src="game.js"></script>`

**错误消息：** `缺少 <script> 标签。HTML MUST 包含 <script> 标签加载游戏脚本。`

---

### A.2 资源与配置规则组（asset- 前缀）— H5 扩展

#### A.2.1 asset-manifest-exists

| 属性 | 值 |
|------|-----|
| ruleId | `asset-manifest-exists` |
| level | `error` |
| 规则组 | asset |
| 描述 | `assets/manifest.json` MUST 存在于提交产物目录 |

**判定逻辑：** `fs.existsSync(path.join(submitDir, 'assets', 'manifest.json'))`

**错误消息：** `缺少 assets/manifest.json。`

---

#### A.2.2 asset-manifest-schema

| 属性 | 值 |
|------|-----|
| ruleId | `asset-manifest-schema` |
| level | `error` |
| 规则组 | asset |
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

#### A.2.3 asset-resource-relative-path

| 属性 | 值 |
|------|-----|
| ruleId | `asset-resource-relative-path` |
| level | `error` |
| 规则组 | asset |
| 描述 | index.html 中引用的资源路径 MUST 使用相对路径 |

**判定逻辑：** `/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi`

**通过示例：** `<script src="game.js">`、`<img src="assets/a.png">`

**失败示例：** `<script src="https://cdn.example.com/lib.js">`

**错误消息：** `检测到绝对路径资源引用：{url}。所有资源 MUST 使用相对路径。`

---

## 附录 B：规则总览表

| ruleId | 规则组 | level | 来源 | 描述 |
|--------|-------|-------|------|------|
| `html-doctype` | html | error | 公共 | MUST 包含 `<!DOCTYPE html>` |
| `html-root` | html | error | 公共 | MUST 包含 `<html>` 根标签 |
| `html-head` | html | error | 公共 | MUST 包含 `<head>` 标签 |
| `html-body` | html | error | 公共 | MUST 包含 `<body>` 标签 |
| `html-charset` | html | error | 公共 | `<head>` 中 MUST 包含 `<meta charset="utf-8">` |
| `html-body-not-empty` | html | error | 公共 | `<body>` MUST 有可见内容 |
| `asset-metadata-exists` | asset | error | 公共 | MUST 存在 `metadata.json` |
| `asset-metadata-schema` | asset | error | 公共 | metadata.json MUST 完整且 game_type 已注册 |
| `lifecycle-exports` | lifecycle | error | H5 特有 | MUST 实现 GameApp 全部 6 个生命周期方法 |
| `lifecycle-window-global` | lifecycle | error | H5 特有 | MUST 挂载 GameApp 实例到 `window.__GAME__` |
| `lifecycle-script-tag` | lifecycle | error | H5 特有 | index.html MUST 包含 `<script>` 标签 |
| `asset-manifest-exists` | asset | error | H5 特有 | MUST 存在 `assets/manifest.json` |
| `asset-manifest-schema` | asset | error | H5 特有 | manifest.json MUST 合法且含 resources |
| `asset-resource-relative-path` | asset | error | H5 特有 | 资源路径 MUST 使用相对路径 |
