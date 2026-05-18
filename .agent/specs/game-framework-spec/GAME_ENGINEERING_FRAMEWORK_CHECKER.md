# 游戏工程规范检查器（Game Engineering Framework Checker）

## 目标
- 基于工程规范对游戏成品进行静态校验。
- 按 `game_type` 选择规则集并输出可追溯的 `ruleId` 结果。
- 本文档包含静态校验规则及 checker 功能验收规范。

## 输入
- 提交产物目录或 ZIP。
- `index.html`、`metadata.json`、`assets/manifest.json`（如适用）。

## 规则来源
- 公共规范：`GAME_ENGINEERING_COMMON.md`
- 类型规范：`H5_GAME_ENGINEERING_FRAMEWORK.md` 等

## 执行流程
1. 读取 `metadata.json` 并解析 `game_type`。
2. 加载公共规则与对应类型规则。
3. 运行通用检查器：`html-structure`、`game-asset`（元信息：`asset-metadata-exists`、`asset-metadata-schema`）。
4. 运行类型检查器：例如 `h5` 的 `game-lifecycle`、`manifest-exists`、`manifest-schema`、`resource-relative-path`。
5. 汇总结果并返回 `ruleId` / `level` / `message`。

## 规则选择逻辑

| Checker | 条件 | 说明 |
|---------|------|------|
| html-structure | 始终运行 | 公共规则 |
| asset-metadata-exists | 始终运行 | 公共规则 |
| asset-metadata-schema | 始终运行 | 公共规则 |
| game-lifecycle | `game_type === "h5"` | H5 特有 |
| manifest-exists | `game_type === "h5"` | H5 特有 |
| manifest-schema | `game_type === "h5"` | H5 特有 |
| resource-relative-path | `game_type === "h5"` | H5 特有 |

## Checker 接口定义

每个 checker 须实现以下接口：

```typescript
interface CheckerResult {
  ruleId: string;           // 全局唯一规则 ID，如 "html-doctype"
  level: 'error' | 'warning' | 'info';
  message: string;          // 人类可读的错误/提示消息
  line?: number;            // 可选行号（1-based），对应 HTML 或 JSON 文件
}

interface GameChecker {
  // checker 名称，用于注册和日志标识
  name: string;
  // 检查提交产物目录，返回规则检查结果列表
  check(submitDir: string, metadata: { game_type: string }): CheckerResult[];
}
```

### 运行时约定
- 所有 checker 的 `check` 方法按执行流程中的顺序依次调用。
- 单个 checker **不应因某条规则失败而提前返回**，须尽可能上报所有违反的规则。
- checker 之间**互不影响**：一个 checker 的 crash 不应阻断后续 checker 执行（由调用方捕获异常并记录 error 级别的 CheckerResult）。
- `submitDir` 保证是已解压到磁盘的目录路径。

## 新增游戏类型步骤
1. 在公共规范中注册新的 `game_type` 值。
2. 新增对应的 `<GAMETYPE>_GAME_ENGINEERING_FRAMEWORK.md`，放入 `.agent/specs/game-framework-spec/` 目录。
3. 在检查器规则选择逻辑中注册新的类型规则。

## UI Test 验收规则（checker 功能验收）

提交代码前必须跑通ui test。
如遇网络或依赖问题，可临时修改代码解决网络问题，但禁止提交为了解决网络依赖问题所做的变更。
