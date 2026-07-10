// Phase 3 step 3: EXTRUDE-PROFILE strategy (the sword answer).
//
// An extrusion (blade, plate, prism, rod) is a 2D PROFILE swept along an AXIS.
// Its face normals are therefore all EITHER perpendicular to the axis (the
// swept side walls) OR parallel to it (the two end caps) — the Gauss map is a
// great circle plus two poles. Detecting that, recovering the axis and the 2D
// profile, then REPLACING the whole triangle soup with a few extruded cuboids
// decouples protrusion from holes: a primitive that matches the profile removes
// the part's triangles outright (no additive knee, no reach-past-surface).
//
// Emission uses the in-game CUBOID (`square`, per-axis scale.x/scale.z) — the
// only primitive that represents an arbitrary rectangle. The profile is covered
// by axis-aligned rectangle STRIPS along its long axis (each strip = the
// profile's width there), extruded by the thickness. Strips follow a taper so
// the staircase is bounded by the strip height. Validated in
// scratchpad/synth-extrude.mjs.

import { eigSym3 } from './agglomerative.js';

// ---- extrusion detection: axis + score + thickness ----
// Returns { axis:[x,y,z], score, tmin, tmax, thickness } or null. score is the
// area fraction whose normal is cleanly ⊥ or ∥ the axis (1.0 = perfect extrusion).
export function detectExtrusion(triangles, opts = {}) {
  let nxx = 0, nxy = 0, nxz = 0, nyy = 0, nyz = 0, nzz = 0, totA = 0;
  const fnx = [], fny = [], fnz = [], fa = [];
  for (const t of triangles) {
    const p = t.p;
    const ux = p[1].x - p[0].x, uy = p[1].y - p[0].y, uz = p[1].z - p[0].z;
    const vx = p[2].x - p[0].x, vy = p[2].y - p[0].y, vz = p[2].z - p[0].z;
    let Nx = uy * vz - uz * vy, Ny = uz * vx - ux * vz, Nz = ux * vy - uy * vx;
    const L = Math.hypot(Nx, Ny, Nz); if (L < 1e-20) continue;
    const a = L / 2; Nx /= L; Ny /= L; Nz /= L;
    nxx += a * Nx * Nx; nxy += a * Nx * Ny; nxz += a * Nx * Nz;
    nyy += a * Ny * Ny; nyz += a * Ny * Nz; nzz += a * Nz * Nz;
    totA += a; fnx.push(Nx); fny.push(Ny); fnz.push(Nz); fa.push(a);
  }
  if (!(totA > 0)) return null;
  const e = eigSym3([nxx / totA, nxy / totA, nxz / totA, nyy / totA, nyz / totA, nzz / totA]);
  const sideEps = opts.sideEps ?? 0.2, capEps = opts.capEps ?? 0.8;
  const cands = e.vectors.map((a) => {
    let clean = 0;
    for (let i = 0; i < fnx.length; i++) {
      const d = Math.abs(fnx[i] * a[0] + fny[i] * a[1] + fnz[i] * a[2]);
      if (d < sideEps || d > capEps) clean += fa[i];
    }
    let tmin = Infinity, tmax = -Infinity;
    for (const t of triangles) for (const q of t.p) {
      const tt = q.x * a[0] + q.y * a[1] + q.z * a[2];
      if (tt < tmin) tmin = tt; if (tt > tmax) tmax = tt;
    }
    return { axis: a.slice(), score: clean / totA, tmin, tmax, extent: tmax - tmin };
  });
  // pick the highest extrusion score; TIE-BREAK (a box/plate is extrudable along
  // several axes, all scoring ~1) by the SMALLEST extent — that is the thickness,
  // whose profile is the full silhouette (blade). A true rod has one high-score
  // axis (its length), so the tie-break never fires there.
  const scoreEps = opts.scoreEps ?? 0.03;
  const top = Math.max(...cands.map((c) => c.score));
  const best = cands.filter((c) => c.score >= top - scoreEps).sort((a, b) => a.extent - b.extent)[0];
  return { axis: best.axis, score: best.score, tmin: best.tmin, tmax: best.tmax, thickness: best.extent };
}

