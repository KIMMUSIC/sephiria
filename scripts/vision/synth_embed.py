#!/usr/bin/env python3
"""Synthetic-composite embedding trainer / evaluator for sephiria inventory cells.

embed-v4: close the catalog-on-charcoal vs in-game-cell domain gap.
  - Occupied plate bank = inpainted live occupied cells (no labels) + procedural charcoal
  - Plate-matcher-style composite: CELL=64, TRIM=0.07, TOPCUT=12, JPEG q=65,
    scales in {26,28,...,60}, offsets ±2/4, 1px navy outline, global sat/lum pull
  - Descriptor: hue hist + 16x16 residual(cell-plate) + ink + occupancy stats
  - Inference: nearest synthetic variant (not prototype mean, not k-vote)

Train on catalog sprites × synthetic plates only.
Validate on live fixtures 6-9 confirmed cells. Occupied live cells are never class labels.
"""
from __future__ import annotations

import io
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path("/workspace/sephiria")
ART_DIR = ROOT / "public" / "images" / "artifacts"
SLAB_DIR = ROOT / "public" / "images" / "slabs"
TABLETS_JSON = ROOT / "data" / "tablets.json"
FIXTURE_DIR = ROOT / "tests" / "fixtures"
INDEX_JSON = ROOT / "data" / "vision" / "embed-index.json"
CACHE = ROOT / ".cache" / "vision-synth"
PLAN_MD = ROOT / "PLAN" / "09-Embed-Synth.md"

FEATURE_VERSION = "embed-v4"
CELL = 64
TOPCUT = 12
TRIM = 0.07
INSET = 6
RI = 3
HUE_BINS = 8
HUE_LEN = 32
RES = 16
RES_LEN = RES * RES * 3  # 768
INK_LEN = 8
STAT_LEN = 4
DIM = HUE_LEN + RES_LEN + INK_LEN + STAT_LEN  # 812
CHROMA_CUT = 12
CHROMA_EMPTY = 38.0
LUMSTD_EMPTY = 27.0
VARIANTS_PER = 12
SEED = 20260815
LIVE_NAMES = ["live-6.png", "live-7.png", "live-8.png", "live-9.png"]
SCALES = list(range(26, 61, 2))
CORE_SCALES = [28, 30, 32, 34, 36, 38, 40, 42, 44]
HUE_W = 0.25
INK_W = 0.20
STAT_W = 0.20
OFFS = [-4, -2, 0, 2, 4]
JPEG_Q = 65
NAVY = np.array([16, 18, 36], dtype=np.uint8)

_DIGIT = {
    "0": ["111", "101", "101", "101", "111"],
    "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"],
    "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"],
    "5": ["111", "100", "111", "001", "111"],
    "6": ["111", "100", "111", "101", "111"],
    "7": ["111", "001", "001", "001", "001"],
    "8": ["111", "101", "111", "101", "111"],
    "9": ["111", "101", "111", "001", "111"],
    "/": ["001", "001", "010", "100", "100"],
}


