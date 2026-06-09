/**
 * Record HTML/Canvas demo animations at 1920×1080 using Playwright + system Chrome.
 *
 * Usage: node record_demos.cjs
 *
 * Prerequisites:
 *   npm install playwright  (in the directory where this script runs)
 *
 * Edit the `DEMOS` array to add/remove demo pages.
 * Output: .mp4 files in the same directory (H.264, 10fps, 1080p).
 */

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const OUT_DIR = __dirname;
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 10;

// Demo pages to record
const DEMOS = [
  { name: 'architecture', file: 'demo-architecture.html', duration: 10000 },
  { name: 'image-pipeline', file: 'demo-image-pipeline.html', duration: 8000 },
  { name: 'workflow', file: 'demo-workflow.html', duration: 8000 },
  { name: 'logo-intro', file: 'brand-logo.html', duration: 6000 },
];

async function recordDemo(name, htmlFile, durationMs) {
  const htmlPath = path.join(OUT_DIR, htmlFile);
  if (!fs.existsSync(htmlPath)) {
    console.log(`  SKIP ${name}: ${htmlFile} not found`);
    return;
  }

  const framesDir = path.join(OUT_DIR, `frames_${name}`);
  fs.mkdirSync(framesDir, { recursive: true });

  console.log(`  Recording: ${name} (${durationMs}ms)...`);

  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });

  const fileUrl = `file://${htmlPath}`;
  await page.goto(fileUrl, { waitUntil: 'networkidle' });

  // Capture frames
  const totalFrames = Math.ceil(durationMs / 1000 * FPS);
  const interval = 1000 / FPS;

  for (let i = 0; i < totalFrames; i++) {
    const framePath = path.join(framesDir, `frame_${String(i).padStart(6, '0')}.png`);
    await page.screenshot({ path: framePath });
    if (i < totalFrames - 1) {
      await page.waitForTimeout(interval);
    }
  }

  await browser.close();

  // Encode to MP4 with ffmpeg
  const mp4Path = path.join(OUT_DIR, `demo-${name}.mp4`);
  await new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-framerate', String(FPS),
      '-i', path.join(framesDir, 'frame_%06d.png'),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'fast',
      '-crf', '18',
      '-an',
      mp4Path
    ], { stdio: 'inherit' });
    ffmpeg.on('close', (code) => {
      // Cleanup frames
      fs.rmSync(framesDir, { recursive: true, force: true });
      code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`));
    });
  });

  console.log(`    -> ${mp4Path}`);
}

(async () => {
  console.log(`Recording ${DEMOS.length} demos at ${WIDTH}x${HEIGHT} ${FPS}fps...\n`);

  for (const demo of DEMOS) {
    await recordDemo(demo.name, demo.file, demo.duration);
  }

  console.log('\nAll demos recorded.');
})();