// ---- profile extraction: project verts onto the plane ⊥ axis ----
// Returns { u, v, center, pts2d:[[pu,pv]...], umin,umax,vmin,vmax } where (u,v)
// is an orthonormal basis of the profile plane and pts2d are unique projected
// welded vertices. `center` is the mid-axis 3D point (thickness centre).
export function extractProfile(triangles, ex, opts = {}) {
  const a = ex.axis;
  // basis u,v ⊥ a
  let u = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let d = u[0] * a[0] + u[1] * a[1] + u[2] * a[2];
  u = [u[0] - d * a[0], u[1] - d * a[1], u[2] - d * a[2]];
  const ul = Math.hypot(u[0], u[1], u[2]) || 1; u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const v = [a[1] * u[2] - a[2] * u[1], a[2] * u[0] - a[0] * u[2], a[0] * u[1] - a[1] * u[0]];
  // bbox of projected points for a weld grid
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const t of triangles) for (const q of t.p) {
    const pu = q.x * u[0] + q.y * u[1] + q.z * u[2];
    const pv = q.x * v[0] + q.y * v[1] + q.z * v[2];
    if (pu < umin) umin = pu; if (pu > umax) umax = pu; if (pv < vmin) vmin = pv; if (pv > vmax) vmax = pv;
  }
  const span = Math.max(umax - umin, vmax - vmin) || 1;
  const weld = span * (opts.weldFrac ?? 2e-4);
  const seen = new Set(); const pts2d = [];
  for (const t of triangles) for (const q of t.p) {
    const pu = q.x * u[0] + q.y * u[1] + q.z * u[2];
    const pv = q.x * v[0] + q.y * v[1] + q.z * v[2];
    const k = Math.round((pu - umin) / weld) + ',' + Math.round((pv - vmin) / weld);
    if (!seen.has(k)) { seen.add(k); pts2d.push([pu, pv]); }
  }
  const midT = (ex.tmin + ex.tmax) / 2;
  const center = [midT * a[0] + ((umin + umax) / 2) * 0, 0, 0]; // placeholder; strips set their own centre
  return { u, v, axis: a, pts2d, umin, umax, vmin, vmax, midT, thickness: ex.thickness };
}

// ---- strip cover: rectangles along the profile's long axis ----
// The long profile axis is whichever of (u,v) has the larger extent. Divide it
// into `strips` bands; for each band, the covering rectangle spans the profile's
// [min,max] across-width there (from the projected points that fall in the band).
// Returns [{ cu, cv, halfU, halfV }] rectangles in profile (u,v) coords.
export function stripCover(profile, opts = {}) {
  const uSpan = profile.umax - profile.umin, vSpan = profile.vmax - profile.vmin;
  const longIsU = uSpan >= vSpan;
  const lo = longIsU ? profile.umin : profile.vmin;
  const hi = longIsU ? profile.umax : profile.vmin + vSpan;
  const strips = Math.max(1, opts.strips ?? 24);
  const bandH = (hi - lo) / strips;
  if (!(bandH > 0)) return [];
  const bands = new Array(strips);
  for (let i = 0; i < strips; i++) bands[i] = { wmin: Infinity, wmax: -Infinity };
  for (const [pu, pv] of profile.pts2d) {
    const along = longIsU ? pu : pv, across = longIsU ? pv : pu;
    let bi = Math.floor((along - lo) / bandH); if (bi < 0) bi = 0; if (bi >= strips) bi = strips - 1;
    const b = bands[bi]; if (across < b.wmin) b.wmin = across; if (across > b.wmax) b.wmax = across;
  }
  // FILL empty interior bands by linear interpolation between their nearest
  // non-empty neighbours (a band with no projected vertex would otherwise leave a
  // horizontal GAP -> hole). Leading/trailing empties (past the profile ends)
  // stay empty.
  const filled = bands.map((b) => (b.wmax >= b.wmin ? b : null));
  let firstNon = filled.findIndex((b) => b), lastNon = -1;
  for (let i = strips - 1; i >= 0; i--) if (filled[i]) { lastNon = i; break; }
  if (firstNon >= 0) for (let i = firstNon; i <= lastNon; i++) {
    if (bands[i].wmax >= bands[i].wmin) continue;
    let a = i - 1; while (a >= 0 && bands[a].wmax < bands[a].wmin) a--;
    let c = i + 1; while (c < strips && bands[c].wmax < bands[c].wmin) c++;
    const ba = bands[a], bc = bands[c], f = (i - a) / (c - a);
    bands[i] = { wmin: ba.wmin + (bc.wmin - ba.wmin) * f, wmax: ba.wmax + (bc.wmax - ba.wmax) * f };
  }
  const rects = [];
  for (let i = 0; i < strips; i++) {
    const b = bands[i]; if (!(b.wmax > b.wmin)) continue;
    const alongLo = lo + i * bandH, alongHi = alongLo + bandH;
    const cAlong = (alongLo + alongHi) / 2, cAcross = (b.wmin + b.wmax) / 2;
    const halfAlong = bandH / 2, halfAcross = (b.wmax - b.wmin) / 2;
    rects.push(longIsU
      ? { cu: cAlong, cv: cAcross, halfU: halfAlong, halfV: halfAcross, band: i }
      : { cu: cAcross, cv: cAlong, halfU: halfAcross, halfV: halfAlong, band: i });
  }
  return { rects, longIsU, lo, bandH, strips };
}

