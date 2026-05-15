# 游戏工程规范 — 公共部分

通用工程技术规范，适用于所有类型的游戏开发与静态校验。

## 目标
- 为 Engineering Agent 提供**稳定、可验证、可测试**的开发边界。
- 便于系统对产物进行静态检查、自动化测试与验收反馈。
- 按 `game_type` 区分不同游戏类型的工程规范。

## 适用范围
- 所有进入平台工程校验与验收流程（即由系统触发规则检查与验收的提交成品）的游戏成品。
- 按 `metadata.json` 中的 `game_type` 字段选择对应的类型规范。
- 本文档中 **MUST** / **MUST NOT** / **SHOULD** 遵循 RFC 2119 定义。

## 游戏类型定义

`metadata.json` MUST 包含 `game_type` 字段，标识游戏类型：

| game_type | 描述 | 对应规范文档 |
|-----------|------|------------|
| `h5` | H5 小游戏（浏览器运行） | `.agent/specs/game-framework-spec/H5_GAME_ENGINEERING_FRAMEWORK.md` + 公共部分 |
| （后续扩展） | ... | ... |

## 元信息规范（所有游戏类型通用）

`metadata.json` MUST 符合以下结构：

```json
{
  "title": "游戏标题",
  "version": "1.0.0",
  "game_type": "h5",
  "resolution": { "width": 800, "height": 600 },
  "orientation": "landscape",
  "entry": "index.html"
}
```

- `game_type`（MUST）— 字符串，必须是已注册的游戏类型值。lint checker 据此选择适用的规则集。
- `title` / `version` / `resolution` / `orientation` / `entry` — 必填字段定义详见附录 A.2 metadata-schema。

## 公共校验规则

以下规则适用于所有游戏类型，无论 `game_type` 为何值。

| 规则分类 | 说明 |
|---------|------|
| HTML 结构 | DOCTYPE、html/head/body 标签、charset、body 非空 |
| 元信息 | metadata.json 必须存在且字段完整 |

详细规则描述见附录。

## 工程规范检查器

工程规范检查器用于按 `game_type` 选择规则集并执行静态校验，详见 [GAME_ENGINEERING_FRAMEWORK_CHECKER.md](./GAME_ENGINEERING_FRAMEWORK_CHECKER.md)。

---

## 附录 A：公共可验证规则清单

### A.1 HTML 结构检查器（html-structure）

**输入**：`index.html` 文本内容（字符串）。

**通用约定：**
- 所有 checker 按 `\n` 分割计算行号（1-based）。
- 多行匹配使用 `[^]*` 而非 `[\s\S]`。
- 输入为空或仅空白时，跳过所有正则匹配，仅返回一条 `html-empty` error。

#### A.1.1 html-doctype

| 属性 | 值 |
|------|-----|
| ruleId | `html-doctype` |
| level | `error` |
| 描述 | 文件 MUST 包含 `<!DOCTYPE html>` 声明（大小写不敏感） |

**判定逻辑：**
```typescript
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
<html><head>...</head><body>...   <!-- 无 DOCTYPE -->
```
```html
<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN">
<html><body>...   <!-- 非 HTML5 DOCTYPE -->
```

**边界：**
- DOCTYPE 前允许 BOM 或空白。
- DOCTYPE 出现在 `<body>` 后判定为失败。

**错误消息：** `缺少 <!DOCTYPE html> 声明。HTML5 文档必须以 <!DOCTYPE html> 开头。`

---

#### A.1.2 html-root

| 属性 | 值 |
|------|-----|
| ruleId | `html-root` |
| level | `error` |
| 描述 | MUST 包含 `<html>` 根标签 |

**判定逻辑：**
```typescript
const RE_HTML_TAG = /<html[\s>]/i;
const passed = RE_HTML_TAG.test(content);
```

**通过示例：** `<html>`、`<html lang="zh-CN">`

**失败示例：** `<htm>`、纯文本无标签

**错误消息：** `缺少 <html> 根标签。文档根元素应为 <html>。`

---

#### A.1.3 html-head

| 属性 | 值 |
|------|-----|
| ruleId | `html-head` |
| level | `error` |
| 描述 | MUST 包含 `<head>` 标签 |

**判定逻辑：** `/^<head[\s>]/i.test(content)`

**通过/失败示例：** `<head>` 通过；`<header>`、无 head 标签失败。

