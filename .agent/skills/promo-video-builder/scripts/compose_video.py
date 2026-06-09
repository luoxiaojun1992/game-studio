#!/usr/bin/env python3
"""
Main video composition script for Game Dev Studio promo video.
Usage: python3 compose_video.py

Edit main() to customize:
  - CHAPTERS: chapter durations matching voiceover segments
  - shot_map: screenshot paths and durations
  - srt_segs: subtitle timing tuples
"""

import os, subprocess, json

# ============ CONFIG - EDIT THESE ============
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(BASE, 'artifacts')          # CI video.webm files
DOCS = os.path.join(BASE, 'docs', 'images')    # Project screenshots
TMP = os.path.join(BASE, 'video-assets', 'tmp')
OUTPUT = os.path.join(BASE, 'video-assets', 'game-dev-studio-promo.mp4')
VOICEOVER = os.path.join(BASE, 'video-assets', 'voiceover_aligned.mp3')
BGM = os.path.join(BASE, 'video-assets', 'bgm.mp3')  # Downloaded from freepd.cn

W, H = 1920, 1080
FONT = '/Library/Fonts/Arial Unicode.ttf'

# Chapter durations (must match voiceover aligned segments)
CHAPTERS = [
    4.4,   # Ch1: AI robot intro
    5.3,   # Ch2: Logo + title
    9.5,   # Ch3: Platform overview
    10.4,  # Ch4: Smart planning
    9.0,   # Ch5: Task board + autopilot
    14.9,  # Ch6: Microservices
    8.7,   # Ch7: Artifacts + outro
]

os.makedirs(TMP, exist_ok=True)


def run(cmd, desc=""):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=300)
    if r.returncode != 0 and r.returncode != 256:
        print(f"  WARN {desc}: {r.stderr[-150:]}")
    return r.returncode == 0

def dur(f):
    try:
        r = subprocess.run(f'ffprobe -v quiet -print_format json -show_format "{f}"',
                           shell=True, capture_output=True, text=True)
        return float(json.loads(r.stdout).get('format', {}).get('duration', 1))
    except: return 1

def check_codec(f):
    """Verify file is 1920x1080 30fps yuv420p h264"""
    r = subprocess.run(f'ffprobe -v error -show_entries stream=width,height,r_frame_rate,pix_fmt,codec_name -of csv=p=0 "{f}"',
                       shell=True, capture_output=True, text=True)
    return r.stdout.strip()


# ============ UTILITY FUNCTIONS ============

def normalize_video(src, dst, target_w=W, target_h=H, target_fps=30):
    """Re-encode any video to uniform 1920x1080 30fps yuv420p"""
    run(f'ffmpeg -y -i "{src}" '
        f'-vf "scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,'
        f'pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:color=#0a0e17,'
        f'setsar=1,fps={target_fps},format=yuv420p" '
        f'-c:v libx264 -preset fast -crf 18 -an "{dst}" 2>/dev/null',
        f'Normalize: {os.path.basename(src)}')


def make_still(src, dst, sec):
    """Create static screenshot video at exact duration"""
    run(f'ffmpeg -y -loop 1 -i "{src}" '
        f'-vf "scale={W}:{H}:force_original_aspect_ratio=decrease,'
        f'pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=#0a0e17,'
        f'setsar=1,fps=30,format=yuv420p" '
        f'-c:v libx264 -preset fast -crf 18 -t {sec} -an "{dst}" 2>/dev/null',
        f'Still: {os.path.basename(src)} {sec}s')


def make_title(lines, dst, sec):
    """Title card with centered text"""
    esc = [l.replace("'", "\\'").replace(":", "\\:") for l in lines]
    y0 = H//2 - len(lines)*30
    filters = []
    for i, line in enumerate(esc):
        fs, c = (48, "white") if i == 0 else (28, "#94a3b8")
        if i == len(esc) - 1 and line.startswith("github"):
            fs, c = 20, "#64748b"
        filters.append(f"drawtext=text='{line}':fontsize={fs}:fontcolor={c}:"
                       f"x=(w-text_w)/2:y={y0+i*80}:fontfile={FONT}")
    chain = ','.join(filters)
    run(f'ffmpeg -y -f lavfi -i "color=c=#0a0e17:s={W}x{H}:r=30:d={sec}" '
        f'-vf "{chain},fade=t=in:d=0.3,fade=t=out:st={sec-0.3}:d=0.3" '
        f'-c:v libx264 -pix_fmt yuv420p -preset fast -crf 18 -an "{dst}" 2>/dev/null',
        f'Title {sec}s')