// A row's thickness profile is a clean LENS iff it is single-peak, monotone
// (within tolerance) to both edges, and u-contiguous (no interior gaps — a gap is
// the guard's separated arms). `samples` = [{ i, u, thick }] sorted by u.
export function isUnimodal(samples, cell, opts = {}) {
  const n = samples.length; if (n < 3) return false;
  const tol = opts.monoTol ?? 0.2;
  // u-contiguity: no gap wider than ~1.5 cells (interior zero / separated part)
  for (let k = 1; k < n; k++) if (samples[k].u - samples[k - 1].u > cell * 1.6) return false;
  let peak = 0; for (let k = 1; k < n; k++) if (samples[k].thick > samples[peak].thick) peak = k;
  const tmax = samples[peak].thick; if (!(tmax > 0)) return false;
  for (let k = peak; k < n - 1; k++) if (samples[k + 1].thick > samples[k].thick + tol * tmax) return false;
  for (let k = peak; k > 0; k--) if (samples[k - 1].thick > samples[k].thick + tol * tmax) return false;
  return true;
}

// ---- 1D LENS DECOMPOSITION (Phase 3 round 3) ----
// A thickness-tapering cross-section t(u) (a blade lens: thick spine, tapering to
// the cutting edge(s)) decomposes into a central SPINE (near-constant max
// thickness -> cuboid) plus BEVELS (linear thickness ramps -> isosceles prisms
// whose triangular cross-section taper matches the ramp exactly, so no edge-on
// steps). `samples` = [{ u, thick }] sorted by u. Returns { spine, bevels, tmax }.
export function lensDecompose(samples, opts = {}) {
  if (!samples.length) return { spine: null, bevels: [], tmax: 0 };
  let tmax = 0; for (const s of samples) if (s.thick > tmax) tmax = s.thick;
  if (!(tmax > 0)) return { spine: null, bevels: [], tmax: 0 };
  const spineFrac = opts.spineFrac ?? 0.85;
  // spine = the widest contiguous run with thick >= spineFrac*tmax
  let bestS = -1, bestE = -1, curS = -1;
  for (let i = 0; i <= samples.length; i++) {
    const ok = i < samples.length && samples[i].thick >= spineFrac * tmax;
    if (ok) { if (curS < 0) curS = i; }
    else if (curS >= 0) { if (i - 1 - curS > bestE - bestS) { bestS = curS; bestE = i - 1; } curS = -1; }
  }
  const spine = bestS >= 0
    ? { u0: samples[bestS].u, u1: samples[bestE].u, thick: tmax }
    : null;
  const bevels = [];
  const s0 = bestS >= 0 ? bestS : 0, s1 = bestS >= 0 ? bestE : samples.length - 1;
  if (s0 > 0) bevels.push({ u0: samples[0].u, u1: samples[s0].u, t0: samples[0].thick, t1: samples[s0].thick });
  if (s1 < samples.length - 1) bevels.push({ u0: samples[s1].u, u1: samples[samples.length - 1].u, t0: samples[s1].thick, t1: samples[samples.length - 1].thick });
  return { spine, bevels, tmax };
}

