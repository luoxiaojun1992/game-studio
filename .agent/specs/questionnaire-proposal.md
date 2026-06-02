# 基于问卷的游戏策划案提交功能规范

> **SPEC-007** | 状态：设计中

## 目标

为 `game_design` 类型提案引入**纯人工**的结构化问卷提交方式，降低非技术用户参与门槛，确保策划案覆盖核心维度（核心玩法、目标受众、技术需求等）。

**Agent 不感知此功能**——game_designer Agent 继续通过现有 `submit_proposal` 自由撰写策划案。问卷仅面向前端人工用户。

核心原则：**问卷负责结构化输入，渲染引擎负责按固定规则输出标准化 Markdown，最终直接调用 `db.createProposal` 保存，不额外存储原始问卷数据**。

## 架构概述

```
前端表单填写 → 问卷字段 (JSON)
                     │
                     ↓
            renderQuestionnaireToMarkdown()
                     │
                     ↓
            sanitizeHtml() 清洗
                     │
                     ↓
            db.createProposal({ source: 'questionnaire', title, content, ... })
                     │
                     ↓
            SSE broadcast 'proposal_created'
```

问卷提交后与普通提案**完全等价**，仅在 `source` 字段上区分来源。不保存原始问卷答案，不引入额外数据表。

### 与现有提案系统的对照

| 维度 | 现有自由文本提案 | 问卷式提案 |
|------|-----------------|-----------|
| 入口 | `submit_proposal` 工具 / `POST /api/proposals` | 前端表单 → `POST /api/proposals/questionnaire` |
| 使用者 | Agent 自由撰写 / 人工通过 API 提交 | **仅人工**（前端表单） |
| 内容来源 | Markdown/HTML（自由撰写） | 结构化问卷答案经渲染引擎生成 |
| 必填校验 | title + content 非空 | 问卷字段分级校验（核心必填 + 扩展可选） |
| 数据库标记 | 无来源标记 | `proposals.source` = `'questionnaire'` |
| 原始答案 | 不可追溯 | **不保存**，提交后即与普通提案等价 |
| 前端展示 | ProposalDetail 直接渲染 content | 完全一致（仅列表中多一个来源标签） |
| 审批流程 | CEO 评审 → 用户决策 | 完全一致 |

## 问卷字段设计

### 游戏策划标准问卷（初版）

| 字段名 | 类型 | 必填 | 长度限制 | 说明 |
|--------|------|------|---------|------|
| `game_name` | string | ✅ | 1-50 | 游戏名称，规则同 `game_name` 校验（字母/数字/中文/下划线/连字符） |
| `game_type` | enum | ❌ | — | 游戏工程类型（对应 `game_engineering_specs` 表中已注册的 `game_type`，如 `h5`），通过 `get_game_types` 工具获取可选值；传入时校验合法性，不传则跳过 |
| `game_genre` | enum | ✅ | — | 游戏类型：`action` / `puzzle` / `rpg` / `strategy` / `casual` / `simulation` / `sports` / `other` |
| `one_liner` | string | ✅ | 1-200 | 一句话描述游戏核心体验（elevator pitch） |
| `core_mechanic` | string | ✅ | 50-2000 | 核心玩法机制：玩家做什么、怎么做、有什么反馈循环 |
| `target_audience` | string | ✅ | 1-500 | 目标用户群体：年龄层、玩家画像、核心诉求 |
| `game_objectives` | string | ✅ | 50-2000 | 游戏目标与胜利条件：如何算赢/输、进度系统 |
| `level_design` | string | ❌ | 0-2000 | 关卡/内容设计规划：关卡数量、难度曲线、内容类型 |
| `ui_ux_notes` | string | ❌ | 0-2000 | UI/UX 设计要点：关键界面、交互方式、视觉风格 |
| `tech_requirements` | string | ❌ | 0-2000 | 技术需求清单：引擎、平台、特殊技术（如物理引擎、网络同步） |
| `estimated_duration` | string | ❌ | 0-100 | 预期开发周期，如 `"2-3周"`、`"1个月"` |
| `reference_games` | string | ❌ | 0-500 | 参考竞品：列举 1-3 个类似游戏及差异化点 |
| `monetization_hint` | string | ❌ | 0-500 | 商业化方向提示：免费/付费/F2P/广告等初步想法 |

### 问卷校验规则

