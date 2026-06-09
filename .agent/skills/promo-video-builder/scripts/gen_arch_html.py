#!/usr/bin/env python3
"""
Generate star-topology architecture diagram HTML.
Configurable center node, service nodes, and animation timing.

Usage:
  python3 gen_arch_html.py [--output arch.html] [--config config.json]

Config JSON format (optional; defaults shown in DEFAULT_CONFIG):
{
  "title": "微服务星型架构",
  "subtitle": "Studio Backend 居中调度",
  "center": {
    "name": "Studio Backend",
    "icon": "🖥️",
    "details": ["Express · SQLite · SSE", "Port 3000 · 统一调度"],
    "color": "#3b82f6"
  },
  "services": [
    {"name": "Creator",   "icon": "🧊", "label": "Blender 3D",      "color": "#3b82f6"},
    {"name": "DrawIO",    "icon": "📐", "label": "Draw.io",          "color": "#10b981"},
    {"name": "Image",     "icon": "🖼️", "label": "ImageMagick",     "color": "#f59e0b"},
    {"name": "Video",     "icon": "🎬", "label": "FFmpeg",           "color": "#ef4444"},
    {"name": "SonarQube", "icon": "🔍", "label": "代码质量",          "color": "#8b5cf6"},
    {"name": "Build",     "icon": "📦", "label": "打包构建",          "color": "#06b6d4"},
    {"name": "Run",       "icon": "▶️", "label": "游戏运行",          "color": "#14b8a6"},
    {"name": "Test",      "icon": "🧪", "label": "自动化测试",        "color": "#a855f7"}
  ],
  "animation_speed_ms": 400,
  "pulse_interval_ms": 2000
}

If no --config is given, the script generates the DEFAULT_CONFIG for Game Dev Studio.
Pass custom JSON to adapt to any project's microservice architecture.
"""

import json, sys, os, argparse

DEFAULT_CONFIG = {
    "title": "微服务星型架构",
    "subtitle": "Studio Backend 居中调度 · 8 个微服务协同",
    "center": {
        "name": "Studio Backend",
        "icon": "🖥️",
        "details": ["Express · SQLite · SSE", "Port 3000 · 统一调度"],
        "color": "#3b82f6"
    },
    "services": [
        {"name": "Creator",   "icon": "🧊", "label": "Blender 3D · 已实现", "color": "#3b82f6"},
        {"name": "DrawIO",    "icon": "📐", "label": "Draw.io · 已实现",     "color": "#10b981"},
        {"name": "Image",     "icon": "🖼️", "label": "ImageMagick · 已实现", "color": "#f59e0b"},
        {"name": "Video",     "icon": "🎬", "label": "FFmpeg · Spec",        "color": "#ef4444"},
        {"name": "SonarQube", "icon": "🔍", "label": "代码质量 · 已实现",     "color": "#8b5cf6"},
        {"name": "Build",     "icon": "📦", "label": "打包构建 · Spec",      "color": "#06b6d4"},
        {"name": "Run",       "icon": "▶️", "label": "游戏运行 · Spec",      "color": "#14b8a6"},
        {"name": "Test",      "icon": "🧪", "label": "自动化测试 · Spec",    "color": "#a855f7"}
    ],
    "animation_speed_ms": 400,
    "pulse_interval_ms": 2000
}

# Pre-computed 8-point circle positions (1920x1080 canvas, center at 960,480, radius 340)
POSITIONS = [
    (960, 140),   # top
    (1460, 220),  # top-right
    (1560, 470),  # right
    (1460, 730),  # bottom-right
    (960, 840),   # bottom
    (460, 730),   # bottom-left
    (360, 470),   # left
    (460, 220),   # top-left
]


