# 游戏工程规范检查器（Game Engineering Framework Checker）

## 目标
- 基于工程规范对游戏成品进行静态校验。
- 按 `game_type` 选择规则集并输出可追溯的 `ruleId` 结果。

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

- 提交代码前必须跑通 UI test。
- 如遇网络或依赖问题，可临时修改代码以完成测试，但禁止提交这些临时变更。