def make_trim(src, dst, start, duration):
    run(f'ffmpeg -y -ss {start} -t {duration} -i "{src}" '
        f'-c:v libx264 -pix_fmt yuv420p -preset fast -crf 18 -an "{dst}" 2>/dev/null',
        f'Trim {duration}s')


def make_slow(src, dst, factor):
    run(f'ffmpeg -y -i "{src}" -vf "setpts={factor}*PTS" '
        f'-c:v libx264 -pix_fmt yuv420p -preset fast -crf 18 -an "{dst}" 2>/dev/null',
        f'Slow {factor}x')


def concat_chapters(paths, dst):
    """Concat filter — REQUIRES uniform codec on all inputs"""
    n = len(paths)
    inputs = ' '.join(f'-i "{p}"' for p in paths)
    labels = ''.join(f'[{i}:v]' for i in range(n))
    run(f'ffmpeg -y {inputs} '
        f'-filter_complex "{labels}concat=n={n}:v=1:a=0[outv]" '
        f'-map "[outv]" -c:v libx264 -pix_fmt yuv420p -preset fast -crf 18 -an '
        f'"{dst}" 2>/dev/null', f'Concat {n} chapters')


def force_trim(src, dst, sec):
    run(f'ffmpeg -y -i "{src}" -c:v libx264 -pix_fmt yuv420p -preset fast -crf 18 '
        f'-an -t {sec} "{dst}" 2>/dev/null', f'Force trim to {sec}s')


def burn_subs(vid, srt, dst):
    run(f'ffmpeg -y -i "{vid}" '
        f'-vf "subtitles={srt}:force_style=\'FontName=Arial Unicode MS,FontSize=24,'
        f'PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,MarginV=50\'" '
        f'-c:v libx264 -pix_fmt yuv420p -preset medium -crf 20 -c:a copy '
        f'"{dst}" 2>/dev/null', 'Subs')


def watermark(vid, dst):
    run(f'ffmpeg -y -i "{vid}" '
        f'-vf "drawtext=text=\'Game Dev Studio\':fontsize=16:fontcolor=#64748b@0.4:'
        f'x=w-tw-24:y=h-th-16:fontfile={FONT}" '
        f'-c:v libx264 -pix_fmt yuv420p -preset medium -crf 20 -c:a copy '
        f'"{dst}" 2>/dev/null', 'WM')


def mux_audio(vid, aac, dst):
    """Mux pre-mixed AAC with video"""
    run(f'ffmpeg -y -i "{vid}" -i "{aac}" '
        f'-c:v copy -c:a copy -shortest "{dst}" 2>/dev/null', 'Audio mux')


def make_srt(segs, path):
    with open(path, 'w') as f:
        for i, (s, e, t) in enumerate(segs, 1):
            ss = f"{int(s//3600):02d}:{int((s%3600)//60):02d}:{int(s%60):02d},{int((s%1)*1000):03d}"
            ee = f"{int(e//3600):02d}:{int((e%3600)//60):02d}:{int(e%60):02d},{int((e%1)*1000):03d}"
            f.write(f"{i}\n{ss} --> {ee}\n{t}\n\n")


# ============ MAIN PIPELINE ============

