# H5 小游戏工程框架规范（Engineering Agent）

## 目标
- 为 Engineering Agent 提供**稳定、可验证、可测试**的开发边界。
- 让游戏业务逻辑在框架内自由扩展，不被强行限制。
- 便于系统对产物进行静态检查、自动化测试与验收反馈。

## 适用范围
- 面向 H5 小游戏（浏览器运行、无服务端依赖）。
- 以 **单一 HTML + 资源包** 作为提交目标。
- 本文档中 **MUST** / **MUST NOT** / **SHOULD** 遵循 RFC 2119 定义。

## 框架选型（固定边界）
> 以下选型用于统一运行时与工具链，减少不确定性。

### 渲染层
- **PixiJS**（Canvas/WebGL 自动选择）
- 最低版本：`>=7.4.0`

### 物理（可选）
- **Matter.js**
- 最低版本：`>=0.19.0`

### 动画与补间
- **@tweenjs/tween.js**
- 最低版本：`>=20.0.0`

### 音频
- **Howler.js**
- 最低版本：`>=2.2.4`

### 输入与交互
- Pointer/Keyboard API（原生）
- 对外封装为统一输入层

### 构建与打包
- **Vite + TypeScript**
- 产物输出为 `dist/index.html` 与资源目录

## 目录结构约定

### 提交产物结构（lint checker 扫描目标）
```
dist/
  index.html          # MUST 存在
  metadata.json       # MUST 存在
  assets/
    manifest.json     # MUST 存在
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

### 要求
- 生命周期 MUST 由框架掌控，业务逻辑通过注册/订阅方式扩展。
- 业务逻辑 MUST NOT 直接操作 DOM 结构（允许只在 `ui/` 中创建 Overlay）。
- `GameApp` 实例 MUST 挂载到 `window.__GAME__`。
- HTML 中 MUST 包含 `<script>` 标签加载游戏脚本。
- GameApp 接口 MUST 实现全部 6 个方法。

## 非目标（明确不做）
- 不规定玩法、规则、关卡内容与复杂度。
- 不限制表现风格、主题、UI 设计。
- 不限制算法、AI、关卡生成方式。

---

## 附录 A：可验证规则清单（精确到实现级别）

> 本附录是 lint checker 实现规范。每条规则提供：
> - 精确的判定逻辑（正则表达式 / JSON Schema / 文件存在性）
> - 通过 / 失败的示例代码
> - 边界条件处理
> - 错误消息模板

### 通用约定

**所有 checker 通用行为：**
- 内容处理：整份 HTML/JS 文件作为单一字符串输入。
- 行号计算：按 `\n` 分割后，1-based 行号。按匹配位置向前累计字符数。
- 多行匹配：使用 `[^]*` 而非 `[\s\S]` 或 `.`（JS 正则不含 s flag 时 `.` 不匹配换行）。
- 空值处理：若输入字符串为空或仅含空白，跳过所有正则匹配，仅返回一条 `html-empty` error。
- 注释排除：所有 JS 正则 MUST **不在** `<!-- -->` 或 `//` 注释及 `/* */` 块注释中验证。具体做法：先通过 `content.replace(/\/\/.*$/gm, '').replace(/\/\*[^]*?\*\//g, '').replace(/<!--[^]*?-->/g, '')` 剔除注释后再匹配。但 HTML 结构规则（匹配 DOCTYPE 等）除外——HTML 标签不排除注释。

---

### A.1 HTML 结构检查器（html-structure）

**输入**：`index.html` 文本内容（字符串）。

#### A.1.1 html-doctype

| 属性 | 值 |
|------|-----|
| ruleId | `html-doctype` |
| level | `error` |
| 描述 | 文件首行附近的 `<body>` 前 MUST 包含 `<!DOCTYPE html>` 声明（大小写不敏感） |

**判定逻辑：**
```typescript
// 在 body 标签之前匹配
// 注意：DOCTYPE 大小写不敏感，但属性值必须为 "html"
const RE_DOCTYPE = /<!DOCTYPE\s+html>/i;
const RE_BODY = /<body[\s>]/i;
const bodyIndex = content.search(RE_BODY);
const target = bodyIndex >= 0 ? content.slice(0, bodyIndex) : content;
const passed = RE_DOCTYPE.test(target);
```