def generate_html(config):
    cfg = config
    services = cfg["services"]
    n = len(services)
    pos = POSITIONS[:n]

    # ===== SVG DEFS =====
    defs = """<defs>
  <filter id="gl"><feGaussianBlur stdDeviation="3"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <radialGradient id="gc" cx="50%" cy="50%"><stop offset="0%" stop-color="%s" stop-opacity="0.15"/><stop offset="100%" stop-color="#0a0e17"/></radialGradient>
</defs>""" % cfg["center"]["color"]

    # ===== TITLE =====
    title = f"""<text x="960" y="54" text-anchor="middle" fill="#e2e8f0" font-size="30" font-weight="700">{cfg['title']}</text>
<text x="960" y="82" text-anchor="middle" fill="#64748b" font-size="14">{cfg['subtitle']}</text>"""

    # ===== BACKGROUND =====
    bg = f'<circle cx="960" cy="480" r="300" fill="url(#gc)"/>'

    # ===== CONNECTION LINES =====
    lines = []
    for i, svc in enumerate(services):
        x, y = pos[i]
        lines.append(f'  <line x1="960" y1="480" x2="{x}" y2="{y}" stroke="{svc["color"]}" stroke-width="2" stroke-dasharray="6 3" id="l-{i}"/>')
    lines_html = '<g id="lines" opacity="0.15">\n' + '\n'.join(lines) + '\n</g>'

    # ===== CENTER NODE =====
    ctr = cfg["center"]
    details = ctr["details"]
    detail_lines = ''.join(f'  <text x="960" y="{472 + i*28}" text-anchor="middle" fill="#64748b" font-size="13">{d}</text>\n'
                           for i, d in enumerate(details))
    center_html = f"""<g id="g-center">
  <rect x="800" y="400" width="320" height="160" rx="24" fill="#111827" stroke="{ctr['color']}" stroke-width="3" filter="url(#gl)"/>
  <text x="960" y="452" text-anchor="middle" fill="#e2e8f0" font-size="20" font-weight="700">{ctr['icon']} {ctr['name']}</text>
  {detail_lines}  <circle cx="960" cy="480" r="80" fill="none" stroke="{ctr['color']}" stroke-width="0.5" stroke-dasharray="3 3" opacity="0.3"/>
</g>"""

    # ===== SERVICE NODES =====
    nodes = []
    for i, svc in enumerate(services):
        x, y = pos[i]
        rx, ry = x - 100, y - 50
        nodes.append(f"""<g id="g-{i}">
  <rect x="{rx}" y="{ry}" width="200" height="100" rx="14" fill="#111827" stroke="{svc['color']}" stroke-width="2" filter="url(#gl)"/>
  <text x="{x}" y="{y + 8}" text-anchor="middle" font-size="24">{svc['icon']}</text>
  <text x="{x}" y="{y + 34}" text-anchor="middle" fill="#e2e8f0" font-size="15" font-weight="600">{svc['name']}</text>
  <text x="{x}" y="{y + 56}" text-anchor="middle" fill="#64748b" font-size="10" font-family="monospace">{svc['label']}</text>
</g>""")
    nodes_html = '\n'.join(nodes)

    # ===== ANIMATION JS =====
    colors_js = json.dumps([s["color"] for s in services])
    speed = cfg["animation_speed_ms"]
    pulse = cfg["pulse_interval_ms"]

    js = f"""<script>
const lineIds = [{','.join(f"'l-{i}'" for i in range(n))}];
const colors = {colors_js};

let i = 0;
function next() {{
  if (i >= lineIds.length) return;
  const l = document.getElementById(lineIds[i]);
  l.setAttribute('stroke', colors[i]);
  l.setAttribute('stroke-dasharray', 'none');
  l.setAttribute('stroke-width', '2.5');
  l.setAttribute('opacity', '0.7');
  l.setAttribute('filter', 'url(#gl)');
  i++;
  setTimeout(next, {speed});
}}

function pulse() {{
  const c = document.getElementById('g-center');
  const r = c.querySelector('rect');
  r.setAttribute('stroke-width', '4');
  setTimeout(() => r.setAttribute('stroke-width', '3'), 600);
}}

setTimeout(next, 200);
setInterval(pulse, {pulse});
</script>"""

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>{cfg['title']}</title>
<style>
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{ background:#0a0e17; overflow:hidden; }}
svg {{ display:block; width:100vw; height:100vh; }}
</style>
</head>
<body>
<svg viewBox="0 0 1920 1080" id="s">
{defs}
{bg}
{title}
{lines_html}
{center_html}
{nodes_html}
</svg>
{js}
</body>
</html>"""

    return html


def main():
    parser = argparse.ArgumentParser(description="Generate star-topology architecture HTML")
    parser.add_argument("--output", "-o", default=None, help="Output HTML file (default: stdout)")
    parser.add_argument("--config", "-c", default=None, help="JSON config file")
    args = parser.parse_args()

    if args.config:
        with open(args.config, 'r', encoding='utf-8') as f:
            config = json.load(f)
        # Merge with defaults for missing fields
        for key in DEFAULT_CONFIG:
            if key not in config:
                config[key] = DEFAULT_CONFIG[key]
    else:
        config = DEFAULT_CONFIG

    html = generate_html(config)

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f"Generated: {args.output}")
    else:
        print(html)


if __name__ == '__main__':
    main()
