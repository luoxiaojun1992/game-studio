#!/usr/bin/env python3
"""
Generate brand logo / title card HTML animation.

Usage:
  python3 gen_logo_html.py [--output logo.html] [--config config.json]

Config JSON format:
{
  "title": "Game Dev Studio",
  "subtitle": "AI-Powered Game Development",
  "subtitle_cn": "AI 多智能体游戏开发协作平台",
  "theme_color": "#3b82f6",
  "accent_color": "#a78bfa",
  "secondary_color": "#f472b6",
  "bg_color": "#0a0e17"
}
"""

import json, argparse


DEFAULT_CONFIG = {
    "title": "Game Dev Studio",
    "subtitle": "AI-Powered Game Development",
    "subtitle_cn": "",
    "theme_color": "#3b82f6",
    "accent_color": "#a78bfa",
    "secondary_color": "#f472b6",
    "bg_color": "#0a0e17"
}


def generate_html(config):
    cfg = config
    tc = cfg["theme_color"]

    # Extra subtitle line
    extra_sub = ""
    if cfg.get("subtitle_cn"):
        extra_sub = f'\n  <div class="logo-subtitle-cn">{cfg["subtitle_cn"]}</div>'

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>{cfg['title']}</title>
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{
  background: {cfg['bg_color']};
  display: flex; justify-content: center; align-items: center;
  min-height: 100vh; font-family: 'SF Pro Display', 'PingFang SC', sans-serif;
}}
.logo-container {{
  text-align: center; padding: 60px;
}}
.logo-icon {{
  position: relative; display: inline-block;
  width: 240px; height: 240px;
}}

/* Glow ring */
.glow-ring {{
  position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
  width: 200px; height: 200px;
  border-radius: 50%;
  border: 2px solid {tc}4d;
  animation: pulse-ring 3s ease-in-out infinite;
}}
@keyframes pulse-ring {{
  0%,100% {{ width: 180px; height: 180px; opacity: 0.3; }}
  50% {{ width: 220px; height: 220px; opacity: 0.6; }}
}}

/* Center shield */
.logo-shield {{
  position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
  width: 120px; height: 140px;
  background: linear-gradient(135deg, {tc}33 0%, {cfg['bg_color']} 100%);
  border-radius: 20px;
  border: 2px solid {tc}99;
  box-shadow: 0 0 40px {tc}33, inset 0 0 20px {tc}0d;
  display: flex; align-items: center; justify-content: center;
}}

/* Controller SVG */
.controller {{ width: 60px; height: 36px; }}
.controller svg {{ width: 100%; height: 100%; }}

/* Sparkles */
.sparkle {{
  position: absolute;
  width: 4px; height: 4px;
  background: {tc};
  border-radius: 50%;
  animation: sparkle-float 2s ease-in-out infinite;
}}
.sparkle:nth-child(3) {{ top: 20px; left: 30px; animation-delay: 0s; }}
.sparkle:nth-child(4) {{ top: 15px; right: 35px; animation-delay: 0.4s; }}
.sparkle:nth-child(5) {{ bottom: 25px; left: 25px; animation-delay: 0.8s; }}
.sparkle:nth-child(6) {{ bottom: 20px; right: 30px; animation-delay: 1.2s; }}
.sparkle:nth-child(7) {{ top: 50%; left: 10px; animation-delay: 1.6s; }}
@keyframes sparkle-float {{
  0%,100% {{ transform: translateY(0) scale(1); opacity: 0.4; }}
  50% {{ transform: translateY(-8px) scale(1.8); opacity: 1; }}
}}

/* Bot nodes */
.bot-node {{
  position: absolute;
  width: 12px; height: 12px;
  border-radius: 50%;
  background: {tc};
  box-shadow: 0 0 8px {tc}99;
}}
.bot-node:nth-child(8) {{ top: -10px; left: 50%; transform: translateX(-50%); }}
.bot-node:nth-child(9) {{ bottom: -10px; left: 50%; transform: translateX(-50%); }}
.bot-node:nth-child(10) {{ left: -10px; top: 50%; transform: translateY(-50%); }}
.bot-node:nth-child(11) {{ right: -10px; top: 50%; transform: translateY(-50%); }}

