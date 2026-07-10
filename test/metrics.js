// Pure similarity metrics for the visual-quality test suite (see
// docs/decoration-reduction-plan.md, "Phase 1.5 — Similarity test suite").
//
// No three.js (or any DOM) imports here on purpose: the harness feeds these
// functions plain typed arrays it read back from WebGL render targets, and
// the app's future in-app "Score current model" action reuses the exact
// same functions — keeping the acceptance test identical everywhere it runs.

// ---------- silhouette IoU ----------

// maskA/maskB: same-length arrays (typed or plain) of truthy/falsy values —
// one entry per pixel, true = foreground (part of the silhouette).
export function silhouetteIoU(maskA, maskB) {
  let inter = 0, union = 0;
  const n = Math.min(maskA.length, maskB.length);
  for (let i = 0; i < n; i++) {
    const a = !!maskA[i], b = !!maskB[i];
    if (a || b) union++;
    if (a && b) inter++;
  }
  return union === 0 ? 1 : inter / union; // both empty = perfect agreement
}

// ---------- sRGB -> CIELAB ----------

function srgb255ToLinear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

// sRGB (D65) primaries -> CIE XYZ, linear-light input 0..1
function linearRgbToXyz(r, g, b) {
  return [
    r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    r * 0.2126729 + g * 0.7151522 + b * 0.0721750,
    r * 0.0193339 + g * 0.1191920 + b * 0.9503041,
  ];
}

// D65 reference white
const XN = 0.95047, YN = 1.0, ZN = 1.08883;
function xyzToLab(x, y, z) {
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x / XN), fy = f(y / YN), fz = f(z / ZN);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// r,g,b: 0..255 sRGB-encoded bytes (as read straight off a canvas/render
// target) -> [L, a, b]
export function rgbToLab(r, g, b) {
  const rl = srgb255ToLinear(r), gl = srgb255ToLinear(g), bl = srgb255ToLinear(b);
  const [x, y, z] = linearRgbToXyz(rl, gl, bl);
  return xyzToLab(x, y, z);
}