**通过示例：**
```html
<!DOCTYPE html>
<html><head>...</head><body>...
```
```html
<!doctype html>
<html lang="en"><body>...
```

**失败示例：**
```html
<html><head>...</head><body>...   <!-- 没有 DOCTYPE -->
```
```html
<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN">
<html><body>...   <!-- 不是 HTML5 DOCTYPE -->
```

**边界：**
- `<!DOCTYPE html>` 之前可以有 BOM 或空白字符，不判定为失败。
- 若 DOCTYPE 出现在 `<body>` 之后（即被内容覆盖），判定为失败。
- 匹配体内容为空 → 先抛 `html-empty`，不再检查本条。

**错误消息：** `缺少 <!DOCTYPE html> 声明。HTML5 文档必须以 <!DOCTYPE html> 开头。`

---

#### A.1.2 html-root

| 属性 | 值 |
|------|-----|
| ruleId | `html-root` |
| level | `error` |
| 描述 | MUST 包含 `<html>` 根标签（有属性或仅标签） |

**判定逻辑：**
```typescript
const RE_HTML_TAG = /<html[\s>]/i;
const passed = RE_HTML_TAG.test(content);
```

**通过示例：**
```html
<html>
```
```html
<html lang="zh-CN">
```

**失败示例：**
```html
<htm>
```
（纯文本，无任何 HTML 标签）

**边界：**
- 匹配 `<html>` 后有空白或 `>` 即通过。
- 不要求匹配闭合标签 `</html>`。
- 单文件 HTML 不需要显式闭合。

**错误消息：** `缺少 <html> 根标签。文档根元素应为 <html>。`

---

#### A.1.3 html-head

| 属性 | 值 |
|------|-----|
| ruleId | `html-head` |
| level | `error` |
| 描述 | MUST 包含 `<head>` 标签 |

**判定逻辑：**
```typescript
const RE_HEAD_TAG = /<head[\s>]/i;
const passed = RE_HEAD_TAG.test(content);
```

**通过示例：** `<head>`、`<head id="h">`

**失败示例：** `<header>`（非 `<head>`）、无 head 标签

**错误消息：** `缺少 <head> 标签。文档应包含 head 区域。`

---

#### A.1.4 html-body

| 属性 | 值 |
|------|-----|
| ruleId | `html-body` |
| level | `error` |
| 描述 | MUST 包含 `<body>` 标签 |

**判定逻辑：**
```typescript
const RE_BODY_TAG = /<body[\s>]/i;
const passed = RE_BODY_TAG.test(content);
```

**错误消息：** `缺少 <body> 标签。游戏内容应在 body 中渲染。`

---

#### A.1.5 html-charset

| 属性 | 值 |
|------|-----|
| ruleId | `html-charset` |
| level | `error` |
| 描述 | `<head>` 区域中 MUST 包含 `<meta charset="utf-8">` |

**判定逻辑：**
```typescript
// 仅当 head 标签存在时才检查
const RE_CHARSET_META = /<meta\s[^>]*charset=["']?utf-8["']?/i;
const hasHead = RE_HEAD_TAG.test(content);
const passed = !hasHead || RE_CHARSET_META.test(content);
// 注：无 head 标签时跳过本检查（html-head 会报告独立 error）
```

**通过示例：**
```html
<head><meta charset="utf-8"></head>
```
```html
<head><meta charset='utf-8'></head>
```
```html
<head><meta charset=utf-8></head>
```

**失败示例：**
```html
<head></head>
```
```html
<head><meta charset="gbk"></head>
```

**边界：**
- charset 值允许不加引号：`charset=utf-8`。
- 值必须为 `utf-8`（不区分大小写），`UTF-8` 通过。
- `<meta http-equiv="Content-Type" content="text/html; charset=utf-8">` 虽合法，但 checker 不要求，只匹配 `charset` 属性形式。

**错误消息：** `缺少字符编码声明 <meta charset="utf-8">。应在 <head> 中添加编码声明。`

---

#### A.1.6 html-body-not-empty

| 属性 | 值 |
|------|-----|
| ruleId | `html-body-not-empty` |
| level | `error` |
| 描述 | `<body>` 标签间的内容 MUST 包含可见字符 |

