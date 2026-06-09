#!/usr/bin/env python3
"""
Generate chapter-aligned Chinese AI voiceover using edge-tts.
Each chapter's voiceover is padded/trimmed to exactly match its video duration.

Usage: python3 gen_voiceover.py

Outputs:
  - voiceover_aligned.mp3  (full concatenated voiceover)
  - aligned_XX.mp3         (per-chapter aligned segments)
"""

import asyncio, edge_tts, os, subprocess, json

OUT = os.path.dirname(os.path.abspath(__file__))
VOICE = "zh-CN-YunyangNeural"   # Professional male voice
RATE = "-12%"                    # Slightly slower for clarity

# Chapter durations (seconds) — MUST match compose_video.py CHAPTERS
CHAPTER_DURS = [4.4, 5.3, 9.5, 10.4, 9.0, 14.9, 8.7]

# Chapter scripts — each matches the visual content of the chapter
SCRIPTS = [
    "五个AI智能体组成游戏制作流水线。",
    "Game Dev Studio，AI多智能体游戏开发协作平台。",
    "团队面板，随时了解五个角色的实时状态。Star Office像素风工作室，智能体工作可视化。",
    "策划案创建演示：通过对话下达指令，或用结构化问卷填写核心信息。策划案实时推送到列表。",
    "任务看板，实时跟踪每个环节的进度。自动驾驶模式，全流程自动运转，一键交接。",
    "内置八款微服务：Creator三维建模，DrawIO图表，Image图片处理，Video视频转码，"
    "Build构建，Run运行，Test测试，SonarQube代码质量扫描。",
    "游戏自动打包上传，在线预览和下载。基于CodeBuddy Agent SDK构建，欢迎Star。",
]


async def gen(idx, text):
    """Generate TTS segment"""
    f = os.path.join(OUT, f"seg_{idx:02d}.mp3")
    await edge_tts.Communicate(text, VOICE, rate=RATE).save(f)
    return f


def get_dur(f):
    r = subprocess.run(f'ffprobe -v quiet -print_format json -show_format "{f}"',
                       shell=True, capture_output=True, text=True)
    return float(json.loads(r.stdout)['format']['duration'])


def align_segment(seg_path, target_dur, idx):
    """
    Pad or trim a voiceover segment to match its chapter video duration.
    - If voiceover > chapter: trim the end
    - If voiceover < chapter: pad with silence at end
    - If close enough (within 0.01s): copy as-is
    """
    actual = get_dur(seg_path)
    out = os.path.join(OUT, f"aligned_{idx:02d}.mp3")

    if actual > target_dur + 0.01:
        subprocess.run(f'ffmpeg -y -i "{seg_path}" -af "atrim=0:{target_dur}" '
                       f'-c:a libmp3lame -b:a 128k "{out}" 2>/dev/null', shell=True)
        print(f"  Ch{idx+1}: trimmed {actual:.2f}s -> {target_dur:.2f}s")
    elif actual < target_dur - 0.01:
        pad = target_dur - actual
        subprocess.run(f'ffmpeg -y -i "{seg_path}" -af "apad=pad_dur={pad:.3f}" '
                       f'-c:a libmp3lame -b:a 128k "{out}" 2>/dev/null', shell=True)
        print(f"  Ch{idx+1}: padded {actual:.2f}s + {pad:.3f}s = {target_dur:.2f}s")
    else:
        subprocess.run(f'cp "{seg_path}" "{out}"', shell=True)
        print(f"  Ch{idx+1}: kept {actual:.2f}s ≈ {target_dur:.2f}s")

    return out


async def main():
    assert len(SCRIPTS) == len(CHAPTER_DURS), \
        f"SCRIPTS ({len(SCRIPTS)}) and CHAPTER_DURS ({len(CHAPTER_DURS)}) must match!"

    print(f"Generating {len(SCRIPTS)} voiceover segments...")
    print(f"Voice: {VOICE}, Rate: {RATE}")

    # Step 1: Generate raw TTS segments
    seg_files = []
    for i, text in enumerate(SCRIPTS):
        print(f"  [{i+1}/{len(SCRIPTS)}] ({len(text)} chars) {text[:60]}...")
        seg_files.append(await gen(i, text))

    # Step 2: Show raw durations
    print(f"\nRaw voiceover durations vs chapter targets:")
    cum = 0
    for i, (seg, target) in enumerate(zip(seg_files, CHAPTER_DURS)):
        sd = get_dur(seg)
        diff = sd - target
        sign = "+" if diff > 0 else ""
        print(f"  Ch{i+1}: raw={sd:.2f}s target={target:.2f}s ({sign}{diff:.2f}s)")
        cum += sd
    print(f"  Total raw: {cum:.2f}s (target: {sum(CHAPTER_DURS):.2f}s)")

    # Step 3: Align each segment to chapter duration
    print(f"\nAligning segments to chapter durations...")
    aligned = []
    for i, (seg, target) in enumerate(zip(seg_files, CHAPTER_DURS)):
        aligned.append(align_segment(seg, target, i))

    # Step 4: Concatenate into final voiceover
    concat_file = os.path.join(OUT, "aligned_concat.txt")
    with open(concat_file, "w") as f:
        for a in aligned:
            f.write(f"file '{a}'\n")

    out_mp3 = os.path.join(OUT, "voiceover_aligned.mp3")
    subprocess.run(f'ffmpeg -y -f concat -safe 0 -i "{concat_file}" '
                   f'-c copy "{out_mp3}" 2>/dev/null', shell=True)

    final_dur = get_dur(out_mp3)
    print(f"\nAligned voiceover: {out_mp3}")
    print(f"Duration: {final_dur:.2f}s (target: {sum(CHAPTER_DURS):.2f}s)")

    # Show cumulative timing for subtitle creation
    print(f"\nCumulative chapter timing (use for SRT subtitles):")
    cum = 0
    for i, target in enumerate(CHAPTER_DURS):
        print(f"  Ch{i+1}: {cum:.1f}s - {cum+target:.1f}s")
        cum += target


if __name__ == "__main__":
    asyncio.run(main())
