---
name: svg-to-png
description: |
  Converts SVG files to PNG raster images. This skill should be used when the user needs to
  convert an SVG file (diagram, chart, illustration) to PNG format, such as for embedding
  in markdown documents, generating preview images, or when an SVG won't render in a target
  viewer. Trigger: "convert SVG to PNG", "svg转png", "this SVG won't display, make it a PNG",
  "generate png from svg".
agent_created: true
---

# SVG to PNG Converter

## Overview

Convert SVG vector graphics to PNG raster images using `rsvg-convert` (librsvg), the most accurate SVG renderer available. Falls back to `cairosvg` or ImageMagick if `rsvg-convert` is not installed.

## Quick Start

Run the bundled conversion script:

```bash
python3 scripts/convert.py <input.svg> [output.png] [--width W] [--height H]
```

### Examples

```bash
# Basic: auto-detect size from SVG viewBox
python3 scripts/convert.py diagram.svg

# Custom output path
python3 scripts/convert.py diagram.svg output/diagram.png

# Fixed width, auto height (aspect ratio preserved)
python3 scripts/convert.py diagram.svg --width 1200

# Fixed dimensions
python3 scripts/convert.py diagram.svg --width 1200 --height 800
```

## Workflow

1. Locate the source SVG file on disk
2. Run `scripts/convert.py` with appropriate arguments:
   - For diagrams embedded in markdown specs, use `--width 1200` for crisp rendering
   - For smaller inline images, `--width 680` matches the SVG viewBox default
   - Omit `--width` and `--height` to use the SVG's native dimensions
3. Verify the output PNG exists and has reasonable file size
4. Reference the PNG in the markdown document (replace the SVG `img` src)
5. Delete the temporary PNG if it was only needed for verification

## Converter Priority

The script auto-detects and uses the best available converter:

| Priority | Converter | Accuracy | Availability |
|----------|-----------|----------|-------------|
| 1 | `rsvg-convert` (librsvg) | Best | `brew install librsvg` |
| 2 | `cairosvg` (Python) | Good | `pip install cairosvg` |
| 3 | `magick` (ImageMagick) | Adequate | `brew install imagemagick` |

## Common Use Case: Embedding in Markdown Specs

When an SVG diagram embedded in a markdown spec fails to render (e.g., on GitHub PR page), convert it to PNG:

```bash
# 1. Extract the SVG from the markdown or use the source SVG file
# 2. Convert with appropriate width for the spec document
python3 scripts/convert.py .agent/specs/diagram.svg --width 1200

# 3. Update the markdown to reference the PNG instead:
# Before: <img src="data:image/svg+xml;base64,..." alt="diagram">
# After:  ![diagram](./diagram.png)
```

## Resources

### scripts/convert.py

Python script that handles SVG→PNG conversion with multi-engine fallback. Accepts `--width` and `--height` options for output size control. Run directly without loading into context.