// ---- raster the profile into an occupancy grid (from the projected triangles),
// carrying per-cell axis (thickness) extent + area-weighted colour ----
function rasterProfile(triangles, prof, opts) {
  const a = prof.axis, u = prof.u, v = prof.v;
  const uMin = prof.umin, vMin = prof.vmin;
  const uSpan = prof.umax - uMin, vSpan = prof.vmax - vMin;
  const bboxMax = opts.bboxMax ?? 1;                     // model bbox (m) for px sizing
  // sub-pixel at the 512² harness views: cell ≤ ~bbox/512; also cap grid dims.
  const cell = Math.max(Math.max(uSpan, vSpan) / (opts.gridMax ?? 384), bboxMax / (opts.pxGrid ?? 640));
  const gw = Math.max(1, Math.ceil(uSpan / cell)), gh = Math.max(1, Math.ceil(vSpan / cell));
  const grid = new Uint8Array(gw * gh);
  const tmin = new Float64Array(gw * gh).fill(Infinity), tmax = new Float64Array(gw * gh).fill(-Infinity);
  const cr = new Float64Array(gw * gh), cg = new Float64Array(gw * gh), cb = new Float64Array(gw * gh), cw = new Float64Array(gw * gh);
  for (const t of triangles) {
    const p = t.p;
    const pu = p.map((q) => (q.x * u[0] + q.y * u[1] + q.z * u[2] - uMin) / cell);
    const pv = p.map((q) => (q.x * v[0] + q.y * v[1] + q.z * v[2] - vMin) / cell);
    const ta = p.map((q) => q.x * a[0] + q.y * a[1] + q.z * a[2]);
    const t0 = Math.min(ta[0], ta[1], ta[2]), t1 = Math.max(ta[0], ta[1], ta[2]);
    const c = t.color;
    let i0 = Math.floor(Math.min(pu[0], pu[1], pu[2])), i1 = Math.ceil(Math.max(pu[0], pu[1], pu[2]));
    let j0 = Math.floor(Math.min(pv[0], pv[1], pv[2])), j1 = Math.ceil(Math.max(pv[0], pv[1], pv[2]));
    if (i0 < 0) i0 = 0; if (i1 >= gw) i1 = gw - 1; if (j0 < 0) j0 = 0; if (j1 >= gh) j1 = gh - 1;
    // barycentric edge functions
    const x0 = pu[0], y0 = pv[0], x1 = pu[1], y1 = pv[1], x2 = pu[2], y2 = pv[2];
    const d = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(d) < 1e-12) continue;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = i + 0.5, py = j + 0.5;
      const l0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / d;
      const l1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / d;
      const l2 = 1 - l0 - l1;
      if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
      const idx = j * gw + i;
      grid[idx] = 1;
      if (t0 < tmin[idx]) tmin[idx] = t0; if (t1 > tmax[idx]) tmax[idx] = t1;
      cr[idx] += c[0]; cg[idx] += c[1]; cb[idx] += c[2]; cw[idx]++;
    }
  }
  return { grid, gw, gh, cell, uMin, vMin, tmin, tmax, cr, cg, cb, cw };
}

// largest all-active rectangle in a Uint8 grid (histogram method). Returns
// { i0,i1,j0,j1,area } (inclusive cell indices) or null.
function largestRect(active, gw, gh) {
  const h = new Int32Array(gw);
  let best = null;
  const st = new Int32Array(gw + 1);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) h[i] = active[j * gw + i] ? h[i] + 1 : 0;
    let sp = 0;
    for (let i = 0; i <= gw; i++) {
      const cur = i < gw ? h[i] : 0;
      while (sp > 0 && h[st[sp - 1]] >= cur) {
        const height = h[st[--sp]];
        const left = sp > 0 ? st[sp - 1] + 1 : 0;
        const area = height * (i - left);
        if (!best || area > best.area) best = { area, i0: left, i1: i - 1, j0: j - height + 1, j1: j };
      }
      st[sp++] = i;
    }
  }
  return best && best.area > 0 ? best : null;
}

