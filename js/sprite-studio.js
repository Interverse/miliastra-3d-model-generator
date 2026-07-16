// Sprite workflow ("Sprite" mode): turns 2D images into (optionally
// animated) .gia exports.
//
// The studio owns only what is unique to sprites — image import, sprite
// settings, and the optional Animator. Everything shared with the model
// workflow lives in its usual place: Generate in the action bar, Download /
// Collision in the right sidebar, results in the Scene panel + viewport.
//
//   setupSpriteStudio(host, opts) -> {
//     state, importFiles, refresh,
//     generate(),    // convert + build export bytes (called by the app's
//                    // Generate button); resolves when done
//     getExport(),   // { bytes, filename } | null
//     isValid(),     // current validation state
//   }
//
// opts callbacks: onPixelGrid(px|null), onValidity(ok), onProgress(0..1),
//   onGenerated(previewMsg), getCollision() -> bool, createWorker() (tests)
import { t, applyI18n, onLangChange } from './i18n.js';
import { textPrompt } from './modal.js';
import { openSheetEditor } from './sheet-editor.js';
import { openAnimHelp } from './anim-help.js';
import { buildAnimatedGia, buildGia, splitIntoModels, MAX_DECORATIONS_PER_MODEL }
  from '../engine/gia/gia-writer.js';

const T = (key, fb) => { const s = t(key); return s && s !== key ? s : fb; };
const uid = () => Math.random().toString(36).slice(2, 9);

const MAX_IMG = 2048;

async function fileToBitmap(fileOrBlob) {
  return await createImageBitmap(fileOrBlob);
}

function bitmapToPixels(bmp, rect) {
  const w = rect ? rect.w : bmp.width;
  const h = rect ? rect.h : bmp.height;
  const k = Math.min(1, MAX_IMG / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  if (rect) ctx.drawImage(bmp, rect.x, rect.y, rect.w, rect.h, 0, 0, cw, ch);
  else ctx.drawImage(bmp, 0, 0, cw, ch);
  const d = ctx.getImageData(0, 0, cw, ch);
  return { width: cw, height: ch, data: d.data, canvas: cv };
}

// decode all frames of a GIF (ImageDecoder API — Chromium)
async function decodeGifFrames(file) {
  if (typeof ImageDecoder === 'undefined') {
    const bmp = await fileToBitmap(file); // fallback: first frame only
    return [bmp];
  }
  const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' });
  await dec.tracks.ready;
  const n = dec.tracks.selectedTrack?.frameCount ?? 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    out.push(await createImageBitmap(image));
    image.close();
  }
  return out;
}