**判定逻辑：**
```typescript
const RE_EXTRACT_BODY = /<body[^]*?>([^]*)<\/body>/i;
const RE_STRIP_TAGS = /<[^>]*>/g;
const RE_WHITESPACE_ONLY = /^[\s\n\r\t]*$/;
const hasBody = RE_BODY_TAG.test(content);

if (hasBody) {
  const bodyMatch = content.match(RE_EXTRACT_BODY);
  if (!bodyMatch) {
    // 有 <body> 开始标签但无 </body> 闭合 → 检查 body 后是否有非空白内容
    const bodyStart = content.search(RE_BODY_TAG);
    const afterBody = content.slice(bodyStart + content.slice(bodyStart).indexOf('>') + 1);
    passed = !RE_WHITESPACE_ONLY.test(afterBody.replace(RE_STRIP_TAGS, ''));
  } else {
    const text = bodyMatch[1].replace(RE_STRIP_TAGS, '');
    passed = !RE_WHITESPACE_ONLY.test(text);
  }
}
```

**通过示例：**
```html
<body><div id="game"></div><script src="game.js"></script></body>
```
```html
<body><canvas id="game"></canvas></body>
```

**失败示例：**
```html
<body></body>
```
```html
<body>   </body>
```
```html
<body>
  <!-- only comment -->
</body>
```
（纯注释 + 空白不视为可见内容，因为注释在去标签后消失）

**边界：**
- 所有 HTML 标签去除后，剩余文本若仅为空白（含 `\n`、`\r`、`\t`、空格），判定为失败。
- `<script>` 内容视为可见（因为脚本中的代码是可见文本）。
- 无 `</body>` 闭合标签时，从 `<body>` 后截取到文件末尾判断。

**错误消息：** `<body> 内容为空或仅含空白与注释。游戏中应有可见的元素。`

---

### A.2 JS 安全检查器（js-security）

**输入**：`index.html` 文本内容（字符串）。

**预处理**：每条规则匹配前先剔除注释：
```typescript
const sanitized = content
  .replace(/\/\/.*$/gm, ''           // 单行注释
  .replace(/\/\*[^]*?\*\//g, ''     // 多行注释
  .replace(/<!--[^]*?-->/g, '');    // HTML 注释
```

#### A.2.1 js-eval

| 属性 | 值 |
|------|-----|
| ruleId | `js-eval` |
| level | `warn` |
| 描述 | MUST NOT 使用 `eval()` 调用 |

**判定逻辑：**
```typescript
const RE_EVAL = /\beval\s*\(/gi;
const matches = sanitized.match(RE_EVAL) || [];
```

**通过示例：**
```javascript
JSON.parse(jsonString);     // 安全
```
```javascript
const result = new Function('return ' + str)();  // 被 js-function-constructor 捕获
```

**失败示例：**
```javascript
eval(code);
```
```javascript
window['eval'](code);       // 动态属性访问，不会被本正则捕获（这是可接受的风险，不要求全覆盖）
```

**边界：**
- 不检测 `window.eval()`、`globalThis.eval()`、`(0, eval)()` 等间接调用形式。
- `eval` 作为变量名（`const eval = ...`）会被误报，但属于低概率，可接受。
- 仅对 HTML/JS 文本做线性扫描，不做 AST 解析。

**错误消息：** `检测到 eval() 调用。eval 存在代码注入风险，建议使用 JSON.parse 或更安全的替代方案。`

---

#### A.2.2 js-function-constructor

| 属性 | 值 |
|------|-----|
| ruleId | `js-function-constructor` |
| level | `warn` |
| 描述 | MUST NOT 使用 `new Function()` 或 `Function()` 构造 |

**判定逻辑：**
```typescript
const RE_FUNCTION_CTOR = /(?:new\s+)?Function\s*\(/g;
const matches = sanitized.match(RE_FUNCTION_CTOR) || [];
```

**通过示例：** `() => {}`（箭头函数）、`function foo() {}`（函数声明）

**失败示例：**
```javascript
new Function('a', 'b', 'return a + b');
```
```javascript
Function('return ' + data)();
```

**边界：**
- `Function.prototype.bind.call(...)` 不会被误报（因为 `Function` 后无 `(`）。
- 匹配 `Function(` 前可选的 `new ` 和空白。

**错误消息：** `检测到 Function() 构造函数调用。动态生成函数存在安全风险，建议避免使用。`

