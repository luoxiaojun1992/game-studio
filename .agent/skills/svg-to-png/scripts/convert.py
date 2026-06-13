#!/usr/bin/env python3
"""
SVG to PNG converter using rsvg-convert (librsvg).
Falls back to cairosvg if rsvg-convert is not available.

Usage:
  python3 convert.py <input.svg> [output.png] [--width W] [--height H]

Examples:
  python3 convert.py diagram.svg                    # → diagram.png (auto size)
  python3 convert.py diagram.svg output.png          # → output.png (auto size)
  python3 convert.py diagram.svg --width 1200        # → diagram.png (1200px wide, auto height)
  python3 convert.py diagram.svg --width 1200 --height 800  # fixed size
"""

import subprocess
import sys
import os
import shutil
from pathlib import Path


def find_converter():
    """Find available SVG→PNG converter. Prefer rsvg-convert, fallback to cairosvg."""
    if shutil.which("rsvg-convert"):
        return "rsvg-convert"
    try:
        import cairosvg
        return "cairosvg"
    except ImportError:
        pass
    # Last resort: ImageMagick (less accurate but widely available)
    if shutil.which("magick"):
        return "magick"
    return None


def convert_rsvg(input_path, output_path, width=None, height=None):
    """Convert using rsvg-convert."""
    cmd = ["rsvg-convert", "-o", output_path]
    if width:
        cmd.extend(["-w", str(width)])
    if height:
        cmd.extend(["-h", str(height)])
    cmd.append(input_path)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"rsvg-convert failed: {result.stderr}")
    return True


def convert_cairosvg(input_path, output_path, width=None, height=None):
    """Convert using cairosvg library."""
    import cairosvg
    with open(input_path, "rb") as f:
        svg_data = f.read()
    kwargs = {}
    if width:
        kwargs["output_width"] = width
    if height:
        kwargs["output_height"] = height
    cairosvg.svg2png(bytestring=svg_data, write_to=output_path, **kwargs)
    return True


def convert_magick(input_path, output_path, width=None, height=None):
    """Convert using ImageMagick (fallback)."""
    cmd = ["magick", "-background", "none", "-density", "300", input_path]
    if width and height:
        cmd.extend(["-resize", f"{width}x{height}"])
    elif width:
        cmd.extend(["-resize", f"{width}x"])
    cmd.append(output_path)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ImageMagick failed: {result.stderr}")
    return True


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    input_path = sys.argv[1]
    if not os.path.exists(input_path):
        print(f"Error: file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    # Parse arguments
    args = sys.argv[2:]
    output_path = None
    width = None
    height = None
    i = 0
    while i < len(args):
        if args[i] == "--width" and i + 1 < len(args):
            width = int(args[i + 1])
            i += 2
        elif args[i] == "--height" and i + 1 < len(args):
            height = int(args[i + 1])
            i += 2
        elif not args[i].startswith("--") and output_path is None:
            output_path = args[i]
            i += 1
        else:
            i += 1

    if output_path is None:
        base = os.path.splitext(input_path)[0]
        output_path = f"{base}.png"

    converter = find_converter()
    if converter is None:
        print(
            "Error: No SVG converter found. Install one of: rsvg-convert, cairosvg, or ImageMagick.",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        if converter == "rsvg-convert":
            convert_rsvg(input_path, output_path, width, height)
        elif converter == "cairosvg":
            convert_cairosvg(input_path, output_path, width, height)
        elif converter == "magick":
            convert_magick(input_path, output_path, width, height)

        size_bytes = os.path.getsize(output_path)
        size_kb = size_bytes / 1024
        print(f"Converted: {input_path} → {output_path}")
        print(f"Size: {size_kb:.1f} KB")
        if width:
            print(f"Width: {width}px")
        if height:
            print(f"Height: {height}px")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