| 字段 | 规则 |
|------|------|
| `game_name` | 复用 `normalizeAndValidateGameName`，1-50 字符 |
| `game_type` | 可选；传入时从 `game_engineering_specs` 表校验是否已注册（动态 `z.enum()`），不传时跳过；传入未注册值 → 400 |
| `one_liner` | 单行文本，不允许换行，1-200 字符 |
| `core_mechanic` / `game_objectives` | 最少 50 字符（防止敷衍），最多 2000 字符 |
| `game_genre` | Literal enum，不支持多选（聚焦核心类型） |
| 全部文本字段 | 统一经过 `normalizeAndValidateRequiredText` / `normalizeOptionalText` 处理 |

## 渲染引擎

### `server/utils/questionnaire-renderer.ts`

输入问卷字段对象，输出标准化 Markdown 字符串。

```typescript
interface QuestionnaireInput {
  game_name: string;
  game_type?: string; // 可选，已注册的游戏工程类型，如 'h5'；值来自 game_engineering_specs 表
  game_genre: 'action' | 'puzzle' | 'rpg' | 'strategy' | 'casual' | 'simulation' | 'sports' | 'other';
  one_liner: string;
  core_mechanic: string;
  target_audience: string;
  game_objectives: string;
  level_design?: string;
  ui_ux_notes?: string;
  tech_requirements?: string;
  estimated_duration?: string;
  reference_games?: string;
  monetization_hint?: string;
}

export function renderQuestionnaireToMarkdown(input: QuestionnaireInput): string;
```

渲染模板（固定规则）：

```markdown
# {game_name}

> {one_liner}

## 1. 游戏工程类型
{game_type || "（待补充）"}

## 2. 游戏类型
{game_genre_label}

## 3. 核心玩法
{core_mechanic}

## 4. 目标受众
{target_audience}

## 5. 游戏目标与胜利条件
{game_objectives}

## 6. 关卡/内容设计
{level_design || "（待补充）"}

## 7. UI/UX 设计要点
{ui_ux_notes || "（待补充）"}

## 8. 技术需求
{tech_requirements || "（待补充）"}

## 9. 预期开发周期
{estimated_duration || "（待补充）"}

## 10. 参考竞品
{reference_games || "（无）"}

## 11. 商业化方向
{monetization_hint || "（待补充）"}
```

> 渲染后的 Markdown 经 `sanitizeHtml` 清洗后作为 `proposals.content` 入库。`game_name` 作为 `proposals.title` 入库。

## 数据模型

### `proposals` 表（唯一变更）

```sql
-- 新增 source 字段，标记提案来源
ALTER TABLE proposals ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
-- source 可选值：'manual'（自由文本，含 Agent 撰写） / 'questionnaire'（问卷生成）

CREATE INDEX IF NOT EXISTS idx_proposals_source ON proposals(source);
```

> 默认 `'manual'` 兼容现有数据，无需迁移。现有记录自动视为自由文本提案。
> **不新增任何其他数据表**，问卷原始答案不持久化。

## API 设计

### `GET /api/game-types`

前端问卷表单初始化时调用，获取当前系统已注册的游戏工程类型，用于渲染 `game_type` 下拉框。

**参数**：无

**响应**：

```json
{
  "game_types": [
    { "type": "h5", "description": "H5 小游戏（浏览器运行）" }
  ]
}
```

**实现**：直接复用 `db.getGameTypes()`，与 `get_game_types` MCP 工具共享同一数据源。DB 无数据时返回空数组。

---

### `POST /api/proposals/questionnaire`

用户从前端问卷表单直接提交的 REST 入口。

**请求体**：

```json
{
  "project_id": "my-project",
  "author_agent_id": "game_designer",
  "game_name": "星际农场",
  "game_type": "h5",
  "game_genre": "simulation",
  "one_liner": "在太空站经营生态农场，培育外星作物并抵御陨石威胁",
  "core_mechanic": "玩家通过种植不同外星作物获取资源...",
  "target_audience": "18-35岁休闲玩家，喜欢模拟经营和轻策略元素",
  "game_objectives": "在限定周期内将农场规模扩大到指定等级...",
  "level_design": "共5个星球场景，每个星球有独特气候和作物...",
  "ui_ux_notes": "采用科幻极简风格，主界面为太空站剖面图...",
  "tech_requirements": "HTML5 Canvas 2D，无需外部引擎，本地存储进度",
  "estimated_duration": "2-3周",
  "reference_games": "《星露谷物语》——简化其复杂度，加入科幻元素",
  "monetization_hint": "免费游玩，内购皮肤与星球扩展包"
}
```

