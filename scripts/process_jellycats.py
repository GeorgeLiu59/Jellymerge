from __future__ import annotations

import json
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "JellyCats"
OUT_DIR = ROOT / "public" / "assets" / "jellycats"
PREVIEW_DIR = ROOT / "processed-preview"

ORDER = [
    ("cherry.jpg", "Cherry"),
    ("blueberry.jpeg", "Blueberry"),
    ("apple.jpg", "Apple"),
    ("orange.jpeg", "Orange"),
    ("peach.jpg", "Peach"),
    ("dragonfruit.jpeg", "Dragonfruit"),
    ("pancake.jpg", "Pancake"),
    ("rose.jpg", "Rose"),
    ("blossom_bunny.jpg", "Blossom Bunny"),
    ("strawberry_bear.jpg", "Strawberry Bear"),
    ("final_flowers.jpg", "Anniversary Bouquet"),
]


def is_background(pixel: tuple[int, int, int, int]) -> bool:
    r, g, b, _ = pixel
    brightness = (r + g + b) / 3
    spread = max(r, g, b) - min(r, g, b)
    # Keep plush whites by only classifying very neutral edge tones as background.
    is_plain_photo_backdrop = brightness > 224 and spread < 32
    is_extreme_white_backdrop = brightness > 244 and spread < 14
    return is_plain_photo_backdrop or is_extreme_white_backdrop


