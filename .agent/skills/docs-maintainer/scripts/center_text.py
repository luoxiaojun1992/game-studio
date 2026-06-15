#!/usr/bin/env python3
"""
Universal SVG Text Vertical Centering Script
=============================================
Processes architecture diagrams with box-content structures to vertically
center text blocks within their container boxes. Accounts for font sizes
when computing visual text block centers.

Usage:
  python3 center_text.py <input.svg> [--dry-run] [--output output.svg]

Algorithm:
  visual_top    = first_y - first_font_size * 0.85    (ascender)
  visual_bottom = last_y  + last_font_size  * 0.15    (descender)
  visual_center = (visual_top + visual_bottom) / 2
  delta         = content_area_center - visual_center

Box detection:
  - Content boxes: rect elements with rx=8
  - Title bars: rect at same (x,y) with height 22-34px
  - Title text (when no title rect): text with font-size >= 12 in top 35% of box
"""

import xml.etree.ElementTree as ET
import re
import sys
import argparse

NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)


# ── Helpers ─────────────────────────────────────────────

def fp(v, default=0.0):
    """Parse float from attribute, stripping px suffix."""
    if v is None:
        return default
    return float(re.sub(r'px$', '', str(v)))


def get_tag(elem):
    """Get local tag name (strip namespace)."""
    tag = elem.tag
    return tag.split('}')[1] if '}' in tag else tag


def text_visual_bounds(y, font_size):
    """
    Approximate visual bounds of a single text line.
    Returns (visual_top, visual_bottom).

    Ascender typically ~85% of font-size above baseline.
    Descender typically ~15% below baseline.
    """
    ascent = font_size * 0.85
    descent = font_size * 0.15
    return (y - ascent, y + descent)


# ── Core Algorithm ─────────────────────────────────────

def find_content_boxes(rects):
    """Find content boxes (rects with rx=8)."""
    boxes = []
    for r in rects:
        rx = fp(r.get('rx'))
        if abs(rx - 8.0) < 0.01:
            boxes.append(r)
    return boxes


def find_title_height(rects, box_x, box_y, box_w):
    """
    Find the title bar height for a box at (box_x, box_y).
    A title bar is a rect at the same (x,y) with same width and height 22-34px.
    """
    for r in rects:
        rx = fp(r.get('x'))
        ry = fp(r.get('y'))
        rw = fp(r.get('width'))
        rh = fp(r.get('height'))
        if abs(rx - box_x) < 0.5 and abs(ry - box_y) < 0.5:
            if abs(rw - box_w) < 0.5 and 22 <= rh <= 34:
                return rh
    return 0


def find_title_from_text(box_texts, box_y, box_h):
    """
    For boxes without a title rect, infer title area from the first large text.
    Returns effective title height (including separator space).
    """
    for _, y, fs in box_texts:
        if fs >= 12 and (y - box_y) < box_h * 0.35:
            return (y - box_y) + 25  # 25px for separator + spacing
    return 0


def process_group(group_elem, group_index=0):
    """
    Process a single SVG <g> group.
    Finds all content boxes and centers their text content vertically.
    """
    rects = []
    texts = []

    for child in group_elem:
        tag = get_tag(child)
        if tag == 'rect':
            rects.append(child)
        elif tag == 'text':
            texts.append(child)

    content_boxes = find_content_boxes(rects)
    if not content_boxes:
        return []

    changes = []

    for box in content_boxes:
        bx = fp(box.get('x'))
        by = fp(box.get('y'))
        bw = fp(box.get('width'))
        bh = fp(box.get('height'))

        # ── Collect texts inside this box ──
        box_texts = []
        for t in texts:
            tx = fp(t.get('x', str(bx + bw / 2)))
            ty = fp(t.get('y'))
            if bx - 15 <= tx <= bx + bw + 15 and by < ty <= by + bh:
                fs = fp(t.get('font-size'), 10)
                box_texts.append((t, ty, fs))

        if len(box_texts) < 2:
            continue

        box_texts.sort(key=lambda x: x[1])

        # ── Determine title area ──
        title_h = find_title_height(rects, bx, by, bw)
        if title_h == 0:
            title_h = find_title_from_text(box_texts, by, bh)

        # ── Filter content texts (exclude title area) ──
        title_cutoff = by + title_h + 1
        content_texts = [(t, y, fs) for t, y, fs in box_texts if y >= title_cutoff]

        if len(content_texts) < 2:
            continue

        # ── Content area center ──
        content_top = by + title_h
        content_h = bh - title_h
        content_center = content_top + content_h / 2

        # ── Text block visual center ──
        first = content_texts[0]
        last = content_texts[-1]

        first_top, _ = text_visual_bounds(first[1], first[2])
        _, last_bot = text_visual_bounds(last[1], last[2])

        text_visual_center = (first_top + last_bot) / 2
        delta = content_center - text_visual_center

        if abs(delta) < 0.8:
            continue

        # ── Apply shift ──
        for t, y, fs in content_texts:
            new_y = y + delta
            t.set('y', f'{new_y:.1f}')

        changes.append({
            'box': f'x={bx:.0f} y={by:.0f} w={bw:.0f} h={bh:.0f}',
            'title_h': title_h,
            'content_center': content_center,
            'visual_center': text_visual_center,
            'delta': delta,
            'num_texts': len(content_texts),
            'first_y': first[1],
            'last_y': last[1],
        })

    return changes


# ── Main ────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='Center text vertically in SVG boxes (visual-bounds algorithm)'
    )
    parser.add_argument('input', help='Input SVG file path')
    parser.add_argument(
        '--output', '-o',
        help='Output SVG file path (default: overwrite input)',
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show changes without modifying file',
    )
    args = parser.parse_args()

    tree = ET.parse(args.input)
    root = tree.getroot()

    all_changes = []
    group_count = 0
    for child in root:
        if get_tag(child) == 'g':
            changes = process_group(child, group_index=group_count)
            all_changes.extend(changes)
            group_count += 1

    # ── Report ──
    groups_affected = len(set(c.get('box', '') for c in all_changes))
    print(f"\n{'='*70}")
    print(f"SVG Text Centering Report")
    print(f"{'='*70}")
    print(f"Groups scanned: {group_count}")
    print(f"Boxes needing adjustment: {len(all_changes)}\n")

    if not all_changes:
        print("✓ All text already centered. No changes needed.")
        return

    for c in all_changes:
        print(f"  {c['box']}")
        print(f"    Title: {c['title_h']:.0f}px  |  "
              f"Content center: {c['content_center']:.1f}")
        print(f"    Text y-range: {c['first_y']:.1f}…{c['last_y']:.1f}  |  "
              f"Lines: {c['num_texts']}")
        print(f"    Visual center: {c['visual_center']:.1f}  →  "
              f"Shift: {c['delta']:+.1f}px")
        print()

    # ── Write ──
    output = args.output or args.input
    if args.dry_run:
        print(f"[DRY RUN] Would write to: {output}")
    else:
        tree.write(output, xml_declaration=True, encoding='unicode')
        print(f"✓ Written: {output}")


if __name__ == '__main__':
    main()