**响应**：

```json
{
  "proposal": { /* 完整 Proposal 对象，source='questionnaire' */ }
}
```

> `proposal` 对象直接来自 `db.createProposal` 的返回值（数据库记录），不含文件路径。问卷内容已渲染为 Markdown 存入 `proposals.content` 字段，不以文件形式保存。

**校验规则**：
- `project_id` / `author_agent_id` / `game_name` / `game_genre` / `one_liner` / `core_mechanic` / `target_audience` / `game_objectives` 必填
- 其余字段可选
- 复用 db.ts 中现有 normalize + 校验逻辑
- content 渲染后走 `sanitizeHtml` 清洗

**执行流程**：

```
1. 校验必填字段 + normalize
2. 可选字段 game_type 如传入，校验是否已在 game_engineering_specs 表中注册（动态枚举，不通过 → 400）
3. 组装 QuestionnaireInput 对象
4. renderQuestionnaireToMarkdown(input) → Markdown content
5. sanitizeHtml(content) → safeContent
6. db.createProposal({
     source: 'questionnaire',
     type: 'game_design',
     title: game_name,
     content: safeContent,
     author_agent_id,
     project_id,
     ...
   })
7. SSE broadcast 'proposal_created'
8. 返回提案对象
```

> 步骤 5 与现有 `POST /api/proposals` 复用同一 `db.createProposal`，仅多一个 `source` 字段。

## 前端组件规划

### 新增组件

| 组件 | 路径 | 说明 |
|------|------|------|
| `QuestionnaireForm` | `src/components/QuestionnaireForm.tsx` | 问卷填写表单，含全部 13 个字段，分"核心信息"和"扩展信息"两组 |
| `QuestionnairePreview` | `src/components/QuestionnairePreview.tsx` | 填写完成后预览渲染出的 Markdown 效果（复用 ProposalDetail 的渲染逻辑或简单 markdown-it） |

### 下拉框字段

| 字段 | 下拉数据来源 | 获取时机 | 说明 |
|------|-------------|---------|------|
| `game_type` | `GET /api/game-types` 返回的 `game_types` 数组 | 组件 `useEffect` 初始化时请求 | 可选字段，动态数据，DB 驱动；请求失败或返回空数组时下拉框为空但不影响提交 |
| `game_genre` | 前端硬编码常量数组 | 无需请求 | 固定 8 个值：`action` / `puzzle` / `rpg` / `strategy` / `casual` / `simulation` / `sports` / `other`；下拉显示中文标签（如 `action → 动作`），提交时发送英文枚举值 |

### ProposalList 调整

- 提案列表中 `source='questionnaire'` 的条目右侧显示 `📝 问卷` 标签，与 Agent 撰写的自由文本提案区分

### ProposalDetail

- **无需调整**。问卷式提案与普通提案存储格式完全一致， ProposalDetail 可直接渲染其 `content`。
- 不展示原始问卷数据（因为不保存）。

### StudioPage 提案面板调整

- 在"策划案"标签页新增 `📝 新建问卷提案` 按钮，打开 QuestionnaireForm 弹窗/侧边栏
- 现有通过指令触发 game_designer Agent 的方式保持不变

## 集成要点

### DB 层扩展（`server/db.ts`）

```typescript
// 新增常量
export const PROPOSAL_SOURCES = ['manual', 'questionnaire'] as const;

// DbProposal 类型更新
export interface DbProposal {
  id: string;
  project_id: string;
  type: 'game_design' | 'biz_design' | 'tech_arch' | 'tech_impl' | 'ceo_review';
  title: string;
  content: string;
  author_agent_id: string;
  status: 'pending_review' | 'under_review' | 'approved' | 'rejected' | 'revision_needed' | 'user_approved' | 'user_rejected';
  reviewer_agent_id: string | null;
  review_comment: string | null;
  user_decision: string | null;
  user_comment: string | null;
  version: number;
  parent_id: string | null;
  source: 'manual' | 'questionnaire';  // ← 新增
  created_at: string;
  updated_at: string;
}
```

### `proposals` 表 `source` 字段兼容

- DDL 新增 `source TEXT NOT NULL DEFAULT 'manual'`
- 现有查询（`getAllProposals`, `getProposal` 等）无需修改，`source` 默认参与查询/返回
- `DbProposal` 类型同步添加 `source`

### 与 `submit_proposal` 的关系

