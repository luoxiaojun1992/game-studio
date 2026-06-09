#!/usr/bin/env python3
"""
Generate process pipeline / workflow diagram HTML with animated stages.

Usage:
  python3 gen_pipeline_html.py [--output pipeline.html] [--config config.json]

Config JSON format:
{
  "title": "ImageMagick 图片处理管线",
  "subtitle": "AI Agent 驱动的自动化图片处理微服务",
  "theme_color": "#3b82f6",
  "stages": [
    {"name": "上传原图", "icon": "📤"},
    {"name": "缩放裁切", "icon": "📐"},
    {"name": "压缩优化", "icon": "🗜️"},
    {"name": "添加水印", "icon": "💧"},
    {"name": "图层合成", "icon": "🎨"},
    {"name": "格式转换", "icon": "🔄"},
    {"name": "下载到游戏", "icon": "📥"}
  ],
  "metrics": [
    {"value": "-87%", "label": "体积缩减"},
    {"value": "6.5x", "label": "加载提速"},
    {"value": "17", "label": "工具数量"},
    {"value": "100%", "label": "自动化"}
  ],
  "show_preview": false,
  "animation_interval_ms": 800
}

Set show_preview=true to include before/after canvas previews.
Metrics are optional — pass empty list to hide.
"""

import json, argparse, os


DEFAULT_CONFIG = {
    "title": "流程管线",
    "subtitle": "端到端自动化流程",
    "theme_color": "#3b82f6",
    "stages": [
        {"name": "输入", "icon": "📤"},
        {"name": "处理", "icon": "⚙️"},
        {"name": "验证", "icon": "✅"},
        {"name": "输出", "icon": "📥"}
    ],
    "metrics": [],
    "show_preview": False,
    "animation_interval_ms": 800
}


def generate_html(config):
    cfg = config
    stages = cfg["stages"]
    n = len(stages)
    tc = cfg["theme_color"]

    # ===== STAGE HTML =====
    stage_html_parts = []
    for i, st in enumerate(stages):
        comma = '' if i == n - 1 else '\n    <div class="arrow">→</div>'
        stage_html_parts.append(f"""    <div class="stage" data-stage="{i}">
      <div class="stage-icon">{st["icon"]}</div>
      <div class="stage-label">{st["name"]}</div>
    </div>{comma}""")
    stages_html = '\n'.join(stage_html_parts)

    # ===== METRICS HTML =====
    metrics_html = ""
    if cfg.get("metrics"):
        metric_parts = []
        for m in cfg["metrics"]:
            metric_parts.append(f"""    <div class="metric">
      <div class="metric-value">{m["value"]}</div>
      <div class="metric-label">{m["label"]}</div>
    </div>""")
        metrics_html = '<div class="metrics">\n' + '\n'.join(metric_parts) + '\n</div>'

    # ===== PREVIEW HTML =====
    preview_html = ""
    if cfg.get("show_preview"):
        preview_html = """<div class="preview-area">
    <div class="image-card">
      <h3>处理前</h3>
      <div class="image-frame"><canvas id="beforeCanvas" width="400" height="250"></canvas></div>
      <div class="image-label">原始素材</div>
    </div>
    <div class="image-card">
      <h3>处理后</h3>
      <div class="image-frame"><canvas id="afterCanvas" width="400" height="250"></canvas></div>
      <div class="image-label">处理完成</div>
    </div>
  </div>"""

    anim_interval = cfg["animation_interval_ms"]

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>{cfg['title']}</title>
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{
  background: #0a0e17; color: #e2e8f0;
  font-family: 'PingFang SC', 'SF Pro Display', sans-serif;
  display: flex; justify-content: center; align-items: center;
  min-height: 100vh; overflow: hidden;
}}
.container {{ width: 960px; padding: 40px; }}
h1 {{ font-size: 28px; color: {tc}; margin-bottom: 8px; font-weight: 600; }}
.subtitle {{ color: #64748b; font-size: 14px; margin-bottom: 32px; }}

.pipeline {{
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  justify-content: center;
}}
.stage {{
  background: #1e293b; border: 1px solid #334155;
  border-radius: 12px; padding: 16px 20px;
  min-width: 110px; text-align: center;
  transition: all 0.4s ease;
}}
.stage.active {{
  border-color: {tc};
  box-shadow: 0 0 20px {tc}4d;
  transform: scale(1.05);
}}
.stage-icon {{ font-size: 28px; margin-bottom: 8px; }}
.stage-label {{ font-size: 12px; color: #94a3b8; font-weight: 500; }}
.arrow {{ color: #475569; font-size: 20px; flex-shrink: 0; }}

.preview-area {{
  margin-top: 36px; display: flex; gap: 24px; align-items: flex-start;
}}
.image-card {{
  flex: 1; background: #1e293b; border: 1px solid #334155;
  border-radius: 12px; padding: 16px; text-align: center;
}}
.image-card h3 {{ font-size: 13px; color: #94a3b8; margin-bottom: 12px; font-weight: 500; }}
.image-frame {{
  width: 100%; aspect-ratio: 16/10; background: #0f172a;
  border-radius: 8px; display: flex; align-items: center; justify-content: center;
  overflow: hidden; border: 1px solid #1e293b;
}}
.image-label {{ margin-top: 10px; font-size: 11px; color: #64748b; }}

.metrics {{
  margin-top: 24px; display: flex; gap: 16px; justify-content: center;
}}
.metric {{
  background: #1e293b; border: 1px solid #334155;
  border-radius: 8px; padding: 12px 20px; text-align: center; min-width: 100px;
}}
.metric-value {{ font-size: 20px; font-weight: 700; color: {tc}; }}
.metric-label {{ font-size: 11px; color: #64748b; margin-top: 4px; }}
</style>
</head>
<body>
<div class="container">
  <h1>{cfg['title']}</h1>
  <div class="subtitle">{cfg['subtitle']}</div>

  <div class="pipeline" id="pipeline">
{stages_html}
  </div>

  {preview_html}
  {metrics_html}
</div>

<script>
let current = 0;
const stages = document.querySelectorAll('.stage');
const total = stages.length;

function animate() {{
  stages.forEach(s => s.classList.remove('active'));
  stages[current].classList.add('active');
  current = (current + 1) % total;
}}

setInterval(animate, {anim_interval});
stages[0].classList.add('active');
</script>
</body>
</html>"""

    return html


def main():
    parser = argparse.ArgumentParser(description="Generate pipeline diagram HTML")
    parser.add_argument("--output", "-o", default=None, help="Output HTML file (default: stdout)")
    parser.add_argument("--config", "-c", default=None, help="JSON config file")
    args = parser.parse_args()

    if args.config:
        with open(args.config, 'r', encoding='utf-8') as f:
            config = json.load(f)
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