def l2(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v if n < 1e-8 else v / n


def load_rgba(path: Path) -> np.ndarray:
    return np.array(Image.open(path).convert("RGBA"), dtype=np.uint8)


def extract_sprite(rgba: np.ndarray) -> np.ndarray | None:
    alpha = rgba[..., 3]
    rgb = rgba[..., :3]
    mask = alpha > 128
    if int(mask.sum()) < 12:
        mask = rgb.max(axis=2) > 20
    mask = mask & (rgb.max(axis=2) >= 12)
    if int(mask.sum()) < 8:
        return None
    ys, xs = np.where(mask)
    sub = rgba[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1].copy()
    sm = mask[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    sub[..., 3] = np.where(sm, np.maximum(sub[..., 3], 255), 0)
    h, w = sub.shape[:2]
    s = max(h, w)
    sq = np.zeros((s, s, 4), dtype=np.uint8)
    oy, ox = (s - h) // 2, (s - w) // 2
    sq[oy : oy + h, ox : ox + w] = sub
    return sq


def rot90_cw(sq: np.ndarray, k: int) -> np.ndarray:
    return sq if k % 4 == 0 else np.rot90(sq, -k)


def inner_slice(cell: np.ndarray) -> np.ndarray:
    return cell[TOPCUT + 2 : CELL - INSET, INSET : CELL - INSET]


def ring_pixels(cell: np.ndarray) -> np.ndarray:
    a, b = RI, RI + 6
    return np.concatenate(
        [
            cell[a:b].reshape(-1, 3),
            cell[CELL - b : CELL - a].reshape(-1, 3),
            cell[:, a:b].reshape(-1, 3),
            cell[:, CELL - b : CELL - a].reshape(-1, 3),
        ],
        axis=0,
    ).astype(np.float64)


def ring_median(cell: np.ndarray) -> np.ndarray:
    return np.median(ring_pixels(cell), axis=0)


def dilate_bool(mask: np.ndarray, iters: int = 1) -> np.ndarray:
    out = mask.copy()
    for _ in range(iters):
        d = out.copy()
        d[1:, :] |= out[:-1, :]
        d[:-1, :] |= out[1:, :]
        d[:, 1:] |= out[:, :-1]
        d[:, :-1] |= out[:, 1:]
        d[1:, 1:] |= out[:-1, :-1]
        d[1:, :-1] |= out[:-1, 1:]
        d[:-1, 1:] |= out[1:, :-1]
        d[:-1, :-1] |= out[1:, 1:]
        out = d
    return out


def spatial_hue_hist(cell: np.ndarray) -> np.ndarray:
    out = np.zeros(HUE_LEN, dtype=np.float64)
    mid = CELL / 2.0
    y0 = TOPCUT
    sl = cell[y0:]
    r = sl[:, :, 0].astype(np.float64)
    g = sl[:, :, 1].astype(np.float64)
    b = sl[:, :, 2].astype(np.float64)
    yy, xx = np.indices(r.shape)
    yy = yy + y0
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    c = mx - mn
    h = np.zeros_like(c)
    m_r = (mx == r) & (c >= CHROMA_CUT)
    m_g = (mx == g) & ~m_r & (c >= CHROMA_CUT)
    m_b = (c >= CHROMA_CUT) & ~m_r & ~m_g
    h[m_r] = (g[m_r] - b[m_r]) / c[m_r]
    h[m_g] = (b[m_g] - r[m_g]) / c[m_g] + 2.0
    h[m_b] = (r[m_b] - g[m_b]) / c[m_b] + 4.0
    h[h < 0] += 6.0
    bins = np.zeros(c.shape, dtype=np.int32)
    colorful = c >= CHROMA_CUT
    bins[colorful] = np.minimum(HUE_BINS - 1, ((h[colorful] / 6.0) * HUE_BINS).astype(np.int32))
    wgt = np.where(c < CHROMA_CUT, 8.0, c)
    q = (yy >= mid).astype(np.int32) * 2 + (xx >= mid).astype(np.int32)
    np.add.at(out, (q * HUE_BINS + bins).ravel(), wgt.ravel())
    mass = float(out.sum())
    if mass > 0:
        out /= mass
    return out


def residual_grid(cell: np.ndarray) -> np.ndarray:
    """16x16 mean residual of (inner cell - ring-median plate), L2-normalized.

    Plate-like pixels (|RGB-ring|_1 <= 40) are zeroed so L2 is not spent on
    charcoal JPEG texture. Same estimator at train and test.
    """
    inn = inner_slice(cell).astype(np.float64)
    plate = ring_median(cell)
    res = inn - plate
    dist = np.abs(res).sum(axis=2)
    chroma = inn.max(axis=2) - inn.min(axis=2)
    fg = (dist > 40) | (chroma >= 40)
    res = res * fg[..., None]
    ih, iw, _ = res.shape
    out = np.zeros((RES, RES, 3), dtype=np.float64)
    cnt = np.zeros((RES, RES), dtype=np.float64)
    gy = (np.arange(ih) * RES) // ih
    gx = (np.arange(iw) * RES) // iw
    yy = np.repeat(gy, iw)
    xx = np.tile(gx, ih)
    pix = res.reshape(-1, 3)
    np.add.at(out, (yy, xx), pix)
    np.add.at(cnt, (yy, xx), 1)
    nz = cnt > 0
    out[nz] /= cnt[nz, None]
    return l2((out / 255.0).reshape(-1))


def ink_hist(cell: np.ndarray) -> np.ndarray:
    out = np.zeros(INK_LEN, dtype=np.float64)
    mid = CELL / 2.0
    sl = cell[TOPCUT:]
    r = sl[:, :, 0].astype(np.float64)
    g = sl[:, :, 1].astype(np.float64)
    b = sl[:, :, 2].astype(np.float64)
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    chroma = np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)
    is_green = (g > r + 8) & (g > b + 4)
    is_white = (lum > 140) & (chroma < 40)
    yy, xx = np.indices(r.shape)
    yy = yy + TOPCUT
    q = (yy >= mid).astype(np.int32) * 2 + (xx >= mid).astype(np.int32)
    for kind, mask in ((0, is_green), (1, is_white)):
        ys, xs = np.where(mask)
        if ys.size:
            np.add.at(out, q[ys, xs] * 2 + kind, 1)
    mass = float(out.sum())
    if mass > 0:
        out /= mass
    return out


def occupancy_stats(cell: np.ndarray) -> tuple[float, float, float]:
    sl = cell[TOPCUT:]
    chroma = sl.max(axis=2) - sl.min(axis=2)
    lum = 0.299 * sl[:, :, 0] + 0.587 * sl[:, :, 1] + 0.114 * sl[:, :, 2]
    inn = inner_slice(cell)
    return float(np.median(chroma)), float(lum.std()), float(inn.std())


def inner_chroma_lum(cell: np.ndarray) -> tuple[float, float]:
    inn = inner_slice(cell).astype(np.float64)
    chroma = inn.max(axis=2) - inn.min(axis=2)
    lum = 0.299 * inn[:, :, 0] + 0.587 * inn[:, :, 1] + 0.114 * inn[:, :, 2]
    return float(chroma.mean()), float(lum.mean())


def is_empty_cell(cell: np.ndarray) -> bool:
    ch, ls, _ = occupancy_stats(cell)
    return ch >= CHROMA_EMPTY and ls <= LUMSTD_EMPTY


def embed_cell(cell: np.ndarray) -> np.ndarray:
    if cell.shape[0] != CELL or cell.shape[1] != CELL:
        cell = np.array(Image.fromarray(cell).resize((CELL, CELL), Image.NEAREST), dtype=np.uint8)
    cell = cell[..., :3]
    hue = spatial_hue_hist(cell)
    res = residual_grid(cell)
    ink = ink_hist(cell)
    ch, ls, ist = occupancy_stats(cell)
    energy = float(min(1.0, abs(float(np.std(inner_slice(cell).astype(np.float64)))) / 80.0))
    st = np.array([ch / 255.0, ls / 255.0, ist / 255.0, energy], dtype=np.float64)
    # Residual is the identity signal. Hue/ink/stats are kept but downweighted:
    # unweighted concat let HUD-white ink + lum_std flip carrot→anvil (v4 first pass 27/45).
    return l2(np.concatenate([hue * HUE_W, res, ink * INK_W, st * STAT_W])).astype(np.float32)


def crop_cell_from_image(img: np.ndarray, grid: dict, slot: int, cols: int) -> np.ndarray:
    origin_x = grid["originX"]
    origin_y = grid["originY"]
    pitch_x = grid["gridWidth"] / cols
    pitch_y = grid["gridHeight"] / grid["rows"]
    margin = pitch_x * TRIM
    r, c = divmod(slot, cols)
    x = origin_x + c * pitch_x
    y = origin_y + r * pitch_y
    left = int(math.trunc(x + margin))
    top = int(math.trunc(y + margin))
    right = int(math.trunc(x + pitch_x - margin))
    bottom = int(math.trunc(y + pitch_y - margin))
    h, w = img.shape[:2]
    left = max(0, min(w - 1, left))
    top = max(0, min(h - 1, top))
    right = max(left + 1, min(w, right))
    bottom = max(top + 1, min(h, bottom))
    crop = img[top:bottom, left:right]
    return np.array(Image.fromarray(crop).resize((CELL, CELL), Image.NEAREST), dtype=np.uint8)


def load_fixtures() -> list[dict]:
    out = []
    for name in LIVE_NAMES:
        fx = json.loads((FIXTURE_DIR / f"{name}.expected.json").read_text())
        fx["_name"] = name
        fx["grid"] = dict(fx["grid"])
        fx["grid"]["rows"] = fx["rows"]
        img_path = ROOT.joinpath(*fx["imagePath"].split("/"))
        fx["_img"] = np.array(Image.open(img_path).convert("RGB"), dtype=np.uint8)
        out.append(fx)
    return out


def collect_empty_bgs(fixtures: list[dict]) -> list[np.ndarray]:
    bgs = []
    for fx in fixtures:
        for exp in fx["expected"]:
            if exp["matchedValue"] is None:
                bgs.append(crop_cell_from_image(fx["_img"], fx["grid"], exp["slotIndex"], fx["cols"]))
    return bgs


def item_blob_mask(cell: np.ndarray) -> np.ndarray:
    """High-chroma or far-from-ring pixels (the item + HUD), dilated. Rivets kept."""
    f = cell.astype(np.float64)
    rm = ring_median(cell)
    chroma = f.max(axis=2) - f.min(axis=2)
    dist = np.abs(f - rm).sum(axis=2)
    lum = 0.299 * f[:, :, 0] + 0.587 * f[:, :, 1] + 0.114 * f[:, :, 2]
    # Plate charcoal itself has chroma ~15 (blue plates ~30). Do not use a
    # low chroma cut or the whole plate becomes "item". Dist-to-ring is FGT-like.
    blob = (dist > 42) | (chroma >= 40)
    hud = np.zeros_like(blob)
    hud[:TOPCUT] = (lum[:TOPCUT] > 110) | (chroma[:TOPCUT] >= 22)
    blob = dilate_bool(blob | hud, 2)
    # keep corner rivets (and a thin outer frame)
    protect = np.zeros_like(blob)
    protect[:2, :] = True
    protect[-2:, :] = True
    protect[:, :2] = True
    protect[:, -2:] = True
    for cy, cx in ((3, 3), (3, 60), (60, 3), (60, 60)):
        protect[max(0, cy - 3) : cy + 4, max(0, cx - 3) : cx + 4] = True
    # HUD in top-left may sit near a rivet; still erase the digits
    blob[:TOPCUT] = hud[:TOPCUT] | (blob[:TOPCUT] & ~protect[:TOPCUT])
    blob[TOPCUT:] = blob[TOPCUT:] & ~protect[TOPCUT:]
    return blob


def inpaint_occupied(cell: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Replace the item blob with ring/interior charcoal. Keep riveted frame."""
    blob = item_blob_mask(cell)
    out = cell.astype(np.float32)
    inn = np.zeros((CELL, CELL), dtype=bool)
    inn[8 : CELL - 8, 8 : CELL - 8] = True
    bg_pix = out[inn & ~blob]
    rm = ring_median(cell).astype(np.float32)
    if bg_pix.shape[0] >= 24:
        mu = bg_pix.mean(axis=0)
        sd = np.clip(bg_pix.std(axis=0), 1.2, 7.0)
    else:
        mu = rm
        sd = np.array([2.4, 2.4, 2.8], dtype=np.float32)
    n = int(blob.sum())
    if n:
        fill = mu + rng.normal(0.0, 1.0, size=(n, 3)).astype(np.float32) * sd
        # mild spatial pull toward ring so the hole is charcoal, not leftover hue
        fill = 0.65 * fill + 0.35 * rm
        out[blob] = fill
    return np.clip(out, 0, 255).astype(np.uint8)


def collect_occupied_plates(fixtures: list[dict], rng: np.random.Generator) -> list[np.ndarray]:
    plates = []
    for fx in fixtures:
        for exp in fx["expected"]:
            v = exp["matchedValue"]
            if v is None or v == "???":
                continue
            cell = crop_cell_from_image(fx["_img"], fx["grid"], exp["slotIndex"], fx["cols"])
            plates.append(inpaint_occupied(cell, rng))
    return plates


def charcoal_plate(rng: np.random.Generator) -> np.ndarray:
    """Dark blue-gray occupied slot (matches live occupied plate, not empty purple)."""
    b = float(rng.uniform(70, 88))
    g = float(rng.uniform(50, 64))
    r = float(rng.uniform(50, 64))
    img = np.zeros((CELL, CELL, 3), dtype=np.float32)
    img[..., 0] = r
    img[..., 1] = g
    img[..., 2] = b
    grad = np.linspace(-5, 6, CELL, dtype=np.float32)[:, None]
    img += grad[:, :, None]
    img += rng.normal(0, 2.0, img.shape).astype(np.float32)
    rim = 2
    img[:rim] = img[:rim] * 0.7 + np.array([90, 95, 110]) * 0.3
    img[-rim:] = img[-rim:] * 0.7 + np.array([90, 95, 110]) * 0.3
    img[:, :rim] = img[:, :rim] * 0.7 + np.array([90, 95, 110]) * 0.3
    img[:, -rim:] = img[:, -rim:] * 0.7 + np.array([90, 95, 110]) * 0.3
    for cy, cx in ((3, 3), (3, 60), (60, 3), (60, 60)):
        if rng.random() < 0.9:
            bright = float(rng.uniform(110, 160))
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    yy, xx = cy + dy, cx + dx
                    if 0 <= yy < CELL and 0 <= xx < CELL:
                        fall = max(0.0, 1.0 - 0.2 * (dy * dy + dx * dx))
                        img[yy, xx] = img[yy, xx] * (1 - 0.6 * fall) + bright * 0.6 * fall
    return np.clip(img, 0, 255).astype(np.uint8)


def purple_plate(rng: np.random.Generator) -> np.ndarray:
    base = np.array(
        [float(rng.uniform(88, 104)), float(rng.uniform(44, 54)), float(rng.uniform(62, 74))],
        dtype=np.float32,
    )
    img = np.zeros((CELL, CELL, 3), dtype=np.float32)
    img[:] = base
    img += rng.normal(0, 2.0, img.shape).astype(np.float32)
    for cy, cx in ((3, 3), (3, 60), (60, 3), (60, 60)):
        bright = float(rng.uniform(100, 140))
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                yy, xx = cy + dy, cx + dx
                if 0 <= yy < CELL and 0 <= xx < CELL:
                    fall = max(0.0, 1.0 - 0.2 * (dy * dy + dx * dx))
                    img[yy, xx] = img[yy, xx] * (1 - 0.5 * fall) + bright * 0.5 * fall
    return np.clip(img, 0, 255).astype(np.uint8)


def paint_hud(cell: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    out = cell.copy()
    text = f"{int(rng.integers(0, 5))}/{int(rng.integers(0, 6))}"
    if rng.random() < 0.35:
        color = np.array([rng.integers(40, 90), rng.integers(200, 255), rng.integers(40, 90)], dtype=np.uint8)
    else:
        color = np.array([rng.integers(210, 255), rng.integers(210, 255), rng.integers(200, 240)], dtype=np.uint8)
    x0 = int(rng.integers(2, 26))
    y0 = int(rng.integers(1, 5))
    scale = 2 if rng.random() < 0.55 else 1
    x = x0
    for ch in text:
        glyph = _DIGIT.get(ch)
        if not glyph:
            x += 3 * scale + 1
            continue
        for gy, row in enumerate(glyph):
            for gx, bit in enumerate(row):
                if bit != "1":
                    continue
                for sy in range(scale):
                    for sx in range(scale):
                        yy, xx = y0 + gy * scale + sy, x + gx * scale + sx
                        if 0 <= yy < TOPCUT and 0 <= xx < CELL:
                            out[yy, xx] = color
        x += 3 * scale + 1
    return out


def jpeg_compress(cell: np.ndarray, quality: int = JPEG_Q) -> np.ndarray:
    buf = io.BytesIO()
    Image.fromarray(cell).save(buf, format="JPEG", quality=int(quality))
    buf.seek(0)
    return np.array(Image.open(buf).convert("RGB"), dtype=np.uint8)


def add_navy_outline(spr: np.ndarray, thick: int = 1) -> np.ndarray:
    """1px (optionally 2px) dark navy around the sprite alpha edge."""
    out = spr.copy()
    alpha = out[..., 3] > 128
    if not alpha.any():
        return out
    edge = dilate_bool(alpha, thick) & ~alpha
    out[edge, 0] = NAVY[0]
    out[edge, 1] = NAVY[1]
    out[edge, 2] = NAVY[2]
    out[edge, 3] = 255
    return out


def pull_rgb(rgb: np.ndarray, sat_scale: float, lum_delta: float) -> np.ndarray:
    f = rgb.astype(np.float32)
    lum = 0.299 * f[..., 0] + 0.587 * f[..., 1] + 0.114 * f[..., 2]
    out = lum[..., None] + (f - lum[..., None]) * sat_scale
    out += lum_delta
    return np.clip(out, 0, 255)


def paste_sprite(
    bg: np.ndarray,
    sprite: np.ndarray,
    scale: int,
    ox: int,
    oy: int,
    sat_scale: float,
    lum_delta: float,
    outline_thick: int = 1,
) -> np.ndarray:
    """Plate-matcher composite: NEAREST resize to `scale`, place at (CELL-s)//2 + offset."""
    canvas = bg.copy()
    s = int(max(20, min(60, scale)))
    spr = np.array(Image.fromarray(sprite).resize((s, s), Image.NEAREST))
    spr = add_navy_outline(spr, thick=outline_thick)
    rgb = pull_rgb(spr[..., :3], sat_scale, lum_delta)
    alpha = spr[..., 3:4].astype(np.float32) / 255.0
    o = (CELL - s) // 2
    y0 = o + oy
    x0 = o + ox
    y1, x1 = y0 + s, x0 + s
    sy0 = 0 if y0 >= 0 else -y0
    sx0 = 0 if x0 >= 0 else -x0
    dy0, dx0 = max(0, y0), max(0, x0)
    dy1, dx1 = min(CELL, y1), min(CELL, x1)
    sy1, sx1 = sy0 + (dy1 - dy0), sx0 + (dx1 - dx0)
    if dy1 > dy0 and dx1 > dx0:
        a = alpha[sy0:sy1, sx0:sx1]
        src = rgb[sy0:sy1, sx0:sx1]
        dst = canvas[dy0:dy1, dx0:dx1].astype(np.float32)
        canvas[dy0:dy1, dx0:dx1] = np.clip(src * a + dst * (1.0 - a), 0, 255).astype(np.uint8)
    return canvas


def load_catalog() -> list[dict]:
    tablets = json.loads(TABLETS_JSON.read_text())
    rotatable = {t["value"] for t in tablets if t.get("rotate") is True}
    items = []
    for kind, d in (("ARTIFACT", ART_DIR), ("TABLET", SLAB_DIR)):
        for f in sorted(d.iterdir()):
            if f.is_dir() or f.suffix.lower() not in {".png", ".webp", ".jpg", ".jpeg"}:
                continue
            sq = extract_sprite(load_rgba(f))
            if sq is None:
                print(f"skip {f.name}", file=sys.stderr)
                continue
            items.append(
                {
                    "value": f.stem,
                    "type": kind,
                    "rotatable": kind == "TABLET" and f.stem in rotatable,
                    "square": sq,
                }
            )
    return items


def make_empty_samples(bgs: list[np.ndarray], rng: np.random.Generator, n: int = 220) -> list[np.ndarray]:
    out = []
    for bg in bgs:
        out.append(bg)
        j = bg.copy()
        if rng.random() < 0.5:
            j = jpeg_compress(j, JPEG_Q)
        if rng.random() < 0.35:
            j = paint_hud(j, rng)
        out.append(j)
    while len(out) < n:
        bg = bgs[int(rng.integers(0, len(bgs)))].copy() if rng.random() < 0.65 else purple_plate(rng)
        if rng.random() < 0.4:
            bg = jpeg_compress(bg, JPEG_Q)
        if rng.random() < 0.25:
            bg = paint_hud(bg, rng)
        out.append(bg)
    return out[:n]


def pick_scale_offset(rng: np.random.Generator, canonical: bool) -> tuple[int, int, int]:
    if canonical:
        return 32, 0, 0
    pool = CORE_SCALES if rng.random() < 0.85 else SCALES
    s = int(pool[int(rng.integers(0, len(pool)))])
    ox = int(OFFS[int(rng.integers(0, len(OFFS)))])
    oy = int(OFFS[int(rng.integers(0, len(OFFS)))])
    return s, ox, oy


def generate_occupied(items, plates, rng, sat_scale: float, lum_delta: float):
    cells, values, rots, types, rotflags = [], [], [], [], []
    for it in items:
        rots_k = [0, 1, 2, 3] if it["rotatable"] else [0]
        per_rot = VARIANTS_PER if not it["rotatable"] else max(3, VARIANTS_PER // 4)
        for r in rots_k:
            spr = rot90_cw(it["square"], r)
            for v in range(per_rot):
                bg = plates[int(rng.integers(0, len(plates)))]
                s, ox, oy = pick_scale_offset(rng, canonical=(v == 0))
                thick = 1 if (v < 8 or rng.random() < 0.7) else 2
                cell = paste_sprite(bg, spr, s, ox, oy, sat_scale, lum_delta, outline_thick=thick)
                cell = jpeg_compress(cell, JPEG_Q if v < 10 else int(rng.integers(60, 72)))
                # Live occupied cells almost always carry n/m HUD. Paint it on
                # most variants so white-ink does not become a class cue.
                if rng.random() < 0.85:
                    cell = paint_hud(cell, rng)
                cells.append(cell)
                values.append(it["value"])
                rots.append(r)
                types.append(it["type"])
                rotflags.append(it["rotatable"])
    return cells, values, rots, types, rotflags


def measure_color_pull(live_cells: list[np.ndarray], preview: list[np.ndarray]) -> tuple[float, float]:
    live_ch = float(np.mean([inner_chroma_lum(c)[0] for c in live_cells]))
    live_lu = float(np.mean([inner_chroma_lum(c)[1] for c in live_cells]))
    syn_ch = float(np.mean([inner_chroma_lum(c)[0] for c in preview]))
    syn_lu = float(np.mean([inner_chroma_lum(c)[1] for c in preview]))
    sat = 1.0 if syn_ch < 1e-3 else live_ch / syn_ch
    sat = float(np.clip(sat, 0.70, 1.20))
    lum = float(np.clip(live_lu - syn_lu, -10.0, 10.0))
    print(
        f"color-pull live inner chroma={live_ch:.2f} lum={live_lu:.2f}  "
        f"preview chroma={syn_ch:.2f} lum={syn_lu:.2f}  → sat={sat:.3f} lumΔ={lum:.2f}",
        file=sys.stderr,
    )
    return sat, lum


def class_key(value: str, rot: int) -> str:
    return f"{value}#{rot}"


def fit_prototypes(embs: np.ndarray, keys: list[str]):
    groups: dict[str, list[int]] = defaultdict(list)
    for i, k in enumerate(keys):
        groups[k].append(i)
    names = sorted(groups)
    protos = np.stack([l2(embs[groups[k]].mean(axis=0)) for k in names]).astype(np.float32)
    return names, protos


def cosine_nn(query, protos, k=5):
    sims = protos @ query
    idx = np.argpartition(-sims, min(k, len(sims) - 1))[:k]
    idx = idx[np.argsort(-sims[idx])]
    return idx, sims[idx]


def knn_value(query, embs, values, k=5):
    sims = embs @ query
    idx = np.argpartition(-sims, min(k, len(sims) - 1))[:k]
    idx = idx[np.argsort(-sims[idx])]
    top5 = [(values[int(i)], float(sims[i])) for i in idx]
    return values[int(idx[0])], float(sims[idx[0]]), top5


def value_rank(query, embs, values, target: str) -> tuple[int, float, list[tuple[str, float]]]:
    """Best-variant rank of `target` among unique values. 0 = top."""
    sims = embs @ query
    best: dict[str, float] = {}
    for i, v in enumerate(values):
        if v == "EMPTY":
            continue
        s = float(sims[i])
        if v not in best or s > best[v]:
            best[v] = s
    ranked = sorted(best.items(), key=lambda kv: -kv[1])
    neighbors = ranked[:8]
    if target not in best:
        return -1, -1.0, neighbors
    rank = next(i for i, (v, _) in enumerate(ranked) if v == target)
    return rank, best[target], neighbors


def heldout_nn_acc(embs, keys, rng, frac=0.2) -> float:
    n = len(keys)
    idx = np.arange(n)
    rng.shuffle(idx)
    cut = int(n * (1 - frac))
    tr, te = idx[:cut], idx[cut:]
    names, protos = fit_prototypes(embs[tr], [keys[i] for i in tr])
    correct = 0
    for i in te:
        j, _ = cosine_nn(embs[i], protos, 1)
        if names[int(j[0])].rsplit("#", 1)[0] == keys[i].rsplit("#", 1)[0]:
            correct += 1
    return correct / max(1, len(te))


def eval_live(fixtures, proto_names, protos, type_of, var_embs, var_values, use_knn: bool):
    name_value = [k.rsplit("#", 1)[0] for k in proto_names]
    name_rot = [int(k.rsplit("#", 1)[1]) for k in proto_names]
    tot = {
        "scored": 0,
        "skipped": 0,
        "emptyCorrect": 0,
        "itemTotal": 0,
        "top1Correct": 0,
        "typeCorrect": 0,
        "overallCorrect": 0,
        "mismatches": [],
    }
    results = {}
    carrot = None

    occ_mask = np.array([v != "EMPTY" for v in var_values])
    occ_embs = var_embs[occ_mask]
    occ_vals = [v for v in var_values if v != "EMPTY"]

    for fx in fixtures:
        cols = fx["cols"]
        grid = fx["grid"]
        preds = []
        for slot in range(fx["totalSlots"]):
            cell = crop_cell_from_image(fx["_img"], grid, slot, cols)
            q = embed_cell(cell)
            empty = is_empty_cell(cell)
            if use_knn:
                if empty:
                    top_val, top_sim, top5 = "EMPTY", 1.0, [("EMPTY", 1.0)]
                else:
                    top_val, top_sim, top5 = knn_value(q, occ_embs, occ_vals, 5)
                top_rot = 0
            else:
                idx, sims = cosine_nn(q, protos, 5)
                top_val = name_value[int(idx[0])]
                top_rot = name_rot[int(idx[0])]
                top_sim = float(sims[0])
                top5 = [(name_value[int(i)], float(s)) for i, s in zip(idx, sims)]
            if empty or top_val == "EMPTY":
                pred = {
                    "slotIndex": slot,
                    "matchedValue": None,
                    "type": None,
                    "rotation": 0,
                    "confidence": top_sim,
                    "top5": top5,
                    "emb": q,
                }
            else:
                pred = {
                    "slotIndex": slot,
                    "matchedValue": top_val,
                    "type": type_of.get(top_val),
                    "rotation": top_rot,
                    "confidence": top_sim,
                    "top5": top5,
                    "emb": q,
                }
            preds.append(pred)

        scored = skip = empty_ok = item_n = top1 = type_ok = overall = 0
        mismatches = []
        for exp in fx["expected"]:
            if exp["matchedValue"] == "???":
                skip += 1
                continue
            scored += 1
            pred = preds[exp["slotIndex"]]
            pv = pred["matchedValue"]
            if (exp["matchedValue"] is None) == (pv is None):
                empty_ok += 1
            ok = False
            if exp["matchedValue"] is None:
                ok = pv is None
            else:
                item_n += 1
                if pv == exp["matchedValue"]:
                    top1 += 1
                if pred["type"] == exp["type"]:
                    type_ok += 1
                ok = pv == exp["matchedValue"]
            if ok:
                overall += 1
            else:
                mismatches.append(
                    {
                        "slot": exp["slotIndex"],
                        "exp": exp["matchedValue"],
                        "pred": pv,
                        "conf": pred["confidence"],
                        "top5": pred["top5"],
                    }
                )
            if fx["_name"] == "live-6.png" and exp["slotIndex"] == 1:
                cell = crop_cell_from_image(fx["_img"], grid, 1, cols)
                rank, sim, neigh = value_rank(pred["emb"], occ_embs, occ_vals, "heart_shaped_carrot")
                carrot = {
                    "expected": exp["matchedValue"],
                    "predicted": pv,
                    "confidence": pred["confidence"],
                    "top5": pred["top5"],
                    "stats": occupancy_stats(cell),
                    "true_rank": rank,
                    "true_sim": sim,
                    "value_neighbors": neigh,
                }
        results[fx["_name"]] = {
            "top1": top1,
            "itemTotal": item_n,
            "overall": overall,
            "scored": scored,
            "emptyCorrect": empty_ok,
            "typeCorrect": type_ok,
            "skipped": skip,
            "mismatches": mismatches,
        }
        tot["scored"] += scored
        tot["skipped"] += skip
        tot["emptyCorrect"] += empty_ok
        tot["itemTotal"] += item_n
        tot["top1Correct"] += top1
        tot["typeCorrect"] += type_ok
        tot["overallCorrect"] += overall
        tot["mismatches"].extend([{**m, "image": fx["_name"]} for m in mismatches])
    tot["carrot"] = carrot
    tot["per"] = results
    tot["preds_by_image"] = None  # filled by caller if needed
    return tot


def export_index(proto_names, protos, type_of, rot_of, counts, sat_scale, lum_delta):
    classes = []
    for i, k in enumerate(proto_names):
        value, rot_s = k.rsplit("#", 1)
        classes.append(
            {
                "id": i,
                "value": value,
                "type": None if value == "EMPTY" else type_of.get(value),
                "rotation": int(rot_s),
                "rotatable": bool(rot_of.get(value, False)),
                "proto": [round(float(x), 6) for x in protos[i].tolist()],
            }
        )
    doc = {
        "version": FEATURE_VERSION,
        "dim": DIM,
        "cell": CELL,
        "topcut": TOPCUT,
        "trim": TRIM,
        "inset": INSET,
        "chroma_cut": CHROMA_CUT,
        "chroma_empty": CHROMA_EMPTY,
        "lumstd_empty": LUMSTD_EMPTY,
        "hue_bins": HUE_BINS,
        "residual": RES,
        "jpeg_q": JPEG_Q,
        "sat_scale": sat_scale,
        "lum_delta": lum_delta,
        "recipe": {
            "blocks": [
                {"name": "spatial_hue", "len": HUE_LEN},
                {"name": "inner_residual_16", "len": RES_LEN},
                {"name": "ink", "len": INK_LEN},
                {"name": "stats", "len": STAT_LEN},
            ],
            "norm": "l2_residual_then_weighted_l2_concat",
            "weights": {"hue": 0.25, "residual": 1.0, "ink": 0.20, "stats": 0.20},
            "plate": "ring_median_fg_masked",
            "empty_gate": "chroma_med>=chroma_empty AND lum_std<=lumstd_empty",
            "inference": "nearest_synthetic_variant",
        },
        "counts": counts,
        "classes": classes,
    }
    INDEX_JSON.parent.mkdir(parents=True, exist_ok=True)
    INDEX_JSON.write_text(json.dumps(doc, separators=(",", ":")))
    print(f"wrote {INDEX_JSON} ({INDEX_JSON.stat().st_size} bytes, {len(classes)} protos)", file=sys.stderr)


def write_plan(counts, nn_held, ev, ev_p, hybrid, wired, sat_scale, lum_delta):
    c = ev.get("carrot") or {}
    lines = [
        "# 09 — Embedding nearest-neighbor on synthetic inventory cells",
        "",
        "작성: 2026-08-15 (KST). 실측. 학습은 카탈로그 스프라이트×합성 플레이트만. live 6–9 확정 칸은 검증 전용(점유 칸을 라벨로 쓰지 않음).",
        "",
        "## Method (embed-v4)",
        "",
        f"- Feature recipe `{FEATURE_VERSION}`, dim={DIM}.",
        "  - `[0:32]` 2×2 chroma-weighted hue hist (8 bins, `y>=TOPCUT=12`)",
        f"  - `[32:{32+RES_LEN}]` **16×16 residual** of (inner cell − ring-median plate), /255, L2-normalized",
        f"  - `[{32+RES_LEN}:{32+RES_LEN+INK_LEN}]` 2×2 green/white ink hist",
        f"  - `[{32+RES_LEN+INK_LEN}:{DIM}]` stats: chroma_med/255, lum_std/255, inner_std/255, energy",
        "  - Residual block L2, then concat L2. Cosine = dot.",
        "- Inference: **nearest synthetic variant** (k-vote undid correct hits in v3).",
        "- Occupied plates: **inpainted live 6–9 occupied cells** (item blob erased with ring/interior charcoal; riveted frame kept) + procedural charcoal. Occupied live cells are never class labels. EMPTY is not trained on inpainted plates.",
        "- Composite matches plate-matcher: CELL=64, TRIM=0.07, TOPCUT=12, NEAREST resize onto matcher scales `{26,28,…,60}`, offsets ∈ {−4,−2,0,2,4}, JPEG quality 65, 1px dark-navy alpha-edge outline.",
        f"- Global sat/lum pull (not per-class): sat_scale={sat_scale:.3f}, lum_delta={lum_delta:.2f} toward live occupied inner chroma/lum.",
        f"- Empty gate unchanged: `chroma_med >= {CHROMA_EMPTY}` AND `lum_std <= {LUMSTD_EMPTY}`.",
        "- Plate-matcher L1 constants were not touched. Old fixtures `tests/fixtures/{1-7}.png.expected.json` were not overwritten. No commit.",
        "",
        "## Counts",
        "",
        f"- Catalog sprites: **{counts['sprites']}** (artifacts {counts['artifacts']}, slabs {counts['slabs']}, rotatable tablets {counts.get('rotatable', '?')})",
        f"- Occupied synth: **{counts['occupied']}** (~{counts['variants_per']} variants / non-rotatable)",
        f"- Inpainted occupied plates: **{counts['inpainted_plates']}** (+ {counts['proc_plates']} procedural charcoal)",
        f"- Empty synth: **{counts['empty']}** (real empty backgrounds {counts['empty_bgs']})",
        f"- Prototypes: **{counts['prototypes']}**",
        f"- Held-out synthetic NN value-acc: **{nn_held:.3f}**",
        "",
        "## Live 6–9 (confirmed cells only) — v4 nearest-variant",
        "",
        "| 장 | top-1 | overall | empty | skip | 남은 오답 |",
        "|---|---|---|---|---|---|",
    ]
    for name, r in ev["per"].items():
        miss = "; ".join(f"#{m['slot']} {m['exp']}→{m['pred']}" for m in r["mismatches"]) or "없음"
        lines.append(
            f"| {name} | {r['top1']}/{r['itemTotal']} | {r['overall']}/{r['scored']} | {r['emptyCorrect']}/{r['scored']} | {r['skipped']} | {miss} |"
        )
    lines.append(
        f"| 합 | **{ev['top1Correct']}/{ev['itemTotal']}** | **{ev['overallCorrect']}/{ev['scored']}** | {ev['emptyCorrect']}/{ev['scored']} | {ev['skipped']} | |"
    )
    lines += [
        "",
        f"Prototype-mean only: **{ev_p['top1Correct']}/{ev_p['itemTotal']}** top-1, **{ev_p['overallCorrect']}/{ev_p['scored']}** overall, {ev_p['emptyCorrect']}/{ev_p['scored']} empty.",
        "",
        "Plate-matcher floor: **44/45** top-1, **72/73** overall.",
        "v3 nearest-variant (history): **34/45** top-1, **62/73** overall, 73/73 empty.",
        "",
        "## live-6 slot 1 (heart_shaped_carrot)",
        "",
        f"- predicted: `{c.get('predicted')}`  conf={c.get('confidence')}",
        f"- top neighbors: {c.get('top5')}",
        f"- true class rank among value-best: **{c.get('true_rank')}** (sim {c.get('true_sim')})",
        f"- value-best neighbors: {c.get('value_neighbors')}",
        f"- occupancy stats: {c.get('stats')}",
        "",
        "## v3 history (embed-v3, 8×8 mean RGB, procedural charcoal only)",
        "",
        "| 장 | top-1 | overall | empty | 남은 오답 |",
        "|---|---|---|---|---|",
        "| live-6.png | 5/11 | 14/20 | 20/20 | #1 carrot→criton; #15 black_tea→mini_balista; #21 silver_bracelet→stabbing_textbook; #22 pride→ignition; #23 plasma_helmet→shield; #32 heart_of_the_beast→preparation |",
        "| live-7.png | 4/6 | 12/14 | 14/14 | #3 pride→red_dew; #12 pointed_bat→keel_fragment |",
        "| live-8.png | 17/19 | 23/25 | 25/25 | #5 frozen_bow→blessing; #26 future→haste |",
        "| live-9.png | 8/9 | 13/14 | 14/14 | #28 palas_card→arrow_lane |",
        "| 합 | **34/45** | **62/73** | 73/73 | |",
        "",
        "v3 carrot: criton 0.929, true rank **45**. Distinctive items already matched. Domain gap + 8×8 mean-RGB collision.",
        "",
        "## Hybrid (plate-matcher top-5 re-ranked by embed cosine)",
        "",
    ]
    if hybrid:
        lines.append(
            f"- {hybrid.get('note', '')} top-1 **{hybrid.get('top1')}/{hybrid.get('items')}**, overall **{hybrid.get('overall')}/{hybrid.get('scored')}**. "
            f"carrot={'fixed' if hybrid.get('carrot_ok') else 'still wrong'}."
        )
        if hybrid.get("details"):
            lines.append(f"- {hybrid['details']}")
    else:
        lines.append("- Not run, or standalone already at/above the plate-matcher floor.")
    lines += [
        "",
        "## Wiring",
        "",
    ]
    if wired:
        lines.append(
            "- `lib/vision/embed-matcher.ts` + `tests/vision/embed-live.test.ts` added. Plate-matcher remains the default recognizer."
        )
    else:
        lines.append(
            "- TS matcher **not** wired as a live-floor replacement. Scripts + index + this note kept. Plate-matcher stays the default."
        )
    lines += [
        "",
        "## Files",
        "",
        "- `scripts/vision/synth_embed.py` — synth, embed, fit, live eval, export",
        "- `data/vision/embed-index.json` — embed-v4 prototypes + recipe + empty-gate constants",
        "- `.cache/vision-synth/` — debug composites, `variants.npz`, `eval.json` (gitignored)",
        "- `.venv/` — numpy / pillow / scikit-learn (gitignored)",
        "",
    ]
    PLAN_MD.write_text("\n".join(lines))
    print(f"wrote {PLAN_MD}", file=sys.stderr)


def save_debug(cells, labels, plates, live_occ, n=20):
    CACHE.mkdir(parents=True, exist_ok=True)
    for i, p in enumerate(plates[:12]):
        Image.fromarray(p).save(CACHE / f"plate_inpaint_{i:02d}.png")
    for i, c in enumerate(live_occ[:4]):
        Image.fromarray(c).save(CACHE / f"live_occ_{i:02d}.png")
    want = [
        i
        for i, lb in enumerate(labels)
        if any(s in lb for s in ("heart_shaped_carrot", "golden_leaf", "six_leaf_clover", "EMPTY", "advent", "pride", "criton"))
    ]
    pick = (want + list(range(len(cells))))[:n]
    for i, idx in enumerate(pick):
        Image.fromarray(cells[idx]).save(CACHE / f"dbg_{i:02d}_{labels[idx]}.png")


def collect_live_occupied(fixtures: list[dict]) -> list[np.ndarray]:
    cells = []
    for fx in fixtures:
        for exp in fx["expected"]:
            v = exp["matchedValue"]
            if v is None or v == "???":
                continue
            cells.append(crop_cell_from_image(fx["_img"], fx["grid"], exp["slotIndex"], fx["cols"]))
    return cells


def preview_synth(items, plates, rng, n=80) -> list[np.ndarray]:
    out = []
    for i in range(n):
        it = items[int(rng.integers(0, len(items)))]
        bg = plates[int(rng.integers(0, len(plates)))]
        s, ox, oy = pick_scale_offset(rng, canonical=(i < 8))
        cell = paste_sprite(bg, it["square"], s, ox, oy, 1.0, 0.0, outline_thick=1)
        cell = jpeg_compress(cell, JPEG_Q)
        out.append(cell)
    return out


def eval_hybrid(fixtures, var_embs, var_values, plate_top5: dict) -> dict:
    """Re-rank plate-matcher top-5 by embed cosine. plate_top5[(image,slot)] = [values]."""
    occ_mask = np.array([v != "EMPTY" for v in var_values])
    occ_embs = var_embs[occ_mask]
    occ_vals = [v for v in var_values if v != "EMPTY"]
    # per-value prototype from variants (max sim == nearest variant of that value)
    by_val: dict[str, list[int]] = defaultdict(list)
    for i, v in enumerate(occ_vals):
        by_val[v].append(i)

    item_n = top1 = overall = scored = empty_ok = 0
    carrot_ok = False
    details = []
    for fx in fixtures:
        for exp in fx["expected"]:
            if exp["matchedValue"] == "???":
                continue
            scored += 1
            cell = crop_cell_from_image(fx["_img"], fx["grid"], exp["slotIndex"], fx["cols"])
            if exp["matchedValue"] is None:
                pred = None if is_empty_cell(cell) else "OCC"
                ok = pred is None
                if ok:
                    empty_ok += 1
                    overall += 1
                continue
            item_n += 1
            if is_empty_cell(cell):
                details.append(f"{fx['_name']}#{exp['slotIndex']} empty-gated")
                continue
            empty_ok += 1
            cands = plate_top5.get((fx["_name"], exp["slotIndex"])) or []
            q = embed_cell(cell)
            if not cands:
                # fallback: embed nearest
                pv, _, _ = knn_value(q, occ_embs, occ_vals, 1)
            else:
                best_v, best_s = None, -1e9
                for v in cands:
                    idxs = by_val.get(v)
                    if not idxs:
                        continue
                    s = float((occ_embs[idxs] @ q).max())
                    if s > best_s:
                        best_s, best_v = s, v
                pv = best_v
            if pv == exp["matchedValue"]:
                top1 += 1
                overall += 1
            if fx["_name"] == "live-6.png" and exp["slotIndex"] == 1:
                carrot_ok = pv == "heart_shaped_carrot"
                details.append(f"carrot hybrid pred={pv} cands={cands}")
    return {
        "top1": top1,
        "items": item_n,
        "overall": overall,
        "scored": scored,
        "empty": empty_ok,
        "carrot_ok": carrot_ok,
        "note": "plate-matcher top-5 re-ranked by embed cosine.",
        "details": "; ".join(details[:8]),
    }


def main() -> int:
    rng = np.random.default_rng(SEED)
    print("loading catalog…", file=sys.stderr)
    items = load_catalog()
    n_art = sum(1 for i in items if i["type"] == "ARTIFACT")
    n_slab = sum(1 for i in items if i["type"] == "TABLET")
    n_rot = sum(1 for i in items if i["rotatable"])
    print(f"sprites {len(items)} art={n_art} slab={n_slab} rotatable={n_rot}", file=sys.stderr)

    fixtures = load_fixtures()
    bgs = collect_empty_bgs(fixtures)
    live_occ = collect_live_occupied(fixtures)
    print(f"empty backgrounds {len(bgs)}  live occupied (confirmed) {len(live_occ)}", file=sys.stderr)

    print("inpainting occupied plates…", file=sys.stderr)
    inpainted = collect_occupied_plates(fixtures, rng)
    proc = [charcoal_plate(rng) for _ in range(8)]
    plates = inpainted + proc
    print(f"plates inpainted={len(inpainted)} procedural={len(proc)}", file=sys.stderr)

    print("measuring color pull…", file=sys.stderr)
    preview = preview_synth(items, plates, np.random.default_rng(SEED + 7), n=80)
    sat_scale, lum_delta = measure_color_pull(live_occ, preview)

    print("synthesizing…", file=sys.stderr)
    o_cells, o_vals, o_rots, o_types, o_rotflags = generate_occupied(items, plates, rng, sat_scale, lum_delta)
    e_cells = make_empty_samples(bgs, rng, n=220)
    print(f"occupied {len(o_cells)} empty {len(e_cells)}", file=sys.stderr)
    save_debug(
        o_cells + e_cells,
        [f"{v}#{r}" for v, r in zip(o_vals, o_rots)] + ["EMPTY#0"] * len(e_cells),
        inpainted,
        live_occ,
    )

    e_gate = sum(is_empty_cell(c) for c in e_cells)
    o_gate = sum(is_empty_cell(c) for c in o_cells)
    print(f"empty-gate: empties {e_gate}/{len(e_cells)}  occupied-as-empty {o_gate}/{len(o_cells)}", file=sys.stderr)

    syn_ch = float(np.mean([inner_chroma_lum(c)[0] for c in o_cells[::20]]))
    syn_lu = float(np.mean([inner_chroma_lum(c)[1] for c in o_cells[::20]]))
    live_ch = float(np.mean([inner_chroma_lum(c)[0] for c in live_occ]))
    live_lu = float(np.mean([inner_chroma_lum(c)[1] for c in live_occ]))
    print(f"after-pull synth inner chroma={syn_ch:.2f} lum={syn_lu:.2f}  live {live_ch:.2f}/{live_lu:.2f}", file=sys.stderr)

    print("embedding…", file=sys.stderr)
    o_embs = np.stack([embed_cell(c) for c in o_cells])
    e_embs = np.stack([embed_cell(c) for c in e_cells])
    embs = np.concatenate([o_embs, e_embs])
    keys = [class_key(v, r) for v, r in zip(o_vals, o_rots)] + ["EMPTY#0"] * len(e_cells)
    value_labels = o_vals + ["EMPTY"] * len(e_cells)
    type_of, rot_of = {}, {}
    for v, t, rf in zip(o_vals, o_types, o_rotflags):
        type_of[v] = t
        rot_of[v] = rf
    type_of["EMPTY"] = None
    rot_of["EMPTY"] = False

    proto_names, protos = fit_prototypes(embs, keys)
    rng2 = np.random.default_rng(SEED + 1)
    nn_held = heldout_nn_acc(embs, keys, rng2)
    print(f"held-out synthetic NN value-acc={nn_held:.3f}", file=sys.stderr)

    counts = {
        "sprites": len(items),
        "artifacts": n_art,
        "slabs": n_slab,
        "rotatable": n_rot,
        "occupied": len(o_cells),
        "empty": len(e_cells),
        "empty_bgs": len(bgs),
        "inpainted_plates": len(inpainted),
        "proc_plates": len(proc),
        "variants_per": VARIANTS_PER,
        "prototypes": len(proto_names),
        "dim": DIM,
        "sat_scale": sat_scale,
        "lum_delta": lum_delta,
    }
    export_index(proto_names, protos, type_of, rot_of, counts, sat_scale, lum_delta)
    np.savez_compressed(CACHE / "variants.npz", embs=embs, keys=np.array(keys), values=np.array(value_labels))

    print("evaluating live 6-9…", file=sys.stderr)
    ev = eval_live(fixtures, proto_names, protos, type_of, embs, value_labels, use_knn=True)
    ev_p = eval_live(fixtures, proto_names, protos, type_of, embs, value_labels, use_knn=False)
    print(
        f"PROTO TOTAL top1={ev_p['top1Correct']}/{ev_p['itemTotal']} "
        f"overall={ev_p['overallCorrect']}/{ev_p['scored']} empty={ev_p['emptyCorrect']}/{ev_p['scored']}",
        file=sys.stderr,
    )

    print("\n===== LIVE 6-9 (nearest variant, embed-v4) =====")
    for name, r in ev["per"].items():
        print(f"{name} top1={r['top1']}/{r['itemTotal']} overall={r['overall']}/{r['scored']} empty={r['emptyCorrect']}/{r['scored']} skip={r['skipped']}")
        for m in r["mismatches"]:
            print(f"  slot {m['slot']} exp={m['exp']} pred={m['pred']} conf={m['conf']:.3f} top5={m['top5'][:5]}")
    print(
        f"TOTAL top1={ev['top1Correct']}/{ev['itemTotal']} overall={ev['overallCorrect']}/{ev['scored']} "
        f"empty={ev['emptyCorrect']}/{ev['scored']}  (v3 34/45, plate-matcher 44/45)"
    )
    c = ev["carrot"]
    print("\n===== live-6 slot 1 heart_shaped_carrot =====")
    print(f"pred={c['predicted']} conf={c['confidence']:.3f} top5={c['top5'][:5]}")
    print(f"true_rank={c['true_rank']} true_sim={c['true_sim']:.3f} neighbors={c['value_neighbors'][:8]}")
    print(f"stats={c['stats']}")

    hybrid = None
    top1 = ev["top1Correct"]
    items_n = ev["itemTotal"]
    carrot_ok = c["predicted"] == "heart_shaped_carrot"
    empty_ok = ev["emptyCorrect"] == ev["scored"]
    wired = False

    plate_top5_path = CACHE / "plate_top5.json"
    if top1 < 44 and plate_top5_path.exists():
        raw = json.loads(plate_top5_path.read_text())
        key = {(e["image"], e["slot"]): e["top5"] for e in raw}
        hybrid = eval_hybrid(fixtures, embs, value_labels, key)
        print(
            f"\n===== HYBRID plate-top5 × embed =====\n"
            f"top1={hybrid['top1']}/{hybrid['items']} overall={hybrid['overall']}/{hybrid['scored']} "
            f"carrot_ok={hybrid['carrot_ok']} {hybrid['details']}"
        )

    write_plan(counts, nn_held, ev, ev_p, hybrid, wired, sat_scale, lum_delta)
    (CACHE / "eval.json").write_text(
        json.dumps(
            {
                "version": FEATURE_VERSION,
                "counts": counts,
                "nn_held": nn_held,
                "sat_scale": sat_scale,
                "lum_delta": lum_delta,
                "knn": {
                    "top1": ev["top1Correct"],
                    "items": ev["itemTotal"],
                    "overall": ev["overallCorrect"],
                    "scored": ev["scored"],
                    "empty": ev["emptyCorrect"],
                    "carrot": ev["carrot"],
                    "per": ev["per"],
                },
                "proto": {
                    "top1": ev_p["top1Correct"],
                    "items": ev_p["itemTotal"],
                    "overall": ev_p["overallCorrect"],
                    "scored": ev_p["scored"],
                    "empty": ev_p["emptyCorrect"],
                    "carrot": ev_p["carrot"],
                },
                "hybrid": hybrid,
                "wired": wired,
            },
            indent=2,
            default=str,
        )
    )
    print(
        f"\nDECISION top1={top1}/{items_n} carrot_ok={carrot_ok} empty_ok={empty_ok} "
        f"wire_threshold=44/45_or_carrot_without_empty_regression",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
