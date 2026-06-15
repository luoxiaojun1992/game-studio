---
name: docs-maintainer
description: |
  game-dev-studio 项目的文档与架构图维护技能。当需要更新 README/Docker README/架构文档、
  同步中英文版本、绘制或修复 SVG 架构图、修复文字排版/居中对齐时使用。
  触发词：更新文档、同步中英文、架构图、README、Docker文档、文字居中、text centering、排版修复。
agent_created: true
---

# Docs Maintainer

## Overview

维护 game-dev-studio 项目的文档与架构图，确保中英文版本同步、架构图排版正确。

核心能力：
1. **代码浏览研究** — 读取关键代码文件（`server/db.ts`, `server/tools.ts`, `docker-compose.yml` 等）理解当前系统状态
2. **架构图绘制** — SVG 四层架构图（前端 → 后端 → 微服务 → 数据/外部服务），含箭头、配色、布局
3. **文字居中算法** — 考虑字体视觉边界的通用垂直居中脚本
4. **中英文同步翻译** — 不破坏 Markdown 排版结构的前提下翻译文档

## When to Use

- 用户要求更新 README/Docker README/架构文档
- 新建服务/模块后需要同步文档
- 架构图出现排版问题（文字不居中、溢出、箭头混乱）
- 中英文版本文档不一致
- 补充 roadmap、project structure 等内容

## Workflow

### Phase 1: 浏览研究

先理解系统当前状态再动手：

```
1. 读取 .agent/AI_AGENT_COMMON_INSTRUCTIONS.md（项目全貌）
2. 读取 .agent/memory/INDEX.md（关键工程决策）
3. 目标文件（根据任务）:
   - server/db.ts       → 数据库表结构（17 张表）
   - server/tools.ts    → MCP 工具列表
   - docker-compose.yml → 服务架构、端口、依赖
   - docs/ARCHITECTURE.md → 当前架构文档
4. 读取当前 README/Docker README/架构文档的中英文版本
```

### Phase 2: 文档更新

**README 更新要点**：
- roadmap：按 SPEC-XXX 编号顺序排列
- project structure：用 ASCII 树形结构，列出所有关键目录和文件
- 中英文版本内容一一对应，只翻译自然语言部分，不翻译代码/路径/文件名
- 表格列对齐保持一致

**Docker README 更新要点**：
- 架构图：ASCII 服务依赖图
- 访问 URL 表：列出所有服务端口和用途
- Volumes 表：列出所有挂载卷
- 环境变量表：列出所有可配置变量
- 启动/停止步骤

**架构文档更新要点**：
- 保持 Mermaid 图（折叠在 `<details>` 中）
- 以 PNG 为主要展示图（`docs/images/architecture.png`）
- 服务划分表：列出各服务和职责
- 数据流描述

### Phase 3: 架构图维护

SVG 架构图位于 `docs/images/architecture.svg`，遵循以下规则：

**布局规则**：
- 4 层结构：前端(80) → 后端(240) → 微服务(650) → 数据+外部(860)
- 层间距 80px 留给箭头
- viewBox 高度根据内容动态调整，不硬编码
- 所有文字使用中文，不混入英文
- 不暴露端口号、协议、框架、Token、部署细节

**箭头规则**：
- 每两层之间 2-3 个粗箭头（stroke-width=4）
- 箭头尖距下一层 10px（如 L1→L2 箭头 y2=230，L2 起始 y=240）
- 不同层用不同颜色（蓝#4F46E5、紫#7C3AED、橙#D97706、灰#64748B）

**配色规则**：
- 前端层：蓝紫系（#EEF2FF / #C7D2FE）
- 后端层：绿色系（#ECFDF5 / #6EE7B7）
- 微服务层：紫色系（#FAF5FF / #DDD6FE）
- 数据层：黄色系（#FEFCE8 / #FDE68A）
- 外部服务：灰色系（#F8FAFC / #E2E8F0）

### Phase 4: 文字居中修复

使用 `scripts/center_text.py` 自动计算并修复文字垂直居中问题。

```bash
# 预览模式（不修改文件）
python3 .agent/skills/docs-maintainer/scripts/center_text.py docs/images/architecture.svg --dry-run

# 应用居中
python3 .agent/skills/docs-maintainer/scripts/center_text.py docs/images/architecture.svg
```

**算法核心**：
```
visual_top    = first_y - first_font_size * 0.85    # ascender: ~85% above baseline
visual_bottom = last_y  + last_font_size  * 0.15    # descender: ~15% below baseline
visual_center = (visual_top + visual_bottom) / 2
delta = content_area_center - visual_center         # shift all texts by this amount
```

**脚本自动处理**：
- 识别内容框（`rx=8` 的 rect）
- 检测标题栏高度（title rect 或大号标题文字）
- 过滤标题区域文字，只居中内容文字
- 保持 `<line>` 分隔线不变，保护非文字元素

### Phase 5: SVG→PNG 转换

依赖项目级 `svg-to-png` skill：

```bash
python3 .agent/skills/svg-to-png/scripts/convert.py docs/images/architecture.svg docs/images/architecture.png --width 2400
```

### Phase 6: 提交

```bash
git add docs/ docs/images/
git commit -m "docs: <描述更新内容>"
git push
```

## 中英文同步规则

1. **先改中文版，后同步英文版**：中文是主版本
2. **不破坏格式**：表格列数、缩进、空行、代码块边界完全一致
3. **翻译边界**：
   - 自然语言段落 → 翻译
   - 代码块内容 → 不翻译
   - 文件路径 → 不翻译
   - 命令示例 → 不翻译
   - 表格中的技术术语 → 不翻译
4. **结构对应**：每个章节在中英文版中位置相同，用对应语言的标题

## 常见踩坑

| 问题 | 原因 | 解决 |
|------|------|------|
| `rsvg-convert` XML parse error | SVG 中 `&` 未转义 | 替换为 `and` 或 `&amp;` |
| 架构图右侧溢出 | 框体 x+w 超过 viewBox | 缩小 w 或增大 viewBox |
| 文字看起来偏上 | 用 baseline 中点代替视觉中点 | 用 `center_text.py` 算视觉边界 |
| 外部服务框内容挤到顶部 | title+分隔线占用空间未被排除 | 脚本自动检测 title cutoff |
| git branch 创建失败 | 已有同名 ref（如 `docs/xxx`） | 改用更长路径名 |
| Docker README 过时 | 新增服务未列入 | 对照 `docker-compose.yml` 检查 |

## Scripts

### scripts/center_text.py

通用 SVG 文字垂直居中脚本。支持 `--dry-run`、`--output` 参数。详见 Phase 4。

## References

- `.agent/AI_AGENT_COMMON_INSTRUCTIONS.md` — 项目全貌
- `.agent/memory/INDEX.md` — 关键工程决策索引
- `.agent/memory/ARCHITECTURE.md` — 详细架构
- `.agent/memory/CONVENTIONS.md` — 工作约定
- `docs/ARCHITECTURE.md` — 架构文档（中英文）
- `docs/README-Docker.md` — Docker 部署文档（中英文）