def main():
    print("="*60)
    print("Game Dev Studio Promo Video Composition")
    print("="*60)

    # ---- Step 1: Build chapters ----
    print("\n[1] Building chapters...")
    chapter_files = []

    # Ch1: AI robot intro (replace with your AI-generated video)
    ai_src = None
    for f in sorted(os.listdir(BASE)):
        if f.startswith('ai-generated-') and f.endswith('.mp4'):
            ai_src = os.path.join(BASE, 'video-assets', f)
            break
    if ai_src:
        ch1 = os.path.join(TMP, 'ch1.mp4')
        normalize_video(ai_src, ch1, W, H)
        force_trim(ch1, os.path.join(TMP, 'ch1_exact.mp4'), CHAPTERS[0])
        chapter_files.append(os.path.join(TMP, 'ch1_exact.mp4'))
    else:
        fall = os.path.join(TMP, 'ch1_fallback.mp4')
        make_title(['Game Dev Studio'], fall, CHAPTERS[0])
        chapter_files.append(fall)

    # Ch2: Logo + title
    logo = os.path.join(BASE, 'video-assets', 'demo-logo-intro.mp4')
    if os.path.exists(logo):
        ltrim = os.path.join(TMP, 'ch2_logo.mp4')
        make_trim(logo, ltrim, 0, 2.6)
        tcard = os.path.join(TMP, 'ch2_title.mp4')
        make_title(['Game Dev Studio', 'AI 多智能体游戏开发协作平台'], tcard, 2.7)
        ch2 = os.path.join(TMP, 'ch2.mp4')
        concat_chapters([ltrim, tcard], ch2)
        force_trim(ch2, os.path.join(TMP, 'ch2_exact.mp4'), CHAPTERS[1])
        chapter_files.append(os.path.join(TMP, 'ch2_exact.mp4'))
    else:
        fall = os.path.join(TMP, 'ch2_fallback.mp4')
        make_title(['Game Dev Studio', 'AI 多智能体游戏开发协作平台'], fall, CHAPTERS[1])
        chapter_files.append(fall)

    # Ch3: Team + StarOffice screenshots
    t1, t2 = os.path.join(TMP, 'ch3_team.mp4'), os.path.join(TMP, 'ch3_studio.mp4')
    make_still(os.path.join(DOCS, 'team.zh-CN.png'), t1, CHAPTERS[2]/2)
    make_still(os.path.join(DOCS, 'studio.zh-CN.png'), t2, CHAPTERS[2]/2)
    ch3 = os.path.join(TMP, 'ch3.mp4')
    concat_chapters([t1, t2], ch3)
    force_trim(ch3, os.path.join(TMP, 'ch3_exact.mp4'), CHAPTERS[2])
    chapter_files.append(os.path.join(TMP, 'ch3_exact.mp4'))

    # Ch4: CI demo clips + screenshot
    for tid, slo in [('UI-009', 1.5), ('UI-010', 1.5)]:
        src = os.path.join(RAW, f'{tid}.webm')
        if os.path.exists(src):
            proc = os.path.join(TMP, f'ch4_{tid}_proc.mp4')
            slowed = os.path.join(TMP, f'ch4_{tid}_slow.mp4')
            normalize_video(src, proc)
            make_slow(proc, slowed, slo)
    ch4_parts = []
    for p in sorted([f for f in os.listdir(TMP) if f.startswith('ch4_') and f.endswith('_slow.mp4')]):
        ch4_parts.append(os.path.join(TMP, p))
    prop = os.path.join(TMP, 'ch4_proposal.mp4')
    prop_dur = max(2, CHAPTERS[3] - len(ch4_parts) * 3)
    make_still(os.path.join(DOCS, 'proposal.zh-CN.png'), prop, prop_dur)
    ch4_parts.append(prop)
    ch4 = os.path.join(TMP, 'ch4.mp4')
    concat_chapters(ch4_parts, ch4)
    force_trim(ch4, os.path.join(TMP, 'ch4_exact.mp4'), CHAPTERS[3])
    chapter_files.append(os.path.join(TMP, 'ch4_exact.mp4'))

    # Ch5: Task board + autopilot
    for vid, tname, ts in [('auto', 'UI-008.webm', 33.0), ('manual', 'UI-007.webm', 55.0)]:
        src = os.path.join(RAW, tname)
        if os.path.exists(src):
            frame = os.path.join(TMP, f'ch5_{vid}_frame.png')
            run(f'ffmpeg -y -i "{src}" -ss {ts} -frames:v 1 "{frame}" 2>/dev/null', f'Frame {vid}')
    ch5_parts = []
    for name, dur in [('task', CHAPTERS[4]/4), ('auto_frame', CHAPTERS[4]/4),
                       ('handoff', CHAPTERS[4]/4), ('manual_frame', CHAPTERS[4]/4)]:
        src = os.path.join(DOCS, f'{name}.zh-CN.png')
        alt = os.path.join(TMP, f'ch5_{name}.png')
        if os.path.exists(src) or os.path.exists(alt):
            p = os.path.join(TMP, f'ch5_{name}.mp4')
            make_still(src if os.path.exists(src) else alt, p, dur)
            ch5_parts.append(p)
    ch5 = os.path.join(TMP, 'ch5.mp4')
    concat_chapters(ch5_parts, ch5)
    force_trim(ch5, os.path.join(TMP, 'ch5_exact.mp4'), CHAPTERS[4])
    chapter_files.append(os.path.join(TMP, 'ch5_exact.mp4'))

    # Ch6: Microservices (title + demo clips)
    tsvc = os.path.join(TMP, 'ch6_title.mp4')
    make_title(['微服务星型架构',
                'Creator · DrawIO · Image · Video · Build · Run · Test · SonarQube'],
               tsvc, 3.3)

    # Demo clips — normalize to 1080p 30fps before concat
    demo_parts = [tsvc]
    for dname, dsec in [('architecture', 4.8), ('image-pipeline', 3.8), ('workflow', 3.0)]:
        dsrc = os.path.join(BASE, 'video-assets', f'demo-{dname}.mp4')
        if os.path.exists(dsrc):
            dout = os.path.join(TMP, f'ch6_{dname}.mp4')
            make_trim(dsrc, dout, 0, dsec)
            # Normalize if needed
            codec = check_codec(dout)
            if '1920,1080,30/1' not in codec:
                ndst = dout.replace('.mp4', '_norm.mp4')
                normalize_video(dout, ndst)
                dout = ndst
            demo_parts.append(dout)

    ch6 = os.path.join(TMP, 'ch6.mp4')
    concat_chapters(demo_parts, ch6)
    force_trim(ch6, os.path.join(TMP, 'ch6_exact.mp4'), CHAPTERS[5])
    chapter_files.append(os.path.join(TMP, 'ch6_exact.mp4'))

    # Ch7: Artifacts + outro with GitHub URL
    art = os.path.join(TMP, 'ch7_art.mp4')
    make_still(os.path.join(DOCS, 'artifact.zh-CN.png'), art, 3.7)
    outro = os.path.join(TMP, 'ch7_outro.mp4')
    make_title(['腾讯技术支持 · GitHub 开源',
                '基于 CodeBuddy Agent SDK',
                'github.com/luoxiaojun1992/game-studio'],
               outro, 5.0)
    ch7 = os.path.join(TMP, 'ch7.mp4')
    concat_chapters([art, outro], ch7)
    force_trim(ch7, os.path.join(TMP, 'ch7_exact.mp4'), CHAPTERS[6])
    chapter_files.append(os.path.join(TMP, 'ch7_exact.mp4'))

    # ---- Step 2: Verify codec uniformity ----
    print("\n[2] Verifying codec uniformity...")
    for cf in chapter_files:
        codec = check_codec(cf)
        ok = '1920,1080,30/1' in codec and 'yuv420p' in codec
        print(f"  {'✓' if ok else '✗'} {os.path.basename(cf)}: {codec}")

    # ---- Step 3: Concatenate all chapters ----
    print("\n[3] Concatenating chapters...")
    raw = os.path.join(TMP, 'raw_assembled.mp4')
    concat_chapters(chapter_files, raw)
    print(f"  Duration: {dur(raw):.1f}s")

    # ---- Step 4: Mux pre-mixed audio ----
    # Audio must be pre-mixed by mix_audio.py (Python PCM mixing)
    mixed_aac = os.path.join(BASE, 'video-assets', 'mixed.aac')
    if os.path.exists(mixed_aac):
        print(f"\n[4] Muxing pre-mixed audio: {mixed_aac}")
        with_audio = os.path.join(TMP, 'with_audio.mp4')
        mux_audio(raw, mixed_aac, with_audio)
    else:
        print("\n[4] WARNING: mixed.aac not found! Run mix_audio.py first.")
        print("  python3 scripts/mix_audio.py voiceover_aligned.mp3 bgm.mp3 mixed.aac")
        with_audio = raw

    # ---- Step 5: Subtitles ----
    print("\n[5] Burning subtitles...")
    srt = os.path.join(BASE, 'video-assets', 'subtitles.srt')

    # Compute cumulative chapter boundaries for subtitle timing
    cum = 0
    srt_segs = []
    texts = [
        "五个AI智能体，组成游戏制作流水线",
        "Game Dev Studio · AI多智能体协作平台",
        "团队面板 + Star Office像素风工作室",
        "对话指令或问卷，快速创建策划案",
        "任务看板跟踪进度，自动驾驶全流程运转",
        "8款微服务，覆盖开发全流程",
        "游戏打包上传 · 欢迎Star",
    ]
    for i, (ch_dur, txt) in enumerate(zip(CHAPTERS, texts)):
        srt_segs.append((cum, cum + ch_dur, txt))
        cum += ch_dur
    make_srt(srt_segs, srt)

    with_subs = os.path.join(TMP, 'with_subs.mp4')
    burn_subs(with_audio, srt, with_subs)

    # ---- Step 6: Watermark ----
    print("\n[6] Adding watermark...")
    watermark(with_subs, OUTPUT)

    # ---- Done ----
    final_dur = dur(OUTPUT)
    final_sz = os.path.getsize(OUTPUT) / (1024*1024)
    print(f"\n{'='*60}")
    print(f"DONE: {OUTPUT}")
    print(f"  {final_dur:.1f}s, {final_sz:.1f}MB, 1920x1080")
    r = subprocess.run(f'ffprobe -v quiet -print_format json -show_streams "{OUTPUT}"',
                       shell=True, capture_output=True, text=True)
    for s in json.loads(r.stdout).get('streams', []):
        print(f"  {s['codec_type']}: {float(s['duration']):.2f}s")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()
