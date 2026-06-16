---
name: architecture-diagram
description: |
  game-dev-studio 项目的 SVG 架构图维护技能。当需要绘制、更新或修复系统架构图、
  修复文字排版/居中对齐、转换 PNG 嵌入文档时使用。
  触发词：架构图、architecture diagram、文字居中、text centering、排版修复、SVG居中。
agent_created: true
---

# Architecture Diagram

## Overview

维护 game-dev-studio 项目的 SVG 系统架构图（`docs/images/architecture.svg`），
包括四层架构布局、配色、箭头、文字居中。

核心能力：
1. **代码浏览研究** — 读取关键代码文件（`server/db.ts`, `server/tools.ts`, `docker-compose.yml` 等）理解当前系统状态
2. **架构图绘制** — SVG 四层架构图（前端 → 后端 → 微服务 → 数据/外部服务），含箭头、配色、布局
3. **文字居中算法** — 考虑字体视觉边界的通用垂直居中脚本

## When to Use

- 架构图出现排版问题（文字不居中、溢出、箭头混乱、容器截断）
- 新建服务/模块后需要更新架构图
- 架构图 SVG→PNG 转换
- 架构文档（`docs/ARCHITECTURE.md`）中嵌入的架构图需要更新

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
```

### Phase 2: 架构文档同步

当架构图变更后，需同步更新架构文档中嵌入的图片引用和服务描述：

- 保持 Mermaid 图（折叠在 `<details>` 中）作为备用
- 以 PNG 为主要展示图（`docs/images/architecture.png`）
- 服务划分表：列出各服务和职责
- 中文版和英文版同步更新图片路径

### Phase 3: 架构图维护

SVG 架构图位于 `docs/images/architecture.svg`，遵循以下规则：

**布局规则**：
- 4 层结构：前端(80) → 后端(240) → 微服务(650) → 数据+外部(860)
- 层间距 80px 留给箭头
- viewBox 高度根据内容动态调整，不硬编码
- 所有文字使用中文，不混入英文
- 不暴露端口号、协议、框架、Token、部署细节
- **容器 padding**：容器高度必须大于最后一个子框底部，留 ≥10px 余量。子框 y+h 不能等于容器 h，否则边框重叠+滤镜阴影导致视觉截断

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
python3 .agent/skills/architecture-diagram/scripts/center_text.py docs/images/architecture.svg --dry-run

# 应用居中
python3 .agent/skills/architecture-diagram/scripts/center_text.py docs/images/architecture.svg
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

依赖项目级 `svg-to-png` skill，中英文版本都需转换：

```bash
python3 .agent/skills/svg-to-png/scripts/convert.py docs/images/architecture.svg docs/images/architecture.png --width 2400
```

### Phase 6: 英文翻译

使用 `scripts/translate_svg.py` 将中文 SVG 翻译为英文版：

```bash
python3 .agent/skills/architecture-diagram/scripts/translate_svg.py docs/images/architecture.svg docs/images/architecture-en.svg
```

翻译后必须手动处理：

1. **标签 rect 宽度**：英文文本通常比中文长，需加宽标签背景框
   - Frontend Layer (80→105), Backend Services (90→115), Microservices Layer (80→120)

2. **相同中文文本的歧义**：如 L1 按钮和 L2 标题都叫"任务看板"、"提案管理"，翻译字典会统一替换。如果两者需要不同翻译（如按钮需缩写），需在翻译后手动修正

3. **专有名词**：SQLite、MinIO、SonarQube、Jaeger、Draw.io、Star-Office 中英文一致，脚本自动跳过

4. **排版验证**：翻译后需用 `center_text.py --dry-run` 检查居中是否仍正确（英文行高不同可能导致偏移）

5. **转换 PNG**：
   ```bash
   python3 .agent/skills/svg-to-png/scripts/convert.py docs/images/architecture-en.svg docs/images/architecture-en.png --width 2400
   ```

### Phase 7: 提交

```bash
git add docs/ docs/images/
git commit -m "docs: <描述更新内容>"
git push
```

## 常见踩坑

| 问题 | 原因 | 解决 |
|------|------|------|
| `rsvg-convert` XML parse error | SVG 中 `&` 未转义 | 替换为 `and` 或 `&amp;` |
| 架构图右侧溢出 | 框体 x+w 超过 viewBox | 缩小 w 或增大 viewBox |
| 文字看起来偏上 | 用 baseline 中点代替视觉中点 | 用 `center_text.py` 算视觉边界 |
| 外部服务框内容挤到顶部 | title+分隔线占用空间未被排除 | 脚本自动检测 title cutoff |
| 子框底部视觉上被截断 | 容器高度 = 子框底部，边框+滤镜阴影重叠在同一线上 | 容器高度 > 最后一个子框底部，留 ≥10px padding |
| viewBox 反复调大无效 | 根因不是 viewBox 而是容器与子框边界重叠 | 先检查容器 h 是否刚好等于最后一个子框 y+h，再考虑 viewBox |

## Scripts

### scripts/center_text.py

通用 SVG 文字垂直居中脚本。支持 `--dry-run`、`--output` 参数。详见 Phase 4。

### scripts/translate_svg.py

中文架构图翻译为英文版脚本。基于翻译字典替换所有 `<text>` 内容，保留布局和配色不变。详见 Phase 6。

**翻译字典维护**：
- 在 `TRANSLATIONS` dict 中添加新词条即可
- 缩进文本需同时添加带空格和不带空格两个 key（脚本会 strip 后匹配）
- 专有名词（SQLite、MinIO 等）无需添加，脚本跳过未匹配项

**常见翻译注意**：
- "任务看板"/"任务交接"/"提案管理" 等词在 CN 版 L1（按钮）和 L2（标题）重复出现，翻译需一致
- 如需区分（如按钮用缩写），翻译后手动修改 SVG 文件

## References

- `.agent/AI_AGENT_COMMON_INSTRUCTIONS.md` — 项目全貌
- `.agent/memory/INDEX.md` — 关键工程决策索引
- `.agent/memory/ARCHITECTURE.md` — 详细架构
- `.agent/memory/CONVENTIONS.md` — 工作约定
- `docs/ARCHITECTURE.md` — 架构文档（中英文）
