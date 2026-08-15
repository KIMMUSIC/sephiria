"""REFERENCE IMPLEMENTATION — NOT SHIPPED, NOT IMPORTED BY THE APP.

This is the validated Python reference for the Phase 3 matcher. `lib/vision/plate-matcher.ts`
is a port of this file and must reproduce its numbers. Run it with:

    python tests/vision/REFERENCE.py

Measured against tests/fixtures on 2026-08-09 (327 sprites, 429 rotation variants):

    image     scored skip   empty            top1   overall lock
    1.jpeg         0   30       -               -         -   36
    2.png         31    5  100.0%   93.3% (14/15)     96.8%   42
    3.png         22   14   95.5%     80.0% (4/5)     90.9%   42
    4.png         28    8  100.0%    60.0% (6/10)     85.7%   34
    5.png         23   13   95.7%   55.6% (10/18)     60.9%   40
    TOTAL        104   70   98.1%     70.8% (34/48)     84.6%

Baseline (lib/vision/baseline-histogram.ts) for comparison: empty 71.2%, top1 12.5%, overall 59.6%.
"""
import numpy as np, json, glob, os, sys, cv2
from PIL import Image

ROOT = "D:/세피리아"
CELL = 64
TOPCUT = int(CELL*0.19)
VALID = np.ones((CELL, CELL), bool); VALID[:TOPCUT] = False
VF = VALID.ravel()
# ---- FROZEN CONFIG (validated 2026-08-09) ----
TRIM = 0.07   # fraction of cell pitch trimmed off each side before resampling to CELL
FGT  = 45     # foreground threshold: summed |RGB| distance to the nearest background colour
SWIN = 6      # half-width of the scale window around the locked scale
TOPK = 28     # candidates kept by the IoU prefilter, per scale
RI   = 3      # inset (px, on the CELL canvas) of the background sampling ring
QP   = 65     # percentile of per-cell icon bbox size used to lock the scale
FORCE = 0     # 0 = derive scale per image; nonzero = force this scale

