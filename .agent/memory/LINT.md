# Lint Framework — 可扩展静态检查架构

## 设计目标

在 `submit_game` tool 层提供**可插拔的静态检查网关**，拦截不合规的游戏提交。
- **可扩展**：新增检查器只需实现接口 + 一行注册，框架核心和 tools.ts 零改动
- **两级阻断**：error 级别阻止提交，warn 级别仅记录日志
- **核心规则轻依赖**：本地规则仍基于正则/字符串分析；另集成 SonarQube 作为外部质量扫描检查器

## 架构

```
server/lint/
├── types.ts              ← 核心类型定义
├── index.ts              ← LintRunner 运行时 + lintGameContent() 便捷入口
└── checkers/
    ├── index.ts          ← 内置检查器注册表
    ├── html-structure.ts ← HTML 结构检查器
    ├── http-method-checker.ts ← HTTP 方法安全检查器
    ├── js-security.ts    ← JS 安全检查器
    └── sonarqube.ts      ← SonarQube 代码质量检查器（支持 HTML/ZIP）
```

### 调用链路

```
submit_game (tools.ts)
  → validateAgentPermission()
  → HTML 模式: lintGameContent(htmlContent, { fileName })
  → ZIP 模式: lintZipBuffer(zipBuffer, { projectId })   ← ZIP 内 HTML 逐一检查，首个 error 立即阻断，并把原始 zipBuffer 注入 context
  │   ├─ passed=true  → 继续执行 db.createGame()
  │   └─ passed=false → return { content: error text }  // 直接返回，不写 DB
  → db.createGame()（ZIP 模式写入 file_storage_id）
  → HTML 模式落盘 output；ZIP 模式上传 MinIO
```

### 核心接口

```typescript
// 每个检查器必须实现的接口
interface LintChecker {
  readonly id: string;           // 唯一标识，如 'html-structure'
  readonly name: string;         // 显示名称
  readonly description: string;  // 功能描述
  check(content: string, context?: LintContext): LintIssue[] | Promise<LintIssue[]>;
}

// issue 结构
interface LintIssue {
  ruleId: string;                // 如 'html-doctype', 'js-eval'
  level: 'error' | 'warn';       // error=阻断, warn=仅记录
  message: string;               // 中文描述
  line?: number;                 // 可选行号
  checkerId: string;             // 来源检查器
}

// 聚合结果
interface LintResult {
  passed: boolean;               // errors.length === 0
  issues: LintIssue[];           // 全部（含 warn）
  errors: LintIssue[];           // 仅 error
  warnings: LintIssue[];         // 仅 warn
  summary: string;               // 人类可读汇总（直接用于错误返回）
}
```

## LintRunner 运行时

| 方法 | 说明 |
|------|------|
| `register(checker)` | 注册单个检查器（重复 ID 抛异常） |
| `registerAll(checkers[])` | 批量注册 |
| `disable(ids[])` | 按 ID 禁用（跳过执行，不删除） |
| `enable(ids[])` | 重新启用 |
| `run(content, context?)` | 执行所有启用中的检查器，聚合结果 |

**容错设计**：单个检查器抛异常时自动降级为 error 级 issue，不会中断其他检查器。

**便捷入口**：
```typescript
import { lintGameContent } from './lint/index.js';
const result = await lintGameContent(htmlContent, { fileName: 'snake.html' });
```

## 内置检查器

### html-structure — HTML 结构检查（6 条，全 error）

| ruleId | 检查项 | 说明 |
|--------|--------|------|
| `html-doctype` | DOCTYPE 声明 | 必须包含 `<!DOCTYPE html>` |
| `html-root` | `<html>` 根标签 | 必须存在 |
| `html-head` | `<head>` 标签 | 必须存在 |
| `html-body` | `<body>` 标签 | 必须存在 |
| `html-charset` | 字符编码 | 必须有 `<meta charset="utf-8">` 或等效声明 |
| `html-body-not-empty` | body 非空 | body 不能为空白 |

### http-method — HTTP 方法安全检查（error）

