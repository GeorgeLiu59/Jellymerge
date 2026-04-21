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
    ("cherry.png", "Cherry"),
    ("blueberry.png", "Blueberry"),
    ("apple.png", "Apple"),
    ("orange.png", "Orange"),
    ("peach.png", "Peach"),
    ("dragonfruit.png", "Dragonfruit"),
    ("pancake.png", "Pancake"),
    ("rose.png", "Rose"),
    ("blossom_bunny.png", "Blossom Bunny"),
    ("strawberry_bear.png", "Strawberry Bear"),
    ("final_flowers.png", "Anniversary Bouquet"),
]


def is_background(
    pixel: tuple[int, int, int, int],
    *,
    plain_brightness_min: int = 224,
    plain_spread_max: int = 32,
    extreme_brightness_min: int = 244,
    extreme_spread_max: int = 14,
) -> bool:
    r, g, b, _ = pixel
    brightness = (r + g + b) / 3
    spread = max(r, g, b) - min(r, g, b)
    # Keep plush whites by only classifying very neutral edge tones as background.
    is_plain_photo_backdrop = brightness > plain_brightness_min and spread < plain_spread_max
    is_extreme_white_backdrop = brightness > extreme_brightness_min and spread < extreme_spread_max
    return is_plain_photo_backdrop or is_extreme_white_backdrop


def flood_background(image: Image.Image, background_profile: dict[str, int] | None = None) -> Image.Image:
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()
    profile = background_profile or {}
    plain_brightness_min = profile.get("plain_brightness_min", 224)
    plain_spread_max = profile.get("plain_spread_max", 32)
    extreme_brightness_min = profile.get("extreme_brightness_min", 244)
    extreme_spread_max = profile.get("extreme_spread_max", 14)
    expansion_brightness_min = profile.get("expansion_brightness_min", 232)
    expansion_spread_max = profile.get("expansion_spread_max", 24)
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
        if not is_background(
            pixels[x, y],
            plain_brightness_min=plain_brightness_min,
            plain_spread_max=plain_spread_max,
            extreme_brightness_min=extreme_brightness_min,
            extreme_spread_max=extreme_spread_max,
        ):
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
                if touches_background and spread < expansion_spread_max and brightness > expansion_brightness_min:
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

    tops = [-1] * width
    bottoms = [-1] * width
    for x in range(width):
        for y in range(height):
            if alpha_pixels[x, y] > 0:
                tops[x] = y
                break
        for y in range(height - 1, -1, -1):
            if alpha_pixels[x, y] > 0:
                bottoms[x] = y
                break

    for x, bottom in enumerate(bottoms):
        top = tops[x]
        if bottom < 0 or top < 0:
            continue
        # Strictly target the lower half near the local silhouette base.
        half_line = top + int((bottom - top) * 0.5)
        local_band = max(12, min(30, int((bottom - top) * 0.24)))
        start = max(half_line, bottom - local_band)
        lower_focus_start = top + int((bottom - top) * 0.56)
        span = max(1, bottom - start)
        for y in range(start, bottom + 1):
            alpha_value = alpha_pixels[x, y]
            if alpha_value == 0:
                continue
            if y < lower_focus_start:
                continue
            r, g, b, _ = pixels[x, y]
            brightness = (r + g + b) / 3
            spread = max(r, g, b) - min(r, g, b)
            # Only desaturate neutral-ish bottom shadows; avoid plush details.
            if spread > 28 or brightness < 86 or brightness > 228:
                continue

            touches_air = False
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if nx < 0 or nx >= width or ny < 0 or ny >= height or alpha_pixels[nx, ny] == 0:
                    touches_air = True
                    break
            if not touches_air:
                continue

            edge_bias = (y - start) / span
            # Stronger suppression near the local bottom edge to remove halo rings.
            fade_strength = 0.22 + edge_bias * (0.82 if spread < 14 else 0.68)
            faded_alpha = int(alpha_value * (1 - fade_strength * edge_bias))
            if edge_bias > 0.76 and spread < 20 and brightness > 120:
                faded_alpha = int(faded_alpha * 0.68)
            if faded_alpha < 72:
                faded_alpha = 0
            pixels[x, y] = (r, g, b, faded_alpha)

    return rgba