**错误消息：** `缺少 <head> 标签。文档应包含 head 区域。`

---

#### A.1.4 html-body

| 属性 | 值 |
|------|-----|
| ruleId | `html-body` |
| level | `error` |
| 描述 | MUST 包含 `<body>` 标签 |

**判定逻辑：** `/^<body[\s>]/i.test(content)`

**错误消息：** `缺少 <body> 标签。游戏内容应在 body 中渲染。`

---

#### A.1.5 html-charset

| 属性 | 值 |
|------|-----|
| ruleId | `html-charset` |
| level | `error` |
| 描述 | `<head>` 中 MUST 包含 `<meta charset="utf-8">` |

**判定逻辑：**
```typescript
const RE_CHARSET_META = /<meta\s[^>]*charset=["']?utf-8["']?/i;
const hasHead = /^<head[\s>]/i.test(content);
const passed = !hasHead || RE_CHARSET_META.test(content);
```

**通过示例：** `<meta charset="utf-8">`、`<meta charset=utf-8>`

**失败示例：** `<meta charset="gbk">`、head 中无 meta charset

**错误消息：** `缺少字符编码声明 <meta charset="utf-8">。`

---

#### A.1.6 html-body-not-empty

| 属性 | 值 |
|------|-----|
| ruleId | `html-body-not-empty` |
| level | `error` |
| 描述 | `<body>` MUST 有可见内容 |

**判定逻辑：** 提取 body 内容，去除所有 HTML 标签后检查是否只剩空白。

**通过示例：** `<body><div id="game"></div></body>`

**失败示例：** `<body></body>`、`<body>   </body>`

**边界：** 纯注释 + 空白不视为可见内容。

**错误消息：** `<body> 内容为空或仅含空白与注释。`

---

### A.2 元信息检查器（game-asset）

#### A.2.1 metadata-exists

| 属性 | 值 |
|------|-----|
| ruleId | `metadata-exists` |
| level | `error` |
| 描述 | metadata.json MUST 存在于提交产物根目录 |

**判定逻辑：** `fs.existsSync(path.join(submitDir, 'metadata.json'))`

**错误消息：** `缺少 metadata.json。`

---

#### A.2.2 metadata-schema

| 属性 | 值 |
|------|-----|
| ruleId | `metadata-schema` |
| level | `error` |
| 描述 | metadata.json MUST 是合法 JSON 且包含所有必填字段 |

**必填字段定义：**
```typescript
const requiredFields: Record<string, (v: any) => boolean> = {
  'title': v => typeof v === 'string' && v.length > 0,
  'version': v => typeof v === 'string' && v.length > 0,
  'game_type': v => typeof v === 'string' && v.length > 0 && REGISTERED_TYPES.has(v),
  'resolution': v => typeof v === 'object' && typeof v.width === 'number' && typeof v.height === 'number',
  'orientation': v => ['landscape', 'portrait'].includes(v),
  'entry': v => typeof v === 'string' && v.length > 0,
};
```

**通过示例：**
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

**失败示例：** 缺少 `game_type` 字段、`game_type` 值未注册。

**错误消息：**
- `metadata.json 不是合法 JSON 格式。`
- `metadata.json 缺少必填字段：{fields}。`
- `metadata.json 字段 "{field}" 类型错误。`
- `metadata.json 中 game_type 值 "{value}" 未注册。支持的 game_type：{list}。`

---

## 附录 B：规则总览表

| ruleId | checker | level | 适用范围 | 描述 |
|--------|---------|-------|---------|------|
| `html-doctype` | html-structure | error | 全部 | MUST 包含 `<!DOCTYPE html>` |
| `html-root` | html-structure | error | 全部 | MUST 包含 `<html>` 根标签 |
| `html-head` | html-structure | error | 全部 | MUST 包含 `<head>` 标签 |
| `html-body` | html-structure | error | 全部 | MUST 包含 `<body>` 标签 |
| `html-charset` | html-structure | error | 全部 | `<head>` 中 MUST 包含 `<meta charset="utf-8">` |
| `html-body-not-empty` | html-structure | error | 全部 | `<body>` MUST 有可见内容 |
| `metadata-exists` | game-asset | error | 全部 | MUST 存在 `metadata.json` |
| `metadata-schema` | game-asset | error | 全部 | metadata.json MUST 包含必填字段且 game_type 已注册 |