// ---------- CIEDE2000 ----------
// Standard formula (Sharma, Wu, Dalal 2005) — deliberately NOT ΔE76: the
// palette builder (engine/convert/color.js) optimizes construction with
// ΔE76; this harness judges perceived similarity with the more accurate
// (and much fiddlier) ΔE2000.
export function deltaE2000(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const rad = Math.PI / 180, deg = 180 / Math.PI;

  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);
  const h1p = C1p === 0 ? 0 : (Math.atan2(b1, a1p) * deg + 360) % 360;
  const h2p = C2p === 0 ? 0 : (Math.atan2(b2, a2p) * deg + 360) % 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    const diff = h2p - h1p;
    if (diff > 180) dhp = diff - 360;
    else if (diff < -180) dhp = diff + 360;
    else dhp = diff;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp;
  if (C1p * C2p === 0) {
    hbarp = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hbarp = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hbarp = (h1p + h2p + 360) / 2;
  } else {
    hbarp = (h1p + h2p - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos((hbarp - 30) * rad) +
    0.24 * Math.cos(2 * hbarp * rad) +
    0.32 * Math.cos((3 * hbarp + 6) * rad) -
    0.2 * Math.cos((4 * hbarp - 63) * rad);
  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
  const SL = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(2 * dTheta * rad) * RC;

  const kL = 1, kC = 1, kH = 1;
  const termL = dLp / (kL * SL);
  const termC = dCp / (kC * SC);
  const termH = dHp / (kH * SH);
  return Math.sqrt(termL * termL + termC * termC + termH * termH + RT * termC * termH);
}

// ---------- mean ΔE2000 over shared-foreground pixels ----------

// rgbA/rgbB: flat pixel buffers (Uint8Array/Uint8ClampedArray), stride 4
// (RGBA) by default. intersectionMask: one entry per pixel, true where the
// pixel is foreground in BOTH renders (XOR pixels are IoU's job, not this
// metric's — see spec).
export function meanDeltaE(rgbA, rgbB, intersectionMask, stride = 4) {
  let sum = 0, n = 0;
  for (let i = 0; i < intersectionMask.length; i++) {
    if (!intersectionMask[i]) continue;
    const o = i * stride;
    const labA = rgbToLab(rgbA[o], rgbA[o + 1], rgbA[o + 2]);
    const labB = rgbToLab(rgbB[o], rgbB[o + 1], rgbB[o + 2]);
    sum += deltaE2000(labA, labB);
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

// ---------- headline score ----------

export function faithScore(meanIoU, meanDE) {
  return 100 * (0.6 * meanIoU + 0.4 * Math.max(0, 1 - meanDE / 20));
}

// ---------- hole detection (see-through gaps) ----------
// See docs/decoration-reduction-plan.md, "Hole gate" (2026-07-09): silhouette
// IoU barely notices a dropped face or an uncovered interior region — a
// hole can cost only a handful of boundary pixels out of 512x512 while being
// glaringly visible to a player. These two functions build a dedicated gate
// for that failure class, independent of IoU/ΔE.

// Binary erosion of a single-channel foreground mask (row-major,
// width*height entries, truthy = foreground). `radius` iterative 4-neighbor
// erosion passes: a foreground pixel survives a pass only if it and all 4
// orthogonal neighbors are foreground; off-canvas neighbors count as
// background, so the mask also erodes inward at the image edge. Plain
// iterative erosion (not a distance transform) is intentionally simple —
// this runs on 512x512 masks a handful of times per model, not a hot loop.
export function erodeMask(mask, width, height, radius) {
  let cur = new Uint8Array(width * height);
  for (let i = 0; i < cur.length; i++) cur[i] = mask[i] ? 1 : 0;
  for (let pass = 0; pass < radius; pass++) {
    const next = new Uint8Array(cur.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!cur[i]) continue;
        const left = x > 0 && cur[i - 1];
        const right = x < width - 1 && cur[i + 1];
        const up = y > 0 && cur[i - width];
        const down = y < height - 1 && cur[i + width];
        next[i] = left && right && up && down ? 1 : 0;
      }
    }
    cur = next;
  }
  return cur;
}

// Shared union-find (path halving + union by size) largest-4-connected-
// component reducer over a single-channel 0/1 flag array (row-major,
// width*height entries) — the common tail of both interiorMisses (hole gate)
// and exteriorExcess (protrusion gate, below): both build a "defect pixel"
// array by a different rule (erosion-based miss vs. dilation-based excess),
// then need the exact same "how big is the worst connected blob" reduction.
// parent[root] stores -(component size); non-root entries store the parent
// index. Only ever touched for indices where flag[i] is true.
function largestConnectedComponent(flag, width, height) {
  const n = width * height;
  let totalPixels = 0;
  for (let i = 0; i < n; i++) if (flag[i]) totalPixels++;
  if (totalPixels === 0) return { totalPixels: 0, largestRegion: 0 };

  const parent = new Int32Array(n).fill(-1);
  function find(a) {
    let root = a;
    while (parent[root] >= 0) root = parent[root];
    while (parent[a] >= 0) {
      const next = parent[a];
      parent[a] = root;
      a = next;
    }
    return root;
  }
  function union(a, b) {
    let ra = find(a), rb = find(b);
    if (ra === rb) return;
    if (parent[ra] > parent[rb]) { const t = ra; ra = rb; rb = t; } // ra = larger tree
    parent[ra] += parent[rb];
    parent[rb] = ra;
  }
  for (let i = 0; i < n; i++) {
    if (!flag[i]) continue;
    const x = i % width;
    if (x > 0 && flag[i - 1]) union(i, i - 1);
    if (x < width - 1 && flag[i + 1]) union(i, i + 1);
    if (i - width >= 0 && flag[i - width]) union(i, i - width);
    if (i + width < n && flag[i + width]) union(i, i + width);
  }
  let largestRegion = 0;
  for (let i = 0; i < n; i++) {
    if (flag[i] && find(i) === i) largestRegion = Math.max(largestRegion, -parent[i]);
  }
  return { totalPixels, largestRegion };
}

// Interior-miss pixels for one view: foreground in the EROSION of the source
// silhouette (a genuine interior point, not near any source silhouette edge)
// but background in the reconstruction. Erosion absorbs silhouette-boundary
// misalignment from legitimate shape abstraction (primitive fitting shifts
// edges a few pixels) and antialiasing fringe; whatever still misses after
// erosion is a real see-through defect — a dropped face, an uncovered
// interior region, or a crack. Intentional see-through in the SOURCE (e.g.
// the gap between a character's legs) is background in the source mask to
// begin with, so it is never eroded-foreground and never counts here — this
// metric only fires where the source says "solid" and the reconstruction
// says "see-through".
//
// Returns { totalPixels, largestRegion }: totalPixels is every miss pixel in
// the view; largestRegion is the size of the biggest 4-connected component
// (union-find flood fill) — a few miss pixels scattered along boundary
// jitter is harmless noise, one large connected blob is a hole a player can
// see through, so the gate keys off largestRegion, not totalPixels.
export function interiorMisses(sourceMask, reconMask, width, height, erosionRadius) {
  const eroded = erodeMask(sourceMask, width, height, erosionRadius);
  const n = width * height;
  const miss = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (eroded[i] && !reconMask[i]) miss[i] = 1;
  }
  return largestConnectedComponent(miss, width, height);
}

// Calibrated hole-gate constants shared by the standalone harness
// (test/similarity-harness.html) and the in-app "Score current model" action
// (js/score-current.js) so both apply the identical gate. See
// docs/decoration-reduction-plan.md "Hole gate" + Phase 1.5 calibration log
// for how these were picked (smallest erosion radius where boundary-shift
// noise passes; smallest region threshold that still catches a genuine hole).
// Tightened 25 -> 3 (2026-07-09, user requirement, superseding an interim
// 25 -> 8 pass): the target is literal ZERO holes, or as close to it as the
// pipeline can get — 25 px was too forgiving a "still basically fine" bar.
// Erosion radius (still the noise-floor knob) is unchanged.
export const HOLE_EROSION_RADIUS = 5;
export const HOLE_REGION_THRESHOLD_PX = 3;