---

#### A.2.3 js-js-url

| 属性 | 值 |
|------|-----|
| ruleId | `js-js-url` |
| level | `warn` |
| 描述 | MUST NOT 使用 `javascript:` 协议 URL |

**判定逻辑：**
```typescript
const RE_JS_URL = /javascript\s*:/gi;
const matches = sanitized.match(RE_JS_URL) || [];
```

**通过示例：**
```html
<a href="https://example.com">链接</a>
```

**失败示例：**
```html
<a href="javascript:void(0)">点击</a>
```
```html
<a href="JavaScript:alert(1)">点击</a>   <!-- 大小写变体 -->
```

**错误消息：** `检测到 javascript: 协议 URL。javascript: URL 存在 XSS 风险，建议使用事件监听处理交互。`

---

#### A.2.4 js-inner-html-write

| 属性 | 值 |
|------|-----|
| ruleId | `js-inner-html-write` |
| level | `warn` |
| 描述 | MUST NOT 使用 `innerHTML` 赋值（`=` 或 `+=`） |

**判定逻辑：**
```typescript
const RE_INNER_HTML_WRITE = /\.innerHTML\s*[\+]?=/g;
const matches = sanitized.match(RE_INNER_HTML_WRITE) || [];
```

**通过示例：**
```javascript
el.textContent = 'Hello';
```
```javascript
el.appendChild(document.createTextNode('Hello'));
```

**失败示例：**
```javascript
el.innerHTML = '<div>Hello</div>';
```
```javascript
el.innerHTML += '<span>more</span>';
```

**边界：**
- `.innerHTML` 仅**读取**（不作为赋值左侧）时无问题，正则不会匹配（无 `=`）。
- `insertAdjacentHTML` 不会被捕获（使用不同的 API，风险类似但本规则不覆盖）。

**错误消息：** `检测到 innerHTML 赋值操作。若赋值内容来自用户输入，可能导致 XSS。建议使用 textContent 或 DOM API。`

---

### A.3 HTTP 方法安全检查器（http-method）

**输入**：`index.html` 文本内容（字符串）。

**预处理**：同 A.2，先剔除注释。

#### A.3.1 http-fetch-method

| 属性 | 值 |
|------|-----|
| ruleId | `http-fetch-method` |
| level | `error` |
| 描述 | `fetch()` 调用中 MUST NOT 使用 POST/PUT/DELETE/PATCH 方法 |

**判定逻辑：**
```typescript
const RE_FETCH_METHOD = /fetch\s*\(\s*[^)]+\s*,\s*\{[^}]*?\bmethod\s*:\s*["']([A-Za-z]+)["']/gi;
const allowedMethods = new Set(['GET', 'OPTIONS', 'HEAD', 'CONNECT', 'TRACE']);
const forbidden = ['POST', 'PUT', 'DELETE', 'PATCH'];

// 遍历所有匹配，method 值转大写后比较
let match;
while ((match = RE_FETCH_METHOD.exec(sanitized)) !== null) {
  const method = match[1].toUpperCase();
  if (!allowedMethods.has(method)) { issues.push(...) }
}
```

**通过示例：**
```javascript
fetch('/api/config');
```
```javascript
fetch('/api/data', { method: 'GET' });
```
```javascript
fetch(url, { headers: { 'Content-Type': 'application/json' } });  // 无 method 字段
```

**失败示例：**
```javascript
fetch('/api/save', { method: 'POST' });
```
```javascript
fetch(url, {method:'POST', body: data});
```
```javascript
fetch(url, { method: "post" });   // 不区分大小写
```

**边界：**
- 仅检测 `fetch(url, { method: 'X' })` 语法。
- 变量形式 `fetch(url, options)`（method 在变量中）不在静态扫描范围内。
- `XMLHttpRequest` 由 `http-xhr-method` 覆盖。
- 单个调用只生成一条 issue（重复不重复计数）。

**错误消息：** `检测到非安全 HTTP 方法 [{method}]。游戏仅允许 GET/OPTIONS 请求。`

---

#### A.3.2 http-xhr-method

| 属性 | 值 |
|------|-----|
| ruleId | `http-xhr-method` |
| level | `error` |
| 描述 | `XMLHttpRequest.open()` 中 MUST NOT 使用 POST/PUT/DELETE/PATCH |

