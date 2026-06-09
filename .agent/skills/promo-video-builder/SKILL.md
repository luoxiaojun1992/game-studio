---
name: promo-video-builder
description: |
  Build product promotional videos from GitHub Actions CI Playwright test recordings,
  project screenshots, and demo animations. Supports AI voiceover (edge-tts), free BGM
  sourcing (freepd.cn), per-chapter audio-video sync, Python PCM audio mixing, FFmpeg
  composition, subtitle burning, and watermarking.
  Triggers: 制作宣传视频, 生成产品演示视频, build promo video, create product demo video.
agent_created: true
---

# Promo Video Builder Skill

Full pipeline: CI artifacts → video composition → voiceover → BGM → export.

## Pipeline Overview

```
Phase 1: Asset Collection
  ├── GH API → download allure-report artifact → extract video.webm
  ├── Project screenshots (docs/images/*.png)
  └── Demo HTML/Canvas animations → record via Playwright

Phase 2: Audio Generation
  ├── edge-tts → per-chapter Chinese voiceover (zh-CN-YunyangNeural, rate=-12%)
  ├── Per-chapter pad/trim to match video chapter durations
  └── BGM: download from freepd.cn (NOT self-generated via Python sine waves)

Phase 3: Video Pre-processing
  ├── Normalize all clips to 1920×1080 30fps (critical for concat to work)
  ├── Re-encode 4K/10fps clips to 1080p 30fps
  ├── Still frames: replace tab-switching in long CI recordings
  └── Title cards: ffmpeg drawtext with Arial Unicode font

Phase 4: Audio Mixing (Python PCM, NOT ffmpeg amix)
  ├── Decode both voiceover + BGM to 48000Hz mono WAV
  ├── Sample-by-sample addition with fade envelope on BGM
  └── Encode to AAC → mux with video

Phase 5: FFmpeg Composition
  ├── Concat filter: assemble chapters (uniform codec required!)
  ├── Subtitles: burn SRT (chapter-aligned timing)
  └── Watermark: drawtext bottom-right
```

## Other Skills to Call

| Skill | When to Use |
|-------|-------------|
| `playwright-cli` | Record HTML/Canvas demo animations at 1080p |
| `多模态内容生成` | Generate AI video footage (text-to-video) for intro/transitions |

## Scripts

### `scripts/compose_video.py` — Main Composition Engine

Orchestrates the entire pipeline. Edit `main()` to customize chapters, shot_map, and segments.

**Key functions:**

| Function | Purpose |
|----------|---------|
| `normalize_video()` | Re-encode to 1920×1080 30fps yuv420p (UNIFORM CODEC MANDATORY for concat) |
| `make_still()` | Loop PNG → video at exact duration |
| `make_title()` | Title card with ffmpeg drawtext (Chinese font: Arial Unicode) |
| `make_trim()` | Trim video segment |
| `make_slow()` | Slow down by factor N (`setpts=N*PTS`) |
| `concat_chapters()` | Concat filter assembly — requires uniform codec on all inputs |
| `force_trim()` | Enforce exact chapter duration |
| `burn_subs()` | Burn SRT subtitles |
| `watermark()` | Brand watermark |

### `scripts/gen_voiceover.py` — AI Voiceover

Generates per-chapter segments with edge-tts, then pads/trims each to exact chapter duration. Outputs `voiceover_aligned.mp3` and per-chapter `aligned_XX.mp3` files.

**Usage**: `python3 gen_voiceover.py`
Edit `SCRIPTS` and `CHAPTER_DURS` to match your video chapter structure.

### `scripts/mix_audio.py` — Python PCM Audio Mixing

**CRITICAL: Do NOT use ffmpeg `amix`** — it fails silently when input streams have different sample rates or channel counts (common with edge-tts 24000Hz mono + BGM 44100Hz stereo).

This script decodes both voiceover and BGM to 48000Hz mono WAV, mixes sample-by-sample with BGM volume envelope, and encodes to AAC.