// ============================================================================
// Phase 3 — protrusion gate (docs/decoration-reduction-plan.md, § 8 "Phase 3
// — Intelligent placement", "Metric hardening" item 1). Exact mirror of the
// hole gate above: the hole gate catches the reconstruction missing solid
// source material (a see-through gap); this gate catches the opposite and
// previously unmeasured failure — the reconstruction ADDING material the
// source never had (jagged edges/spurious primitives poking out past the
// silhouette). Both events in § 5.2 ("gates green but output shows jagged
// protruding edges") were exactly this failure mode with no metric to catch
// it — the essence pyramid's soft-IoU symmetric agreement can't distinguish
// "recon is missing a bit of source" from "recon has an extra bit sticking
// out", so a one-sided gate was needed on each side.
// ============================================================================

// Binary dilation of a single-channel foreground mask — the exact mirror of
// erodeMask above (same iterative 4-neighbor-pass structure), with the
// survive condition flipped: a pixel becomes (or stays) foreground if IT or
// ANY of its 4 orthogonal neighbors is foreground, instead of requiring ALL
// of them. Off-canvas neighbors count as background (never force a dilation
// at the image edge), matching erodeMask's edge convention.
export function dilateMask(mask, width, height, radius) {
  let cur = new Uint8Array(width * height);
  for (let i = 0; i < cur.length; i++) cur[i] = mask[i] ? 1 : 0;
  for (let pass = 0; pass < radius; pass++) {
    const next = new Uint8Array(cur.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (cur[i]) { next[i] = 1; continue; }
        const left = x > 0 && cur[i - 1];
        const right = x < width - 1 && cur[i + 1];
        const up = y > 0 && cur[i - width];
        const down = y < height - 1 && cur[i + width];
        next[i] = left || right || up || down ? 1 : 0;
      }
    }
    cur = next;
  }
  return cur;
}

// Exterior-excess pixels for one view: foreground in the RECONSTRUCTION but
// background in the DILATION of the source silhouette (dilation is the
// protrusion-gate mirror of the hole gate's erosion — it absorbs the same
// silhouette-boundary misalignment and antialiasing fringe that legitimate
// shape abstraction and edge jitter produce, in the opposite direction).
// Whatever still sticks out past the dilated source is a genuine protrusion
// — a spurious primitive, a faceted QEM edge, or emit-snap distortion — not
// boundary noise. Argument order (reconMask first, then sourceMask)
// deliberately mirrors the plan spec's `excess = recon ∧ ¬dilate(source, 5)`
// formula, unlike interiorMisses (sourceMask first) — see call sites.
//
// Returns { totalPixels, largestRegion } via the same union-find
// largest-4-connected-component reduction interiorMisses uses (see
// largestConnectedComponent above): a few scattered excess pixels along
// boundary jitter is harmless, one large connected blob is a protrusion a
// player can see.
export function exteriorExcess(reconMask, sourceMask, width, height, dilationRadius = 5) {
  const dilated = dilateMask(sourceMask, width, height, dilationRadius);
  const n = width * height;
  const excess = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (reconMask[i] && !dilated[i]) excess[i] = 1;
  }
  return largestConnectedComponent(excess, width, height);
}

// Calibrated protrusion-gate constants, shared by the standalone harness and
// the in-app "Score current model" action — same construction as the hole
// gate's constants above (see docs/decoration-reduction-plan.md "Metric
// hardening"): dilation radius mirrors HOLE_EROSION_RADIUS (same noise-floor
// magnitude, opposite direction), region threshold mirrors
// HOLE_REGION_THRESHOLD_PX (target: literal zero protrusions; ≤3 px worst
// connected region tolerated as "extremely tiny", same green-at-0/
// yellow-1-3/FAIL->3 scoreboard convention as holes).
export const PROTRUSION_DILATION_RADIUS = 5;
export const PROTRUSION_REGION_THRESHOLD_PX = 3;

// ============================================================================
// Phase 2 — Essence metric suite (docs/decoration-reduction-plan.md, "Phase 2
// — Essence capture", section 2A). Replaces the exact-match IoU/ΔE gates with
// scale-tolerant agreement metrics that TIE triangle-soup and a clean
// abstraction at fine scale but reward the abstraction at the coarse,
// gameplay-viewing scale a player actually reads. Raw meanIoU/meanΔE stay
// reported-only (see similarity-harness.html), not gates, from this phase on.
// ============================================================================

// ---------- MSSA: multi-scale silhouette agreement ----------

// 2x2 box-downsample. `buf` is a flat, row-major width*height array of values
// in [0,1] (a binary mask or an already-pooled coverage-fraction buffer);
// width/height are assumed even (the pyramid below only ever calls this on
// 512/256/128/64, all powers of two).
export function avgPool2(buf, w, h) {
  const ow = Math.floor(w / 2), oh = Math.floor(h / 2);
  const out = new Float32Array(ow * oh);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const x0 = x * 2, y0 = y * 2;
      const i00 = y0 * w + x0, i01 = i00 + 1, i10 = i00 + w, i11 = i10 + 1;
      out[y * ow + x] = (buf[i00] + buf[i01] + buf[i10] + buf[i11]) / 4;
    }
  }
  return out;
}

