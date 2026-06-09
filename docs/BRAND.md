# Game Dev Studio — Brand Identity System

[中文文档 (Chinese)](./BRAND.zh-CN.md)

> Version 1.0 · 2026-06-09

## 1. Logo

![Game Dev Studio Logo](./images/brand/logo.svg)

The logo represents a **game controller** with a D-pad (left) and action buttons (right), surrounded by 8 symmetrically placed dots representing the multi-agent ecosystem. The design communicates "AI-powered game development" through clean geometric shapes and a tech-forward color palette.

### Logo Mark

| Element | Description |
|---------|-------------|
| Controller Body | Rounded rectangle (`rx=40`) with deep blue gradient (`#1e4470` → `#0a1628`) |
| D-pad | Cross-shaped directional pad on the left side (`#4fc3f7`) |
| Action Buttons | Three circular buttons on the right side (`#7c4dff` / `#4fc3f7`) |
| Perimeter Dots | 8 dots at 45° intervals, alternating between Primary and Secondary colors |
| ViewBox | `0 0 480 480` — square aspect ratio, scalable vector |

### Logo Variants

Only one color variant is defined for now — the standard **dark theme** version. Always use this on dark backgrounds (`#050510` or darker).

### Clear Space

Maintain a minimum clear space of **25% of the logo height** on all sides. No text, graphics, or UI elements should intrude into this zone.

### Minimum Size

- **Digital**: Height ≥ 32px
- **Print**: Width ≥ 15mm

---

## 2. Color Palette

| Role | Hex | Preview | Usage |
|------|-----|---------|-------|
| **Background** | `#050510` | ████████ | Primary dark background, canvas |
| **Primary** | `#4FC3F7` | ████████ | Main accent, brand highlights, interactive elements |
| **Secondary** | `#7C4DFF` | ████████ | Supporting accent, secondary actions, emphasis |
| **Panel** | `#0D1B2E` | ████████ | Card backgrounds, panels, elevated surfaces |
| **Border** | `#1A3050` | ████████ | Dividers, borders, disabled states |
| **Text Muted** | `#92A8C0` | ████████ | Secondary text, captions, placeholders |

### Color Usage Ratio

Follow the **60-30-10** principle:
- **60%** — Background / Panel (dark neutrals)
- **30%** — Primary / Secondary (brand accents)
- **10%** — Highlights and decorative elements

---

## 3. Typography

### Brand Name

| Property | Value |
|----------|-------|
| Font | **Space Grotesk Bold** |
| Size | 56px (headline) — 72px (hero) |
| Color | Linear gradient: `#4FC3F7` → `#7C4DFF` |
| Letter Spacing | 6px |
| Text Transform | Uppercase |

### Tagline & Body

| Property | Value |
|----------|-------|
| Font | **DM Sans Regular** |
| Size | 22–24px (tagline), 16–18px (body) |
| Color | `#92A8C0` (muted) or `#7899B0` (tagline) |

### Font Hierarchy

| Level | Font | Size | Weight | Color |
|-------|------|------|--------|-------|
| H1 / Brand | Space Grotesk | 56–72px | Bold | Gradient |
| H2 / Section | Space Grotesk | 28–36px | Bold | `#4FC3F7` |
| Body | DM Sans | 16–24px | Regular | `#92A8C0` |
| Caption | DM Sans | 14px | Regular | `#5C798F` |

---

## 4. Usage Guidelines

### ✅ Do

- Use the logo on dark backgrounds (`#050510` or `#0D1B2E`)
- Maintain the 25% clear space rule
- Use the gradient brand name on dark surfaces
- Keep the logo proportional (do not stretch or skew)
- Use Primary (`#4FC3F7`) as the dominant accent in UI

### ❌ Don't

- Place the logo on bright/white backgrounds
- Alter the logo colors or proportions
- Add drop shadows, glows, or other effects
- Rotate or flip the logo
- Use the logo smaller than 32px in digital contexts
- Combine the logo with other graphics in its clear space

---

## 5. Assets

| File | Path | Description |
|------|------|-------------|
| Logo SVG | `docs/images/brand/logo.svg` | Vector logo mark, 480×480 viewBox |
| Design Source | `.ardot/` project file | Ardot editable design file (AI品牌Logo设计) |

---

## 6. Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-06-09 | 1.0 | Initial brand identity system: Logo, color palette, typography, usage guidelines |