def remove_bottom_halo_rim(image: Image.Image) -> Image.Image:
    """Aggressively strip bright halo pixels near the silhouette base."""
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()
    alpha = rgba.getchannel("A")
    alpha_pixels = alpha.load()

    tops = [-1] * width
    bottoms = [-1] * width
    for x in range(width):
        for y in range(height):
            if alpha_pixels[x, y] > 0:
                tops[x] = y
                break
        for y in range(height - 1, -1, -1):
            if alpha_pixels[x, y] > 0:
                bottoms[x] = y
                break

    for x, bottom in enumerate(bottoms):
        top = tops[x]
        if top < 0 or bottom < 0:
            continue
        h = bottom - top
        if h < 8:
            continue
        start = max(top + int(h * 0.58), bottom - max(10, int(h * 0.18)))
        for y in range(start, bottom + 1):
            a = alpha_pixels[x, y]
            if a == 0:
                continue

            touches_air = False
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if nx < 0 or nx >= width or ny < 0 or ny >= height or alpha_pixels[nx, ny] == 0:
                    touches_air = True
                    break
            if not touches_air:
                continue

            r, g, b, _ = pixels[x, y]
            brightness = (r + g + b) / 3
            spread = max(r, g, b) - min(r, g, b)
            edge_bias = (y - start) / max(1, bottom - start)

            # Target light/neutral fringe most strongly at the very bottom edge.
            if brightness > 126 and spread < 36:
                new_alpha = int(a * (0.15 + (1 - edge_bias) * 0.25))
                if edge_bias > 0.7:
                    new_alpha = int(new_alpha * 0.45)
            elif brightness > 104 and spread < 24 and edge_bias > 0.75:
                new_alpha = int(a * 0.4)
            else:
                continue

            # Extra hard-cut for the lowest semi-transparent fringe ring.
            if edge_bias > 0.86 and a < 235 and brightness > 78 and spread < 52:
                new_alpha = int(new_alpha * 0.22)

            if new_alpha < 90:
                new_alpha = 0
            pixels[x, y] = (r, g, b, new_alpha)

    rgba.putalpha(alpha)
    return rgba


def strip_bottom_translucent_fringe(image: Image.Image) -> Image.Image:
    """Hard-remove translucent pixels below each column's solid base."""
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()
    alpha = rgba.getchannel("A")
    alpha_pixels = alpha.load()

    for x in range(width):
        bottom_solid = -1
        for y in range(height - 1, -1, -1):
            if alpha_pixels[x, y] >= 200:
                bottom_solid = y
                break
        if bottom_solid < 0:
            continue

        # Remove all lower translucent fringe below the solid silhouette base.
        for y in range(bottom_solid + 1, height):
            if alpha_pixels[x, y] > 0:
                alpha_pixels[x, y] = 0

        # Also trim very weak anti-aliased ring right on the base edge.
        for y in range(max(0, bottom_solid - 2), min(height, bottom_solid + 2)):
            a = alpha_pixels[x, y]
            if a == 0:
                continue
            r, g, b, _ = pixels[x, y]
            brightness = (r + g + b) / 3
            spread = max(r, g, b) - min(r, g, b)
            if a < 150 and brightness > 100 and spread < 48:
                alpha_pixels[x, y] = 0

    rgba.putalpha(alpha)
    return rgba