// 5-level average-pool pyramid of a binary mask: 512 -> 256 -> 128 -> 64 ->
// 32 (assuming a 512x512 input; any power-of-two w/h works, it just yields
// different absolute level sizes). Level 0 is the mask itself, coerced to
// 0/1 floats; each subsequent level is avgPool2 of the previous, so pooled
// levels hold coverage FRACTIONS in [0,1] rather than booleans.
export function buildMaskPyramid(mask, w, h) {
  const levels = [];
  let buf = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) buf[i] = mask[i] ? 1 : 0;
  let cw = w, ch = h;
  levels.push({ buf, w: cw, h: ch });
  for (let i = 0; i < 4; i++) {
    buf = avgPool2(buf, cw, ch);
    cw = Math.floor(cw / 2);
    ch = Math.floor(ch / 2);
    levels.push({ buf, w: cw, h: ch });
  }
  return levels;
}

// Soft IoU over fractional-coverage buffers (a straight boolean IoU when fed
// 0/1 masks): sum(min)/sum(max), 1 if the union is empty (both sides
// entirely background — perfect agreement, same convention as silhouetteIoU).
export function softIoU(a, b) {
  let sumMin = 0, sumMax = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i], bv = b[i];
    sumMin += av < bv ? av : bv;
    sumMax += av > bv ? av : bv;
  }
  return sumMax === 0 ? 1 : sumMin / sumMax;
}

// fine -> coarse: 512, 256, 128, 64, 32. 75% of the weight sits in the
// <=128^2 band (the "gameplay" scale a player actually perceives silhouette
// at) — this is the design property that makes soup and a clean abstraction
// TIE on this metric, unlike raw per-pixel IoU.
export const MSSA_WEIGHTS = [0.10, 0.15, 0.25, 0.25, 0.25];

export function multiScaleSilhouette(maskA, maskB, w, h) {
  const pyrA = buildMaskPyramid(maskA, w, h);
  const pyrB = buildMaskPyramid(maskB, w, h);
  let score = 0;
  for (let i = 0; i < MSSA_WEIGHTS.length; i++) {
    score += MSSA_WEIGHTS[i] * softIoU(pyrA[i].buf, pyrB[i].buf);
  }
  return score;
}

// ============================================================================
// Phase 3 — jaggedness gate (docs/decoration-reduction-plan.md, § 8 "Metric
// hardening" item 2). The essence pyramid's finest level (512^2) carries only
// 10% of MSSA's weight by design (scale tolerance is the point, § 4) — real
// faceting (coarse 8k-QEM edges, emit-snap hypotenuse distortion,
// surface-sphere contaminants) washes out in that average even though it's
// exactly what the user's "jagged edges protruding out of the model"
// complaint (§ 5.2) is about. This gate runs independently, at fixed
// resolution, keyed on contour roughness rather than area agreement — a
// faceted outline has a visibly LONGER 4-connected boundary than a smooth
// one at the same silhouette, even when the two silhouettes have near-
// identical area (which is why MSSA/IoU don't feel it).
// ============================================================================

// Cheap contour-roughness proxy: count of foreground<->background
// 4-neighbor transitions across the mask, counted once per adjacent pixel
// pair (only the right and down neighbor of each pixel, so no boundary edge
// is double-counted) — the total 4-connected perimeter length of the mask's
// silhouette at its own resolution. A faceted/jagged boundary has strictly
// more such transitions than a smooth one enclosing the same area, so the
// ratio of this count (recon vs. source) is a direct, cheap jaggedness
// signal without needing true turning-angle contour tracing.
export function contourRoughness(mask, width, height) {
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const v = !!mask[i];
      if (x < width - 1 && !!mask[i + 1] !== v) count++;
      if (y < height - 1 && !!mask[i + width] !== v) count++;
    }
  }
  return count;
}

// Level index into buildMaskPyramid's 512->256->128->64->32 pyramid that
// lands on 128^2 (index 0 = 512, 1 = 256, 2 = 128) — the same "gameplay"
// band the MSSA weights concentrate 75% of their weight in (§ 4), chosen so
// this gate judges roughness at the scale a player actually reads silhouette
// at, not full source-mesh resolution (which would flag ordinary AA fringe)
// or the coarse end (which smooths real faceting away entirely).
export const JAGGEDNESS_PYRAMID_LEVEL = 2; // 128^2

// Rebinarizes one buildMaskPyramid level (its buf holds [0,1] coverage
// fractions from repeated avgPool2, not booleans) at the >=0.5 majority
// threshold, so contourRoughness counts a clean 128^2 silhouette boundary
// instead of a fuzzy fractional one.
function maskPyramidLevelBinary(mask, w, h, level) {
  const { buf, w: lw, h: lh } = buildMaskPyramid(mask, w, h)[level];
  const bin = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i++) bin[i] = buf[i] >= 0.5 ? 1 : 0;
  return { mask: bin, w: lw, h: lh };
}