def flood_background(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()
    seen = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def push(x: int, y: int) -> None:
        if 0 <= x < width and 0 <= y < height:
            index = y * width + x
            if not seen[index]:
                seen[index] = 1
                queue.append((x, y))

    for x in range(width):
        push(x, 0)
        push(x, height - 1)
    for y in range(height):
        push(0, y)
        push(width - 1, y)

    mask = Image.new("L", (width, height), 0)
    mask_pixels = mask.load()
    while queue:
        x, y = queue.popleft()
        if not is_background(pixels[x, y]):
            continue
        mask_pixels[x, y] = 255
        push(x + 1, y)
        push(x - 1, y)
        push(x, y + 1)
        push(x, y - 1)

    for _ in range(3):
        additions = []
        for y in range(1, height - 1):
            for x in range(1, width - 1):
                if mask_pixels[x, y] > 0:
                    continue
                r, g, b, _ = pixels[x, y]
                brightness = (r + g + b) / 3
                spread = max(r, g, b) - min(r, g, b)
                touches_background = (
                    mask_pixels[x + 1, y] > 0
                    or mask_pixels[x - 1, y] > 0
                    or mask_pixels[x, y + 1] > 0
                    or mask_pixels[x, y - 1] > 0
                )
                if touches_background and spread < 24 and brightness > 232:
                    additions.append((x, y))
        if not additions:
            break
        for x, y in additions:
            mask_pixels[x, y] = 255

    mask = mask.filter(ImageFilter.GaussianBlur(1.2)) if False else mask
    alpha = Image.new("L", (width, height), 255)
    alpha_pixels = alpha.load()
    mask_pixels = mask.load()
    for y in range(height):
        for x in range(width):
            if mask_pixels[x, y] > 0:
                alpha_pixels[x, y] = 0

    rgba.putalpha(alpha)
    return rgba


def reduce_edge_shadows(image: Image.Image) -> Image.Image:
    """Fade neutral cast shadows that cling to the bottom outer edge."""
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()
    alpha = rgba.getchannel("A")
    alpha_pixels = alpha.load()

    bottoms = [-1] * width
    for x in range(width):
        for y in range(height - 1, -1, -1):
            if alpha_pixels[x, y] > 0:
                bottoms[x] = y
                break

    for x, bottom in enumerate(bottoms):
        if bottom < 0:
            continue
        start = max(0, bottom - 34)
        span = max(1, bottom - start)
        for y in range(start, bottom + 1):
            alpha_value = alpha_pixels[x, y]
            if alpha_value == 0:
                continue
            r, g, b, _ = pixels[x, y]
            brightness = (r + g + b) / 3
            spread = max(r, g, b) - min(r, g, b)
            if spread > 36 or brightness < 96 or brightness > 222:
                continue

            touches_air = False
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if nx < 0 or nx >= width or ny < 0 or ny >= height or alpha_pixels[nx, ny] == 0:
                    touches_air = True
                    break
            if not touches_air:
                continue

            edge_bias = (y - start) / span
            faded_alpha = int(alpha_value * (1 - 0.45 * edge_bias))
            if faded_alpha < 64:
                faded_alpha = 0
            pixels[x, y] = (r, g, b, faded_alpha)

    return rgba


def trim_and_pad(image: Image.Image, padding_ratio: float = 0.12) -> Image.Image:
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        return image
    cropped = image.crop(bbox)
    padding = max(10, round(max(cropped.size) * padding_ratio))
    padded = Image.new("RGBA", (cropped.width + padding * 2, cropped.height + padding * 2), (255, 255, 255, 0))
    padded.alpha_composite(cropped, (padding, padding))
    return padded


def fit_square(image: Image.Image, size: int = 360) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    scale = min(size * 0.86 / image.width, size * 0.86 / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    x = (size - resized.width) // 2
    y = (size - resized.height) // 2
    canvas.alpha_composite(resized, (x, y))
    return canvas


def alpha_parts(image: Image.Image) -> list[dict[str, float]]:
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        return [{"x": 0, "y": 0, "r": 0.45}]

    left, top, right, bottom = bbox
    width = right - left
    height = bottom - top
    # Smaller cells produce a denser, more faithful multi-circle hitbox.
    cell = max(12, round(max(width, height) / 8))
    parts = []
    alpha_pixels = alpha.load()
    for y in range(top, bottom, cell):
        for x in range(left, right, cell):
            x2 = min(x + cell, right)
            y2 = min(y + cell, bottom)
            total = (x2 - x) * (y2 - y)
            if total <= 0:
                continue
            filled = 0
            weighted_x = 0
            weighted_y = 0
            for py in range(y, y2):
                for px in range(x, x2):
                    value = alpha_pixels[px, py]
                    if value > 40:
                        filled += 1
                        weighted_x += px
                        weighted_y += py
            coverage = filled / total
            if coverage < 0.14:
                continue
            cx = weighted_x / filled if filled else (x + x2) / 2
            cy = weighted_y / filled if filled else (y + y2) / 2
            parts.append(
                {
                    "x": round((cx - image.width / 2) / (image.width / 2), 3),
                    "y": round((cy - image.height / 2) / (image.height / 2), 3),
                    "r": round((cell / image.width) * (0.5 + coverage * 0.2), 3),
                }
            )

    if len(parts) < 3:
        parts.append({"x": 0, "y": 0, "r": round(max(width, height) / image.width * 0.42, 3)})
    return parts


def make_contact_sheet(files: list[dict[str, object]]) -> None:
    tile = 180
    cols = 4
    rows = (len(files) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * tile, rows * tile), (255, 248, 252, 255))
    draw = ImageDraw.Draw(sheet)
    for index, item in enumerate(files):
        img = Image.open(ROOT / "public" / str(item["src"]).lstrip("/")).convert("RGBA")
        thumb = img.copy()
        thumb.thumbnail((tile - 28, tile - 48), Image.Resampling.LANCZOS)
        x = (index % cols) * tile + (tile - thumb.width) // 2
        y = (index // cols) * tile + 12
        sheet.alpha_composite(thumb, (x, y))
        draw.text(((index % cols) * tile + 12, (index // cols) * tile + tile - 28), str(item["name"]), fill=(86, 64, 96, 255))
    sheet.convert("RGB").save(PREVIEW_DIR / "jellycat-contact-sheet.jpg", quality=92)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    for stale in OUT_DIR.glob("*.png"):
        stale.unlink()

    manifest = []
    for level, (filename, name) in enumerate(ORDER):
        source = SOURCE_DIR / filename
        image = ImageOps.exif_transpose(Image.open(source))
        clean = flood_background(image)
        clean = reduce_edge_shadows(clean)
        clean = trim_and_pad(clean)
        clean = fit_square(clean)
        out_name = f"{level + 1:02d}-{Path(filename).stem}.png"
        clean.save(OUT_DIR / out_name)
        manifest.append(
            {
                "name": name,
                "src": f"/assets/jellycats/{out_name}",
                "parts": alpha_parts(clean),
            }
        )

    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (ROOT / "src" / "jellycatSprites.js").write_text(
        "export const jellycatSprites = "
        + json.dumps(manifest, indent=2)
        + ";\n"
    )
    make_contact_sheet(manifest)


if __name__ == "__main__":
    main()
