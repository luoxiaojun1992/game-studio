# Lint Framework — 可扩展静态检查架构

## 设计目标

在 `submit_game` tool 层提供**可插拔的静态检查网关**，拦截不合规的游戏提交。
- **可扩展**：新增检查器只需实现接口 + 一行注册，框架核心和 tools.ts 零改动
- **两级阻断**：error 级别阻止提交，warn 级别仅记录日志
- **核心规则轻依赖**：仅集成 SonarQube 作为外部质量扫描检查器；旧 HTML 模式本地检查器已全部移除

## 架构

```
server/lint/
├── types.ts              ← 核心类型定义
├── index.ts              ← lintGameArtifact() ZIP 入口
└── checkers/
    ├── index.ts          ← 检查器注册表（仅剩 sonarqube）
    └── sonarqube.ts      ← SonarQube 代码质量检查器（仅 ZIP 模式）
```

### 调用链路

```
submit_game (tools.ts)
  -> validateAgentPermission()
  -> 目录模式: 打包 ZIP -> lintGameArtifact(zipBuffer, { projectId })
     -> SonarQube checker: scanner 微服务 -> sonar-scanner CLI -> SonarQube API
  -> passed=true  -> db.createGame() + 上传 MinIO
  -> passed=false -> return { content: error text }  // 不创建 DB 记录
  -> LintResult.extraPayloads 携带 Sonar 报告 -> 上传 MinIO 写入 `sonar_storage_id`
  -> db.createGame() 写入 ZIP 的 file_storage_id 和 Sonar 的 sonar_storage_id
```

### 内置检查器

| 检查器 | 级别 | 覆盖模式 | 说明 |
|:---|:---|:---|:---|
| `sonarqube` | error | ZIP | 通过 scanner 微服务调用 sonar-scanner CLI 对 ZIP 包做质量扫描；质量门未通过则阻断提交 |

> **注意**：旧版 HTML 模式检查器（`html-structure.ts`、`http-method-checker.ts`、`js-security.ts`）已在重构中移除，因 `submit_game` 已不再支持内联 HTML 提交。

## 扩展指南

### 新增检查器步骤

1. 在 `checkers/` 下新建文件，实现 `LintChecker` 接口
2. 在 `checkers/index.ts` 的 `builtInCheckers` 数组中注册
3. 检查器可返回 error（阻断）或 warn（仅日志）

```typescript
import type { LintChecker } from '../types.js';

const myChecker: LintChecker = {
  name: 'my-checker',
  description: '自定义检查规则',
  supportedModes: ['zip'],
  async check(context) {
    const issues: LintIssue[] = [];
    // 检查逻辑...
    return issues;
  }
};
```

## 注意事项

- **仅 ZIP 模式**：所有路径校验、扫描均基于 ZIP Buffer 操作，不再支持未打包的内联 HTML 内容
- **SonarQube 扫描**：通过独立 scanner 微服务执行（`sonar-scanner-service.ts`），backend 通过 HTTP API 调用，非进程内调用
- **重复扫描防护**：`scannedProjects` 内存 Set 防止同一 ZIP 被重复扫描；进程重启或 `resetSonarScanHistory()` 会清空
- **扫描结果复用**：Sonar 报告通过 `LintResult.extraPayloads` 返回，由 `submit_game` 上传 MinIO 并写入 `games.sonar_storage_id`