// jaggedness = roughness(recon) / roughness(source) at the 128^2 pyramid
// level. Ratio > 1 means the reconstruction's outline is more jagged than
// the source's at gameplay scale (the defect this gate targets); ratio < 1
// (a smoother recon than source, e.g. a curved-primitive fit replacing a
// faceted low-poly source) is not penalized — only the FAIL-above direction
// is gated (see JAGGEDNESS_FAIL_THRESHOLD). 1 (perfect agreement) when the
// source has zero transitions at this level (degenerate/empty-silhouette
// edge case), matching the "empty = perfect agreement" convention used
// elsewhere in this file (silhouetteIoU, softIoU).
export function jaggednessRatio(sourceMask, reconMask, w, h, level = JAGGEDNESS_PYRAMID_LEVEL) {
  const src = maskPyramidLevelBinary(sourceMask, w, h, level);
  const recon = maskPyramidLevelBinary(reconMask, w, h, level);
  const srcRough = contourRoughness(src.mask, src.w, src.h);
  const reconRough = contourRoughness(recon.mask, recon.w, recon.h);
  return srcRough === 0 ? 1 : reconRough / srcRough;
}

// Calibration sweep (docs/decoration-reduction-plan.md "Metric hardening"
// item 2 — required, same requirement as the hole-gate radius sweep): ran
// jaggednessRatio across the full suite under the SHIPPED default
// (hyperCurved left unset -> converter's own default true; see the
// test/similarity-harness.html config-mismatch fix note) via
// test/similarity-harness.html?auto=1. Measured worst-view ratios (2026-07-09):
// shiba 0.985, matilda 1.073, stormterror 1.053, stylized_sword 1.038
// (bypass path — source-exact triangles, its own boundary IS the recon
// boundary almost everywhere), shattered_crystal_sword 1.009. All five sit
// in a tight 0.985-1.073 band (a <9% spread) with NO bimodal separation
// visible in this suite — i.e. the suite does not currently exercise a case
// where this specific proxy (4-neighbor transition count at the 128^2
// pyramid level) reads a clear faceting defect; the coarse-QEM-facet /
// emit-snap distortion defects documented in § 8 forensic attribution
// apparently wash out at 128^2 the same way they wash out of MSSA's 0.10
// fine-level weight (both are pooling-based). The starting hypothesis of
// 1.15 was KEPT (not tuned down to chase a tighter gate against a suite that
// has no positive example to calibrate against): it sits ~0.08 above the
// worst clean measurement (matilda 1.073), a comparable margin-to-worst-
// clean ratio as the hole gate's few-px cushion, without manufacturing a
// separator the data doesn't support. See gates.jaggedness in the harness
// results for this run: all five PASS at this threshold — the gate is
// currently a floor, not yet a discriminator; flagged as a metric-design
// finding (this proxy may need a finer pyramid level or true turning-angle
// energy to catch faceting that protrusion/holes don't already flag).
export const JAGGEDNESS_FAIL_THRESHOLD = 1.15;

// ---------- LFCF: low-frequency color field ----------

// Area-weighted mean-color agreement over a coarse (default 32x32) cell
// grid, in place of per-pixel ΔE: this is the change that "un-shelves" flat-
// color-over-coverage fitters, because one large flat-colored primitive
// averages out to close to the true regional color at glance scale even
// though it disagrees with per-pixel ΔE all over its footprint.
//
// rgbA/rgbB: flat RGBA byte buffers (stride 4), sRGB-encoded (same convention
// as meanDeltaE's inputs). maskA/maskB: per-pixel foreground booleans.
// Returns the mean ΔE2000 over cells with >=25% foreground coverage in BOTH
// masks (cells thinner than that are skipped as unreliable color samples —
// mostly edge/background noise); 0 if no cell qualifies (no evidence of
// color disagreement, same "empty = perfect" convention used elsewhere here).
export function coarseLabField(rgbA, rgbB, maskA, maskB, w, h, cells = 32) {
  const cellW = w / cells, cellH = h / cells;
  let sum = 0, n = 0;
  for (let cy = 0; cy < cells; cy++) {
    const y0 = Math.floor(cy * cellH), y1 = Math.floor((cy + 1) * cellH);
    for (let cx = 0; cx < cells; cx++) {
      const x0 = Math.floor(cx * cellW), x1 = Math.floor((cx + 1) * cellW);
      let total = 0, fgA = 0, fgB = 0;
      let rA = 0, gA = 0, bA = 0, rB = 0, gB = 0, bB = 0;
      for (let y = y0; y < y1; y++) {
        const rowBase = y * w;
        for (let x = x0; x < x1; x++) {
          const i = rowBase + x;
          total++;
          if (maskA[i]) {
            fgA++;
            const o = i * 4;
            rA += srgb255ToLinear(rgbA[o]); gA += srgb255ToLinear(rgbA[o + 1]); bA += srgb255ToLinear(rgbA[o + 2]);
          }
          if (maskB[i]) {
            fgB++;
            const o = i * 4;
            rB += srgb255ToLinear(rgbB[o]); gB += srgb255ToLinear(rgbB[o + 1]); bB += srgb255ToLinear(rgbB[o + 2]);
          }
        }
      }
      if (total === 0) continue;
      if (fgA / total < 0.25 || fgB / total < 0.25) continue;
      const [xa, ya, za] = linearRgbToXyz(rA / fgA, gA / fgA, bA / fgA);
      const [xb, yb, zb] = linearRgbToXyz(rB / fgB, gB / fgB, bB / fgB);
      sum += deltaE2000(xyzToLab(xa, ya, za), xyzToLab(xb, yb, zb));
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

// ---------- PPC: part proportions (thickness spectrum + solidity) ----------

// Two-pass 3-4 chamfer distance transform: for every FOREGROUND pixel,
// (approximately, chamfer-3/4 divided by 3) its Euclidean distance to the
// nearest background pixel — i.e. how deep into the shape that point sits,
// the standard proxy for local thickness. Background pixels read 0.
export function distanceTransformChamfer(mask, w, h) {
  const INF = 1e9;
  const dt = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) dt[i] = mask[i] ? INF : 0;
  // forward pass: top-left -> bottom-right
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let d = dt[i];
      if (x > 0) d = Math.min(d, dt[i - 1] + 3);
      if (y > 0) d = Math.min(d, dt[i - w] + 3);
      if (x > 0 && y > 0) d = Math.min(d, dt[i - w - 1] + 4);
      if (x < w - 1 && y > 0) d = Math.min(d, dt[i - w + 1] + 4);
      dt[i] = d;
    }
  }
  // backward pass: bottom-right -> top-left
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let d = dt[i];
      if (x < w - 1) d = Math.min(d, dt[i + 1] + 3);
      if (y < h - 1) d = Math.min(d, dt[i + w] + 3);
      if (x < w - 1 && y < h - 1) d = Math.min(d, dt[i + w + 1] + 4);
      if (x > 0 && y < h - 1) d = Math.min(d, dt[i + w - 1] + 4);
      dt[i] = d;
    }
  }
  for (let i = 0; i < w * h; i++) dt[i] /= 3;
  return dt;
}

