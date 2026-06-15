#!/usr/bin/env python3
"""
Translate Chinese SVG architecture diagram to English.
Preserves all layout, colors, positions, and non-text elements.
Only replaces text content.

Usage:
  python3 translate_svg.py <input.svg> <output.svg>
"""

import xml.etree.ElementTree as ET
import re
import sys

NS = 'http://www.w3.org/2000/svg'


# ── Translation map ────────────────────────────────────

TRANSLATIONS = {
    # Title
    'Game Dev Studio \u7cfb\u7edf\u67b6\u6784':
        'Game Dev Studio System Architecture',
    '多智能体游戏研发工作台 · 功能模块 · 业务逻辑 · 技术架构':
        'Multi-Agent Game Dev Workspace \u00b7 Modules \u00b7 Business Logic \u00b7 Architecture',

    # L1 Frontend
    '前端展示层': 'Frontend Layer',
    '团队总览': 'Team Overview',
    '指令中心': 'Command Center',
    'Studio 工作台': 'Studio Workspace',
    '提案管理': 'Proposal Mgmt',
    '游戏成品': 'Game Delivery',
    '运行观测': 'Observability',

    # L2 Backend
    '后端业务层': 'Backend Services',
    '智能体编排': 'Agent Orchestration',
    '6 角色协作团队': '6-Role Team',
    '研发工程师 · 架构师 · 游戏策划': 'Dev Engineer \u00b7 Architect \u00b7 Game Designer',
    '商业策划 · CEO · 团队建设': 'Biz Strategist \u00b7 CEO \u00b7 Team Builder',
    '核心能力': 'Core Capabilities',
    '\u2022 智能体生命周期管理': '\u2022 Agent Lifecycle Management',
    '\u2022 SSE 实时流式输出': '\u2022 SSE Real-time Streaming',
    '\u2022 工具调用权限审批': '\u2022 Tool Call Approval',
    '\u2022 长期记忆（按角色/项目）': '\u2022 Long-term Memory (Role/Project)',
    '任务交接链': 'Task Handoff Chain',
    '策划 → CEO → 架构师 → 研发': 'Designer \u2192 CEO \u2192 Architect \u2192 Dev',
    '团队协作': 'Team Collaboration',
    '\u2022 创建/评审/决策 工作流': '\u2022 Create / Review / Decide Workflow',
    '\u2022 问卷式结构化策划案': '\u2022 Questionnaire-based Design Doc',
    '\u2022 附件管理与图表绑定': '\u2022 Attachment & Diagram Binding',
    '\u2022 开发与测试任务流转': '\u2022 Dev & Test Task Flow',
    '\u2022 状态追踪与可视化': '\u2022 Status Tracking & Visualization',
    '\u2022 跨角色任务移交': '\u2022 Cross-role Task Transfer',
    '\u2022 自动交接开关': '\u2022 Auto Handover Toggle',
    '游戏生产': 'Game Production',
    '游戏提交（双模式）': 'Game Submit (Dual Mode)',
    '\u2022 HTML 内容模式': '\u2022 HTML Content Mode',
    '\u2022 ZIP 打包上传 MinIO': '\u2022 ZIP Upload to MinIO',
    '代码质量流水线': 'Code Quality Pipeline',
    '\u2022 SonarQube 静态扫描': '\u2022 SonarQube Static Scan',
    '\u2022 游戏工程规范检查': '\u2022 Game Engineering Check',
    '  20 条规则（8 公共 + 6 H5 + 6 移动）': '  20 Rules (8 Common + 6 H5 + 6 Mobile)',
    '20 条规则（8 公共 + 6 H5 + 6 移动）': '20 Rules (8 Common + 6 H5 + 6 Mobile)',
    '游戏工程框架': 'Game Engineering Framework',
    '\u2022 类型注册与规范定义': '\u2022 Type Registration & Specs',
    '\u2022 MCP 工具查询接口': '\u2022 MCP Tool Query API',
    '基础设施': 'Infrastructure',
    'Studio 集成': 'Studio Integration',
    '\u2022 Star-Office 状态同步': '\u2022 Star-Office Status Sync',
    '\u2022 Agent 注册与健康检查': '\u2022 Agent Registration & Health',
    '\u2022 MinIO 对象存储': '\u2022 MinIO Object Storage',
    '\u2022 安全路径解析': '\u2022 Secure Path Resolution',
    '\u2022 日志流式采集': '\u2022 Log Streaming Collection',
    '\u2022 SSE 事件广播': '\u2022 SSE Event Broadcasting',
    '\u2022 OpenTelemetry 追踪': '\u2022 OpenTelemetry Tracing',
    '架构亮点：项目级数据隔离': 'Highlight: Project-level Data Isolation',
    '所有业务数据按 project_id 隔离': 'All business data isolated by project_id',

    # L3 Microservices
    '微服务层': 'Microservices Layer',
    'Creator 服务': 'Creator Service',
    'Blender 三维引擎': 'Blender 3D Engine',
    '建模 \u00b7 材质 \u00b7 场景 \u00b7 导出': 'Modeling \u00b7 Materials \u00b7 Scene \u00b7 Export',
    '安全路径防护': 'Secure Path Protection',
    'Image 服务': 'Image Service',
    'ImageMagick 图片处理': 'ImageMagick Processing',
    '裁剪 \u00b7 缩放 \u00b7 水印 \u00b7 批量处理': 'Crop \u00b7 Resize \u00b7 Watermark \u00b7 Batch',
    '雪碧图生成': 'Sprite Sheet Generation',
    'Draw.io 服务': 'Draw.io Service',
    '图表服务': 'Diagram Service',
    '图表 CRUD \u00b7 导出 PNG/SVG': 'Diagram CRUD \u00b7 Export PNG/SVG',
    '→ 导出服务': '\u2192 Export Service',
    'Scanner 服务': 'Scanner Service',
    'SonarQube 扫描服务': 'SonarQube Scan Service',
    'ZIP 扫描 \u00b7 问题报告': 'ZIP Scan \u00b7 Issue Reports',
    '缓存去重': 'Cache Deduplication',

    # L4 Data Layer
    '数据层': 'Data Layer',
    '嵌入式关系数据库': 'Embedded Relational Database',
    '项目级数据隔离': 'Project-level Data Isolation',
    'output/ 目录': 'output/ Directory',
    'MinIO 对象存储': 'MinIO Object Storage',
    '持久化特性': 'Persistence',
    '17 张核心业务表': '17 Core Business Tables',

    # L4 External Services
    '外部服务': 'External Services',
    '对象存储': 'Object Storage',
    '\u2022 游戏文件存储': '\u2022 Game File Storage',
    '\u2022 附件管理': '\u2022 Attachment Management',
    '\u2022 扫描报告归档': '\u2022 Scan Report Archive',
    '\u2022 预签名下载链接': '\u2022 Presigned Download URLs',
    '代码质量平台': 'Code Quality Platform',
    '\u2022 静态代码扫描': '\u2022 Static Code Analysis',
    '\u2022 Bug 与安全漏洞检测': '\u2022 Bug & Vulnerability Detection',
    '\u2022 代码异味分析': '\u2022 Code Smell Analysis',
    '\u2022 质量门禁控制': '\u2022 Quality Gate Control',
    'Agent 工作空间': 'Agent Workspace',
    '\u2022 多 Agent 状态同步': '\u2022 Multi-Agent Status Sync',
    '\u2022 实时协作画布': '\u2022 Real-time Collab Canvas',
    '\u2022 任务可视化管理': '\u2022 Task Visualization',
    '\u2022 跨项目隔离': '\u2022 Cross-project Isolation',
    '分布式追踪': 'Distributed Tracing',
    '\u2022 跨服务调用链路': '\u2022 Cross-service Call Chains',
    '\u2022 性能瓶颈分析': '\u2022 Performance Bottleneck Analysis',
    '\u2022 错误根因定位': '\u2022 Root Cause Analysis',
    '\u2022 可视化追踪界面': '\u2022 Visual Tracing UI',
    '图表导出': 'Diagram Export',
    '\u2022 架构图设计': '\u2022 Architecture Design',
    '\u2022 游戏流程图绘制': '\u2022 Game Flowchart Drawing',
    '\u2022 PNG/SVG 导出': '\u2022 PNG/SVG Export',
    '\u2022 提案附件绑定': '\u2022 Proposal Attachment Binding',

    # Common duplicates (L1 and L2 share these)
    '任务看板': 'Task Board',
    '任务交接': 'Task Handover',
    '文件存储': 'File Storage',
    '可观测性': 'Observability',
}


def get_tag(elem):
    tag = elem.tag
    return tag.split('}')[1] if '}' in tag else tag


def process_svg(input_path, output_path):
    ET.register_namespace('', NS)
    tree = ET.parse(input_path)
    root = tree.getroot()

    changes = 0
    missing = set()

    for elem in root.iter():
        tag = get_tag(elem)
        if tag == 'text' and elem.text:
            text = elem.text.strip()
            # Try exact match first
            stripped = text.strip()
            if stripped in TRANSLATIONS:
                # Preserve leading whitespace
                leading = text[:len(text) - len(text.lstrip())]
                elem.text = leading + TRANSLATIONS[stripped]
                changes += 1
            elif stripped:
                missing.add(stripped)

    if missing:
        print(f'WARNING: {len(missing)} untranslated texts:')
        for m in sorted(missing):
            print(f'  "{m}"')

    tree.write(output_path, xml_declaration=True, encoding='unicode')
    print(f'Translated {changes} text elements → {output_path}')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: python3 translate_svg.py <input.svg> <output.svg>')
        sys.exit(1)
    process_svg(sys.argv[1], sys.argv[2])
