# Lint Framework — 可扩展静态检查架构

## 设计目标

在 `submit_game` tool 层提供**可插拔的静态检查网关**，拦截不合规的游戏提交。
- **可扩展**：新增检查器只需实现接口 + 一行注册，框架核心和 tools.ts 零改动
- **两级阻断**：error 级别阻止提交，warn 级别仅记录日志
- **核心规则**：集成 SonarQube 外部质量扫描 + GameEngineeringChecker 本地工程规范检查

## 架构

```
server/lint/
├── types.ts              ← 核心类型定义（含 submitDir 字段）
├── index.ts              ← lintGameArtifact() ZIP/目录双模入口
└── checkers/
    ├── index.ts          ← 检查器注册表（sonarqube + game-engineering）
    ├── sonar/
    │   ├── sonarqube.ts  ← SonarQube 代码质量检查器（仅 ZIP 模式）
    │   ├── sonarqube-client.ts
    │   └── sonarqube-token.ts
    └── game-engineering/  ← 游戏工程规范检查器
        ├── index.ts      ← 主 checker，LintChecker 接口实现
        └── rules/
            ├── types.ts  ← GameRule / CheckerResult 类型定义
            ├── common/   ← 8 条通用规则：html-* (6) + asset-metadata-* (2)
            │   ├── utils.ts
            │   ├── html-doctype.ts
            │   ├── html-root.ts
            │   ├── html-head.ts
            │   ├── html-body.ts
            │   ├── html-charset.ts
            │   ├── html-body-not-empty.ts
            │   ├── asset-metadata-exists.ts
            │   └── asset-metadata-schema.ts
            └── h5/       ← 6 条 H5 特有规则：lifecycle-* (3) + asset-* (3)
            └── phaser-mobile/  ← 6 条 Phaser Mobile 特有规则：lifecycle-phaser-* (4) + asset-* (2)
                ├── lifecycle-exports.ts
                ├── lifecycle-window-global.ts
                ├── lifecycle-script-tag.ts
                ├── asset-manifest-exists.ts
                ├── asset-manifest-schema.ts
                └── asset-resource-relative-path.ts
```

### 调用链路

```
submit_game (tools.ts)
  -> validateAgentPermission()
  -> 目录模式: 读取 games/latest/ -> 打包 ZIP -> lintGameArtifact(zipBuffer, { submitDir, projectId })
     -> SonarQube checker: 从 submitDir 自行打包 ZIP -> scanner 微服务 -> sonar-scanner CLI -> SonarQube API
     -> GameEngineeringChecker: 读取 submitDir/dist/* 文件 -> 20 条规则 -> LintIssue[]
  -> passed=true  -> db.createGame() + 上传 MinIO
  -> passed=false -> return { content: error text }  // 不创建 DB 记录
  -> LintResult.extraPayloads 携带 Sonar 报告 -> 上传 MinIO 写入 `sonar_storage_id`
  -> db.createGame() 写入 ZIP 的 file_storage_id 和 Sonar 的 sonar_storage_id
```

### 内置检查器

| 检查器 | 级别 | 覆盖模式 | 说明 |
|:---|:---|:---|:---|
| `sonarqube` | error | ZIP | 通过 scanner 微服务调用 sonar-scanner CLI 对 ZIP 包做质量扫描；质量门未通过则阻断提交 |
| `game-engineering` | error | 目录 | 直接读取 `submitDir/dist/*` 文件，按 `game_type` 选择规则集（8 公共 + 6 H5 + 6 phaser-mobile），验证 HTML 结构、元信息、生命周期契约等工程规范 |

## GameEngineeringChecker 架构

- **规则自动分类**：`common/` 目录下规则适用于所有 game_type；`h5/` 目录下规则仅对 `game_type === "h5"` 生效；`phaser-mobile/` 目录下规则仅对 `game_type === "phaser-mobile"` 生效
- **产物目录约定**：所有游戏类型使用 `submitDir/dist/` 为提交前缀：
  - HTML 规则读取 `submitDir/dist/index.html`
  - 元信息规则读取 `submitDir/dist/metadata.json`
  - H5 manifest 规则读取 `submitDir/dist/assets/manifest.json`