// Normalized histogram of the chamfer DT over foreground pixels only (a
// "thickness spectrum" — what fraction of the silhouette's area sits at each
// local-thickness band). Bin range is fixed at [0, min(w,h)/2] so histograms
// from different views/models/renders share the same bin edges and
// histIntersection is meaningful; values beyond the range clamp to the last
// bin (only possible for a fully-solid, edge-to-edge blob).
export const THICKNESS_BINS = 24;

export function thicknessSpectrum(mask, w, h, bins = THICKNESS_BINS) {
  const dt = distanceTransformChamfer(mask, w, h);
  const maxDist = Math.min(w, h) / 2;
  const hist = new Float32Array(bins);
  let fgCount = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    fgCount++;
    let bin = Math.floor((dt[i] / maxDist) * bins);
    if (bin >= bins) bin = bins - 1;
    if (bin < 0) bin = 0;
    hist[bin]++;
  }
  if (fgCount > 0) for (let i = 0; i < bins; i++) hist[i] /= fgCount;
  return hist;
}

// Histogram intersection (both histograms assumed normalized to sum 1):
// sum(min(a_i, b_i)), range [0,1].
export function histIntersection(histA, histB) {
  let sum = 0;
  const n = Math.min(histA.length, histB.length);
  for (let i = 0; i < n; i++) sum += Math.min(histA[i], histB[i]);
  return sum;
}