// ---------- image optimizer ----------
// Web images of pixel sprites are usually upscaled (one logical pixel ≈
// k×k screen pixels — k is often FRACTIONAL after web resizing), padded
// with transparent margins, and dirtied by anti-aliased edges + noise.
//
// optimizeSpriteGroup(list) processes a set of SAME-SIZED frames (an
// animation sequence) together: one shared trim rectangle (the union of
// all frames' content) and one shared pixel grid, so every output frame
// has identical dimensions and alignment — no animation jitter.
//
// Grid estimation: sub-pixel edge peaks (weighted centroids of the
// edge-energy profile) are fitted with a continuous-period comb using
// circular statistics — the concentration R(k) of peak positions mod k
// is ≈1 exactly when the peaks lie on a lattice of spacing k, integer or
// not. The largest k with R ≥ 0.9 on the combined evidence wins.
// Reconstruction: one output pixel per grid cell, colored by the MODE
// (majority bucket) of the cell's center region — isolated noisy pixels
// and aliased borders are voted away.
export function optimizeSpriteGroup(list) {
  if (!list.length) return null;
  const { width: w, height: h } = list[0];
  if (list.some((p) => p.width !== w || p.height !== h)) return null;
  const at = (x, y) => (y * w + x) * 4;

  // ---- 1) shared trim: union of every frame's visible bounding box ----
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (const { data } of list) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[at(x, y) + 3] >= 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
  }
  if (x1 < 0) return null;
  const tw = x1 - x0 + 1, th = y1 - y0 + 1;

  // ---- 2) edge-energy profiles summed over ALL frames ----
  const NOISE_FLOOR = 60; // per-pair distance below this is in-pixel noise
  const Ex = new Float64Array(tw); // energy of the boundary LEFT of column x
  const Ey = new Float64Array(th);
  for (const { data } of list) {
    const solid = (i) => data[i + 3] >= 128;
    const dist = (i, j) => {
      const a = solid(i), b = solid(j);
      if (a !== b) return 400;
      if (!a) return 0;
      return Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1])
        + Math.abs(data[i + 2] - data[j + 2]);
    };
    for (let y = y0; y <= y1; y++) {
      for (let x = x0 + 1; x <= x1; x++) {
        const d = dist(at(x - 1, y), at(x, y));
        if (d > NOISE_FLOOR) Ex[x - x0] += d;
      }
    }
    for (let x = x0; x <= x1; x++) {
      for (let y = y0 + 1; y <= y1; y++) {
        const d = dist(at(x, y - 1), at(x, y));
        if (d > NOISE_FLOOR) Ey[y - y0] += d;
      }
    }
  }

  // ---- 3) continuous grid fit (per axis) ----
  // Sub-pixel edge peaks: clusters of adjacent high-energy boundaries
  // collapse to their weighted centroid (anti-aliasing splits one edge
  // across two boundaries — the centroid recovers its true position).
  const peaksOf = (E, len) => {
    let maxE = 0;
    for (let i = 1; i < len; i++) if (E[i] > maxE) maxE = E[i];
    if (!maxE) return [];
    const thr = 0.08 * maxE;
    const peaks = [];
    let i = 1;
    while (i < len) {
      if (E[i] > thr) {
        let sw = 0, sp = 0;
        while (i < len && E[i] > thr) { sw += E[i]; sp += i * E[i]; i++; }
        peaks.push({ p: sp / sw, w: sw });
      } else i++;
    }
    return peaks;
  };
  // Circular concentration of peak positions modulo k: R ≈ 1 ⇔ all peaks
  // sit on a lattice with (possibly fractional) spacing k.
  const ring = (peaks, k) => {
    let sr = 0, si = 0, sw = 0;
    for (const { p, w: wt } of peaks) {
      const a = (2 * Math.PI * p) / k;
      sr += wt * Math.cos(a);
      si += wt * Math.sin(a);
      sw += wt;
    }
    return {
      R: sw ? Math.hypot(sr, si) / sw : 0,
      phase: ((Math.atan2(si, sr) / (2 * Math.PI)) * k + k) % k,
    };
  };
  const fitGrid = (peaks, len) => {
    if (peaks.length < 3) return null;
    const kMax = Math.min(64, len / 2);
    // coarse multiplicative scan, then fine refinement around the LARGEST
    // strong candidate (divisors of the true k also score 1 — skip them)
    let best = null;
    for (let k = 1.6; k <= kMax; k *= 1.012) {
      const { R } = ring(peaks, k);
      if (R >= 0.9 && (!best || k > best.k)) best = { k, R };
    }
    if (!best) return null;
    // the acceptance threshold creates a plateau whose TOP edge overshoots
    // the true period (especially with few peaks) — hunt the R maximum in
    // a window reaching well below the plateau top
    let refined = { k: best.k, R: ring(peaks, best.k).R };
    for (let k = best.k / 1.2; k <= best.k * 1.05; k += best.k * 0.001) {
      const r = ring(peaks, k);
      if (r.R > refined.R + 1e-9) refined = { k, R: r.R };
    }
    const { phase } = ring(peaks, refined.k);
    return { k: refined.k, phase, R: refined.R };
  };
  const px = peaksOf(Ex, tw);
  const py = peaksOf(Ey, th);
  let gx = fitGrid(px, tw);
  let gy = fitGrid(py, th);
  // axes of one sprite share the pixel size: harmonize near-equal results,
  // and borrow the found axis when the other lacks evidence
  if (gx && gy && Math.abs(gx.k - gy.k) < 0.12 * Math.max(gx.k, gy.k)) {
    const k = (gx.k + gy.k) / 2;
    gx = { k, phase: ring(px, k).phase };
    gy = { k, phase: ring(py, k).phase };
  } else if (gx && !gy) {
    gy = { k: gx.k, phase: py.length ? ring(py, gx.k).phase : 0 };
  } else if (gy && !gx) {
    gx = { k: gy.k, phase: px.length ? ring(px, gy.k).phase : 0 };
  }
  const kx = gx?.k ?? 1, ky = gy?.k ?? 1;
  const isNoop = kx === 1 && ky === 1
    && x0 === 0 && y0 === 0 && tw === w && th === h;
  if (isNoop) return null;

  // ---- 4) grid cells (real-valued boundaries → integer sample spans) ----
  const cellsOf = (g, len) => {
    if (!g || g.k === 1) {
      return Array.from({ length: len }, (_, i) => [i, i + 1]);
    }
    const { k, phase } = g;
    let b = ((phase % k) + k) % k;
    if (b > 0) b -= k; // leading partial cell
    const out = [];
    for (; b < len; b += k) {
      const lo = Math.max(0, Math.round(b));
      const hi = Math.min(len, Math.round(b + k));
      // keep even thin edge cells — aliasing fringes are semi-transparent
      // and vote themselves away; empty output borders are cropped later
      if (hi - lo >= Math.max(1, k * 0.2)) out.push([lo, hi]);
    }
    return out;
  };
  const cx = cellsOf(gx, tw);
  const cy = cellsOf(gy, th);
  const w2 = cx.length, h2 = cy.length;
  if (!w2 || !h2) return null;

  // ---- 5) mode-color reconstruction per frame on the SHARED grid ----
  const frames = list.map(({ data }) => {
    const solid = (i) => data[i + 3] >= 128;
    const cv = document.createElement('canvas');
    cv.width = w2; cv.height = h2;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const img = ctx.createImageData(w2, h2);
    const out = img.data;
    const vote = (sx0, sx1, sy0, sy1, o) => {
      let nOp = 0, nTr = 0;
      const buckets = new Map(); // 4-bit/channel bucket -> [n, Σr, Σg, Σb]
      for (let y = sy0; y < sy1; y++) {
        for (let x = sx0; x < sx1; x++) {
          const i = at(x, y);
          if (!solid(i)) { nTr++; continue; }
          nOp++;
          const key = (data[i] >> 4) << 8 | (data[i + 1] >> 4) << 4 | (data[i + 2] >> 4);
          let b = buckets.get(key);
          if (!b) buckets.set(key, b = [0, 0, 0, 0]);
          b[0]++; b[1] += data[i]; b[2] += data[i + 1]; b[3] += data[i + 2];
        }
      }
      if (nOp === 0 && nTr === 0) return false;
      if (nOp > nTr) {
        let best = null;
        for (const b of buckets.values()) if (!best || b[0] > best[0]) best = b;
        out[o] = Math.round(best[1] / best[0]);
        out[o + 1] = Math.round(best[2] / best[0]);
        out[o + 2] = Math.round(best[3] / best[0]);
        out[o + 3] = 255; // crisp pixel-art alpha
      }
      return true;
    };
    for (let by = 0; by < h2; by++) {
      for (let bx = 0; bx < w2; bx++) {
        const [gx0, gx1] = cx[bx];
        const [gy0, gy1] = cy[by];
        const o = (by * w2 + bx) * 4;
        // centre sample first (aliased borders live at cell edges),
        // full cell as fallback
        const ix = gx1 - gx0 >= 4 ? Math.max(1, Math.floor((gx1 - gx0) * 0.25)) : 0;
        const iy = gy1 - gy0 >= 4 ? Math.max(1, Math.floor((gy1 - gy0) * 0.25)) : 0;
        if (!vote(x0 + gx0 + ix, x0 + gx1 - ix, y0 + gy0 + iy, y0 + gy1 - iy, o)) {
          vote(x0 + gx0, x0 + gx1, y0 + gy0, y0 + gy1, o);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return { width: w2, height: h2, data: out, canvas: cv };
  });

  // ---- 6) crop empty output borders (union across frames, so every
  // frame keeps identical dimensions and alignment) ----
  let ox0 = w2, oy0 = h2, ox1 = -1, oy1 = -1;
  for (const f of frames) {
    for (let y = 0; y < h2; y++) {
      for (let x = 0; x < w2; x++) {
        if (f.data[(y * w2 + x) * 4 + 3] > 0) {
          if (x < ox0) ox0 = x;
          if (x > ox1) ox1 = x;
          if (y < oy0) oy0 = y;
          if (y > oy1) oy1 = y;
        }
      }
    }
  }
  if (ox1 < 0) return null;
  const fw = ox1 - ox0 + 1, fh = oy1 - oy0 + 1;
  const cropped = (fw === w2 && fh === h2) ? frames : frames.map((f) => {
    const cv = document.createElement('canvas');
    cv.width = fw; cv.height = fh;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(f.canvas, ox0, oy0, fw, fh, 0, 0, fw, fh);
    const img = ctx.getImageData(0, 0, fw, fh);
    return { width: fw, height: fh, data: img.data, canvas: cv };
  });

  const kAvg = (kx + ky) / 2;
  return {
    frames: cropped,
    k: kAvg,
    kLabel: Math.abs(kAvg - Math.round(kAvg)) < 0.05
      ? String(Math.round(kAvg))
      : kAvg.toFixed(2),
    trim: { x: x0, y: y0 },
    // map a point in ORIGINAL image coordinates to output-pixel coordinates
    // (used to carry custom pivots across the optimization)
    mapPoint: (mx, my) => {
      const lx = mx - x0, ly = my - y0;
      const ix = cx.findIndex(([lo, hi]) => lx >= lo && lx < hi);
      const iy = cy.findIndex(([lo, hi]) => ly >= lo && ly < hi);
      const rx = ix >= 0 ? ix : Math.round((lx - cx[0][0]) / kx);
      const ry = iy >= 0 ? iy : Math.round((ly - cy[0][0]) / ky);
      return {
        x: Math.max(0, Math.min(fw, rx - ox0)),
        y: Math.max(0, Math.min(fh, ry - oy0)),
      };
    },
  };
}

// single-image convenience wrapper (kept for API compatibility)
export function optimizeSpritePixels(pixels) {
  const r = optimizeSpriteGroup([pixels]);
  return r && { pixels: r.frames[0], k: r.k, kLabel: r.kLabel, trim: r.trim, mapPoint: r.mapPoint };
}

export function setupSpriteStudio(host, opts = {}) {
  // ---------- state ----------
  const state = {
    assets: [],      // { id, name, pixels }
    animations: [],  // { id, name, frames: [assetId], loop, spf, useFps }
    startingId: null,
    current: null,   // current animation id
    settings: { pixelSize: 0.05, thickness: 0.1, alphaCutoff: 0.5, overdraw: true,
      name: 'Sprite', pixelGrid: true },
  };
  const results = new Map(); // assetId -> { decorations, stats } after generate

  // ---------- layout ----------
  // Primary workflow: import image(s) → Generate (action bar). The Animator
  // is a secondary, collapsed panel for the multi-frame use case.
  // All texts are bound via data-i18n(-title) so language switches apply live.
  host.innerHTML = `
  <details class="panel" open>
    <summary data-i18n="ss.import"></summary>
    <button id="ss-add-images" class="secondary" data-i18n="ss.addimg"></button>
    <button id="ss-add-sheet" class="secondary" data-i18n="ss.addsheet"></button>
    <div class="hint2" data-i18n="ss.importhint"></div>
    <div class="ss-frames" id="ss-frames"></div>
    <div class="hint2" id="ss-frames-hint" hidden data-i18n="ss.frameshint"></div>
    <div class="row" id="ss-pivot-row" hidden data-i18n-title="tip.ss.pivot">
      <span data-i18n="ss.pivot"></span>
      <input id="ss-pivot-x" type="number" step="1">
      <input id="ss-pivot-y" type="number" step="1">
    </div>
    <button id="ss-pivot-all" class="secondary" hidden data-i18n="ss.pivotall"
      data-i18n-title="tip.ss.pivotall"></button>
    <button id="ss-optimize" class="secondary" hidden data-i18n="ss.optimize"
      data-i18n-title="tip.ss.optimize"></button>
    <div class="hint2" id="ss-optinfo"></div>
    <div class="ss-divider"></div>
    <label class="row"><span data-i18n="ss.name"></span>
      <input id="ss-name" type="text" value="Sprite"></label>
    <label class="row" data-i18n-title="tip.sprite.px"><span data-i18n="sprite.px"></span>
      <input id="ss-px" type="number" value="0.05" min="0.01" step="0.01"></label>
    <label class="row" data-i18n-title="tip.sprite.thick"><span data-i18n="sprite.thick"></span>
      <input id="ss-thick" type="number" value="0.1" min="0.05" step="0.05"></label>
    <label class="row" data-i18n-title="tip.sprite.od"><span data-i18n="sprite.od"></span>
      <input id="ss-od" type="checkbox" checked></label>
    <label class="row" data-i18n-title="tip.ss.pixelgrid"><span data-i18n="ss.pixelgrid"></span>
      <input id="ss-grid" type="checkbox" checked></label>
    <button id="ss-clear" class="secondary" data-i18n="ss.clear" data-i18n-title="tip.ss.clear"></button>
    <div class="ss-error" id="ss-error"></div>
  </details>

  <details class="panel" id="ss-anim-panel" open>
    <summary data-i18n="ss.animator"></summary>
    <div class="hint2" data-i18n="ss.animhint"></div>
    <label class="row"><span data-i18n="ss.animation"></span>
      <select id="ss-anims"></select></label>
    <div class="btn-strip">
      <button id="ss-anim-add" class="mini" data-i18n-title="ss.addanim">＋</button>
      <button id="ss-anim-dup" class="mini" data-i18n-title="ss.dupanim">⧉</button>
      <button id="ss-anim-ren" class="mini" data-i18n-title="ss.renanim">✎</button>
      <button id="ss-anim-del" class="mini danger" data-i18n-title="ss.delanim">✕</button>
    </div>
    <label class="row"><span data-i18n="ss.mode"></span>
      <select id="ss-loop">
        <option value="loop" data-i18n="ss.loop"></option>
        <option value="once" data-i18n="ss.oneshot"></option>
      </select></label>
    <label class="row" data-i18n-title="ss.timingtoggle">
      <span id="ss-timing-label"></span>
      <input id="ss-timing" type="number" value="0.1" min="0" step="0.01">
      <button id="ss-timing-toggle" class="mini" data-i18n-title="ss.timingtoggle">⇄</button></label>
    <label class="row" data-i18n-title="tip.ss.start"><span data-i18n="ss.start"></span>
      <input id="ss-start" type="checkbox"></label>
    <div class="ss-error" id="ss-anim-error"></div>
    <div class="subhead" data-i18n="ss.preview"></div>
    <canvas id="ss-canvas" width="300" height="200"></canvas>
    <div class="btn-strip">
      <button id="ss-play" class="mini" data-i18n-title="ss.play">▶</button>
      <button id="ss-stepb" class="mini" data-i18n-title="ss.stepback">⏮</button>
      <button id="ss-stepf" class="mini" data-i18n-title="ss.stepfwd">⏭</button>
      <button id="ss-restart" class="mini" data-i18n-title="ss.restart">↺</button>
      <select id="ss-speed" data-i18n-title="ss.speed">
        <option value="0.25">0.25×</option><option value="0.5">0.5×</option>
        <option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option>
      </select>
    </div>
    <input id="ss-scrub" class="ss-scrub" type="range" min="0" max="0" value="0" step="1"
      data-i18n-title="ss.scrub">
    <div class="hint2" id="ss-frameinfo"></div>
    <button id="ss-help" class="secondary" data-i18n="ss.howto"></button>
  </details>`;
  applyI18n(host);

  const $ = (id) => host.querySelector('#' + id);

  // ---------- animations ----------
  const anim = () => state.animations.find((a) => a.id === state.current) ?? null;
  const addAnimation = (name) => {
    const a = { id: uid(), name, frames: [], loop: true, spf: 0.1, useFps: false };
    state.animations.push(a);
    state.current = a.id;
    if (!state.startingId) state.startingId = a.id;
    return a;
  };
  addAnimation(T('ss.defaultanim', 'Idle'));

  // ---------- validation ----------
  // Image-level problems (nothing imported, missing name) surface in the
  // Images panel; animation-specific problems surface in the (optional)
  // Animation panel so the primary workflow never talks about animations.
  let valid = false;
  const validate = () => {
    const imgErrs = [];
    const animErrs = [];
    const names = new Set();
    if (!$('ss-name').value.trim()) imgErrs.push(T('ss.err.name', 'Sprite name is required'));
    const noImages = state.assets.length === 0;
    if (noImages) imgErrs.push(T('ss.err.noimages', 'Add at least one image'));
    for (const a of state.animations) {
      const nm = a.name.trim();
      if (!nm) animErrs.push(T('ss.err.animname', 'Animation names cannot be empty'));
      else if (names.has(nm.toLowerCase())) animErrs.push(`${T('ss.err.dup', 'Duplicate animation name:')} ${nm}`);
      names.add(nm.toLowerCase());
      if (!(a.spf > 0) || !isFinite(a.spf)) animErrs.push(`${nm}: ${T('ss.err.timing', 'invalid FPS / seconds-per-frame')}`);
      // an empty animation is only an ANIMATION problem when images exist —
      // with no images at all, the Images panel message already covers it
      if (!a.frames.length && !noImages) animErrs.push(`${nm}: ${T('ss.err.empty', 'animation has no frames')}`);
      for (const fid of a.frames) {
        if (!state.assets.find((s) => s.id === fid)) animErrs.push(`${nm}: ${T('ss.err.missing', 'missing frame image')}`);
      }
    }
    if (!state.animations.length) animErrs.push(T('ss.err.noanims', 'Add at least one animation'));
    $('ss-error').textContent = imgErrs.slice(0, 3).join(' · ');
    $('ss-anim-error').textContent = animErrs.slice(0, 3).join(' · ');
    // empty animations still block generation even though the message
    // lives in the Images panel ("add at least one image")
    const framesMissing = state.animations.some((a) => !a.frames.length);
    valid = imgErrs.length === 0 && animErrs.length === 0 && !framesMissing;
    opts.onValidity?.(valid);
    // multiple images → animated export → auto-assemble does not apply
    opts.onAnimatedChange?.(isAnimated());
    return valid;
  };

  // ---------- rendering ----------
  const renderAnimSelect = () => {
    const sel = $('ss-anims');
    sel.innerHTML = '';
    for (const a of state.animations) {
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = a.name + (a.id === state.startingId ? ' ★' : '');
      sel.appendChild(o);
    }
    sel.value = state.current ?? '';
    const a = anim();
    if (a) {
      $('ss-loop').value = a.loop ? 'loop' : 'once';
      $('ss-timing-label').textContent = a.useFps ? T('ss.fps', 'FPS') : T('ss.spf', 'Seconds per frame');
      // both directions truncated to 3 decimals so toggling never drifts
      $('ss-timing').value = a.useFps
        ? Math.trunc(1e3 / a.spf) / 1e3
        : Math.trunc(a.spf * 1e3) / 1e3;
      $('ss-start').checked = a.id === state.startingId;
    }
  };

  const renderFrames = () => {
    const box = $('ss-frames');
    box.innerHTML = '';
    const a = anim();
    $('ss-frames-hint').hidden = !a || !a.frames.length;
    if (!a) return;
    a.frames.forEach((fid, i) => {
      const asset = state.assets.find((s) => s.id === fid);
      const div = document.createElement('div');
      div.className = 'ss-frame' + (i === player.frame && state.current === player.animId ? ' sel' : '');
      div.draggable = true;
      const th = document.createElement('canvas');
      th.width = 42; th.height = 42;
      if (asset) {
        const c = th.getContext('2d');
        c.imageSmoothingEnabled = false;
        const k = Math.min(42 / asset.pixels.width, 42 / asset.pixels.height);
        c.drawImage(asset.pixels.canvas, 0, 0, asset.pixels.width, asset.pixels.height,
          (42 - asset.pixels.width * k) / 2, (42 - asset.pixels.height * k) / 2,
          asset.pixels.width * k, asset.pixels.height * k);
      }
      const label = document.createElement('span');
      label.textContent = `${i + 1} · ${asset?.name ?? '?'}` + (results.has(fid) ? ' ✓' : '');
      const ren = document.createElement('button');
      ren.textContent = '✎';
      ren.title = T('ss.rename', 'Rename');
      ren.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!asset) return;
        const nm = await textPrompt({ title: T('ss.rename', 'Rename'),
          label: T('ss.imgname', 'Image name'), value: asset.name });
        if (nm) { asset.name = nm; renderFrames(); }
      });
      const del = document.createElement('button');
      del.textContent = '✕';
      del.title = T('ss.removeimg', 'Remove');
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        a.frames.splice(i, 1);
        renderAll();
      });
      div.append(th, label, ren, del);
      div.addEventListener('click', () => { player.frame = i; player.playing = false; renderPlayer(); renderFrames(); });
      div.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', String(i)));
      div.addEventListener('dragover', (e) => e.preventDefault());
      div.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (isNaN(from) || from === i) return;
        const [m] = a.frames.splice(from, 1);
        a.frames.splice(i, 0, m);
        renderAll();
      });
      box.appendChild(div);
    });
  };

  const renderAll = () => { renderAnimSelect(); renderFrames(); validate(); renderPlayer(); };

  // ---------- preview player ----------
  const player = { playing: false, frame: 0, animId: null, speed: 1, acc: 0, last: 0 };
  const cvs = $('ss-canvas');
  const pctx = cvs.getContext('2d');
  // the asset shown in the preview / selected in the frames list
  const selectedAsset = () => {
    const a = anim();
    return a ? state.assets.find((s) => s.id === a.frames[player.frame]) ?? null : null;
  };
  // where the current asset lands inside the preview canvas
  const previewLayout = (asset) => {
    const { width: w, height: h } = asset.pixels;
    const k = Math.min((cvs.width - 16) / w, (cvs.height - 16) / h);
    return { k, ox: (cvs.width - w * k) / 2, oy: (cvs.height - h * k) / 2 };
  };
  const syncPivotUI = () => {
    const asset = selectedAsset();
    $('ss-pivot-row').hidden = !asset;
    $('ss-pivot-all').hidden = !asset || state.assets.length < 2;
    $('ss-optimize').hidden = !state.assets.length;
    if (asset) {
      $('ss-pivot-x').value = asset.pivot.x;
      $('ss-pivot-y').value = asset.pivot.y;
    }
  };
  const renderPlayer = () => {
    const a = anim();
    player.animId = state.current;
    const n = a?.frames.length ?? 0;
    $('ss-scrub').max = Math.max(0, n - 1);
    if (player.frame >= n) player.frame = Math.max(0, n - 1);
    $('ss-scrub').value = player.frame;
    $('ss-play').textContent = player.playing ? '⏸' : '▶';
    $('ss-frameinfo').textContent = a
      ? `${a.name} · ${T('ss.frame', 'frame')} ${n ? player.frame + 1 : 0}/${n} · ${a.spf.toFixed(3)}s`
      : '';
    pctx.fillStyle = '#14161a';
    pctx.fillRect(0, 0, cvs.width, cvs.height);
    const asset = selectedAsset();
    if (asset) {
      const { width: w, height: h, canvas } = asset.pixels;
      const { k, ox, oy } = previewLayout(asset);
      pctx.imageSmoothingEnabled = k < 1;
      pctx.drawImage(canvas, ox, oy, w * k, h * k);
      // pivot crosshair (the point that becomes the model origin)
      const cx = ox + asset.pivot.x * k;
      const cy = oy + asset.pivot.y * k;
      pctx.strokeStyle = '#fff';
      pctx.lineWidth = 3;
      pctx.beginPath();
      pctx.moveTo(cx - 7, cy); pctx.lineTo(cx + 7, cy);
      pctx.moveTo(cx, cy - 7); pctx.lineTo(cx, cy + 7);
      pctx.stroke();
      pctx.strokeStyle = '#2d6cdf';
      pctx.lineWidth = 1.5;
      pctx.beginPath();
      pctx.moveTo(cx - 7, cy); pctx.lineTo(cx + 7, cy);
      pctx.moveTo(cx, cy - 7); pctx.lineTo(cx, cy + 7);
      pctx.stroke();
    }
    syncPivotUI();
    // the viewport mirrors the selected image (only on actual changes —
    // renderPlayer runs every animation tick); pivot is part of the key so
    // pivot edits reposition the viewport preview too
    const key = `${asset?.id ?? ''}|${state.settings.pixelSize}|${asset?.pivot.x ?? 0},${asset?.pivot.y ?? 0}`;
    if (key !== lastPreviewKey) {
      lastPreviewKey = key;
      opts.onImageSelected?.(asset ?? null);
    }
  };
  let lastPreviewKey = '';
  const tick = (ts) => {
    requestAnimationFrame(tick);
    const a = anim();
    if (!player.playing || !a || !a.frames.length) { player.last = ts; return; }
    player.acc += (ts - player.last) / 1000 * player.speed;
    player.last = ts;
    const spf = Math.max(0.001, a.spf);
    while (player.acc >= spf) {
      player.acc -= spf;
      if (player.frame + 1 >= a.frames.length) {
        if (a.loop) player.frame = 0;
        else { player.playing = false; break; }
      } else player.frame++;
    }
    renderPlayer();
  };
  requestAnimationFrame(tick);

  // ---------- import ----------
  const addAsset = (name, pixels) => {
    // default pivot = bottom-center, which is exactly where the engine
    // already puts the origin — so an untouched pivot changes nothing
    const asset = { id: uid(), name, pixels,
      pivot: { x: Math.round(pixels.width / 2), y: pixels.height } };
    state.assets.push(asset);
    anim()?.frames.push(asset.id);
    return asset;
  };
  let nameTouched = false; // user edited the sprite name manually
  const importFiles = async (files) => {
    if (!anim()) addAnimation(T('ss.defaultanim', 'Idle'));
    // the first imported image names the sprite (until the user edits it)
    if (!nameTouched && !state.assets.length && files.length) {
      const base = files[0].name.replace(/\.[^.]+$/, '').trim();
      if (base) {
        state.settings.name = base;
        $('ss-name').value = base;
      }
    }
    for (const file of files) {
      const base = file.name.replace(/\.[^.]+$/, '') || 'frame';
      if (/gif$/i.test(file.type) || /\.gif$/i.test(file.name)) {
        const frames = await decodeGifFrames(file);
        frames.forEach((bmp, i) => addAsset(`${base}_${i + 1}`, bitmapToPixels(bmp)));
      } else {
        addAsset(base, bitmapToPixels(await fileToBitmap(file)));
      }
    }
    renderAll();
  };

  $('ss-add-images').addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = true;
    inp.accept = 'image/*';
    inp.addEventListener('change', () => importFiles([...inp.files]));
    inp.click();
  });
  $('ss-add-sheet').addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.addEventListener('change', async () => {
      const file = inp.files[0];
      if (!file) return;
      const bmp = await fileToBitmap(file);
      const res = await openSheetEditor(bmp, undefined, {
        // a sheet can hold several animations: save the current slices as a
        // NEW animation without closing the editor, then keep slicing
        onSaveAnimation: async (rects) => {
          const nm = await textPrompt({ title: T('ss.addanim', 'Add animation'),
            label: T('ss.animname', 'Animation name'),
            value: `Anim${state.animations.length + 1}` });
          if (!nm) return false;
          addAnimation(nm);
          rects.forEach((r, i) => addAsset(`${nm}_${i + 1}`, bitmapToPixels(bmp, r)));
          renderAll();
          return true;
        },
      });
      if (!res) return;
      if (!anim()) addAnimation(T('ss.defaultanim', 'Idle'));
      const base = file.name.replace(/\.[^.]+$/, '') || 'sheet';
      res.frames.forEach((r, i) => addAsset(`${base}_${i + 1}`, bitmapToPixels(bmp, r)));
      renderAll();
    });
    inp.click();
  });
  // clear everything: images, animations, cached results — fresh start
  $('ss-clear').addEventListener('click', () => {
    state.assets = [];
    state.animations = [];
    state.startingId = null;
    state.current = null;
    results.clear();
    lastExport = null;
    nameTouched = false;
    state.settings.name = 'Sprite';
    $('ss-name').value = 'Sprite';
    $('ss-optinfo').textContent = '';
    player.frame = 0;
    player.playing = false;
    addAnimation(T('ss.defaultanim', 'Idle'));
    renderAll();
    opts.onClear?.(); // the app clears generated reconstructions too
  });
  // clipboard paste imports images too (asset management applies to both)
  document.addEventListener('paste', (e) => {
    if (host.hidden) return;
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); importFiles(files); }
  });

  // ---------- pivot editing ----------
  for (const [id, axis] of [['ss-pivot-x', 'x'], ['ss-pivot-y', 'y']]) {
    $(id).addEventListener('input', () => {
      const asset = selectedAsset();
      const v = parseFloat($(id).value);
      if (asset && isFinite(v)) { asset.pivot[axis] = v; asset.pivotTouched = true; renderPlayer(); }
    });
  }
  // apply the SAME RELATIVE position to every image (sizes may differ)
  $('ss-pivot-all').addEventListener('click', () => {
    const src = selectedAsset();
    if (!src) return;
    const fx = src.pivot.x / src.pixels.width;
    const fy = src.pivot.y / src.pixels.height;
    for (const asset of state.assets) {
      if (asset === src) continue;
      asset.pivot.x = Math.round(fx * asset.pixels.width);
      asset.pivot.y = Math.round(fy * asset.pixels.height);
      asset.pivotTouched = true;
    }
    renderPlayer();
  });
  // clicking the preview sets the pivot of the shown image
  cvs.addEventListener('pointerdown', (ev) => {
    const asset = selectedAsset();
    if (!asset) return;
    const r = cvs.getBoundingClientRect();
    const sx = cvs.width / r.width, sy = cvs.height / r.height;
    const { k, ox, oy } = previewLayout(asset);
    asset.pivot.x = Math.round(((ev.clientX - r.left) * sx - ox) / k);
    asset.pivot.y = Math.round(((ev.clientY - r.top) * sy - oy) / k);
    asset.pivotTouched = true;
    renderPlayer();
  });

  // ---------- optimize images (trim + true-pixel downscale) ----------
  // Same-sized images (animation sequences, extracted GIF frames) are
  // processed as ONE group: a shared trim rectangle and a shared pixel
  // grid keep every frame's dimensions and alignment identical.
  $('ss-optimize').addEventListener('click', () => {
    const groups = new Map();
    for (const asset of state.assets) {
      const key = `${asset.pixels.width}x${asset.pixels.height}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(asset);
    }
    const lines = [];
    let n = 0;
    for (const group of groups.values()) {
      const res = optimizeSpriteGroup(group.map((a) => a.pixels));
      if (!res) continue;
      group.forEach((asset, i) => {
        const { width: ow, height: oh } = asset.pixels;
        const out = res.frames[i];
        // custom pivots follow the image through trim + grid mapping;
        // untouched pivots re-default to the new bottom-center
        asset.pivot = asset.pivotTouched
          ? res.mapPoint(asset.pivot.x, asset.pivot.y)
          : { x: Math.round(out.width / 2), y: out.height };
        asset.pixels = out;
        results.delete(asset.id); // stale conversion
        n++;
        if (lines.length < 3) {
          lines.push(`${asset.name}: ${ow}×${oh} → ${out.width}×${out.height}` +
            (res.k > 1 ? ` (×${res.kLabel})` : ''));
        }
      });
    }
    $('ss-optinfo').textContent = n
      ? `${T('ss.optdone', 'Optimized {n} images').split('{n}').join(String(n))} — ${lines.join(' · ')}`
      : T('ss.optnone', 'Nothing to optimize');
    lastPreviewKey = ''; // pixels changed under the same asset id
    renderAll();
  });

  // ---------- animator wiring ----------
  $('ss-anims').addEventListener('change', () => {
    state.current = $('ss-anims').value;
    player.frame = 0;
    player.acc = 0;
    renderAll(); // switching updates the preview immediately
  });
  $('ss-anim-add').addEventListener('click', async () => {
    const nm = await textPrompt({ title: T('ss.addanim', 'Add animation'),
      label: T('ss.animname', 'Animation name'), value: `Anim${state.animations.length + 1}` });
    if (nm) { addAnimation(nm); renderAll(); }
  });
  $('ss-anim-del').addEventListener('click', () => {
    const a = anim();
    if (!a) return;
    state.animations = state.animations.filter((x) => x !== a);
    if (state.startingId === a.id) state.startingId = state.animations[0]?.id ?? null;
    state.current = state.animations[0]?.id ?? null;
    renderAll();
  });
  $('ss-anim-ren').addEventListener('click', async () => {
    const a = anim();
    if (!a) return;
    const nm = await textPrompt({ title: T('ss.renanim', 'Rename animation'),
      label: T('ss.animname', 'Animation name'), value: a.name });
    if (nm) { a.name = nm; renderAll(); }
  });
  $('ss-anim-dup').addEventListener('click', () => {
    const a = anim();
    if (!a) return;
    const c = { ...a, id: uid(), name: a.name + ' Copy', frames: [...a.frames] };
    state.animations.push(c);
    state.current = c.id;
    renderAll();
  });
  $('ss-loop').addEventListener('change', () => { const a = anim(); if (a) a.loop = $('ss-loop').value === 'loop'; });
  $('ss-timing').addEventListener('input', () => {
    const a = anim();
    if (!a) return;
    const v = parseFloat($('ss-timing').value);
    // FPS converts to SPF internally, truncated to 3 decimal places
    if (v > 0) a.spf = a.useFps ? Math.trunc(1e3 / v) / 1e3 : v;
    validate(); renderPlayer();
  });
  $('ss-timing-toggle').addEventListener('click', () => {
    const a = anim();
    if (!a) return;
    a.useFps = !a.useFps;
    renderAnimSelect();
  });
  $('ss-start').addEventListener('change', () => {
    const a = anim();
    if (a && $('ss-start').checked) state.startingId = a.id;
    renderAnimSelect();
  });
  $('ss-help').addEventListener('click', () => openAnimHelp());

  // player controls
  $('ss-play').addEventListener('click', () => { player.playing = !player.playing; renderPlayer(); });
  $('ss-restart').addEventListener('click', () => { player.frame = 0; player.acc = 0; renderPlayer(); renderFrames(); });
  $('ss-stepb').addEventListener('click', () => { player.playing = false; player.frame = Math.max(0, player.frame - 1); renderPlayer(); renderFrames(); });
  $('ss-stepf').addEventListener('click', () => {
    const n = anim()?.frames.length ?? 0;
    player.playing = false;
    player.frame = Math.min(Math.max(0, n - 1), player.frame + 1);
    renderPlayer(); renderFrames();
  });
  $('ss-scrub').addEventListener('input', () => { player.playing = false; player.frame = parseInt($('ss-scrub').value, 10) || 0; renderPlayer(); renderFrames(); });
  $('ss-speed').addEventListener('change', () => { player.speed = parseFloat($('ss-speed').value) || 1; });

  for (const [id, key, parse] of [
    ['ss-name', 'name', (v) => v], ['ss-px', 'pixelSize', parseFloat],
    ['ss-thick', 'thickness', parseFloat], ['ss-od', 'overdraw', null],
    ['ss-grid', 'pixelGrid', null]]) {
    $(id).addEventListener(parse ? 'input' : 'change', () => {
      state.settings[key] = parse ? (parse($(id).value) || state.settings[key]) : $(id).checked;
      if (key === 'name') nameTouched = true;
      if (key === 'pixelGrid' || key === 'pixelSize') opts.onPixelGrid?.(state.settings.pixelGrid ? state.settings.pixelSize : null);
      validate();
    });
  }

  // ---------- generate & export ----------
  let worker = null; // created on first use
  let jobSeq = 0;
  const convertAsset = (asset) => new Promise((resolve, reject) => {
    worker ??= opts.createWorker?.()
      ?? new Worker(new URL('./convert-worker.js', import.meta.url), { type: 'module' });
    const jobId = ++jobSeq;
    const onMsg = (ev) => {
      if (ev.data.jobId !== jobId) return;
      worker.removeEventListener('message', onMsg);
      if (!ev.data.ok) reject(new Error(ev.data.error ?? 'conversion failed'));
      else resolve(ev.data); // { decorations, stats, positions, colors, owners }
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage({
      jobId,
      sprite: {
        texture: { width: asset.pixels.width, height: asset.pixels.height,
          data: new Uint8ClampedArray(asset.pixels.data) },
        pixelSize: state.settings.pixelSize,
        thickness: state.settings.thickness,
        overdraw: state.settings.overdraw,
      },
      params: { alphaCutoff: state.settings.alphaCutoff, maxDecorations: 99900 },
    });
  });

  // Shift a freshly converted result so the image's pivot lands at the
  // model origin. Engine mapping: worldX = (px - w/2)·ps, worldY = (h - py)·ps
  // — i.e. the default origin is the BOTTOM-CENTER of the image, which is
  // exactly the default pivot (zero shift). Decoration positions are in
  // 0.1 m units; the preview triangle soup is in meters.
  const applyPivot = (res, asset) => {
    const { width: w, height: h } = asset.pixels;
    const p = asset.pivot ?? { x: w / 2, y: h };
    const ps = state.settings.pixelSize;
    const ox = -(p.x - w / 2) * ps; // meters
    const oy = -(h - p.y) * ps;
    if (!ox && !oy) return;
    for (const d of res.decorations) {
      d.position.x += ox * 10;
      d.position.y += oy * 10;
    }
    if (res.positions) {
      for (let i = 0; i < res.positions.length; i += 3) {
        res.positions[i] += ox;
        res.positions[i + 1] += oy;
      }
    }
  };

  // an export is "animated" unless it is exactly one animation of one frame
  const isAnimated = () =>
    state.animations.length > 1 || (state.animations[0]?.frames.length ?? 0) > 1;

  let lastExport = null; // { bytes, filename }

  // Build the .gia bytes from the CACHED conversions and the CURRENT
  // settings (collision / auto-assemble are read fresh every time, so
  // toggling them after Generate still affects the next Download).
  const buildExport = () => {
    if (!state.animations.length) return lastExport;
    // every referenced frame must have a cached conversion
    for (const a of state.animations) {
      for (const fid of a.frames) if (!results.has(fid)) return lastExport;
    }
    const name = state.settings.name.trim().replace(/\s+/g, '_') || 'Sprite';
    const collision = opts.getCollision?.() ?? true;
    if (isAnimated()) {
      const animations = state.animations.map((a) => ({
        name: a.name.trim(),
        secondsPerFrame: a.spf,
        oneShot: !a.loop,
        frames: a.frames.map((fid) =>
          splitIntoModels('f', results.get(fid).decorations, MAX_DECORATIONS_PER_MODEL)
            .map((m) => ({ decorations: m.decorations }))),
      }));
      const startName = state.animations.find((a) => a.id === state.startingId)?.name
        ?? state.animations[0].name;
      const bytes = buildAnimatedGia({
        name, animations, startingAnimation: startName.trim(), collision,
      });
      lastExport = { bytes, filename: `${name}_Animated.gia` };
    } else {
      // single image → plain static sprite .gia (auto-assemble follows
      // the right-sidebar checkbox, exactly like the model workflow)
      const decs = results.get(state.animations[0].frames[0]).decorations;
      const bytes = buildGia({
        models: splitIntoModels(name, decs, MAX_DECORATIONS_PER_MODEL),
        exportName: name, collision,
        autoAssemble: opts.getAutoAssemble?.() ?? false,
      });
      lastExport = { bytes, filename: `${name}.gia` };
    }
    return lastExport;
  };

  // Full generation pass — driven by the app's Generate button.
  const generate = async () => {
    if (!validate()) return null;
    lastExport = null;
    $('ss-error').textContent = '';
    try {
      // convert each UNIQUE asset once (frames may repeat assets)
      const used = new Set();
      for (const a of state.animations) for (const fid of a.frames) used.add(fid);
      let done = 0;
      for (const fid of used) {
        const asset = state.assets.find((s) => s.id === fid);
        const res = await convertAsset(asset);
        applyPivot(res, asset); // shift so the pivot becomes the origin
        results.set(fid, res);
        done++;
        opts.onProgress?.(done / used.size);
      }
      buildExport();
      renderFrames();
      // Every converted frame becomes a scene entry. Each item carries the
      // FULL worker message (decorations + positions/colors/owners preview
      // geometry the viewport overlay renders from) plus the image name.
      const list = [...used].map((fid) => ({
        msg: results.get(fid),
        label: state.assets.find((s) => s.id === fid)?.name ?? '',
      }));
      opts.onGenerated?.(list);
      return lastExport;
    } catch (err) {
      $('ss-error').textContent = `${T('ss.fail', 'Generation failed:')} ${err.message}`;
      throw err;
    }
  };

  renderAll();
  // dynamic texts (frame info, timing label, ★ marker) follow the language
  onLangChange(() => renderAll());
  return {
    state,
    importFiles,
    refresh: renderAll,
    generate,
    // rebuilt on demand so collision/auto-assemble reflect the checkboxes
    // at DOWNLOAD time, exactly like the model workflow
    getExport: () => buildExport(),
    isValid: () => valid,
  };
}