/* Connection lines */
.conn-line {{
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
  pointer-events: none;
}}
.conn-line svg {{ width: 100%; height: 100%; }}
.line-dash {{
  stroke: {tc}26;
  stroke-width: 1; stroke-dasharray: 4 4;
  animation: dash-flow 2s linear infinite;
}}
@keyframes dash-flow {{ to {{ stroke-dashoffset: -16; }} }}

/* Text */
.logo-text {{ margin-top: 30px; }}
.logo-title {{
  font-size: 42px; font-weight: 700;
  background: linear-gradient(135deg, {tc} 0%, {cfg['accent_color']} 50%, {cfg['secondary_color']} 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
  letter-spacing: 2px;
}}
.logo-subtitle {{
  font-size: 16px; color: #64748b;
  margin-top: 8px; letter-spacing: 4px; text-transform: uppercase;
}}
.logo-subtitle-cn {{
  font-size: 18px; color: #94a3b8;
  margin-top: 4px;
}}
</style>
</head>
<body>
<div class="logo-container">
  <div class="logo-icon">
    <div class="glow-ring"></div>
    <div class="logo-shield">
      <div class="controller">
        <svg viewBox="0 0 60 36" fill="none">
          <!-- Gamepad body -->
          <rect x="4" y="2" width="52" height="32" rx="10" fill="none" stroke="{tc}" stroke-width="2.5"/>
          <!-- D-pad -->
          <line x1="16" y1="8" x2="16" y2="20" stroke="#64748b" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="10" y1="14" x2="22" y2="14" stroke="#64748b" stroke-width="2.5" stroke-linecap="round"/>
          <!-- Action buttons -->
          <circle cx="42" cy="10" r="3.5" fill="none" stroke="{cfg['secondary_color']}" stroke-width="2"/>
          <circle cx="42" cy="20" r="3.5" fill="none" stroke="{cfg['accent_color']}" stroke-width="2"/>
          <circle cx="35" cy="15" r="3.5" fill="none" stroke="{tc}" stroke-width="2"/>
          <!-- Center buttons -->
          <rect x="25" y="13" width="6" height="3" rx="1.5" fill="#475569"/>
          <rect x="25" y="18" width="6" height="3" rx="1.5" fill="#475569"/>
        </svg>
      </div>
    </div>
    <!-- Sparkles -->
    <div class="sparkle"></div><div class="sparkle"></div>
    <div class="sparkle"></div><div class="sparkle"></div>
    <div class="sparkle"></div>
    <!-- Bot nodes -->
    <div class="bot-node"></div><div class="bot-node"></div>
    <div class="bot-node"></div><div class="bot-node"></div>
    <!-- Connection lines -->
    <div class="conn-line">
      <svg viewBox="0 0 240 240">
        <line x1="120" y1="0" x2="120" y2="50" class="line-dash"/>
        <line x1="120" y1="190" x2="120" y2="240" class="line-dash"/>
        <line x1="0" y1="120" x2="50" y2="120" class="line-dash"/>
        <line x1="190" y1="120" x2="240" y2="120" class="line-dash"/>
      </svg>
    </div>
  </div>
  <div class="logo-text">
    <div class="logo-title">{cfg['title']}</div>
    <div class="logo-subtitle">{cfg['subtitle']}</div>{extra_sub}
  </div>
</div>
</body>
</html>"""

    return html


def main():
    parser = argparse.ArgumentParser(description="Generate brand logo HTML")
    parser.add_argument("--output", "-o", default=None, help="Output HTML file (default: stdout)")
    parser.add_argument("--config", "-c", default=None, help="JSON config file")
    parser.add_argument("--title", default=None, help="Quick: set title (overrides config)")
    parser.add_argument("--subtitle", default=None, help="Quick: set subtitle")
    args = parser.parse_args()

    if args.config:
        with open(args.config, 'r', encoding='utf-8') as f:
            config = json.load(f)
    else:
        config = DEFAULT_CONFIG.copy()

    if args.title:
        config["title"] = args.title
    if args.subtitle:
        config["subtitle"] = args.subtitle

    html = generate_html(config)

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f"Generated: {args.output}")
    else:
        print(html)


if __name__ == '__main__':
    main()