| 场景 | 行为 |
|------|------|
| Agent 自由撰写 | 走 `submit_proposal`，`source='manual'` |
| 用户前端表单提交 | 走 `POST /api/proposals/questionnaire`，`source='questionnaire'` |

### 审批与交接

- 问卷式提案的审批流程与自由文本提案**完全一致**
- `proposal_decided` / `proposal_reviewed` SSE 事件格式不变
- 交接机制不变：game_designer → CEO → architect → engineer

### 提示词——不修改

**Agent 不感知问卷功能**。`server/agents.ts` 中 game_designer 的提示词保持不变，继续使用 `submit_proposal` 自由撰写策划案。`TOOLS_OVERVIEW` 无需更新。

## 相关文件

| 文件 | 角色 |
|------|------|
| `server/utils/questionnaire-renderer.ts` | 问卷字段 → Markdown 渲染引擎 |
| `server/db.ts` | `source` 字段 + `PROPOSAL_SOURCES` 常量 + `DbProposal` 类型更新 |
| `server/db.d.ts` | 类型声明更新 |
| `server/index.ts` | `GET /api/game-types` + `POST /api/proposals/questionnaire` |
| `src/types.ts` | `Proposal.source` 类型 |
| `src/config.ts` | 新增 `getGameTypes` + `submitQuestionnaireProposal` API 封装 |
| `src/components/QuestionnaireForm.tsx` | 问卷填写表单 |
| `src/components/QuestionnairePreview.tsx` | 渲染预览组件 |
| `src/components/ProposalList.tsx` | 列表来源标签 |
| `src/pages/StudioPage.tsx` | 新建问卷提案按钮 |

## 测试策略

1. **单元测试**：`questionnaire-renderer.ts` 的渲染输出校验（字段缺失时的兜底文案、Markdown 格式正确性）
2. **API 测试**：
   - `POST /api/proposals/questionnaire` 必填字段缺失 → 400
   - `POST /api/proposals/questionnaire` `game_type` 传入未注册值 → 400（不传则跳过）
   - `POST /api/proposals/questionnaire` 完整字段 → 200 并正确创建 proposal 记录，`source='questionnaire'`
   - 创建的 proposal 与通过 `POST /api/proposals` 创建的格式完全一致（除 source 外）
3. **DB 兼容测试**：现有 `submit_proposal` 调用后 `source` 默认为 `'manual'`，不影响现有流程
4. **前端测试**：问卷表单校验、分步填写、预览渲染、来源标签显示
5. **UI-010（E2E）**：打开问卷表单 → 填写核心必填字段（game_name/genre/one_liner/core_mechanic/target_audience/game_objectives）→ 下一步 → 填写扩展字段 → 提交 → 弹窗关闭 + 列表数量增加 + 标题可见 + 紫色"问卷"来源标签可见
   - data-testid 链路：`create-questionnaire-proposal-btn` → `q-game-name` → `q-game-genre` → `q-one-liner` → `q-core-mechanic` → `q-target-audience` → `q-game-objectives` → `q-next-step` → `q-level-design` → `q-tech-req` → `q-duration` → `q-submit`
   - debug 日志覆盖：后端路由（`[DEBUG:questionnaire]` step1~step7）、前端组件（`[DEBUG:QuestionnaireForm]`）、SSE 事件（`[DEBUG:SSE] proposal_created`）、E2E 测试（`[UI-010]` step1~step8）

## UI Test 验收规则

提交代码前必须跑通 ui test。
如遇网络或依赖问题，可临时修改代码解决网络问题，但禁止提交为了解决网络依赖问题所做的变更。

## 注意事项

- **不保存原始问卷**：问卷字段仅在提交瞬间用于渲染 Markdown，提交后即丢弃。如需回显编辑，v2 可重新设计。
- **game_type 动态枚举**：`game_type` 的合法值由 `game_engineering_specs` 表驱动，前端通过 `GET /api/game-types` 获取可选值渲染下拉框，禁止硬编码。
- **genre 扩展**：`game_genre` enum 初版硬编码 8 个类型，后续可通过配置文件或数据表扩展，避免频繁改代码。
- **多语言**：问卷字段标签和渲染模板需支持 i18n，初版仅支持中文，英文模板后续补充。
- **XSS 安全**：渲染后的 Markdown 与 `submit_proposal` 走同一套 `sanitizeHtml` 流程，不引入新的安全面。
- **Agent 无感知**：game_designer Agent 的提示词、工具列表、审批逻辑均不因此功能产生任何变化。
