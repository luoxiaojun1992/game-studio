"""
ImageMagick command generators.

Each function returns the command list to be executed
via imagemagick.execute().
"""

from typing import Literal

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------
TARGET_FORMATS = Literal["png", "jpg", "webp", "avif", "gif", "bmp"]
GRAVITIES = Literal[
    "center", "north", "south", "east", "west",
    "northeast", "northwest", "southeast", "southwest"
]
FLIP_ROTATE_MODES = Literal["flip", "flop", "rotate", "transpose", "transverse"]
WATERMARK_TYPES = Literal["text", "image"]


# ---------------------------------------------------------------------------
# Image Operations
# ---------------------------------------------------------------------------

def resize(
    input_path: str,
    output_path: str,
    width: int,
    height: int,
    keep_aspect: bool = True,
) -> list[str]:
    """
    Resize an image.

    Args:
        input_path: Path to input image.
        output_path: Path for output image.
        width: Target width in pixels.
        height: Target height in pixels.
        keep_aspect: If True, use ^ + gravity center + extent to fill while keeping aspect.
    """
    geometry = f"{width}x{height}"
    if keep_aspect:
        return [
            "magick", input_path,
            "-resize", f"{geometry}^",
            "-gravity", "center",
            "-extent", geometry,
            output_path,
        ]
    else:
        return [
            "magick", input_path,
            "-resize", f"{geometry}!",
            output_path,
        ]


def crop(
    input_path: str,
    output_path: str,
    width: int,
    height: int,
    x: int,
    y: int,
) -> list[str]:
    """Crop an image to the specified dimensions at the given offset."""
    return [
        "magick", input_path,
        "-crop", f"{width}x{height}+{x}+{y}",
        "+repage",
        output_path,
    ]


def convert_format(
    input_path: str,
    output_path: str,
    target_format: TARGET_FORMATS,
) -> list[str]:
    """Convert an image to a different format."""
    return [
        "magick", input_path,
        output_path,
    ]


def compress(
    input_path: str,
    output_path: str,
    quality: int,
) -> list[str]:
    """Compress an image by adjusting quality."""
    return [
        "magick", input_path,
        "-quality", str(quality),
        output_path,
    ]


def watermark_text(
    input_path: str,
    output_path: str,
    text: str,
    position: str = "southeast",
    opacity: float = 0.5,
    font_size: int = 24,
) -> list[str]:
    """Add a text watermark to an image."""
    opacity_pct = int(opacity * 100)
    return [
        "magick", input_path,
        "-font", "Noto-Sans-CJK-SC",
        "-pointsize", str(font_size),
        "-fill", f"rgba(255,255,255,{opacity_pct}%)",
        "-gravity", position,
        "-annotate", "+10+10", text,
        output_path,
    ]


def watermark_image(
    input_path: str,
    overlay_path: str,
    output_path: str,
    position: str = "southeast",
    opacity: float = 0.5,
) -> list[str]:
    """Add an image watermark overlay."""
    opacity_pct = int(opacity * 100)
    return [
        "magick", input_path,
        "(", overlay_path, "-alpha", "set",
        "-channel", "A", "-evaluate", "set", f"{opacity_pct}%", "+channel", ")",
        "-gravity", position,
        "-geometry", "+10+10",
        "-composite",
        output_path,
    ]


def composite(
    base_path: str,
    overlay_path: str,
    output_path: str,
    gravity: GRAVITIES = "center",
    x: int = 0,
    y: int = 0,
) -> list[str]:
    """Composite (overlay) one image on top of another."""
    if x != 0 or y != 0:
        geometry = f"+{x}+{y}"
        return [
            "magick", base_path,
            overlay_path,
            "-gravity", gravity,
            "-geometry", geometry,
            "-composite",
            output_path,
        ]
    else:
        return [
            "magick", base_path,
            overlay_path,
            "-gravity", gravity,
            "-composite",
            output_path,
        ]


def flip_rotate(
    input_path: str,
    output_path: str,
    mode: FLIP_ROTATE_MODES,
    angle: int = 90,
) -> list[str]:
    """Flip or rotate an image."""
    cmd = ["magick", input_path]

    if mode == "flip":
        cmd.append("-flip")
    elif mode == "flop":
        cmd.append("-flop")
    elif mode == "transpose":
        cmd.append("-transpose")
    elif mode == "transverse":
        cmd.append("-transverse")
    elif mode == "rotate":
        cmd.extend(["-rotate", str(angle)])

    cmd.append(output_path)
    return cmd


def add_margin(
    input_path: str,
    output_path: str,
    top: int,
    right: int,
    bottom: int,
    left: int,
    color: str = "transparent",
) -> list[str]:
    """Add margin/border around an image."""
    return [
        "magick", input_path,
        "-bordercolor", color,
        "-border", f"{left}x{top}",
        output_path,
    ]


def color_adjust(
    input_path: str,
    output_path: str,
    brightness: int = 0,
    contrast: int = 0,
    saturation: int = 100,
    hue: int = 100,
) -> list[str]:
    """Adjust color properties of an image."""
    cmd = ["magick", input_path]

    # brightness-contrast: IM uses percent values
    if brightness != 0 or contrast != 0:
        cmd.extend(["-brightness-contrast", f"{brightness}x{contrast}"])

    # modulate: brightness,saturation,hue (100=original)
    cmd.extend(["-modulate", f"100,{saturation},{hue}"])

    cmd.append(output_path)
    return cmd


def image_info(input_path: str) -> list[str]:
    """Get detailed information about an image."""
    return [
        "magick", "identify",
        "-verbose",
        input_path,
    ]


def batch(
    input_paths: list[str],
    output_dir: str,
    operation: str,
    operation_params: dict,
) -> list[list[str]]:
    """
    Generate commands for batch processing multiple images.

    Args:
        input_paths: List of input file paths.
        output_dir: Directory for output files.
        operation: Operation name (resize/convert/compress).
        operation_params: Parameters for the operation.

    Returns:
        List of command lists (one per image).
    """
    import os
    commands = []

    for input_path in input_paths:
        base = os.path.splitext(os.path.basename(input_path))[0]

        if operation == "resize":
            width = operation_params.get("width", 256)
            height = operation_params.get("height", 256)
            keep_aspect = operation_params.get("keep_aspect", True)
            output_path = os.path.join(output_dir, f"{base}_resized.png")
            commands.append(resize(input_path, output_path, width, height, keep_aspect))

        elif operation == "convert":
            fmt = operation_params.get("target_format", "png")
            output_path = os.path.join(output_dir, f"{base}.{fmt}")
            commands.append(convert_format(input_path, output_path, fmt))

        elif operation == "compress":
            quality = operation_params.get("quality", 80)
            output_path = os.path.join(output_dir, f"{base}_compressed.jpg")
            commands.append(compress(input_path, output_path, quality))

    return commands


def sprite_sheet(
    input_paths: list[str],
    output_path: str,
    columns: int,
    rows: int,
    tile_width: int = None,
    tile_height: int = None,
) -> list[str]:
    """Create a sprite sheet from multiple images."""
    cmd = [
        "magick", "montage",
    ]
    cmd.extend(input_paths)
    cmd.extend([
        "-tile", f"{columns}x{rows}",
        "-geometry", "+0+0",
        "-background", "none",
        output_path,
    ])
    return cmd
