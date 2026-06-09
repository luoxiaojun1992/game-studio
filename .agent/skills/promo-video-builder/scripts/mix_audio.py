#!/usr/bin/env python3
"""
Python PCM-level audio mixing: voiceover + background music.

CRITICAL: Do NOT use ffmpeg `amix` for this task. The `amix` filter fails
silently when input streams have different sample rates or channel counts.
edge-tts outputs 24000Hz mono, while downloaded BGM is typically 44100Hz stereo.
The `amix` filter does NOT reliably resample/conform mismatched streams.

This script:
  1. Decodes both voiceover and BGM to 48000Hz mono WAV (unified format)
  2. Mixes sample-by-sample with BGM fade envelope
  3. Encodes output to AAC

Usage: python3 mix_audio.py <voiceover.mp3> <bgm.mp3> <output.aac>

Parameters (edit in main()):
  - BGM_VOL: background music volume (0.0-1.0, default 0.55)
  - FADE_IN_S: BGM fade-in duration (seconds)
  - FADE_OUT_S: BGM fade-out duration (seconds)
"""

import subprocess, struct, sys, os

SAMPLE_RATE = 48000
BGM_VOL = 0.55
FADE_IN_S = 2
FADE_OUT_S = 5


def decode_to_wav(src, dst):
    """Decode any audio file to 48000Hz mono PCM WAV"""
    subprocess.run(
        f'ffmpeg -y -i "{src}" -ar {SAMPLE_RATE} -ac 1 -f wav -c:a pcm_s16le "{dst}" 2>/dev/null',
        shell=True, check=True)


def read_wav(path):
    """Read 16-bit mono WAV file, return list of int samples"""
    with open(path, 'rb') as f:
        f.seek(44)  # Skip WAV header
        data = f.read()
    samples = []
    for i in range(0, len(data), 2):
        samples.append(struct.unpack('<h', data[i:i+2])[0])
    return samples


def write_wav(path, samples):
    """Write 16-bit mono WAV file"""
    with open(path, 'wb') as f:
        data_size = len(samples) * 2
        f.write(b'RIFF')
        f.write(struct.pack('<I', 36 + data_size))
        f.write(b'WAVE')
        f.write(b'fmt ')
        f.write(struct.pack('<IHHIIHH', 16, 1, 1, SAMPLE_RATE,
                           SAMPLE_RATE * 2, 2, 16))
        f.write(b'data')
        f.write(struct.pack('<I', data_size))
        for s in samples:
            f.write(struct.pack('<h', max(-32768, min(32767, s))))


def mix(vo_path, bgm_path, out_path):
    """Mix voiceover + BGM with fade envelope"""
    # Decode to unified format
    tmp_vo = '/tmp/_vo_mix.wav'
    tmp_bgm = '/tmp/_bgm_mix.wav'
    decode_to_wav(vo_path, tmp_vo)
    decode_to_wav(bgm_path, tmp_bgm)

    vo = read_wav(tmp_vo)
    bgm = read_wav(tmp_bgm)

    print(f"Voiceover: {len(vo)} samples ({len(vo)/SAMPLE_RATE:.1f}s)")
    print(f"BGM:       {len(bgm)} samples ({len(bgm)/SAMPLE_RATE:.1f}s)")

    # Mix
    fade_in = int(FADE_IN_S * SAMPLE_RATE)
    fade_out = int(FADE_OUT_S * SAMPLE_RATE)
    min_len = min(len(vo), len(bgm))
    output = []

    for i in range(min_len):
        # BGM fade envelope
        factor = BGM_VOL
        if i < fade_in:
            factor *= i / fade_in
        elif i > min_len - fade_out:
            factor *= (min_len - i) / fade_out

        mixed = vo[i] + int(bgm[i] * factor)
        output.append(max(-32768, min(32767, mixed)))

    # Voiceover-only tail if BGM is shorter
    for i in range(min_len, len(vo)):
        output.append(vo[i])

    print(f"Mixed: {len(output)} samples ({len(output)/SAMPLE_RATE:.1f}s)")
    print(f"  BGM volume: {BGM_VOL*100:.0f}%")
    print(f"  Fade in: {FADE_IN_S}s, Fade out: {FADE_OUT_S}s")

    # Write WAV → encode to AAC
    tmp_mix = '/tmp/_mixed.wav'
    write_wav(tmp_mix, output)

    subprocess.run(
        f'ffmpeg -y -i "{tmp_mix}" -c:a aac -b:a 256k "{out_path}" 2>/dev/null',
        shell=True, check=True)

    # Verify
    r = subprocess.run(f'ffmpeg -i "{out_path}" -af "volumedetect" -f null /dev/null 2>&1',
                       shell=True, capture_output=True, text=True)
    for line in r.stderr.split('\n'):
        if 'mean_volume' in line or 'max_volume' in line:
            print(f"  {line.strip()}")

    # Cleanup temp files
    for f in [tmp_vo, tmp_bgm, tmp_mix]:
        if os.path.exists(f):
            os.remove(f)


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python3 mix_audio.py <voiceover.mp3> <bgm.mp3> [output.aac]")
        print("Example: python3 mix_audio.py voiceover_aligned.mp3 bgm-chronos.mp3 mixed.aac")
        sys.exit(1)

    vo = sys.argv[1]
    bgm = sys.argv[2]
    out = sys.argv[3] if len(sys.argv) > 3 else 'mixed.aac'
    mix(vo, bgm, out)
    print(f"\nDone: {out}")