- **game_type 读取**：从 `submitDir/dist/metadata.json` 的 `game_type` 字段获取
- **20 条规则**（18 error + 2 warning）：

| ruleId | 组 | 适用范围 | 描述 |
|--------|-----|---------|------|
| `html-doctype` | html | 全部 | MUST 包含 `<!DOCTYPE html>` |
| `html-root` | html | 全部 | MUST 包含 `<html>` 根标签 |
| `html-head` | html | 全部 | MUST 包含 `<head>` 标签 |
| `html-body` | html | 全部 | MUST 包含 `<body>` 标签 |
| `html-charset` | html | 全部 | `<head>` 中 MUST 包含 `<meta charset="utf-8">` |
| `html-body-not-empty` | html | 全部 | `<body>` MUST 有可见内容 |
| `asset-metadata-exists` | asset | 全部 | MUST 存在 `metadata.json` |
| `asset-metadata-schema` | asset | 全部 | metadata.json MUST 完整且 game_type 已注册 |
| `lifecycle-exports` | lifecycle | H5 | MUST 实现 GameApp 全部 6 个生命周期方法 |
| `lifecycle-window-global` | lifecycle | H5 | MUST 挂载 GameApp 实例到 `window.__GAME__` |
| `lifecycle-script-tag` | lifecycle | H5 | index.html MUST 包含 `<script>` 标签 |
| `asset-manifest-exists` | asset | H5 | MUST 存在 `assets/manifest.json` |
| `asset-manifest-schema` | asset | H5 | manifest.json MUST 合法且含 resources |
| `asset-resource-relative-path` | asset | H5 | 资源路径 MUST 使用相对路径 |
| `lifecycle-phaser-game` | lifecycle | Phaser Mobile | MUST 创建 `new Phaser.Game()` 实例 |
| `lifecycle-phaser-scene-preload` | lifecycle | Phaser Mobile | MUST 定义 `preload()` 方法 |
| `lifecycle-phaser-scene-create` | lifecycle | Phaser Mobile | MUST 定义 `create()` 方法 |
| `lifecycle-phaser-script-tag` | lifecycle | Phaser Mobile | index.html MUST 加载 `<script>` |
| `asset-resource-relative-path` | asset | Phaser Mobile | 资源路径 MUST 使用相对路径 |
| `asset-capacitor-config` | asset | Phaser Mobile | SHOULD 包含 capacitor.config（warning） |

## 扩展指南

### 新增检查器步骤

1. 在 `checkers/` 下新建文件，实现 `LintChecker` 接口
2. 在 `checkers/index.ts` 的 `builtInCheckers` 数组中注册
3. 检查器可返回 error（阻断）或 warn（仅日志）

示例：
```typescript
import type { LintChecker, LintIssue, LintContext } from '../types.js';

const myChecker: LintChecker = {
  id: 'my-checker',
  name: '我的检查器',
  description: '自定义检查规则',
  check(context: LintContext): LintIssue[] | Promise<LintIssue[]> {
    // 使用 context.submitDir 读取游戏目录文件
    return [];
  }
};
```

### 新增游戏工程规范规则步骤

1. 在 `rules/common/`（通用）或 `rules/{game_type}/`（类型特有）下新建 `.ts` 文件
2. 实现 `GameRule` 接口：`ruleId`、`level`、`appliesTo()`、`check(submitDir)`
3. 在 `game-engineering/index.ts` 的 `_initRules()` 中静态 import 并注册

## 注意事项

- **统一目录模式**：LintContext 以 `submitDir` 为唯一输入，checker 自行决定处理方式（读文件、打包 ZIP 等），不再传递 zipBuffer
- **SonarQube 扫描**：从 `submitDir` 自行打包 ZIP 后通过 scanner 微服务执行（`sonar-scanner-service.ts`），backend 通过 HTTP API 调用，非进程内调用
- **重复扫描防护**：`scannedProjects` 内存 Set 防止同一 ZIP 被重复扫描；进程重启或 `resetSonarScanHistory()` 会清空
- **扫描结果复用**：Sonar 报告通过 `LintResult.extraPayloads` 返回，由 `submit_game` 上传 MinIO 并写入 `games.sonar_storage_id`