def keep_largest_alpha_component(image: Image.Image) -> Image.Image:
    """Remove detached alpha islands (e.g., leftover floor-shadow blobs)."""
    rgba = image.convert("RGBA")
    width, height = rgba.size
    alpha = rgba.getchannel("A")
    alpha_pixels = alpha.load()
    seen = bytearray(width * height)
    components: list[list[tuple[int, int]]] = []

    for y in range(height):
        for x in range(width):
            if alpha_pixels[x, y] == 0:
                continue
            idx = y * width + x
            if seen[idx]:
                continue
            seen[idx] = 1
            queue: deque[tuple[int, int]] = deque([(x, y)])
            points: list[tuple[int, int]] = []
            while queue:
                cx, cy = queue.popleft()
                points.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if nx < 0 or nx >= width or ny < 0 or ny >= height:
                        continue
                    if alpha_pixels[nx, ny] == 0:
                        continue
                    nidx = ny * width + nx
                    if seen[nidx]:
                        continue
                    seen[nidx] = 1
                    queue.append((nx, ny))
            components.append(points)

    if len(components) <= 1:
        return rgba

    largest = max(components, key=len)
    keep = set(largest)
    for y in range(height):
        for x in range(width):
            if alpha_pixels[x, y] == 0:
                continue
            if (x, y) not in keep:
                alpha_pixels[x, y] = 0

    rgba.putalpha(alpha)
    return rgba


def remove_tiny_alpha_specks(
    image: Image.Image, min_pixels: int = 20, alpha_threshold: int = 12
) -> Image.Image:
    """Remove tiny detached alpha islands and very faint edge noise."""
    rgba = image.convert("RGBA")
    width, height = rgba.size
    alpha = rgba.getchannel("A")
    alpha_pixels = alpha.load()
    seen = bytearray(width * height)

    # Drop near-invisible fuzz first.
    for y in range(height):
        for x in range(width):
            if alpha_pixels[x, y] < alpha_threshold:
                alpha_pixels[x, y] = 0

    # Remove very small connected alpha islands.
    for y in range(height):
        for x in range(width):
            if alpha_pixels[x, y] == 0:
                continue
            idx = y * width + x
            if seen[idx]:
                continue

            seen[idx] = 1
            queue: deque[tuple[int, int]] = deque([(x, y)])
            points: list[tuple[int, int]] = []

            while queue:
                cx, cy = queue.popleft()
                points.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if nx < 0 or nx >= width or ny < 0 or ny >= height:
                        continue
                    if alpha_pixels[nx, ny] == 0:
                        continue
                    nidx = ny * width + nx
                    if seen[nidx]:
                        continue
                    seen[nidx] = 1
                    queue.append((nx, ny))

            if len(points) < min_pixels:
                for px, py in points:
                    alpha_pixels[px, py] = 0

    rgba.putalpha(alpha)
    return rgba


def remove_near_white_bottom_band(
    image: Image.Image,
    start_ratio: float = 0.7,
    bright_threshold: int = 178,
    spread_threshold: int = 42,
    soft_bright_threshold: int = 160,
    soft_spread_threshold: int = 30,
    soft_alpha_max: int = 210,
) -> Image.Image:
    """Remove white/near-white fringe pixels only in the bottom image band."""
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()
    alpha = rgba.getchannel("A")
    alpha_pixels = alpha.load()
    start_y = int(height * start_ratio)

    for y in range(start_y, height):
        for x in range(width):
            a = alpha_pixels[x, y]
            if a == 0:
                continue

            touches_air = False
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if nx < 0 or nx >= width or ny < 0 or ny >= height or alpha_pixels[nx, ny] == 0:
                    touches_air = True
                    break
            if not touches_air:
                continue

            r, g, b, _ = pixels[x, y]
            brightness = (r + g + b) / 3
            spread = max(r, g, b) - min(r, g, b)
            if brightness > bright_threshold and spread < spread_threshold:
                alpha_pixels[x, y] = 0
            elif brightness > soft_bright_threshold and spread < soft_spread_threshold and a < soft_alpha_max:
                alpha_pixels[x, y] = 0

    rgba.putalpha(alpha)
    return rgba