- 检测 `fetch` 与 `XMLHttpRequest.open` 中声明的方法
- 阻断明显非安全写操作方法（如 `POST`、`PUT`、`DELETE`、`PATCH`）
- 命中后按 error 级 issue 直接阻断 `submit_game`

### js-security — JS 安全检查（4 条，全 warn）

| ruleId | 检查项 | 说明 |
|--------|--------|------|
| `js-eval` | eval() 调用 | 检测 `eval(` 使用 |
| `js-function` | Function() 构造函数 | 检测 `new Function(` / `Function(` |
| `js-js-url` | javascript: 协议 | 检测 `javascript:` URL scheme |
| `js-innerHTML` | innerHTML 写入 | 检测 `.innerHTML =` 赋值（含行号定位） |

### sonarqube — SonarQube 质量扫描（warn/error 混合）

- 通过独立 scanner 微服务（Python/FastAPI）上传 ZIP 并触发 sonar-scanner CLI 分析
- Scanner 微服务自动解压 ZIP、创建 SonarQube 项目、执行扫描、轮询结果
- Backend 通过 `sonar-scanner-service.ts` 提交 ZIP 并轮询状态，扫描完成后从 SonarQube REST API 拉取 issues
- `SonarQubeClient`（`sonarqube-client.ts`）负责查询 issues 和创建项目；`TokenManager`（`sonarqube-token.ts`）动态生成 USER_TOKEN
- ZIP 模式优先复用 `LintContext.zipBuffer`，避免"解压后再打包"的重复开销
- `sonarIssuesCache`（module 级 Map）按 projectKey 缓存 raw issues，供 `lintZipBuffer` → `submit_game` 复用
- 扫描完成后将 `sonar-issues.json` 追加到 ZIP 包并独立上传 MinIO，`games` 表记录 `sonar_storage_id`
- Scanner 服务任何异常（含 auth 失败）均 `throw err`，由 LintRunner 转为 error issue 阻断提交
- 默认连接：`http://localhost:9002`，studio-backend 认证：`SONARQUBE_USER/PASSWORD`；scanner 微服务认证：`SONAR_USER/PASSWORD`

## 扩展指南

新增检查器的标准步骤（以敏感词检测为例）：

```typescript
// 1. 创建 server/lint/checkers/sensitive-words.ts
export const sensitiveWordChecker: LintChecker = {
  id: 'sensitive-words',
  name: '敏感词检测',
  description: '检测游戏内容中的敏感词汇',
  check(content: string, context?: LintContext): LintIssue[] {
    const words = loadSensitiveWords();
    const issues: LintIssue[] = [];
    for (const word of words) {
      if (content.includes(word)) {
        issues.push({ ruleId: 'sensitive-word', level: 'error', message: `发现敏感词: ${word}`, checkerId: 'sensitive-words' });
      }
    }
    return issues;
  },
};

// 2. 在 server/lint/checkers/index.ts 的 builtInCheckers 数组中添加
export const builtInCheckers: LintChecker[] = [
  htmlStructureChecker,
  httpMethodChecker,
  jsSecurityChecker,
  sensitiveWordChecker,     // ← 加这一行
];

// 完成！tools.ts、index.ts、types.ts 不需要任何修改
```

## E2E 兼容性

测试中 Mock Server 返回的 `submit_game` HTML 内容已包含完整 DOCTYPE + html/head/meta charset/body 骨架，不含受阻断的 HTTP 写操作方法，也不含 eval/innerHTML 等危险调用，**可通过现有内置规则**，无需调整测试数据或 mock 配置。

## 工程决策与经验

| 决策 | 原因 |
|------|------|
| 正则而非 DOM/AST 解析 | 保持零依赖；HTML 结构规则只需字符串匹配即可覆盖 |
| error/warn 两级而非三级 | 简化语义：要么阻断要么提示，无"info"噪音 |
| 框架层 catch 单检查器异常 | 一个 checker 崩溃不影响其他 checker 继续运行 |
| context 对象传 fileName/projectId/zipBuffer | 支持按文件/项目策略检查，并允许 SonarQube 在 ZIP 模式复用原始包 |
| LintResult.summary 直接作为 tool 返回文本 | 减少上层格式化逻辑，checker 报错信息直达用户 |