**判定逻辑：**
```typescript
const RE_XHR_METHOD = /\.open\s*\(\s*["']([A-Za-z]+)["']\s*,/gi;
// 匹配逻辑同 http-fetch-method
```

**通过示例：**
```javascript
const xhr = new XMLHttpRequest();
xhr.open('GET', '/api/data');
```

**失败示例：**
```javascript
xhr.open('POST', '/api/save');
```

**错误消息：** `检测到 XMLHttpRequest.open() 中的非安全 HTTP 方法 [{method}]。游戏仅允许 GET/OPTIONS 请求。`

---

### A.4 游戏框架契约检查器（game-lifecycle）— ✋ 待实现

**输入**：`index.html` 文本内容（字符串）。

#### A.4.1 lifecycle-exports

| 属性 | 值 |
|------|-----|
| ruleId | `lifecycle-exports` |
| level | `error` |
| 描述 | GameApp 接口 MUST 实现全部 6 个生命周期方法：init/start/pause/resume/resize/destroy |

**判定逻辑：**
在剔除注释后的内容中，搜索以下 6 个方法名**作为对象方法的定义**（非变量名、非注释）：
```typescript
const REQUIRED_METHODS = ['init', 'start', 'pause', 'resume', 'resize', 'destroy'];
// 匹配模式：name(... 或 name (  — 作为对象方法、类方法或字面量
const RE_METHOD = new RegExp(`\\b(${REQUIRED_METHODS.join('|')})\\s*\\(`, 'g');
const found = new Set(sanitized.match(RE_METHOD)?.map(m => m.replace(/\s*\($/, '')) || []);
const missing = REQUIRED_METHODS.filter(m => !found.has(m));
```

**通过示例（任意一种形式均可）：**
```javascript
const app = {
  init(config) { /* ... */ },
  start() { /* ... */ },
  pause() { /* ... */ },
  resume() { /* ... */ },
  resize(w, h) { /* ... */ },
  destroy() { /* ... */ },
};
```
```javascript
class MyGame implements GameApp {
  init(config) {}
  start() {}
  pause() {}
  resume() {}
  resize(w, h) {}
  destroy() {}
}
```

**失败示例：** 缺少任意一个方法。例如只有 `init`、`start`、`destroy` 三个方法。

**边界：**
- 仅做线性文本扫描，不做 AST 解析。函数名出现在任意位置（对象字面量、class、全局函数）均计入。
- 函数签名参数列表不验证。
- 方法体是否为空（`init() {}`）不验证，只验证方法名出现。
- 若 6 个缺失任意一个，report error。

**错误消息：** `缺少 GameApp 生命周期方法：{missing}。GameApp MUST 实现全部 6 个方法：init/start/pause/resume/resize/destroy。`

---

#### A.4.2 lifecycle-window-global

| 属性 | 值 |
|------|-----|
| ruleId | `lifecycle-window-global` |
| level | `error` |
| 描述 | GameApp 实例 MUST 挂载到 `window.__GAME__` |

**判定逻辑：**
```typescript
// 匹配 window.__GAME__ 作为赋值左侧或表达式的一部分
// 如: window.__GAME__ = xxx;  或  exports.default = window.__GAME__ = ...
const RE_WINDOW_GAME = /window\.__GAME__\s*=/;
const passed = RE_WINDOW_GAME.test(sanitized);
```

**通过示例：**
```javascript
window.__GAME__ = new MyGame();
```
```javascript
window.__GAME__ = app;
```

**失败示例：**
```javascript
const game = new MyGame();    // 没有挂载到 window.__GAME__
```

**边界：**
- 仅检测 `window.__GAME__` *** 赋值***
- 不验证赋值右侧的类型或值
- `window['__GAME__'] = ...` 不会被匹配（动态属性不要求）
- 若上一规则 `lifecycle-exports` 已失败（缺少方法），本条自动失败（无对象可挂载），但仍报告两次 error

**错误消息：** `缺少 window.__GAME__ 挂载。GameApp 实例 MUST 赋值给 window.__GAME__，形如 window.__GAME__ = new MyGame()。`

---

#### A.4.3 lifecycle-script-tag

| 属性 | 值 |
|------|-----|
| ruleId | `lifecycle-script-tag` |
| level | `error` |
| 描述 | index.html MUST 包含 `<script>` 标签引用游戏脚本 |

**判定逻辑：**
```typescript
// 匹配 <script>、<script src="...">、<script type="module"> 等
const RE_SCRIPT_TAG = /<script[\s>]/i;
const passed = RE_SCRIPT_TAG.test(content);
// 注意：此处不剔除注释，因为 script 标签即使被注释也是有效存在
```

**通过示例：**
```html
<script src="game.js"></script>
```
```html
<script type="module" src="game.js"></script>
```

**失败示例：**
```html
<!-- 无 script 标签 -->
<div id="game"></div>
```
```html
<script>     <!-- 空 script -->
</script>
```

**边界：**
- `<script>` 标签即使内容为空也通过检查（脚本可能通过 `src` 加载）。
- `type="module"` 等变体不影响检查。
- 若脚本内容为空且无 `src` 属性，虽通过本检查，但运行时可能无法启动——这是 game 自身的逻辑问题，非 lint 职责。

**错误消息：** `缺少 <script> 标签。HTML MUST 包含 <script> 标签加载游戏脚本。`

---

### A.5 资源与配置检查器（game-asset）— ✋ 待实现

**输入**：提交产物目录的本地文件路径。checker 需读取 `metadata.json`、`assets/manifest.json`。

#### A.5.1 metadata-exists

| 属性 | 值 |
|------|-----|
| ruleId | `metadata-exists` |
| level | `error` |
| 描述 | `metadata.json` MUST 存在于提交产物根目录 |

**判定逻辑：**
```typescript
import fs from 'fs';
const metadataPath = path.join(submitDir, 'metadata.json');
const passed = fs.existsSync(metadataPath);
```

**错误消息：** `缺少 metadata.json。提交产物根目录 MUST 包含 metadata.json 文件。`

---

#### A.5.2 metadata-schema

| 属性 | 值 |
|------|-----|
| ruleId | `metadata-schema` |
| level | `error` |
| 描述 | `metadata.json` MUST 是合法 JSON 且包含所有必填字段 |

**判定逻辑：**
```typescript
const content = fs.readFileSync(metadataPath, 'utf-8');
let data: any;
try { data = JSON.parse(content); }
catch (e) { /* 非法 JSON → 失败 */ }

// 字段验证
const requiredFields: Record<string, (v: any) => boolean> = {
  'title': v => typeof v === 'string' && v.length > 0,
  'version': v => typeof v === 'string' && v.length > 0,
  'resolution': v => typeof v === 'object' && typeof v.width === 'number' && typeof v.height === 'number',
  'orientation': v => ['landscape', 'portrait'].includes(v),
  'entry': v => typeof v === 'string' && v.length > 0,
};
// 缺失或类型不匹配均失败
```

**通过示例：**
```json
{
  "title": "Snake Game",
  "version": "1.0.0",
  "resolution": { "width": 800, "height": 600 },
  "orientation": "landscape",
  "entry": "index.html"
}
```

**失败示例：**
```json
{
  "title": "",
  "version": "1.0.0"
  // 缺少 resolution / orientation / entry
}
```
```json
{
  "title": 123,    // 非字符串
  "version": "1.0.0",
  "resolution": "800x600",  // 非对象
  "orientation": "vertical", // 非法值
  "entry": "index.html"
}
```

**边界：**
- `title` 和 `version` 空字符串判定为失败。
- `resolution` 必须是对象，`width` 和 `height` 必须是 number。（允许浮点数，不要求整数）
- `orientation` 仅允许 `"landscape"` 或 `"portrait"`（字符串严格匹配）。
- JSON 尾部逗号、注释不属于标准 JSON → `JSON.parse` 应抛错，判定为非法 JSON。
- 非标准 JSON（`// 注释`、`key 不加引号`）均通过 `JSON.parse` 自动排除。不额外处理。

**错误消息（按优先级）：**
- `metadata.json 不是合法 JSON 格式。请检查 JSON 语法。`
- `metadata.json 缺少必填字段：{fields}。`
- `metadata.json 字段 "{field}" 类型错误，期望 {expected}。`

---

#### A.5.3 manifest-exists

| 属性 | 值 |
|------|-----|
| ruleId | `manifest-exists` |
| level | `error` |
| 描述 | `assets/manifest.json` MUST 存在于提交产物目录 |

**判定逻辑：**
```typescript
const manifestPath = path.join(submitDir, 'assets', 'manifest.json');
const passed = fs.existsSync(manifestPath);
```

**错误消息：** `缺少 assets/manifest.json。提交产物 MUST 包含 assets/manifest.json 资源清单。`

---

#### A.5.4 manifest-schema

| 属性 | 值 |
|------|-----|
| ruleId | `manifest-schema` |
| level | `error` |
| 描述 | `assets/manifest.json` MUST 是合法 JSON 且遵循资源清单格式 |

**判定逻辑：**
```typescript
const content = fs.readFileSync(manifestPath, 'utf-8');
let data: any;
try { data = JSON.parse(content); } catch (e) { /* 失败 */ }

// 必填字段
if (!Array.isArray(data?.resources)) { /* 失败 */ }
for (const item of data.resources) {
  if (typeof item.path !== 'string' || item.path.length === 0) { /* 失败：缺少 path */ }
  if (typeof item.type !== 'string' || item.type.length === 0) { /* 失败：缺少 type */ }
}
```

**通过示例：**
```json
{
  "resources": [
    { "path": "sprites/player.png", "type": "image" },
    { "path": "audio/bgm.mp3", "type": "audio" },
    { "path": "data/levels.json", "type": "data", "preload": true }
  ]
}
```

**失败示例：**
```json
{ "resources": [] }     // 空数组
```
```json
{ "resources": [{}] }   // 缺少 path/type
```
```json
{ "notResources": [] }  // 字段名不对
```
```json
"plain string"          // 不是对象
```

**边界：**
- `resources` 必须是数组，可以为空（允许暂时无资源，但通常情况下应该有内容）。
- 每项的 `path` 和 `type` 为字符串且非空即可，`type` 的具体值不做枚举校验（允许自定义类型）。
- 允许额外字段（如 `preload`），不做限制。

**错误消息：**
- `assets/manifest.json 不是合法 JSON 格式。`
- `assets/manifest.json 缺少 resources 数组。`
- `assets/manifest.json resources[索引] 缺少必填字段 "path" 或 "type"。`

---

#### A.5.5 resource-relative-path

| 属性 | 值 |
|------|-----|
| ruleId | `resource-relative-path` |
| level | `error` |
| 描述 | index.html 中引用的资源路径 MUST 使用相对路径 |

**判定逻辑：**
在 index.html 中搜索常见资源引用属性，检查路径值是否以 `http://` 或 `https://` 开头：
```typescript
// 在整份 HTML 中匹配以下属性值
const RE_ABSOLUTE = /(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
const matches = content.match(RE_ABSOLUTE) || [];
```

**通过示例：**
```html
<script src="game.js"></script>
<link rel="stylesheet" href="styles.css">
<img src="assets/sprites/player.png">
```

**失败示例：**
```html
<script src="https://cdn.example.com/lib.js"></script>
<img src="http://other-server.com/img.png">
```

**边界：**
- `//cdn.example.com/lib.js`（protocol-relative URL）也被视为非相对路径——虽以 `//` 开头，但动态协议可能引发安全风险。匹配条件：不验证，因为正则只匹配 `http://` 和 `https://`。
- data URI（`src="data:image/png;base64,..."`）通过（不是 http 链接）。
- 此规则不验证 manifest.json 中的 `path` 字段（manifest-schema 已确保 path 存在）。

**错误消息：** `检测到绝对路径资源引用：{url}。所有游戏资源 MUST 使用相对路径。`

---

### A.6 增强安全检查器（js-security-ext）— ✋ 待实现

**输入**：`index.html` 文本内容（字符串）。

**预处理**：同 A.2，先剔除注释。

#### A.6.1 js-document-write

| 属性 | 值 |
|------|-----|
| ruleId | `js-document-write` |
| level | `error` |
| 描述 | MUST NOT 使用 `document.write()` |

**判定逻辑：**
```typescript
const RE_DOC_WRITE = /document\.write\s*\(/gi;
const matches = sanitized.match(RE_DOC_WRITE) || [];
```

**通过示例：** `document.createElement('div')`

**失败示例：** `document.write('<script>...</script>');`

**错误消息：** `检测到 document.write() 调用。document.write 可能导致页面内容异常，建议使用 DOM API 操作。`

---

#### A.6.2 js-dynamic-script

| 属性 | 值 |
|------|-----|
| ruleId | `js-dynamic-script` |
| level | `error` |
| 描述 | MUST NOT 动态创建 `<script>` 标签加载远程脚本 |

**判定逻辑：**
```typescript
// 匹配 createElement('script') + .src 赋值的组合模式
// 不要求严格同一条语句，只要文件内同时存在两者
const RE_CREATE_SCRIPT = /createElement\s*\(\s*["']script["']\s*\)/gi;
const RE_SET_SRC = /\.src\s*=\s*["']https?:\/\//gi;
const hasCreate = RE_CREATE_SCRIPT.test(sanitized);
const hasSrc = RE_SET_SRC.test(sanitized);
const passed = !(hasCreate && hasSrc);
```

**通过示例：**
```javascript
const script = document.createElement('script');
script.src = './local.js';                    // 相对路径
document.body.appendChild(script);
```

**失败示例：**
```javascript
const s = document.createElement('script');
s.src = 'https://cdn.example.com/tracker.js';
document.head.appendChild(s);
```

**边界：**
- 只有 `createElement('script')` + `.src = 'http...'` 两者同时存在于文件中时才判定失败。
- 若 `.src` 赋值为相对路径（不含 `http://` 或 `https://`），通过。
- `import()` 动态导入不在本规则范围内。
- 此规则的目的是阻止运行时从外部加载未经验证的脚本，不是阻止所有动态脚本。

**错误消息：** `检测到动态创建远程脚本。所有脚本 MUST 随包提交，禁止运行时从远程加载。`

---

## 附录 B：规则总览表

| ruleId | checker | level | 简短描述 |
|--------|---------|-------|---------|
| `html-doctype` | html-structure ✅ | error | MUST 包含 `<!DOCTYPE html>` |
| `html-root` | html-structure ✅ | error | MUST 包含 `<html>` 根标签 |
| `html-head` | html-structure ✅ | error | MUST 包含 `<head>` 标签 |
| `html-body` | html-structure ✅ | error | MUST 包含 `<body>` 标签 |
| `html-charset` | html-structure ✅ | error | `<head>` 中 MUST 包含 `<meta charset="utf-8">` |
| `html-body-not-empty` | html-structure ✅ | error | `<body>` MUST 有可见内容 |
| `js-eval` | js-security ✅ | warn | MUST NOT 使用 `eval()` |
| `js-function-constructor` | js-security ✅ | warn | MUST NOT 使用 `new Function()` / `Function()` |
| `js-js-url` | js-security ✅ | warn | MUST NOT 使用 `javascript:` 协议 URL |
| `js-inner-html-write` | js-security ✅ | warn | MUST NOT 使用 `innerHTML` 写入 |
| `http-fetch-method` | http-method ✅ | error | MUST NOT 使用 POST/PUT/DELETE/PATCH（fetch） |
| `http-xhr-method` | http-method ✅ | error | MUST NOT 使用 POST/PUT/DELETE/PATCH（XHR） |
| `lifecycle-exports` | game-lifecycle ✋ | error | MUST 实现 GameApp 全部 6 个生命周期方法 |
| `lifecycle-window-global` | game-lifecycle ✋ | error | MUST 挂载 GameApp 实例到 `window.__GAME__` |
| `lifecycle-script-tag` | game-lifecycle ✋ | error | index.html MUST 包含 `<script>` 标签 |
| `metadata-exists` | game-asset ✋ | error | MUST 存在 `metadata.json` |
| `metadata-schema` | game-asset ✋ | error | metadata.json MUST 包含必填字段且类型正确 |
| `manifest-exists` | game-asset ✋ | error | MUST 存在 `assets/manifest.json` |
| `manifest-schema` | game-asset ✋ | error | manifest.json MUST 是合法 JSON 且包含 resources 数组 |
| `resource-relative-path` | game-asset ✋ | error | 资源路径 MUST 使用相对路径 |
| `js-document-write` | js-security-ext ✋ | error | MUST NOT 使用 `document.write()` |
| `js-dynamic-script` | js-security-ext ✋ | error | MUST NOT 动态创建远程 `<script>` |