// greedy MAXIMAL-RECTANGLE COVER: repeatedly carve the largest all-filled
// rectangle. Each rect is all-filled => INSCRIBED (never protrudes past the
// silhouette); their union covers every filled cell => no holes (to cell res).
function maxRectCover(grid, gw, gh, opts = {}) {
  const active = grid.slice();
  const rects = [];
  const maxRects = opts.maxRects ?? 600;
  while (rects.length < maxRects) {
    const r = largestRect(active, gw, gh);
    if (!r) break;
    rects.push(r);
    for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) active[j * gw + i] = 0;
  }
  return rects;
}

// ---- full extrude fit: triangles -> extruded cuboid placements (or null) ----
// Replacement semantics: a clean extrusion is REPLACED by inscribed cuboids from
// a maximal-rectangle cover of the rasterized profile. Returns null when not
// extrusion-positive.
export function extrudeFit(triangles, opts = {}) {
  const ex = detectExtrusion(triangles, opts);
  if (!ex || ex.score < (opts.minScore ?? 0.92) || !(ex.thickness > 0)) return null;
  const prof = extractProfile(triangles, ex, opts);
  const R2 = rasterProfile(triangles, prof, opts);
  const a = ex.axis, u = prof.u, v = prof.v;
  const w = [u[1] * a[2] - u[2] * a[1], u[2] * a[0] - u[0] * a[2], u[0] * a[1] - u[1] * a[0]];
  const Rot = [[u[0], a[0], w[0]], [u[1], a[1], w[1]], [u[2], a[2], w[2]]]; // right-handed
  const cell = R2.cell, minHalfThick = ex.thickness * 0.02;
  const N = R2.gw * R2.gh;
  // THICKNESS BUCKETS: a single rectangle must not span two thicknesses (a
  // blade+guard rect would over- or under-cover one of them edge-on). Quantize
  // each filled cell's axis extent into buckets and cover each bucket separately,
  // so every emitted cuboid is thickness-homogeneous (its mean thickness is exact).
  const bucketSize = Math.max(cell, ex.thickness * (opts.bucketFrac ?? 0.12));
  const bucket = new Int32Array(N).fill(-1);
  const buckets = new Map();               // bucketId -> Uint8 mask
  for (let idx = 0; idx < N; idx++) {
    if (!R2.grid[idx]) continue;
    const th = (R2.tmax[idx] >= R2.tmin[idx]) ? R2.tmax[idx] - R2.tmin[idx] : 0;
    const b = Math.round(th / bucketSize);
    bucket[idx] = b;
    let mask = buckets.get(b); if (!mask) { mask = new Uint8Array(N); buckets.set(b, mask); }
    mask[idx] = 1;
  }
  const placements = [];
  let cuboidCount = 0, prismCount = 0;
  const emitCuboid = (uc, halfU, vc, halfV, thick, midT, col) => {
    const halfThick = Math.max(thick / 2, minHalfThick);
    placements.push({
      kind: 'square', fullY: true, _extrude: true,
      position: { x: midT * a[0] + uc * u[0] + vc * v[0], y: midT * a[1] + uc * u[1] + vc * v[1], z: midT * a[2] + uc * u[2] + vc * v[2] },
      rotation: Rot, scale: { x: 2 * halfU, y: 2 * halfThick, z: 2 * halfV }, color: col, area: 4 * halfU * halfV,
    });
    cuboidCount++;
  };
  // bevel -> isosceles PRISM: base(scale.x)=spine-side thickness, depth(scale.z)=
  // bevel width, extruded along v (scale.y). local Y=v, local Z = edge->spine
  // (apex at -localZ = the cutting edge), local X = v × localZ. Centroid at
  // (edgeU+2·spineU)/3. scale.z = width·2/√3 so preview depth = width.
  const emitBevelPrism = (edgeU, spineU, tBase, vc, halfV, midT, col) => {
    const wdt = Math.abs(spineU - edgeU);
    if (wdt < cell || tBase < minHalfThick * 2) return false;
    const sdir = spineU >= edgeU ? 1 : -1;
    const lz = [sdir * u[0], sdir * u[1], sdir * u[2]];
    const lx = [v[1] * lz[2] - v[2] * lz[1], v[2] * lz[0] - v[0] * lz[2], v[0] * lz[1] - v[1] * lz[0]];
    const Rp = [[lx[0], v[0], lz[0]], [lx[1], v[1], lz[1]], [lx[2], v[2], lz[2]]];
    const cU = (edgeU + 2 * spineU) / 3;
    placements.push({
      kind: 'prism', _extrude: true,
      position: { x: midT * a[0] + cU * u[0] + vc * v[0], y: midT * a[1] + cU * u[1] + vc * v[1], z: midT * a[2] + cU * u[2] + vc * v[2] },
      rotation: Rp, scale: { x: Math.max(tBase, 2 * minHalfThick), y: 2 * halfV, z: wdt * 2 / Math.sqrt(3) }, color: col, area: wdt * tBase,
    });
    prismCount++;
    return true;
  };
  if (opts.lens === true) {
    // DISPATCH + MERGE (round 5): per row, use the lens ONLY where the thickness
    // profile is a clean unimodal lens (single peak, monotone to both edges, no
    // interior gaps — the BLADE); multi-modal/gappy rows (the GUARD) go to the
    // rect-partition so no prism ramps across a gap. Consecutive matching lens rows
    // MERGE into one segment => one length-spanning spine cuboid + 2 symmetric
    // prisms (midT=0 confirmed). Spine<->bevel thickness continuity is enforced by
    // using the spine thickness as each bevel's base.
    const spineFrac = opts.spineFrac ?? 0.85;
    const rowInfo = new Array(R2.gh).fill(null);
    const nonLensMask = new Uint8Array(N);
    for (let j = 0; j < R2.gh; j++) {
      const samples = [];
      for (let i = 0; i < R2.gw; i++) {
        const idx = j * R2.gw + i; if (!R2.grid[idx]) continue;
        const has = R2.tmax[idx] >= R2.tmin[idx];
        samples.push({ i, u: R2.uMin + (i + 0.5) * cell, thick: has ? R2.tmax[idx] - R2.tmin[idx] : 0, idx });
      }
      if (samples.length < 3 || !isUnimodal(samples, cell, opts)) { for (const s of samples) nonLensMask[s.idx] = 1; continue; }
      let tmax = 0; for (const s of samples) if (s.thick > tmax) tmax = s.thick;
      let s0 = -1, s1 = -1; for (let k = 0; k < samples.length; k++) if (samples[k].thick >= spineFrac * tmax) { if (s0 < 0) s0 = k; s1 = k; }
      let cr = 0, cg = 0, cb = 0, cw = 0; for (const s of samples) { cr += R2.cr[s.idx]; cg += R2.cg[s.idx]; cb += R2.cb[s.idx]; cw += R2.cw[s.idx]; }
      rowInfo[j] = { su0: samples[s0].u, su1: samples[s1].u, sth: tmax, leftU: samples[0].u, rightU: samples[samples.length - 1].u, col: cw > 0 ? [Math.round(cr / cw), Math.round(cg / cw), Math.round(cb / cw)] : [180, 180, 190] };
    }
    // merge consecutive matching lens rows into segments
    const tolU = cell * 3;
    let seg = null;
    const closeSeg = () => {
      if (!seg) return;
      const vc = R2.vMin + ((seg.j0 + seg.j1 + 1) / 2) * cell, halfV = (seg.j1 - seg.j0 + 1) * cell / 2;
      emitCuboid((seg.su0 + seg.su1) / 2, (seg.su1 - seg.su0 + cell) / 2, vc, halfV, seg.sth, 0, seg.col);
      if (!emitBevelPrism(seg.leftU, seg.su0, seg.sth, vc, halfV, 0, seg.col)) emitCuboid((seg.leftU + seg.su0) / 2, (seg.su0 - seg.leftU + cell) / 2, vc, halfV, seg.sth * 0.5, 0, seg.col);
      if (!emitBevelPrism(seg.rightU, seg.su1, seg.sth, vc, halfV, 0, seg.col)) emitCuboid((seg.rightU + seg.su1) / 2, (seg.rightU - seg.su1 + cell) / 2, vc, halfV, seg.sth * 0.5, 0, seg.col);
      seg = null;
    };
    for (let j = 0; j < R2.gh; j++) {
      const r = rowInfo[j];
      if (!r) { closeSeg(); continue; }
      if (seg && Math.abs(r.su0 - seg.su0) < tolU && Math.abs(r.su1 - seg.su1) < tolU && Math.abs(r.leftU - seg.leftU) < tolU && Math.abs(r.rightU - seg.rightU) < tolU && Math.abs(r.sth - seg.sth) < 0.35 * seg.sth) {
        const n = seg.n + 1;
        seg.su0 = (seg.su0 * seg.n + r.su0) / n; seg.su1 = (seg.su1 * seg.n + r.su1) / n;
        seg.leftU = (seg.leftU * seg.n + r.leftU) / n; seg.rightU = (seg.rightU * seg.n + r.rightU) / n;
        seg.sth = (seg.sth * seg.n + r.sth) / n; seg.j1 = j; seg.n = n;
      } else { closeSeg(); seg = { j0: j, j1: j, n: 1, su0: r.su0, su1: r.su1, leftU: r.leftU, rightU: r.rightU, sth: r.sth, col: r.col }; }
    }
    closeSeg();
    // non-lens (guard/tip) cells -> thickness-bucketed max-rect cuboids
    const gb = new Map();
    for (let idx = 0; idx < N; idx++) {
      if (!nonLensMask[idx]) continue;
      const th = R2.tmax[idx] >= R2.tmin[idx] ? R2.tmax[idx] - R2.tmin[idx] : 0;
      const b = Math.round(th / bucketSize); let m = gb.get(b); if (!m) { m = new Uint8Array(N); gb.set(b, m); } m[idx] = 1;
    }
    for (const m of gb.values()) for (const r of maxRectCover(m, R2.gw, R2.gh, opts)) {
      let tsum = 0, hsum = 0, sr = 0, sg = 0, sb = 0, sw = 0, cnt = 0;
      for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) { const idx = j * R2.gw + i; if (R2.tmax[idx] >= R2.tmin[idx]) { tsum += (R2.tmin[idx] + R2.tmax[idx]) / 2; hsum += (R2.tmax[idx] - R2.tmin[idx]) / 2; cnt++; } sr += R2.cr[idx]; sg += R2.cg[idx]; sb += R2.cb[idx]; sw += R2.cw[idx]; }
      emitCuboid(R2.uMin + (r.i0 + (r.i1 - r.i0 + 1) / 2) * cell, (r.i1 - r.i0 + 1) * cell / 2, R2.vMin + (r.j0 + (r.j1 - r.j0 + 1) / 2) * cell, (r.j1 - r.j0 + 1) * cell / 2, cnt ? hsum / cnt * 2 : 0, cnt ? tsum / cnt : (ex.tmin + ex.tmax) / 2, sw > 0 ? [Math.round(sr / sw), Math.round(sg / sw), Math.round(sb / sw)] : [180, 180, 190]);
    }
  } else {
    for (const mask of buckets.values()) {
      for (const r of maxRectCover(mask, R2.gw, R2.gh, opts)) {
        let tsum = 0, hsum = 0, sr = 0, sg = 0, sb = 0, sw = 0, cnt = 0;
        for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
          const idx = j * R2.gw + i;
          if (R2.tmax[idx] >= R2.tmin[idx]) { tsum += (R2.tmin[idx] + R2.tmax[idx]) / 2; hsum += (R2.tmax[idx] - R2.tmin[idx]) / 2; cnt++; }
          sr += R2.cr[idx]; sg += R2.cg[idx]; sb += R2.cb[idx]; sw += R2.cw[idx];
        }
        emitCuboid(R2.uMin + (r.i0 + (r.i1 - r.i0 + 1) / 2) * cell, (r.i1 - r.i0 + 1) * cell / 2, R2.vMin + (r.j0 + (r.j1 - r.j0 + 1) / 2) * cell, (r.j1 - r.j0 + 1) * cell / 2, cnt ? hsum / cnt * 2 : 0, cnt ? tsum / cnt : (ex.tmin + ex.tmax) / 2, sw > 0 ? [Math.round(sr / sw), Math.round(sg / sw), Math.round(sb / sw)] : [180, 180, 190]);
      }
    }
  }
  if (!placements.length) return null;
  return { placements, ex, rectCount: placements.length, cuboids: cuboidCount, prisms: prismCount };
}
