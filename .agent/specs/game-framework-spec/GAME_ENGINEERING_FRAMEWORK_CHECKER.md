# 游戏工程规范检查器（Game Engineering Framework Checker）

## 目标
- 作为 Lint 系统下的**一个统一检查器（checker）**，对游戏成品进行工程规范静态校验。
- 内部注册多条规则（rule），按 `game_type` 自动选择适用的规则集并输出可追溯的 `ruleId` 结果。

## 架构概述

```
Lint Runner
  └── game-engineering-checker（单一 checker，接受游戏目录）
        ├── 自动读取 submitDir/metadata.json → 获取 game_type
        ├── 加载通用规则（所有 game_type 均运行）
        ├── 加载类型特定规则（仅当 game_type 匹配时运行）
        └── 依次运行每条规则，汇总结果
```

- Checker 本身**不按游戏类型或框架拆分**，所有游戏类型共用同一个 checker。
- 规则（rule）是粒度单位，**事先开发好、注册在 checker 内部**。
- 游戏类型通过**游戏目录内的 `metadata.json` 自动读取**；读取失败或无法获取 `game_type` → 整次 lint check 视为失败。

## 输入
- 提交产物目录（`submitDir`），保证已解压到磁盘。

## 执行流程
1. 读取 `submitDir/metadata.json`。
   - 文件不存在 → **lint 失败**，返回 `asset-metadata-exists` 规则级别的 fatal error。
   - 文件存在但无法解析或缺少 `game_type` → **lint 失败**，返回 fatal error。
2. 加载 checker 中已注册的**所有规则**。
   - 通用/公共规则：`appliesTo(gameType)` 始终返回 `true`。
   - 类型特定规则：`appliesTo(gameType)` 仅对特定 `game_type` 返回 `true`。
3. 依次运行每条规则的 `check(submitDir)` 方法，收集 `CheckerResult[]`。
4. 汇总所有结果返回。

## 规则定义

### CheckerResult 接口

```typescript
interface CheckerResult {
  ruleId: string;           // 全局唯一规则 ID，如 "html-doctype"
  level: 'error' | 'warning' | 'info';
  message: string;          // 人类可读的错误/提示消息
  line?: number;            // 可选行号（1-based），对应 HTML 或 JSON 文件
}
```

### GameRule 接口

```typescript
interface GameRule {
  /** 规则唯一 ID */
  ruleId: string;
  /** 默认 level */
  level: 'error' | 'warning' | 'info';
  /** 判定是否适用于当前游戏类型 */
  appliesTo(gameType: string): boolean;
  /** 执行检查，传入提交产物目录路径 */
  check(submitDir: string): CheckerResult[];
}
```

### 规则生命周期
- 规则在 checker 初始化时注册，运行时不变。
- `appliesTo()` 在 `check()` 前调用：返回 `false` 时跳过该规则。
- `check()` 应**尽可能上报所有违反项**，而非遇到第一个错误就返回。

## 规则注册方式

```typescript
class GameEngineeringChecker {
  private rules: GameRule[] = [];

  /** 注册一条规则 */
  register(rule: GameRule): void { ... }

  /** 执行检查，自动从目录读取 game_type */
  check(submitDir: string): CheckerResult[] {
    const gameType = this.readGameType(submitDir);
    if (!gameType) return this.fatal('无法从提交产物中读取 game_type');

    const results: CheckerResult[] = [];
    for (const rule of this.rules) {
      if (!rule.appliesTo(gameType)) continue;
      try {
        results.push(...rule.check(submitDir));
      } catch (err) {
        results.push({
          ruleId: rule.ruleId,
          level: 'error',
          message: `规则执行异常：${err.message}`,
        });
      }
    }
    return results;
  }

  private readGameType(submitDir: string): string | null {
    // 读取 submitDir/metadata.json, 提取 game_type 字段
  }

  private fatal(msg: string): CheckerResult[] {
    return [{ ruleId: 'checker-fatal', level: 'error', message: msg }];
  }
}
```

## 规则分类

| 规则组（前缀） | 适用范围 | 示例 ruleId |
|---------------|---------|------------|
| `html-` | 通用 | `html-doctype`, `html-root`, `html-head`, `html-body`, `html-charset`, `html-body-not-empty` |
| `asset-` | 通用 | `asset-metadata-exists`, `asset-metadata-schema` |
| `lifecycle-` | H5 特有 | `lifecycle-exports`, `lifecycle-window-global`, `lifecycle-script-tag` |
| `manifest-` | H5 特有 | `manifest-exists`, `manifest-schema` |
| `resource-` | H5 特有 | `resource-relative-path` |

- 规则 `appliesTo()` 返回 `true` 时运行，返回 `false` 时跳过。
- 新增游戏类型时，只需开发对应的规则并注册到 checker，无需新建 checker。
- Checker 和规则共享 `game_type` 的同一个注册数据源。

## 新增游戏类型的步骤
1. 在公共规范中注册新的 `game_type` 值。
2. 新增对应的 `<GAMETYPE>_GAME_ENGINEERING_FRAMEWORK.md`，放入 `.agent/specs/game-framework-spec/` 目录。
3. 开发新规则（实现 `GameRule` 接口），在 checker 初始化时注册。
4. 无需修改 checker 本身的执行逻辑。

## UI Test 验收规则（checker 功能验收）

提交代码前必须跑通 ui test。
如遇网络或依赖问题，可临时修改代码解决网络问题，但禁止提交为了解决网络依赖问题所做的变更。
