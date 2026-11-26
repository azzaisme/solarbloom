"""Turn a capture from capture.py into a seeded pencil drawing and a comparison."""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt, gaussian_filter, maximum_filter, minimum_filter


def load_fields(directory):
    scene = Image.open(directory / "scene.png").convert("RGBA")
    normals = np.asarray(Image.open(directory / "normals.png").convert("RGB")) / 127.5 - 1
    geometry = np.asarray(Image.open(directory / "geometry.png").convert("RGBA")) / 255
    alpha = geometry[..., 3]
    # Normalize blurred normals separately on each object to keep the strokes coherent near its edges.
    object_id = np.where(alpha < 0.55, 0, np.where(geometry[..., 1] < 0.5, 1, 2))
    smooth = np.zeros_like(normals)
    for index in (1, 2):
        region = object_id == index
        weight = gaussian_filter(region.astype(float), 1.6)
        for channel in range(3):
            blurred = gaussian_filter(normals[..., channel] * region, 1.6)
            smooth[..., channel][region] = (blurred / np.maximum(weight, 0.001))[region]
    smooth /= np.maximum(np.linalg.norm(smooth, axis=2, keepdims=True), 0.001)
    return scene, smooth, geometry[..., 0], object_id


def trace(field, ids, depth, x, y, length):
    height, width = ids.shape
    start = ids[round(y), round(x)]
    origin_depth = depth[round(y), round(x)]
    halves = []
    for sign in (-1, 1):
        px, py = x, y
        dx, dy = field[round(y), round(x)] * sign
        points = []
        for _ in range(length // 2):
            ix, iy = round(px), round(py)
            if not (0 <= ix < width and 0 <= iy < height):
                break
            if ids[iy, ix] != start or abs(depth[iy, ix] - origin_depth) > 0.035:
                break
            points.append((px, py))
            vx, vy = field[iy, ix]
            if vx * dx + vy * dy < 0:
                vx, vy = -vx, -vy
            dx, dy = vx, vy
            px, py = px + dx * 1.6, py + dy * 1.6
        halves.append(points)
    return halves[0][:0:-1] + halves[1]


def pencil_variation(rng, shape, scale):
    noise = gaussian_filter(rng.standard_normal(shape), scale)
    return np.clip(noise / noise.std(), -2.5, 2.5)


def hatching(normals, depth, ids, shade, pressure_patches, rng):
    height, width = ids.shape
    # A tangent perpendicular to the projected normal follows the local turn of the surface.
    # Where the surface faces straight at the camera, fade to a stable pencil angle.
    nx, ny = normals[..., 0], -normals[..., 1]
    tilt = np.minimum(np.hypot(nx, ny) * 3, 1)
    angle = np.arctan2(nx, -ny)
    base = -0.55
    # Blend doubled angles because reversing the direction does not change a pencil line.
    angle = np.arctan2(tilt * np.sin(2 * angle) + (1 - tilt) * np.sin(2 * base),
                       tilt * np.cos(2 * angle) + (1 - tilt) * np.cos(2 * base)) / 2
    angle += 0.23 * pencil_variation(rng, ids.shape, 11)
    ink = np.zeros((height, width))
    for rotation, spacing, threshold, strength in [(0, 4, 0.1, 0.74), (1.05, 6, 0.43, 0.53)]:
        direction = angle + rotation
        field = np.stack((np.cos(direction), np.sin(direction)), axis=-1)
        marks = Image.new("L", (width, height))
        pencil = ImageDraw.Draw(marks)
        for y in range(2, height - 2, spacing):
            for x in range(2, width - 2, spacing):
                sx, sy = x + rng.integers(-2, 3), y + rng.integers(-2, 3)
                tone = shade[sy, sx]
                chance = (tone - threshold) * (1.8 if rotation else 1.45)
                chance = np.clip(chance * pressure_patches[sy, sx], 0, 0.9)
                if ids[sy, sx] == 0 or rng.random() > chance:
                    continue
                points = trace(field, ids, depth, sx, sy, rng.integers(5, 20))
                if len(points) < 3:
                    continue
                pressure = (0.33 + tone * 0.67) * rng.uniform(0.28, 1)
                # A few light strokes carry just past where the geometry ended them.
                if rng.random() < 0.17:
                    x0, y0 = points[-2]
                    x1, y1 = points[-1]
                    pencil.line([(x1, y1), (2 * x1 - x0, 2 * y1 - y0)],
                                fill=round(255 * pressure * 0.38), width=1)
                pencil.line(points, fill=round(255 * pressure), width=1)
        ink += np.asarray(marks) / 255 * strength
    return ink


def edge_stroke(anchor, tangent, distance, length, offset, construction, rng):
    # Follow only a short arc. The wrist drifts sideways and the ends can sail past a turn.
    height, width = distance.shape
    halves = []
    initial = tangent[anchor[1], anchor[0]]
    for sign in (-1, 1):
        point = anchor.astype(float)
        direction = initial * sign
        points = []
        for _ in range(length // 2):
            x, y = np.rint(point).astype(int)
            if not (0 <= x < width and 0 <= y < height):
                break
            vx, vy = tangent[y, x]
            if np.dot((vx, vy), direction) < 0:
                vx, vy = -vx, -vy
            direction = 0.64 * direction + 0.36 * np.array([vx, vy])
            normal = np.array([-vy, vx]) * sign
            # Gently pull the tracking point back to the guide curve.
            if abs(distance[y, x]) > 0.5:
                gx, gy = tangent[y, x]
                point -= np.array([gy, -gx]) * distance[y, x] * 0.32
            points.append(point + normal * offset)
            point += direction * 2.8
        halves.append(points)
    points = np.array(halves[0][:0:-1] + halves[1])
    if len(points) < 4:
        return points
    progress = np.linspace(-1, 1, len(points))
    perpendicular = np.array([-initial[1], initial[0]])
    bow = rng.uniform(-1, 1) * (7 if construction else 2)
    drift = rng.uniform(-1, 1) * (12 if construction else 3)
    wiggle = np.sin(progress * 3 + rng.uniform(0, np.pi)) * (2 if construction else 1.1)
    return points + (bow * progress**2 + drift * progress + wiggle)[:, None] * perpendicular


def contour_passes(ids, shade, rng):
    height, width = ids.shape
    construction = Image.new("L", (width, height))
    accents = Image.new("L", (width, height))
    skip_patches = pencil_variation(rng, ids.shape, 13)
    for region_id in (1, 2):
        region = ids == region_id
        eroded = minimum_filter(region, 3)
        edge = region & ~eroded
        distance = distance_transform_edt(region) - distance_transform_edt(~region)
        weighted_tone = gaussian_filter(shade * region, 8) / np.maximum(gaussian_filter(region.astype(float), 8), 0.01)
        anchors = np.column_stack(np.nonzero(edge))[:, ::-1]
        for is_construction, target, smooth, spacing in [(True, construction, 5, 18), (False, accents, 2, 17)]:
            dy, dx = np.gradient(gaussian_filter(distance, smooth))
            tangent = np.stack((-dy, dx), axis=-1)
            tangent /= np.maximum(np.linalg.norm(tangent, axis=2, keepdims=True), 0.01)
            available = edge.copy()
            draw = ImageDraw.Draw(target)
            for anchor in rng.permutation(anchors):
                x, y = anchor
                if not available[y, x]:
                    continue
                tone = weighted_tone[y, x]
                if not is_construction and 0.76 * tone + 0.20 * skip_patches[y, x] < 0.30:
                    continue
                extent = rng.integers(16, 32) if is_construction else rng.integers(7, 18)
                offset = rng.uniform(-7, 7) if is_construction else rng.uniform(-2.8, 2.8)
                points = edge_stroke(anchor, tangent, distance, extent, offset, is_construction, rng)
                if len(points) < 4:
                    continue
                pressure = rng.uniform(0.09, 0.30) if is_construction else rng.uniform(0.40, 0.87)
                if region_id == 2:
                    pressure *= 0.63
                stroke_width = 1 if is_construction else 1 + round(2 * pressure**2)
                # Taper the ends of individual marks so fragments don't have blunt caps.
                for i, (start, end) in enumerate(zip(points, points[1:])):
                    taper = min(1, (i + 1) / 3, (len(points) - i - 1) / 3)
                    draw.line([tuple(start), tuple(end)], fill=round(255 * pressure * taper),
                              width=max(1, round(stroke_width * taper)))
                available[max(0, y - spacing):y + spacing + 1, max(0, x - spacing):x + spacing + 1] = False
    return np.asarray(construction) / 255, np.asarray(accents) / 255


def draw_sketch(scene, normals, depth, ids, seed):
    rng = np.random.default_rng(seed)
    height, width = ids.shape
    visible = ids > 0
    # Blender's camera-space geometry pass uses negative Z for normals facing the camera.
    light = np.array([-0.48, 0.62, -0.62])
    diffuse = np.clip(normals @ light, 0, 1)
    luma = (np.asarray(scene)[..., :3] / 255) @ np.array([0.2126, 0.7152, 0.0722])
    tone = np.zeros_like(luma)
    for index in (1, 2):
        region = ids == index
        bright = np.percentile(luma[region], 84)
        tone[region] = 1 - np.clip((luma[region] - 0.12) / max(bright - 0.12, 0.01), 0, 1)
    shade = np.clip((1 - diffuse) * 0.39 + tone * 0.64 + (ids == 2) * 0.12, 0, 1)

    # Depth and object changes provide occlusion lines. Strong normal changes pick out folds.
    depth_edge = (maximum_filter(depth, 3) - minimum_filter(depth, 3)) * visible
    normal_edge = sum(np.hypot(*np.gradient(normals[..., c])) for c in range(3))
    detail = np.clip((normal_edge - 0.07) * 1.9, 0, 0.6) + np.clip((depth_edge - 0.015) * 10, 0, 0.53)
    grain = rng.normal(0, 1, (height, width))
    pressure_patches = np.clip(1 + 0.34 * pencil_variation(rng, ids.shape, 13), 0.18, 1.55)
    ink = hatching(normals, depth, ids, shade, pressure_patches, rng)
    # Fade the tone at the object boundary so it can't recreate a continuous silhouette.
    same_surface = maximum_filter(ids, 5) == minimum_filter(ids, 5)
    edge_fade = gaussian_filter((same_surface & visible).astype(float), 2.3)
    construction, accents = contour_passes(ids, shade, rng)
    ink = visible * (ink * 0.85 + shade ** 1.6 * 0.30 * pressure_patches + detail * 0.42) * edge_fade
    ink += construction + accents + 0.26 * gaussian_filter(accents, 1.25)
    ink = np.clip(ink * (0.86 + grain * 0.19), 0, 0.92)
    paper_grain = grain * 2.1 + gaussian_filter(grain, 6) * 23
    paper = np.array([247, 237, 215]) + paper_grain[..., None]
    graphite = np.where((ids == 2)[..., None], [51, 62, 42], [45, 38, 29])
    image = paper * (1 - ink[..., None]) + graphite * ink[..., None]
    return Image.fromarray(np.clip(image, 0, 255).astype(np.uint8))


def scene_backdrop(scene):
    height, width = scene.height, scene.width
    y, x = np.mgrid[:height, :width]
    glow = np.exp(-((x - width * 0.37)**2 + (y - height * 0.22)**2) / width**2)
    colors = np.array([57, 104, 103]) + glow[..., None] * np.array([107, 93, 66])
    image = Image.fromarray(colors.astype(np.uint8)).convert("RGBA")
    image.alpha_composite(scene)
    return image.convert("RGB")


def font(name, size):
    return ImageFont.truetype(name, size)


def comparison(scene, sketch):
    board = Image.new("RGB", (1296, 686), "#ebdfc8")
    heading = ImageDraw.Draw(board)
    serif = font("DejaVuSerif.ttf", 30)
    label = font("DejaVuSans.ttf", 14)
    for x, image, title, subtitle in [
        (28, scene, "The captured scene", "SOLARBLOOM FROG MODEL"),
        (662, sketch, "Tide’s pencil study", "NORMAL-GUIDED HATCHING"),
    ]:
        heading.text((x, 24), title, font=serif, fill="#243f36")
        heading.text((x + 1, 65), subtitle, font=label, fill="#4d5c4e")
        board.paste(image.resize((606, 526), Image.Resampling.LANCZOS), (x, 96))
        heading.rectangle((x, 96, x + 606, 622), outline="#a69577")
    heading.text((29, 644), "Saltwind field study  /  Frog on a lily pad", font=label, fill="#4d5c4e")
    return board


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("capture", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--seed", type=int, default=17)
    args = parser.parse_args()
    scene, normals, depth, ids = load_fields(args.capture)
    sketch = draw_sketch(scene, normals, depth, ids, args.seed)
    args.output.mkdir(parents=True, exist_ok=True)
    sketch.save(args.output / "frog-sketch.png")
    comparison(scene_backdrop(scene), sketch).save(args.output / "before-after.png")


if __name__ == "__main__":
    main()