def load_sq(p):
    a = np.array(Image.open(p).convert("RGBA")); al = a[..., 3] > 128
    if al.sum() < 12: return None
    ys, xs = np.where(al); sub = a[ys.min():ys.max()+1, xs.min():xs.max()+1]
    h, w = sub.shape[:2]; s = max(h, w)
    sq = np.zeros((s, s, 4), np.uint8); sq[(s-h)//2:(s-h)//2+h, (s-w)//2:(s-w)//2+w] = sub
    return sq

ROTF = {t["value"]: bool(t.get("rotate")) for t in json.load(open(f"{ROOT}/data/tablets.json", encoding="utf-8"))}
TM = {}
for kind, d in (("ARTIFACT", "artifacts"), ("TABLET", "slabs")):
    for f in sorted(glob.glob(f"{ROOT}/public/images/{d}/*")):
        if os.path.isdir(f): continue
        sq = load_sq(f)
        if sq is not None: TM[(kind, os.path.splitext(os.path.basename(f))[0])] = sq

SCALES = list(range(26, 61, 2))
VKEY, VROT, VSQ = [], [], []
for k, v in TM:
    for r in ([0, 1, 2, 3] if (k == "TABLET" and ROTF.get(v)) else [0]):
        VKEY.append((k, v)); VROT.append(r); VSQ.append(TM[(k, v)] if r == 0 else np.rot90(TM[(k, v)], -r))
NV = len(VKEY)

def sprite(i, s):
    a = np.array(Image.fromarray(VSQ[i]).resize((s, s), Image.NEAREST))
    return a[..., :3].astype(np.float32), (a[..., 3:4].astype(np.float32)/255.0)

SPR = {s: [sprite(i, s) for i in range(NV)] for s in SCALES}
MBANK = {}
for s in SCALES:
    M = np.zeros((NV, CELL*CELL), np.float32)
    o = (CELL-s)//2
    for i in range(NV):
        m = np.zeros((CELL, CELL), np.float32)
        m[o:o+s, o:o+s] = (SPR[s][i][1][..., 0] > 0.5)
        M[i] = m.ravel()
    MBANK[s] = M
print(f"bank: {NV} variants x {len(SCALES)} scales", file=sys.stderr)

def shift2(a, dy, dx, fill=False):
    out = np.zeros_like(a) if a.dtype != bool else np.zeros_like(a)
    ys, yd = (slice(0, CELL-dy), slice(dy, CELL)) if dy >= 0 else (slice(-dy, CELL), slice(0, CELL+dy))
    xs, xd = (slice(0, CELL-dx), slice(dx, CELL)) if dx >= 0 else (slice(-dx, CELL), slice(0, CELL+dx))
    out[yd, xd] = a[ys, xs]
    return out

def ringpix(c):
    a, b = RI, RI+6
    return np.concatenate([c[a:b].reshape(-1, 3), c[CELL-b:CELL-a].reshape(-1, 3),
                           c[:, a:b].reshape(-1, 3), c[:, CELL-b:CELL-a].reshape(-1, 3)])

def fg_of(cell):
    ring = ringpix(cell)
    q = (ring//16).astype(np.int32)
    co, cn = np.unique(q[:, 0]*4096+q[:, 1]*64+q[:, 2], return_counts=True)
    keep = co[cn > len(ring)*0.04]
    bg = (np.stack([keep//4096, (keep//64) % 64, keep % 64], 1)*16+8).astype(np.float32)
    if len(bg) == 0: bg = np.array([[60., 40., 60.]], np.float32)
    fg = (np.abs(cell[:, :, None, :]-bg[None, None]).sum(3).min(2) > FGT) & VALID
    m = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n, lab, st, cen = cv2.connectedComponentsWithStats(m, 8)
    if n <= 1: return None
    bi = 1+int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    if int(st[bi, cv2.CC_STAT_AREA]) < VALID.sum()*0.045: return None
    blob = lab == bi
    keepm = blob | (fg & cv2.dilate(blob.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool))
    ys, xs = np.where(keepm)
    return dict(fg=keepm, cy=float(ys.mean()), cx=float(xs.mean()),
                size=max(int(xs.max()-xs.min())+1, int(ys.max()-ys.min())+1))

def cells_of(shot, fx):
    g = fx["grid"]; cols, rows = fx["cols"], fx["rows"]
    im = Image.open(f"{ROOT}/인벤 예시/{shot}").convert("RGB")
    px, py = g["gridWidth"]/cols, g["gridHeight"]/rows
    for i in range(cols*rows):
        r, c = divmod(i, cols)
        x, y = g["originX"]+c*px, g["originY"]+r*py
        m = px*TRIM
        yield i, np.array(im.crop((int(x+m), int(y+m), int(x+px-m), int(y+py-m)))
                          .resize((CELL, CELL), Image.NEAREST)).astype(np.float32)

OFFS = [-2, 0, 2]
def run(shot, fx):
    cells, info = {}, {}
    for i, c in cells_of(shot, fx):
        cells[i] = c; info[i] = fg_of(c)
    occ = [i for i in cells if info[i]]; emp = [i for i in cells if not info[i]]
    # Learned plates: the icon differs per cell, so a per-pixel median cancels it out.
    plate_occ = np.median(np.stack([cells[i] for i in occ]), 0) if len(occ) >= 4 else None
    plate_emp = np.median(np.stack([cells[i] for i in emp]), 0) if len(emp) >= 3 else None
    sizes = [info[i]["size"] for i in occ]
    seed = int(np.median(sizes)) if sizes else 42

    def plate_for(cel):
        pl = plate_occ
        if plate_emp is not None and plate_occ is not None:
            r = ringpix(cel)
            if np.abs(r-ringpix(plate_emp)).mean() < np.abs(r-ringpix(plate_occ)).mean():
                pl = plate_emp
        if pl is None: pl = np.tile(np.median(ringpix(cel), 0), (CELL, CELL, 1)).astype(np.float32)
        return pl

    def best_at(i, scales, topk, offs):
        v = info[i]; cel = cells[i]; plate = plate_for(cel)
        dy, dx = int(round(CELL/2-v["cy"])), int(round(CELL/2-v["cx"]))
        fgf = shift2(v["fg"], dy, dx).ravel().astype(np.float32)
        valf = shift2(VALID, dy, dx).ravel().astype(np.float32)
        nfg = float(fgf.sum())
        if nfg < 20: return None
        cset = set()
        for s in scales:
            M = MBANK[s]
            inter = M @ fgf
            iou = inter/np.maximum((M @ valf)+nfg-inter, 1e-6)
            cset.update(int(j) for j in np.argpartition(-iou, min(topk, NV-1))[:topk])
        if not cset: return None
        D = np.abs(cel-plate).sum(2)*VALID
        Dsum = float(D.sum()); nval = float(VALID.sum()); base = Dsum/nval
        best = (-1e9, None, None, None)
        ccy, ccx = -dy, -dx
        for j in cset:
            for s in scales:
                rgb, al = SPR[s][j]; o = (CELL-s)//2
                for oy in offs:
                    for ox in offs:
                        y0, x0 = o+ccy+oy, o+ccx+ox
                        if y0 < 0 or x0 < 0 or y0+s > CELL or x0+s > CELL: continue
                        vreg = VALID[y0:y0+s, x0:x0+s]
                        comp = plate[y0:y0+s, x0:x0+s]*(1-al)+rgb*al
                        newreg = (np.abs(cel[y0:y0+s, x0:x0+s]-comp).sum(2)*vreg).sum()
                        sc = 1.0-((Dsum-D[y0:y0+s, x0:x0+s].sum()+newreg)/nval)/max(base, 1e-6)
                        if sc > best[0]: best = (sc, VKEY[j], VROT[j], s)
        return best if best[1] else None

    # Under-segmentation can only SHRINK the measured icon bbox, never grow it,
    # so an upper percentile is a better scale estimator than the median.
    lock = FORCE if FORCE else (int(np.percentile(sizes, QP)) if sizes else 42)
    lock = min(SCALES, key=lambda z: abs(z-lock))
    cand_s = [s for s in SCALES if abs(s-lock) <= SWIN] or [lock]

    preds = {}
    for i in cells:
        if info[i] is None: preds[i] = None; continue
        b = best_at(i, cand_s, TOPK, OFFS)
        preds[i] = (b[1], b[2], b[0]) if b else None
    return preds, lock

tot = dict(sc=0, sk=0, e=0, t1=0, t1n=0, ok=0)
print(f"{'image':9s} {'scored':>6} {'skip':>4} {'empty':>7} {'top1':>15} {'overall':>9} lock")
for fxp in sorted(glob.glob(f"{ROOT}/tests/fixtures/*.expected.json")):
    shot = os.path.basename(fxp).replace(".expected.json", "")
    fx = json.load(open(fxp, encoding="utf-8"))
    preds, lock = run(shot, fx)
    sc = sk = eok = t1 = t1n = ok = 0
    for e in fx["expected"]:
        gv = e["matchedValue"]
        if gv == "???": sk += 1; continue
        sc += 1
        p = preds.get(e["slotIndex"]); pv = p[0][1] if p else None
        if (gv is None) == (pv is None): eok += 1
        if gv is not None:
            t1n += 1
            if pv == gv: t1 += 1; ok += 1
        elif pv is None: ok += 1
    for k, v in (("sc", sc), ("sk", sk), ("e", eok), ("t1", t1), ("t1n", t1n), ("ok", ok)): tot[k] += v
    print(f"{shot:9s} {sc:>6} {sk:>4} {(f'{eok/sc*100:.1f}%' if sc else '-'):>7} "
          f"{(f'{t1/t1n*100:.1f}% ({t1}/{t1n})' if t1n else '-'):>15} "
          f"{(f'{ok/sc*100:.1f}%' if sc else '-'):>9} {lock}")
print(f"{'TOTAL':9s} {tot['sc']:>6} {tot['sk']:>4} {tot['e']/max(tot['sc'],1)*100:>6.1f}% "
      f"{tot['t1']/max(tot['t1n'],1)*100:>8.1f}% ({tot['t1']}/{tot['t1n']}) "
      f"{tot['ok']/max(tot['sc'],1)*100:>8.1f}%")
