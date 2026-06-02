# 提案内容 XSS 安全过滤规范

> **SPEC-001** | 状态：已实现

## 目标
确保所有通过工具/API 提交的提案内容在入库前经过 XSS 过滤，防止恶意 HTML/JavaScript 注入。

## 适用范围
- `submit_proposal` 工具的 `content` 字段
- `POST /api/proposals` API 的 `content` 字段

## 过滤规则

| 类别 | 规则 |
|------|------|
| 允许的标签 | `p`, `br`, `strong`, `em`, `ul`, `ol`, `li`, `code`, `pre`, `a`, `span`, `div` |
| 允许的属性 | `a`: `href`, `title`, `target`, `rel` |
| 允许的协议 | `http`, `https` |
| 禁止的内容 | `<script>` 标签、`on*` 事件属性、`javascript:`/`data:`/`vbscript:`/`file:` 协议 |
| 安全约束 | `target="_blank"` 时必须同时设置 `rel="noopener noreferrer"` |

## 处理流程

```
用户输入(content)
    → validateHtmlSafe()：校验是否含恶意内容
    ├── 有风险 → 返回错误信息拒绝提交（仅工具入口）
    └── 安全 → sanitizeHtml()：清洗后入库
```

### 双入口处理差异

| 入口 | 行为 |
|------|------|
| `submit_proposal` 工具 | `validateHtmlSafe()` 校验 + 拒绝；`sanitizeHtml()` 清洗后入库 |
| `POST /api/proposals` API | 直接 `sanitizeHtml()` 清洗后入库（静默过滤） |

工具入口拒绝高风险内容（如 `<script>`、`onerror`），因为 AI Agent 可以立即调整输出。
API 入口静默过滤以提升前端用户体验。

## 实现

- 工具函数：`server/utils/sanitize-html.ts` 提供 `validateHtmlSafe` 和 `sanitizeHtml`
- 复用关系：`submit_game` 工具已使用同一工具对 `description` 做安全处理，提案 `content` 复用同一逻辑
- 依赖库：`sanitize-html` npm 包

## 相关文件

| 文件 | 角色 |
|------|------|
| `server/utils/sanitize-html.ts` | 提供 `validateHtmlSafe()` 校验 + `sanitizeHtml()` 清洗 |
| `server/tools.ts` | `submit_proposal` 工具入口 |
| `server/index.ts` | `POST /api/proposals` API 入口 |