def restore_internal_alpha_holes(image: Image.Image, max_fill_y_ratio: float = 1.0) -> Image.Image:
    """Restore transparent holes fully enclosed by opaque pixels."""
    rgba = image.convert("RGBA")
    width, height = rgba.size
    alpha = rgba.getchannel("A")
    alpha_pixels = alpha.load()
    fill_y_limit = int(height * max_fill_y_ratio)
    seen = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def push(x: int, y: int) -> None:
        if 0 <= x < width and 0 <= y < height:
            index = y * width + x
            if seen[index]:
                return
            seen[index] = 1
            queue.append((x, y))

    for x in range(width):
        if alpha_pixels[x, 0] == 0:
            push(x, 0)
        if alpha_pixels[x, height - 1] == 0:
            push(x, height - 1)
    for y in range(height):
        if alpha_pixels[0, y] == 0:
            push(0, y)
        if alpha_pixels[width - 1, y] == 0:
            push(width - 1, y)

    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < width and 0 <= ny < height and alpha_pixels[nx, ny] == 0:
                index = ny * width + nx
                if not seen[index]:
                    seen[index] = 1
                    queue.append((nx, ny))

    for y in range(height):
        for x in range(width):
            if y > fill_y_limit:
                continue
            if alpha_pixels[x, y] != 0:
                continue
            if seen[y * width + x]:
                continue
            alpha_pixels[x, y] = 255

    rgba.putalpha(alpha)
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
        has_transparency = "A" in image.getbands() and image.getchannel("A").getextrema()[0] < 255
        if has_transparency:
            # Trust manually cleaned alpha cutouts from JellyCats/.
            clean = image.convert("RGBA")
            clean = remove_tiny_alpha_specks(clean)
        else:
            if filename in {"blossom_bunny.png", "final_flowers.png"}:
                # Preserve bright upper details by using a stricter white-backdrop profile.
                clean = flood_background(
                    image,
                    {
                        "plain_brightness_min": 242,
                        "plain_spread_max": 10,
                        "extreme_brightness_min": 248,
                        "extreme_spread_max": 6,
                        "expansion_brightness_min": 247,
                        "expansion_spread_max": 8,
                    },
                )
            else:
                clean = flood_background(image)
            clean = reduce_edge_shadows(clean)
            clean = remove_bottom_halo_rim(clean)
            if filename in {"blossom_bunny.png", "final_flowers.png"}:
                # Repair only top-region enclosed alpha holes while keeping lower shadow cleanup.
                clean = restore_internal_alpha_holes(clean, max_fill_y_ratio=0.62)
            clean = strip_bottom_translucent_fringe(clean)
            clean = keep_largest_alpha_component(clean)
            if filename == "blossom_bunny.png":
                clean = remove_near_white_bottom_band(
                    clean,
                    start_ratio=0.73,
                    bright_threshold=194,
                    spread_threshold=24,
                    soft_bright_threshold=182,
                    soft_spread_threshold=18,
                    soft_alpha_max=202,
                )
            elif filename == "final_flowers.png":
                clean = remove_near_white_bottom_band(
                    clean,
                    start_ratio=0.79,
                    bright_threshold=198,
                    spread_threshold=26,
                    soft_bright_threshold=182,
                    soft_spread_threshold=20,
                    soft_alpha_max=178,
                )
            elif filename == "orange.png":
                clean = remove_near_white_bottom_band(
                    clean,
                    start_ratio=0.62,
                    bright_threshold=152,
                    spread_threshold=64,
                    soft_bright_threshold=134,
                    soft_spread_threshold=50,
                    soft_alpha_max=244,
                )
            elif filename in {"cherry.png", "blueberry.png", "peach.png"}:
                clean = remove_near_white_bottom_band(
                    clean,
                    start_ratio=0.66,
                    bright_threshold=166,
                    spread_threshold=52,
                    soft_bright_threshold=146,
                    soft_spread_threshold=40,
                    soft_alpha_max=228,
                )
            else:
                clean = remove_near_white_bottom_band(clean, start_ratio=0.7)
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