function crossProd(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

// Andrew's monotone-chain convex hull. `points` need not be sorted or
// deduplicated.
function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const n = pts.length;
  if (n < 3) return pts;
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && crossProd(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && crossProd(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function polygonArea(poly) {
  let area = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

// solidity = foreground area / convex-hull area, in pixels. Per spec, the
// hull is built from foreground EXTREMA only (leftmost/rightmost foreground
// pixel per row, topmost/bottommost per column) rather than every foreground
// pixel — those extrema are the only points that can ever sit on the hull, so
// this is both an exactness-preserving optimization and matches the plan
// text ("monotone-chain hull on foreground extrema"). Returns 1 (perfectly
// solid, trivial) when the mask is empty or degenerate (<3 hull candidates).
export function solidity(mask, w, h) {
  const rowMin = new Int32Array(h).fill(-1), rowMax = new Int32Array(h).fill(-1);
  const colMin = new Int32Array(w).fill(-1), colMax = new Int32Array(w).fill(-1);
  let fgCount = 0;
  for (let y = 0; y < h; y++) {
    const rowBase = y * w;
    for (let x = 0; x < w; x++) {
      if (!mask[rowBase + x]) continue;
      fgCount++;
      if (rowMin[y] === -1 || x < rowMin[y]) rowMin[y] = x;
      if (rowMax[y] === -1 || x > rowMax[y]) rowMax[y] = x;
      if (colMin[x] === -1 || y < colMin[x]) colMin[x] = y;
      if (colMax[x] === -1 || y > colMax[x]) colMax[x] = y;
    }
  }
  if (fgCount === 0) return 1;
  const points = [];
  for (let y = 0; y < h; y++) {
    if (rowMin[y] !== -1) { points.push([rowMin[y], y]); points.push([rowMax[y], y]); }
  }
  for (let x = 0; x < w; x++) {
    if (colMin[x] !== -1) { points.push([x, colMin[x]]); points.push([x, colMax[x]]); }
  }
  if (points.length < 3) return 1;
  const hullArea = polygonArea(convexHull(points));
  return hullArea > 0 ? fgCount / hullArea : 1;
}

// Per-view PPC convenience wrapper: 0.7 * thickness-spectrum histogram
// intersection + 0.3 * solidity agreement (1 - |solidityA - solidityB|).
// Callers average this across the 26 views for the headline PPC value.
export function partProportionAgreement(maskA, maskB, w, h) {
  const thickAgree = histIntersection(thicknessSpectrum(maskA, w, h), thicknessSpectrum(maskB, w, h));
  const solidAgree = 1 - Math.abs(solidity(maskA, w, h) - solidity(maskB, w, h));
  return 0.7 * thickAgree + 0.3 * solidAgree;
}

// ---------- EssenceScore (headline) ----------

export function essenceScore(essenceSil, lfcf, ppc) {
  return 100 * (0.50 * essenceSil + 0.30 * Math.max(0, 1 - lfcf / 15) + 0.20 * ppc);
}

// ============================================================================
// Phase 3 — structural edge term (docs/decoration-reduction-plan.md, § 8
// "Metric hardening" item 3; the only metric in the suite that "feels"
// muddied detail — see § L3 item 1's `E = w_sil*(1-IoU) + w_mean*deltaE +
// w_struct*deltaE_edges` and § 8 forensic attribution: "area-weighted
// region-mean color over deltaE<=12-merged clusters + palette majority
// smoothing... LFCF structurally blind to it (32^2 cells)"). REPORT-ONLY for
// now, over the 6 face views only (same view subset as LFCF/meanDeltaE) —
// per spec this becomes a gate once the decal phase (§ 8 item 4, "detail as
// paint") lands and there is something the fitter can actually DO about a
// low edge-agreement score.
// ============================================================================

// Rec. 601 luma grayscale from an sRGB-encoded RGBA byte buffer (stride 4) —
// deliberately simple (no linearization) since this feeds an edge-DETECTION
// pass, not a perceptual color metric; consistent, monotonic contrast is all
// Sobel needs.
function toGrayscale(rgb, w, h, stride = 4) {
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * stride;
    gray[i] = 0.299 * rgb[o] + 0.587 * rgb[o + 1] + 0.114 * rgb[o + 2];
  }
  return gray;
}

// Sobel gradient magnitude over a grayscale buffer; clamps to the nearest
// in-bounds pixel at the image edge (replicate-border convention) rather
// than treating out-of-bounds as 0, so the image border doesn't read as a
// false edge.
function sobelMagnitude(gray, w, h) {
  const at = (x, y) => gray[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  const mag = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx =
        -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) +
         at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      const gy =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) +
         at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      mag[y * w + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return mag;
}

// Default Sobel-magnitude threshold for "is this pixel an edge": chosen as a
// moderate fraction of the ~1442 theoretical max (4x255*sqrt(2)) that in
// practice separates genuine luma discontinuities (color-region boundaries,
// paint strokes, creases) from smooth-gradient/lighting noise on flat-shaded
// unlit renders (this is report-only, so precision here matters less than
// for a gated threshold — see calibration note in the harness).
export const STRUCT_EDGE_TAU = 40;

// edgeAgreement: Sobel-magnitude edge maps of rgbA/rgbB (thresholded at tau)
// -> IoU of the two binary edge maps, restricted to sharedMask (foreground in
// BOTH renders — same convention as meanDeltaE's intersectionMask, so this
// only judges pixels where both sides actually have surface to compare).
// High agreement = the reconstruction's internal structural lines (creases,
// paint strokes, decal boundaries) land where the source's do; low agreement
// is exactly the "muddied detail" failure region-mean color averaging can't
// see (LFCF's 32x32 cells are far too coarse to notice a missing eyebrow or
// blurred crease).
export function edgeAgreement(rgbA, rgbB, sharedMask, w, h, tau = STRUCT_EDGE_TAU) {
  const magA = sobelMagnitude(toGrayscale(rgbA, w, h), w, h);
  const magB = sobelMagnitude(toGrayscale(rgbB, w, h), w, h);
  let inter = 0, union = 0;
  for (let i = 0; i < w * h; i++) {
    if (!sharedMask[i]) continue;
    const a = magA[i] > tau, b = magB[i] > tau;
    if (a || b) union++;
    if (a && b) inter++;
  }
  return union === 0 ? 1 : inter / union;
}

// ============================================================================
// Efficiency diagnostics ("the waste detector" — 2A). None of these are
// silhouette/color agreement metrics; they measure how the decoration budget
// itself was spent, from the decoration records + a per-decoration visible-
// size proxy (26-view max screen-pixel footprint from test/views26.js
// renderOwnerAreas in the standalone harness, or object-space
// decorationSize() below as the in-app fallback that needs no ID render).
// ============================================================================

// Object-space size of one decoration, using the EXACT dimension formulas
// js/preview-mesh.js's buildPreview() uses (kept in lockstep with that file —
// see the half-extent/radius constants there: box() takes half-extents
// scale*0.05 so full box dims are scale*0.1; sphere radii scale*0.05;
// cylinder/cone radii scale.{x,z}*0.05 with half-height scale.y*0.05 so full
// height is scale.y*0.1; prism side scale.x*0.075 with the same *0.1 full
// height; the residual right-triangle's legs are the calibrated
// scale.y*0.13 / scale.z*0.27). Volumetric kinds return a volume (m^3); the
// flat kinds (right triangle, plane) have ~zero physical thickness in-game,
// so they return an area (m^2) instead — comparable within their own kind
// for percentile/share purposes, which is all these diagnostics need.
const SQRT3 = Math.sqrt(3);

export function decorationSize(kind, scale) {
  const sx = scale?.x ?? 1, sy = scale?.y ?? 1, sz = scale?.z ?? 1;
  switch (kind) {
    case 'square': {
      const w = sx * 0.1, h = sy * 0.1, d = sz * 0.1;
      return w * h * d;
    }
    case 'plane': {
      const w = sx * 0.1, d = sz * 0.1;
      return w * 0.004 * d; // 0.002 half-thickness (preview-mesh box()) -> 0.004 full
    }
    case 'sphere': {
      const rx = sx * 0.05, ry = sy * 0.05, rz = sz * 0.05;
      return (4 / 3) * Math.PI * rx * ry * rz;
    }
    case 'cylinder': {
      const rx = sx * 0.05, rz = sz * 0.05, h = sy * 0.1;
      return Math.PI * rx * rz * h;
    }
    case 'cone': {
      const rx = sx * 0.05, rz = sz * 0.05, h = sy * 0.1;
      return (Math.PI * rx * rz * h) / 3;
    }
    case 'prism': {
      const side = sx * 0.075, h = sy * 0.1;
      return ((SQRT3 / 4) * side * side) * h;
    }
    default: { // residual right triangle: flat, legs a x b -> area a*b/2
      const a = sy * 0.13, b = sz * 0.27;
      return 0.5 * a * b;
    }
  }
}

// Shape-usage histogram: what share of the decoration COUNT is spent on
// residual right triangles (the failure mode called out by the user
// directive: "hundreds of tiny triangles") vs. volumetric primitives.
const VOLUMETRIC_KINDS = new Set(['square', 'sphere', 'cylinder', 'cone', 'prism', 'plane']);

export function shapeHistogram(decorations) {
  let triCount = 0, volCount = 0;
  for (const d of decorations) {
    if (VOLUMETRIC_KINDS.has(d.kind)) volCount++;
    else triCount++;
  }
  const n = decorations.length || 1;
  return { triangleShare: triCount / n, volumetricShare: volCount / n };
}

// Percentile reader over a per-decoration size array (visArea or
// decorationSize output) — linear interpolation between the two nearest
// ranks, same convention as most stats libraries.
export function areaPercentiles(sizes) {
  const sorted = Array.from(sizes).sort((a, b) => a - b);
  const pct = (p) => {
    if (sorted.length === 0) return 0;
    const idx = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  return { p10: pct(10), p25: pct(25), p50: pct(50), p75: pct(75), p90: pct(90) };
}

// Share of decorations whose visible footprint is below `threshold` (default
// 4 px at the harness's 512x512 render size — spec's wasteShare definition).
// Count-based (matches shapeHistogram's convention), not area-weighted: a
// decoration that never clears 4 px anywhere across 26 views bought
// essentially nothing for its slot in the budget.
export function wasteShare(sizes, threshold = 4) {
  if (sizes.length === 0) return 0;
  let waste = 0;
  for (let i = 0; i < sizes.length; i++) if (sizes[i] < threshold) waste++;
  return waste / sizes.length;
}

// Share of total decoration size sitting in the lower half of the model's
// own vertical extent (decoration position.y below the midpoint of the
// min/max Y across all decorations) — a coarse "how much of the budget went
// to the bottom half" diagnostic (reported only, not gated).
export function bottomHalfArea(decorations, sizes) {
  if (decorations.length === 0) return 0;
  let minY = Infinity, maxY = -Infinity;
  for (const d of decorations) {
    if (d.position.y < minY) minY = d.position.y;
    if (d.position.y > maxY) maxY = d.position.y;
  }
  const midY = (minY + maxY) / 2;
  let bottom = 0, total = 0;
  for (let i = 0; i < decorations.length; i++) {
    const s = sizes[i];
    total += s;
    if (decorations[i].position.y < midY) bottom += s;
  }
  return total > 0 ? bottom / total : 0;
}

// Share of total size held by the N largest decorations — "coverage@N": a
// clean abstraction concentrates coverage into a handful of large primitives
// (high coverage@N), while soup spreads it thin across thousands of small
// ones (low coverage@N).
export function coverageTopN(sizes, n) {
  const arr = Array.from(sizes);
  const total = arr.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  const top = arr.slice().sort((a, b) => b - a).slice(0, Math.min(n, arr.length)).reduce((a, b) => a + b, 0);
  return top / total;
}
