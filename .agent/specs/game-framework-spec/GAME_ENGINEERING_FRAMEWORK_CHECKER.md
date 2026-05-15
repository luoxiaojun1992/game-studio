# 游戏工程规范检查器与验收门禁（Game Engineering Framework Checker & Acceptance Gate）

## 目标
- 基于工程规范对游戏成品进行静态校验。
- 按 `game_type` 选择规则集并输出可追溯的 `ruleId` 结果。
- 本文档包含静态校验规则及配套的工程验收门禁要求。

## 输入
- 提交产物目录或 ZIP。
- `index.html`、`metadata.json`、`assets/manifest.json`（如适用）。

## 规则来源
- 公共规范：`GAME_ENGINEERING_COMMON.md`
- 类型规范：`H5_GAME_ENGINEERING_FRAMEWORK.md` 等

## 执行流程
1. 读取 `metadata.json` 并解析 `game_type`。
2. 加载公共规则与对应类型规则。
3. 运行通用检查器：`html-structure`、`game-asset`（元信息）。
4. 运行类型检查器：例如 `h5` 的 `game-lifecycle`、`manifest-exists`、`manifest-schema`、`resource-relative-path`。
5. 汇总结果并返回 `ruleId` / `level` / `message`。

## 规则选择逻辑

| Checker | 条件 | 说明 |
|---------|------|------|
| html-structure | 始终运行 | 公共规则 |
| metadata-exists | 始终运行 | 公共规则 |
| metadata-schema | 始终运行 | 公共规则 |
| game-lifecycle | `gameType === "h5"` | H5 特有 |
| manifest-exists | `gameType === "h5"` | H5 特有 |
| manifest-schema | `gameType === "h5"` | H5 特有 |
| resource-relative-path | `gameType === "h5"` | H5 特有 |

## 新增游戏类型步骤
1. 在公共规范中注册新的 `game_type` 值。
2. 新增对应的 `<GAMETYPE>_GAME_ENGINEERING_FRAMEWORK.md`，放入 `.agent/specs/game-framework-spec/` 目录。
3. 在检查器规则选择逻辑中注册新的类型规则。

## UI Test 验收规则

- UI test 为静态校验通过后的补充验收步骤，指 `tests/ui` 下的 Playwright E2E 用例，提交代码前必须全部通过。
- 如遇网络或依赖问题，优先修复环境或使用 mock/stub。
- 允许的临时改动仅限本地绕过网络/依赖（如替换本地地址或临时 mock）。
- 提交前必须全部回退。
- 禁止提交任何绕过依赖的变更或功能逻辑改动。