**Usage**: `python3 mix_audio.py vo_aligned.mp3 bgm.mp3 output.aac`

### `scripts/record_demos.cjs` — Demo Recording

Records HTML/Canvas pages at 1920×1080 using Playwright + system Chrome. Outputs H.264 MP4.

**Usage**: `node record_demos.cjs`

## Critical Pitfalls

### 1. Codec Uniformity (MUST READ)

When using ffmpeg concat filter, ALL input files must have identical:
- Resolution (1920×1080)
- Frame rate (30fps)
- Pixel format (yuv420p)
- Codec (libx264)

**Check before concat:**
```bash
for f in chapter*.mp4; do
  ffprobe -v error -show_entries stream=width,height,r_frame_rate,pix_fmt -of csv=p=0 "$f"
done
```

If any differ, re-encode with `normalize_video()`.

### 2. Chinese Font Rendering

ALWAYS use `/Library/Fonts/Arial Unicode.ttf` on macOS — NEVER `PingFang.ttc`.

### 3. Per-Chapter Audio-Video Sync (KEY FIX from v7)

**Problem**: Global silence padding (e.g., 1.5s) shifts ALL chapters, causing narration to overlap into adjacent chapters.

**Solution**: Pad/trim each voiceover segment to its chapter duration individually.
```python
# For each chapter_i:
# if seg_dur > chapter_dur: atrim=0:chapter_dur
# if seg_dur < chapter_dur: apad=pad_dur=(chapter_dur - seg_dur)
```

Subtitles must use chapter video boundaries, NOT voiceover boundaries.

### 4. BGM Sourcing

Use **freepd.cn** (Chinese CDN mirror of FreePD.com, Kevin MacLeod's CC0 library):
- Access speed: ~230KB/s from China
- All tracks CC0: free commercial use, no attribution

**Banned sources:**
- Incompetech direct (too slow, ~5KB/s)
- Mixkit (hotlink protection returns 403)
- Bensound (requires browser interaction)
- Self-generated Python sine waves (user explicitly forbids)

**Recommended tracks for tech product videos:**
- `Electronic/Chronos` — sci-fi electronic, 129s
- `Electronic/Space Ambience` — ambient, 276s
- `Upbeat/Motions` — driving beat, 117s

**Download pattern:**
```bash
# 1. Fetch RSC payload to discover track hex paths
curl -s "https://freepd.cn/music?_rsc=1" > /tmp/freepd_rsc.txt

# 2. Extract hex-encoded track paths with Python
# 3. Download: curl -o track.mp3 "https://freepd.cn/api/music/{hex_path}"
```

### 5. GitHub Artifact Download

```bash
# GH_TOKEN must be set in environment (never hardcode in scripts)
# Find latest CI run
gh run list --repo OWNER/REPO --workflow=CI --limit=5

# List artifacts
gh api repos/OWNER/REPO/actions/runs/RUN_ID/artifacts

# Download allure-report
gh run download RUN_ID --repo OWNER/REPO --name allure-report --dir artifacts/
```

### 6. Tab Switching in CI Recordings

CI Playwright tests contain excessive tab-switching loops. Use `extract_still_frame()` to capture a single representative frame → static clip.

### 7. Playwright on Managed Python Runtime

Managed Python 3.13 may have `greenlet` code-signing issues. Use Node.js Playwright with system Chrome:
```javascript
const { chromium } = require('playwright');
const browser = await chromium.launch({ channel: 'chrome' });
```

## Video Structure Convention

Keep under 2 minutes. Typical 7-chapter structure:
1. AI visualization / intro (4-5s)
2. Logo + product name (5s)
3. Platform overview: team panel + studio (9-10s)
4. Smart features: CI clips + screenshots (10s)
5. Workflow: task board + autopilot (9s)
6. Microservices showcase (15s)
7. Artifacts + outro with GitHub URL (8-9s)

Total: ~62s
