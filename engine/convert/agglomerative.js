// P3 agglomerative primitive fitter (HFP-style, decision recorded in
// docs/decoration-reduction-plan.md "P3 method decision — agglomerative-primary").
//
// Consumes the QEM working mesh (post-reduction colored triangles) and replaces
// triangle-soup emission for regions where a curved primitive (ellipsoid /
// cylinder) fits well, freeing budget the bandSpend loop reinvests. Everything
// it does NOT consume falls through unchanged to the existing planar-merge /
// right-triangle tail.
//
// Method: reuse the qem.js skeleton (welded adjacency graph + lazy binary heap
// keyed on fitting-error increase), clusters instead of vertices. The seed
// forest is split by curvature class; only adjacent, same-palette, same-class
// clusters merge. Merge cost comes from O(1) incremental algebraic accumulators
// (combinable like quadrics — plane covariance, algebraic sphere moments,
// cylinder normal-covariance). The expensive geometric refit runs once per
// EMITTED cluster (RANSAC-free LSQ here; the axis from the normal covariance is
// already good — see stability check in the module test).
//
// Curvature classes are agglomerated SEPARATELY (a cluster is entirely
// sphere-type or cylinder-type), which keeps the heap key in one consistent
// unit per heap: sphere heap = algebraic point-distance RMS; cylinder heap =
// normal-plane residual (both monotone merge-ordering signals; emission refit
// fixes parameters).

// ---------- 3x3 symmetric eigensolver (Jacobi) ----------
// Returns { values:[l0<=l1<=l2], vectors:[v0,v1,v2] } (column eigenvectors).
export function eigSym3(m) {
  // m: [a00,a01,a02,a11,a12,a22] packed upper triangle
  let a00 = m[0], a01 = m[1], a02 = m[2], a11 = m[3], a12 = m[4], a22 = m[5];
  // eigenvectors accumulate in V
  let v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 12; sweep++) {
    const off = Math.abs(a01) + Math.abs(a02) + Math.abs(a12);
    if (off < 1e-18) break;
    // rotate to zero the largest off-diagonal
    const rot = (p, q, apq, app, aqq, idx) => {};
    // do all three pairs each sweep
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      let apq, app, aqq;
      if (p === 0 && q === 1) { apq = a01; app = a00; aqq = a11; }
      else if (p === 0 && q === 2) { apq = a02; app = a00; aqq = a22; }
      else { apq = a12; app = a11; aqq = a22; }
      if (Math.abs(apq) < 1e-20) continue;
      const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
      const c = Math.cos(phi), s = Math.sin(phi);
      // apply rotation to matrix entries
      if (p === 0 && q === 1) {
        const n00 = c * c * a00 - 2 * s * c * a01 + s * s * a11;
        const n11 = s * s * a00 + 2 * s * c * a01 + c * c * a11;
        const n02 = c * a02 - s * a12;
        const n12 = s * a02 + c * a12;
        a00 = n00; a11 = n11; a01 = 0; a02 = n02; a12 = n12;
      } else if (p === 0 && q === 2) {
        const n00 = c * c * a00 - 2 * s * c * a02 + s * s * a22;
        const n22 = s * s * a00 + 2 * s * c * a02 + c * c * a22;
        const n01 = c * a01 - s * a12;
        const n12 = s * a01 + c * a12;
        a00 = n00; a22 = n22; a02 = 0; a01 = n01; a12 = n12;
      } else {
        const n11 = c * c * a11 - 2 * s * c * a12 + s * s * a22;
        const n22 = s * s * a11 + 2 * s * c * a12 + c * c * a22;
        const n01 = c * a01 - s * a02;
        const n02 = s * a01 + c * a02;
        a11 = n11; a22 = n22; a12 = 0; a01 = n01; a02 = n02;
      }
      // accumulate eigenvectors: V = V * R(p,q)
      for (let i = 0; i < 3; i++) {
        const vp = v[i * 3 + p], vq = v[i * 3 + q];
        v[i * 3 + p] = c * vp - s * vq;
        v[i * 3 + q] = s * vp + c * vq;
      }
    }
  }
  const vals = [a00, a11, a22];
  const cols = [[v[0], v[3], v[6]], [v[1], v[4], v[7]], [v[2], v[5], v[8]]];
  // sort ascending
  const idx = [0, 1, 2].sort((i, j) => vals[i] - vals[j]);
  return {
    values: [vals[idx[0]], vals[idx[1]], vals[idx[2]]],
    vectors: [cols[idx[0]], cols[idx[1]], cols[idx[2]]],
  };
}

// solve 4x4 linear system Ax=b (Gaussian elimination, partial pivot). Returns
// null if singular. A: row-major length 16, b: length 4.
export function solve4(A, b) {
  const M = A.slice(), y = b.slice();
  for (let col = 0; col < 4; col++) {
    let piv = col, best = Math.abs(M[col * 4 + col]);
    for (let r = col + 1; r < 4; r++) { const v = Math.abs(M[r * 4 + col]); if (v > best) { best = v; piv = r; } }
    if (best < 1e-15) return null;
    if (piv !== col) {
      for (let k = 0; k < 4; k++) { const t = M[col * 4 + k]; M[col * 4 + k] = M[piv * 4 + k]; M[piv * 4 + k] = t; }
      const t = y[col]; y[col] = y[piv]; y[piv] = t;
    }
    const d = M[col * 4 + col];
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const f = M[r * 4 + col] / d;
      for (let k = col; k < 4; k++) M[r * 4 + k] -= f * M[col * 4 + k];
      y[r] -= f * y[col];
    }
  }
  return [y[0] / M[0], y[1] / M[5], y[2] / M[10], y[3] / M[15]];
}

// ---------- incremental accumulator ----------
// Combinable (sum) moments over an area-weighted point+normal set.
export function newAccum() {
  return {
    w: 0,
    sx: 0, sy: 0, sz: 0,               // Σw p
    sxx: 0, sxy: 0, sxz: 0, syy: 0, syz: 0, szz: 0, // Σw p⊗p
    sp2: 0,                            // Σw |p|²
    spx: 0, spy: 0, spz: 0,           // Σw p|p|²
    nxx: 0, nxy: 0, nxz: 0, nyy: 0, nyz: 0, nzz: 0, // Σw n⊗n
    nx: 0, ny: 0, nz: 0,              // Σw n
  };
}
export function accumAddPoint(a, w, x, y, z, nx, ny, nz) {
  a.w += w;
  a.sx += w * x; a.sy += w * y; a.sz += w * z;
  a.sxx += w * x * x; a.sxy += w * x * y; a.sxz += w * x * z;
  a.syy += w * y * y; a.syz += w * y * z; a.szz += w * z * z;
  const p2 = x * x + y * y + z * z;
  a.sp2 += w * p2;
  a.spx += w * x * p2; a.spy += w * y * p2; a.spz += w * z * p2;
  a.nxx += w * nx * nx; a.nxy += w * nx * ny; a.nxz += w * nx * nz;
  a.nyy += w * ny * ny; a.nyz += w * ny * nz; a.nzz += w * nz * nz;
  a.nx += w * nx; a.ny += w * ny; a.nz += w * nz;
}
export function accumMerge(o, a, b) {
  for (const k in o) o[k] = a[k] + b[k];
  return o;
}

// centered point covariance (area-weighted) from an accumulator
function pointCov(a) {
  const w = a.w || 1e-30;
  const cx = a.sx / w, cy = a.sy / w, cz = a.sz / w;
  return {
    c: [cx, cy, cz],
    cov: [
      a.sxx / w - cx * cx, a.sxy / w - cx * cy, a.sxz / w - cx * cz,
      a.syy / w - cy * cy, a.syz / w - cy * cz, a.szz / w - cz * cz,
    ],
  };
}

// ---------- fits (from accumulators) ----------

// PLANE: area-weighted MSE = smallest eigenvalue of the centered covariance.
export function planeFit(a) {
  const { c, cov } = pointCov(a);
  const e = eigSym3(cov);
  const n = e.vectors[0]; // normal = smallest-eigenvalue direction
  return { center: c, normal: n, mse: Math.max(0, e.values[0]) };
}

// SPHERE (algebraic Kåsa): solve for center c, g=|c|²-r² minimizing
// Σw(|p|² - 2c·p + g)². Returns center, radius, and area-weighted algebraic
// RMS distance (approximate geometric RMS). null if degenerate.
export function sphereFit(a) {
  const w = a.w;
  if (w <= 0) return null;
  // normal equations for [cx,cy,cz,g]; residual r_i = |p|² - 2c·p + g
  // minimize Σ w (|p|² - 2 c·p + g)^2 -> linear in (c,g)
  // Build 4x4 from moments. Unknown vector u = [cx,cy,cz,g].
  // d/dc: Σ w (|p|² - 2c·p + g)(-2p) = 0
  // d/dg: Σ w (|p|² - 2c·p + g)(1)   = 0
  const A = [
    4 * a.sxx, 4 * a.sxy, 4 * a.sxz, -2 * a.sx,
    4 * a.sxy, 4 * a.syy, 4 * a.syz, -2 * a.sy,
    4 * a.sxz, 4 * a.syz, 4 * a.szz, -2 * a.sz,
    -2 * a.sx, -2 * a.sy, -2 * a.sz, w,
  ];
  const b = [2 * a.spx, 2 * a.spy, 2 * a.spz, -a.sp2];
  const sol = solve4(A, b);
  if (!sol) return null;
  const [cx, cy, cz, g] = sol;
  const r2 = cx * cx + cy * cy + cz * cz - g;
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  // area-weighted mean squared ALGEBRAIC residual, converted to distance²:
  // resid_i = |p-c|² - r² ≈ 2r(d_i) for small d_i -> d² ≈ resid²/(4r²)
  // Σw resid² = Σw(|p|² - 2c·p + g)² expand via moments:
  const sumResid2 = sphereAlgResidual2(a, cx, cy, cz, g);
  const mse = sumResid2 / (a.w * 4 * r2);
  return { center: [cx, cy, cz], radius: r, mse: Math.max(0, mse) };
}

// Σ w (|p|² - 2c·p + g)² from moments (all O(1)).
function sphereAlgResidual2(a, cx, cy, cz, g) {
  // let f = |p|² - 2c·p + g. Σw f² = Σw|p|⁴ - 4Σw|p|²(c·p) + 2gΣw|p|²
  //   + 4Σw(c·p)² - 4gΣw(c·p) + g²Σw
  // We don't accumulate Σw|p|⁴; approximate it via Σw|p|² and the spread is
  // acceptable for ordering. Instead compute f² exactly using available
  // moments EXCEPT |p|⁴: use the identity Σw f² with the terms we have and drop
  // the |p|⁴ term's excess by re-centering. Simplest stable route: recompute
  // via centered coords is overkill; use the moment expansion with Σw|p|⁴
  // approximated as (Σw|p|²)²/w (Jensen lower bound) — good enough for ordering.
  const w = a.w;
  const sp4approx = (a.sp2 * a.sp2) / (w || 1e-30);
  const cpP2 = cx * a.spx + cy * a.spy + cz * a.spz;            // Σw (c·p)|p|²
  const cp2 = cx * cx * a.sxx + cy * cy * a.syy + cz * cz * a.szz
    + 2 * (cx * cy * a.sxy + cx * cz * a.sxz + cy * cz * a.syz); // Σw (c·p)²
  const cp = cx * a.sx + cy * a.sy + cz * a.sz;                 // Σw (c·p)
  return sp4approx - 4 * cpP2 + 2 * g * a.sp2 + 4 * cp2 - 4 * g * cp + g * g * w;
}

// CYLINDER ordering signal: axis = smallest eigenvector of the normal
// covariance (cylinder normals are ⊥ axis, so they lie in a plane whose normal
// is the axis). The residual = that plane's fit error λ_min(Σw n⊗n)/w. Valid
// only when the MIDDLE normal eigenvalue is substantial (genuinely 2-D normal
// spread — else it is a plane, not a cylinder). Returns null when not
// cylinder-like. mse is a normal-space residual (ordering only).
export function cylinderSignal(a) {
  const w = a.w || 1e-30;
  const N = [a.nxx / w, a.nxy / w, a.nxz / w, a.nyy / w, a.nyz / w, a.nzz / w];
  const e = eigSym3(N);
  const l0 = e.values[0], l1 = e.values[1], l2 = e.values[2];
  if (l2 < 1e-9) return null;
  // plane: l1≈0; cylinder: l1 sizeable; sphere: l0 sizeable too
  if (l1 / l2 < 0.06) return null;       // ~planar normals
  return { axis: e.vectors[0], mse: Math.max(0, l0 / l2), l0, l1, l2 };
}

// Precise geometric cylinder refit for EMISSION: axis from normal covariance,
// circle (center,radius) from projecting points to the axis-perpendicular
// plane and Kåsa-fitting, plus the true radial RMS and axial extent.
export function cylinderRefit(pts, ws, a) {
  const sig = cylinderSignal(a);
  if (!sig) return null;
  let ax = sig.axis;
  const alen = Math.hypot(ax[0], ax[1], ax[2]) || 1;
  ax = [ax[0] / alen, ax[1] / alen, ax[2] / alen];
  // basis u,v ⊥ ax
  let u = Math.abs(ax[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  // u = u - (u·ax)ax
  let d = u[0] * ax[0] + u[1] * ax[1] + u[2] * ax[2];
  u = [u[0] - d * ax[0], u[1] - d * ax[1], u[2] - d * ax[2]];
  const ul = Math.hypot(u[0], u[1], u[2]) || 1; u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const vv = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]];
  // project + Kåsa circle fit in (u,v)
  let W = 0, sq = 0, sr = 0, sqq = 0, srr = 0, sqr = 0, sq3 = 0, sr3 = 0, sqrr = 0, srqq = 0, amin = Infinity, amax = -Infinity;
  const qs = [], rs = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], wi = ws[i];
    const q = p[0] * u[0] + p[1] * u[1] + p[2] * u[2];
    const rr = p[0] * vv[0] + p[1] * vv[1] + p[2] * vv[2];
    const t = p[0] * ax[0] + p[1] * ax[1] + p[2] * ax[2];
    if (t < amin) amin = t; if (t > amax) amax = t;
    qs.push(q); rs.push(rr);
    W += wi; sq += wi * q; sr += wi * rr;
    sqq += wi * q * q; srr += wi * rr * rr; sqr += wi * q * rr;
    const l2 = q * q + rr * rr;
    sq3 += wi * q * l2; sr3 += wi * rr * l2;
  }
  // solve 3x3 for circle center (cu,cv), g via Kåsa: minimize Σw(|x|²-2c·x+g)²
  const A3 = [
    4 * sqq, 4 * sqr, -2 * sq,
    4 * sqr, 4 * srr, -2 * sr,
    -2 * sq, -2 * sr, W,
  ];
  const b3 = [2 * sq3, 2 * sr3, -(sqq + srr)];
  const sol = solve3(A3, b3);
  if (!sol) return null;
  const cu = sol[0], cv = sol[1];
  let rsum = 0, rsq = 0, wsum = 0;
  for (let i = 0; i < qs.length; i++) {
    const dq = qs[i] - cu, dr = rs[i] - cv;
    const dist = Math.hypot(dq, dr);
    rsum += ws[i] * dist; rsq += ws[i] * dist * dist; wsum += ws[i];
  }
  const radius = rsum / (wsum || 1);
  const rms = Math.sqrt(Math.max(0, rsq / (wsum || 1) - radius * radius));
  // 3D circle center = cu*u + cv*v + mid-axis*ax
  const midT = (amin + amax) / 2;
  const center = [
    cu * u[0] + cv * vv[0] + midT * ax[0],
    cu * u[1] + cv * vv[1] + midT * ax[1],
    cu * u[2] + cv * vv[2] + midT * ax[2],
  ];
  return { axis: ax, u, v: vv, center, radius, height: amax - amin, rms };
}

// Cone taper test (Phase B): given a cylinder-fit's axis+center and the cluster
// points, linearly regress radius(t) along the axis. If the narrow end tapers to
// ~0 (point-taper — the in-game cone has no frustum), return cone params:
// center (segment midpoint), localY = base->apex direction, baseRadius, height.
// Returns null when it is a genuine (non-tapering) cylinder. Validated in
// scratchpad/synth-prism-cone.mjs (slope=tan(halfangle), apex-at-end).
export function coneRefit(pts, ws, ref, coneTaper = 0.3) {
  const ax = ref.axis;
  let tmin = Infinity, tmax = -Infinity;
  let W = 0, sT = 0, sR = 0, sTT = 0, sTR = 0;
  const T = [], Rr = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], wi = ws[i];
    const dx = p[0] - ref.center[0], dy = p[1] - ref.center[1], dz = p[2] - ref.center[2];
    const t = dx * ax[0] + dy * ax[1] + dz * ax[2];
    const rx = dx - t * ax[0], ry = dy - t * ax[1], rz = dz - t * ax[2];
    const r = Math.hypot(rx, ry, rz);
    T.push(t); Rr.push(r);
    W += wi; sT += wi * t; sR += wi * r; sTT += wi * t * t; sTR += wi * t * r;
    if (t < tmin) tmin = t; if (t > tmax) tmax = t;
  }
  const denom = W * sTT - sT * sT;
  if (Math.abs(denom) < 1e-20) return null;
  const b = (W * sTR - sT * sR) / denom;
  const a0 = (sR - b * sT) / W;
  const rAtMin = a0 + b * tmin, rAtMax = a0 + b * tmax;
  const rBase = Math.max(rAtMin, rAtMax), rNarrow = Math.min(rAtMin, rAtMax);
  if (!(rBase > 0)) return null;
  if (rNarrow > rBase * coneTaper) return null;         // not a point-taper -> cylinder
  const height = tmax - tmin;
  if (!(height > 0)) return null;
  const apexAtMax = rAtMax < rAtMin;                     // apex = narrow end
  const midT = (tmin + tmax) / 2;
  const center = [ref.center[0] + midT * ax[0], ref.center[1] + midT * ax[1], ref.center[2] + midT * ax[2]];
  const localY = apexAtMax ? [ax[0], ax[1], ax[2]] : [-ax[0], -ax[1], -ax[2]];
  let rsq = 0, ww = 0;
  for (let i = 0; i < T.length; i++) { const pred = a0 + b * T[i]; const d = Rr[i] - pred; rsq += ws[i] * d * d; ww += ws[i]; }
  return { axis: localY, center, radius: rBase, height, rms: Math.sqrt(rsq / (ww || 1)) };
}

function solve3(A, b) {
  const M = A.slice(), y = b.slice();
  for (let col = 0; col < 3; col++) {
    let piv = col, best = Math.abs(M[col * 3 + col]);
    for (let r = col + 1; r < 3; r++) { const v = Math.abs(M[r * 3 + col]); if (v > best) { best = v; piv = r; } }
    if (best < 1e-15) return null;
    if (piv !== col) {
      for (let k = 0; k < 3; k++) { const t = M[col * 3 + k]; M[col * 3 + k] = M[piv * 3 + k]; M[piv * 3 + k] = t; }
      const t = y[col]; y[col] = y[piv]; y[piv] = t;
    }
    const dd = M[col * 3 + col];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = M[r * 3 + col] / dd;
      for (let k = col; k < 3; k++) M[r * 3 + k] -= f * M[col * 3 + k];
      y[r] -= f * y[col];
    }
  }
  return [y[0] / M[0], y[1] / M[4], y[2] / M[8]];
}

// ---------- tiny binary min-heap of merge candidates ----------
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].cost <= a[i].cost) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < a.length && a[l].cost < a[s].cost) s = l; if (r < a.length && a[r].cost < a[s].cost) s = r; if (s === i) break;[a[s], a[i]] = [a[i], a[s]]; i = s; } } return top; }
}

// sRGB[0..255] -> CIELAB (D65). Local copy so the fitter has no cross-module dep.
function rgbToLabLocal(rgb) {
  const f = (u) => { u /= 255; return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); };
  const r = f(rgb[0]), g = f(rgb[1]), b = f(rgb[2]);
  let x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  let z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const g3 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = g3(x); y = g3(y); z = g3(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

// ---------- main entry ----------
// triangles: [{ p:[{x,y,z}x3], color }] (post-QEM working mesh, decoration space)
// returns { placements:[curved decoration placements], residual:[triangles], stats }
export function agglomerativeFit(triangles, opts = {}) {
  const n = triangles.length;
  const empty = { placements: [], residual: triangles, stats: { spheres: 0, cylinders: 0, consumed: 0 } };
  if (n < (opts.minFaces ?? 8)) return empty;

  // bbox / scale
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of triangles) for (const q of t.p) {
    if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x;
    if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y;
    if (q.z < minZ) minZ = q.z; if (q.z > maxZ) maxZ = q.z;
  }
  const scale = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (!(scale > 0)) return empty;
  // Phase-2 re-aim: PROPORTIONAL tolerance. Acceptance/growth gate is
  // rms <= alpha * primitive-radius, not an absolute fraction of the bbox — so
  // a large limb tolerates proportionally more residual and actually engages,
  // instead of the old 0.006*bbox that found ZERO viable clusters on organics.
  const alpha = opts.alpha ?? 0.2;                     // rms <= alpha * radius
  const tol = (opts.tolFrac ?? 0.01) * scale;          // kickstart floor only
  const kickRad = scale * 0.12;                        // nominal radius for degenerate/near-planar merges
  const colorDE = opts.colorDE ?? 12;                  // Lab ΔE under which adjacent clusters may merge
  const minFaces = opts.minFaces ?? 8;
  const minCoverage = opts.minCoverage ?? 0.25;        // fraction of full primitive surface the cluster must cover
  const maxRadiusFrac = opts.maxRadiusFrac ?? 0.9;     // reject balloon fits

  // weld vertices (scale-relative)
  const eps = scale * 2e-5;
  const nx = Math.floor((maxX - minX) / eps) + 3, ny = Math.floor((maxY - minY) / eps) + 3;
  const vmap = new Map(); const vx = [], vy = [], vz = [];
  const vid = (q) => {
    const k = ((Math.round((q.z - minZ) / eps) * ny) + Math.round((q.y - minY) / eps)) * nx + Math.round((q.x - minX) / eps);
    let id = vmap.get(k); if (id === undefined) { id = vx.length; vmap.set(k, id); vx.push(q.x); vy.push(q.y); vz.push(q.z); } return id;
  };
  const FA = new Int32Array(n), FB = new Int32Array(n), FC = new Int32Array(n);
  const cxs = new Float64Array(n), cys = new Float64Array(n), czs = new Float64Array(n);
  const fnx = new Float64Array(n), fny = new Float64Array(n), fnz = new Float64Array(n), farea = new Float64Array(n);
  const colorKey = new Array(n);
  const labL = new Float64Array(n), labA = new Float64Array(n), labB = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = triangles[i].p;
    const a = vid(p[0]), b = vid(p[1]), c = vid(p[2]);
    FA[i] = a; FB[i] = b; FC[i] = c;
    const ux = vx[b] - vx[a], uy = vy[b] - vy[a], uz = vz[b] - vz[a];
    const wx = vx[c] - vx[a], wy = vy[c] - vy[a], wz = vz[c] - vz[a];
    let Nx = uy * wz - uz * wy, Ny = uz * wx - ux * wz, Nz = ux * wy - uy * wx;
    const L = Math.hypot(Nx, Ny, Nz);
    farea[i] = L * 0.5;
    if (L > 1e-20) { fnx[i] = Nx / L; fny[i] = Ny / L; fnz[i] = Nz / L; }
    cxs[i] = (vx[a] + vx[b] + vx[c]) / 3; cys[i] = (vy[a] + vy[b] + vy[c]) / 3; czs[i] = (vz[a] + vz[b] + vz[c]) / 3;
    const col = triangles[i].color; colorKey[i] = (col[0] << 16) | (col[1] << 8) | col[2];
    const lab = rgbToLabLocal(col); labL[i] = lab[0]; labA[i] = lab[1]; labB[i] = lab[2];
  }
  const labDE = (i, j) => Math.hypot(labL[i] - labL[j], labA[i] - labA[j], labB[i] - labB[j]);

  // face adjacency via shared welded edges
  const emap = new Map();
  const addE = (u, v, f) => { const k = u < v ? u * vx.length + v : v * vx.length + u; let a = emap.get(k); if (!a) { a = []; emap.set(k, a); } a.push(f); };
  for (let i = 0; i < n; i++) { addE(FA[i], FB[i], i); addE(FB[i], FC[i], i); addE(FA[i], FC[i], i); }
  const adj = Array.from({ length: n }, () => []);
  for (const arr of emap.values()) {
    if (arr.length < 2) continue;
    for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) {
      adj[arr[a]].push(arr[b]); adj[arr[b]].push(arr[a]);
    }
  }

  // Curvature gate: planar (0) vs non-planar (1) by the max 1-ring dihedral.
  // (Robust; local single/double sub-classification is too noisy on moderate
  // tessellation — instead we run the sphere agglomeration over all non-planar
  // faces, then cylinders over what the sphere pass didn't accept. The RMS +
  // coverage acceptance gates reject mis-assigned regions, which fall through.)
  const planarDot = opts.planarDot ?? 0.02; // 1-cos; ~11.5°
  const cls = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let maxD = 0;
    for (const g of adj[i]) {
      const d = 1 - (fnx[i] * fnx[g] + fny[i] * fny[g] + fnz[i] * fnz[g]);
      if (d > maxD) maxD = d;
    }
    cls[i] = maxD < planarDot ? 0 : 1;
  }

  const accumOf = (f) => { const a = newAccum(); accumAddPoint(a, farea[f], cxs[f], cys[f], czs[f], fnx[f], fny[f], fnz[f]); return a; };

  const consumed = new Uint8Array(n);
  const placements = [];
  let sphereCount = 0, cylCount = 0, coneCount = 0, prismCount = 0;
  const dbg = { planar: 0, curved: 0, clustersBig: 0, rejFit: 0, rejBalloon: 0, rejRms: 0, rejCover: 0, maxCluster: 0 };
  for (let i = 0; i < n; i++) if (cls[i] === 0) dbg.planar++; else dbg.curved++;

  // shared agglomeration over eligible faces; kind: 2 sphere, 1 cylinder
  const runClass = (eligible, kind, costFn) => {
    const parent = new Int32Array(n).map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const acc = new Array(n), members = new Array(n), version = new Int32Array(n), alive = new Uint8Array(n);
    const nbr = new Array(n);
    for (let i = 0; i < n; i++) {
      if (!eligible(i)) continue;
      acc[i] = accumOf(i); members[i] = [i]; alive[i] = 1; nbr[i] = new Set();
    }
    const heap = new Heap();
    const pushPair = (a, b) => {
      const m = accumMerge(newAccum(), acc[a], acc[b]);
      const r = costFn(m);              // { cost, rad }
      // Proportional growth gate: allow the merge when the fitting residual is
      // within alpha of the emerging primitive radius (large limbs tolerate
      // proportionally more), with the absolute kickstart floor for tiny/planar
      // clusters whose radius isn't yet determined.
      if (r.cost <= Math.max(tol, alpha * r.rad)) {
        heap.push({ a, b, va: version[a], vb: version[b], cost: r.cost });
      }
    };
    // seed adjacency (relaxed to a Lab ΔE threshold, area-weighted region mean
    // color emitted later — lets a limb of gently varying shading merge into one
    // primitive instead of shattering at every quantization boundary).
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      for (const g of adj[i]) {
        if (g > i && alive[g] && labDE(i, g) <= colorDE) { nbr[i].add(g); nbr[g].add(i); }
      }
    }
    for (let i = 0; i < n; i++) if (alive[i]) for (const g of nbr[i]) if (g > i) pushPair(i, g);
    while (heap.size) {
      const e = heap.pop();
      let a = e.a, b = e.b;
      if (!alive[a] || !alive[b]) continue;
      if (version[a] !== e.va || version[b] !== e.vb) continue; // stale
      // merge b into a
      parent[b] = a;
      accumMerge(acc[a], acc[a], acc[b]); // in place: acc[a]=acc[a]+acc[b]
      for (const f of members[b]) members[a].push(f);
      alive[b] = 0; acc[b] = null; members[b] = null;
      version[a]++;
      // combine neighbors
      for (const g of nbr[b]) { if (g === a) continue; if (alive[g]) { nbr[a].add(g); nbr[g].delete(b); nbr[g].add(a); } }
      nbr[b] = null;
      nbr[a].delete(b);
      // re-push pairs from a
      for (const g of nbr[a]) if (alive[g]) pushPair(Math.min(a, g), Math.max(a, g));
    }
    // emit qualifying clusters
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      if (members[i].length > dbg.maxCluster) dbg.maxCluster = members[i].length;
      const bk = 'big' + kind; dbg[bk] = Math.max(dbg[bk] || 0, members[i].length);
      const ck = 'cnt' + kind; if (members[i].length >= minFaces) dbg[ck] = (dbg[ck] || 0) + 1;
      if (members[i].length < minFaces) continue;
      dbg.clustersBig++;
      const pl = emitCluster(kind, acc[i], members[i]);
      if (pl) {
        placements.push(pl); for (const f of members[i]) consumed[f] = 1;
        if (pl.kind === 'sphere') sphereCount++;
        else if (pl.kind === 'cone') coneCount++;
        else if (pl.kind === 'prism') prismCount++;
        else cylCount++;
      }
    }
  };

  // reject a placement whose decoration zoom (scale * 10) would exceed 50 on any
  // axis (cap.js passes curved primitives through uncapped) — fall to triangles.
  const zoomOk = (pl) => pl.scale.x * 10 <= 50 && pl.scale.y * 10 <= 50 && pl.scale.z * 10 <= 50;

  // build a decoration placement for an accepted cluster; null if it fails
  // acceptance (bad geometric fit / balloon / low coverage).
  // area-weighted region-mean color of a face set (relaxed-ΔE clusters span
  // several quantized colors; one flat mean reads correctly at glance scale).
  const meanColor = (faces) => {
    let w = 0, r = 0, g = 0, b = 0;
    for (const f of faces) { const a = farea[f], c = triangles[f].color; w += a; r += a * c[0]; g += a * c[1]; b += a * c[2]; }
    w = w || 1;
    return [Math.round(r / w), Math.round(g / w), Math.round(b / w)];
  };

  const emitCluster = (targetCls, a, faces) => {
    let area = 0; for (const f of faces) area += farea[f];
    const color = meanColor(faces);
    if (targetCls === 2) {
      // ANISOTROPIC ELLIPSOID acceptance (replaces the isotropic sphere-RMS gate
      // that dumped elongated limbs to triangles). Center = area-weighted
      // centroid; axes = PCA; per-axis radius = max abs projection (one-sided
      // silhouette clamp — the shell never protrudes past the cluster's own PCA
      // extent). Accept when the shell RMS is within alpha of the mean radius.
      const w = a.w || 1e-30;
      const c0 = [a.sx / w, a.sy / w, a.sz / w];
      const { cov } = pointCov(a); const e = eigSym3(cov);
      let R = [e.vectors[2], e.vectors[1], e.vectors[0]]; // local x,y,z = major->minor
      R = orthoRH(R);
      const rad = [0, 0, 0];
      const proj = new Array(faces.length);
      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        const dx = cxs[f] - c0[0], dy = cys[f] - c0[1], dz = czs[f] - c0[2];
        const p0 = dx * R[0][0] + dy * R[1][0] + dz * R[2][0];
        const p1 = dx * R[0][1] + dy * R[1][1] + dz * R[2][1];
        const p2 = dx * R[0][2] + dy * R[1][2] + dz * R[2][2];
        proj[fi] = [p0, p1, p2];
        if (Math.abs(p0) > rad[0]) rad[0] = Math.abs(p0);
        if (Math.abs(p1) > rad[1]) rad[1] = Math.abs(p1);
        if (Math.abs(p2) > rad[2]) rad[2] = Math.abs(p2);
      }
      const meanRad = Math.cbrt(Math.max(rad[0], 1e-9) * Math.max(rad[1], 1e-9) * Math.max(rad[2], 1e-9));
      if (rad[0] > scale * maxRadiusFrac) { dbg.rejBalloon++; return null; }
      if (meanRad <= 0) { dbg.rejFit++; return null; }
      // shell RMS: normalized ellipsoid radius t per point, residual ~ |p-c|*(t-1)/t
      let rsq = 0, ww = 0;
      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi], pr = proj[fi];
        const t = Math.sqrt((pr[0] / (rad[0] || 1e-9)) ** 2 + (pr[1] / (rad[1] || 1e-9)) ** 2 + (pr[2] / (rad[2] || 1e-9)) ** 2);
        const pm = Math.hypot(pr[0], pr[1], pr[2]);
        const d = t > 1e-6 ? pm * (t - 1) / t : pm;
        rsq += farea[f] * d * d; ww += farea[f];
      }
      const rms = Math.sqrt(rsq / (ww || 1));
      if (rms > alpha * meanRad) { dbg.rejRms++; return null; }
      const ellSurf = 4 * Math.PI * (Math.max(rad[0] * rad[1], 1e-12) + rad[0] * rad[2] + rad[1] * rad[2]) / 3;
      if (area / ellSurf < minCoverage) { dbg.rejCover++; return null; }
      const cov1 = 1 + (opts.coverEps ?? 0.04);
      const spl = {
        kind: 'sphere', position: { x: c0[0], y: c0[1], z: c0[2] },
        rotation: R, scale: { x: 2 * rad[0] * cov1, y: 2 * rad[1] * cov1, z: 2 * rad[2] * cov1 }, color,
        area: Math.max(rad[0] * rad[1], rad[0] * rad[2], rad[1] * rad[2]) * 4,
      };
      return zoomOk(spl) ? spl : null;
    } else if (targetCls === 3) {
      // SHEET -> regular triangular PRISM (Phase B; the stormterror wing lever).
      // PCA: normal = smallest eigenvector; sheet iff l0 << l1. In-plane
      // equilateral triangle (the in-game prism cross-section is regular — scale.z
      // is ignored by the renderer), extruded along the normal by the sheet
      // thickness. INSCRIBED (circumradius a fraction of the point spread) so it
      // never protrudes past the wing silhouette — the kept triangles carry
      // coverage, the knee drops only the ones the prism provably contains.
      const w = a.w || 1e-30;
      const c0 = [a.sx / w, a.sy / w, a.sz / w];
      const { cov } = pointCov(a); const e = eigSym3(cov);
      const l0 = e.values[0], l1 = e.values[1];
      if (!(l1 > 0) || l0 > l1 * (opts.sheetFlat ?? 0.06)) { dbg.rejFit++; return null; }
      const normal = e.vectors[0], ip1 = e.vectors[1], ip2 = e.vectors[2];
      // The equilateral corners point along local X-Z at angles -90/30/150 deg
      // (renderer convention). With local X=ip1, Z=ip2, a corner at angle A sits
      // in in-plane direction (cos A, sin A). PROTRUSION-PROOF sizing: circumradius
      // R = the MINIMUM point-cloud extent across the 3 corner directions, so every
      // corner is provably inside the wing's own silhouette — the prism can never
      // add false silhouette (which crashed stormterror 0.913->0.805 with a naive
      // circumradius). far = max in-plane radius, for the triangle-vs-slab test.
      const cornerAng = [-Math.PI / 2, -Math.PI / 2 + 2 * Math.PI / 3, -Math.PI / 2 + 4 * Math.PI / 3];
      const ext = [0, 0, 0];
      let maxN = 0, far = 0;
      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        const dx = cxs[f] - c0[0], dy = cys[f] - c0[1], dz = czs[f] - c0[2];
        const pn = dx * normal[0] + dy * normal[1] + dz * normal[2];
        if (Math.abs(pn) > maxN) maxN = Math.abs(pn);
        const pu = dx * ip1[0] + dy * ip1[1] + dz * ip1[2];
        const pv = dx * ip2[0] + dy * ip2[1] + dz * ip2[2];
        const rr = Math.hypot(pu, pv); if (rr > far) far = rr;
        for (let k = 0; k < 3; k++) {
          const proj = pu * Math.cos(cornerAng[k]) + pv * Math.sin(cornerAng[k]);
          if (proj > ext[k]) ext[k] = proj;   // one-sided extent toward this corner
        }
      }
      if (!(far > 0)) { dbg.rejFit++; return null; }
      const thickness = Math.max(2 * maxN, scale * 2e-3);
      const R = Math.min(ext[0], ext[1], ext[2]);          // inscribed: no corner protrudes
      // triangle-likeness: a broad triangular sheet has R ~ far; a rectangle/slab
      // collapses R (a corner direction has small extent) -> reject (a prism would
      // be a poor, wasteful cover for a rectangular panel).
      if (!(R > 0) || R < far * (opts.prismTriFrac ?? 0.45)) { dbg.rejFit++; return null; }
      const side = R * Math.sqrt(3);
      const triArea = (Math.sqrt(3) / 4) * side * side;
      if (!(triArea > 0) || area / triArea < minCoverage) { dbg.rejCover++; return null; }
      const Rp = orthoRH([ip1, normal, ip2]);              // local Y = normal (extrude)
      const cov1 = 1 + (opts.coverEps ?? 0.04);
      const ppl = {
        kind: 'prism', position: { x: c0[0], y: c0[1], z: c0[2] },
        rotation: Rp, scale: { x: side * cov1, y: thickness, z: side * cov1 }, color,
        area: triArea,
      };
      return zoomOk(ppl) ? ppl : null;
    } else {
      const pts = faces.map((f) => [cxs[f], cys[f], czs[f]]);
      const ws = faces.map((f) => farea[f]);
      const ref = cylinderRefit(pts, ws, a);
      if (!ref) return null;
      if (ref.radius > scale * maxRadiusFrac || ref.radius <= 0 || ref.height <= 0) return null;
      // CONE (Phase B): does radius taper to a point? A pancake (constant radius)
      // fails coneRefit's taper test, so this cleanly separates cones from disks.
      const cone = coneRefit(pts, ws, ref, opts.coneTaper ?? 0.3);
      if (cone && cone.radius > 0 && cone.height > 0 && cone.radius <= scale * maxRadiusFrac &&
          cone.rms <= alpha * cone.radius &&
          area / (Math.PI * cone.radius * Math.hypot(cone.radius, cone.height)) >= minCoverage) {
        const ax2 = cone.axis;
        let u2 = Math.abs(ax2[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        const d2 = u2[0] * ax2[0] + u2[1] * ax2[1] + u2[2] * ax2[2];
        u2 = [u2[0] - d2 * ax2[0], u2[1] - d2 * ax2[1], u2[2] - d2 * ax2[2]];
        const u2l = Math.hypot(u2[0], u2[1], u2[2]) || 1; u2 = [u2[0] / u2l, u2[1] / u2l, u2[2] / u2l];
        const zc2 = [u2[1] * ax2[2] - u2[2] * ax2[1], u2[2] * ax2[0] - u2[0] * ax2[2], u2[0] * ax2[1] - u2[1] * ax2[0]];
        const Rc = [[u2[0], ax2[0], zc2[0]], [u2[1], ax2[1], zc2[1]], [u2[2], ax2[2], zc2[2]]];
        const cov1c = 1 + (opts.coverEps ?? 0.04);
        const conePl = {
          kind: 'cone', position: { x: cone.center[0], y: cone.center[1], z: cone.center[2] },
          rotation: Rc, scale: { x: 2 * cone.radius * cov1c, y: cone.height * cov1c, z: 2 * cone.radius * cov1c }, color,
          area: cone.radius * cone.height,
        };
        if (zoomOk(conePl)) return conePl;
      }
      // DISK/PANCAKE guard: a "cylinder" whose height is far below its radius is
      // really a flat planar patch mis-fit as a zero-height cylinder — it emits a
      // large flat disc of FALSE silhouette (matilda grew pancakes like
      // radius 0.27 m / height 0.01 m). A genuine rod/limb has height >= radius.
      if (ref.height < ref.radius * (opts.minCylAspect ?? 1.0)) return null;
      if (ref.rms > alpha * ref.radius) return null;      // proportional acceptance
      if (area / (2 * Math.PI * ref.radius * ref.height) < minCoverage) return null;
      // rotation: local y = axis, local x = u, local z = x cross y (RH)
      const u = ref.u, ax = ref.axis;
      const zc = [u[1] * ax[2] - u[2] * ax[1], u[2] * ax[0] - u[0] * ax[2], u[0] * ax[1] - u[1] * ax[0]];
      const R = [[u[0], ax[0], zc[0]], [u[1], ax[1], zc[1]], [u[2], ax[2], zc[2]]];
      // OVER-COVER radius and axial ends (hole gate: no uncovered fringe).
      const cov1 = 1 + (opts.coverEps ?? 0.04);
      const cpl = {
        kind: 'cylinder', position: { x: ref.center[0], y: ref.center[1], z: ref.center[2] },
        rotation: R, scale: { x: 2 * ref.radius * cov1, y: ref.height * cov1, z: 2 * ref.radius * cov1 }, color,
        area: 2 * ref.radius * ref.height,
      };
      return zoomOk(cpl) ? cpl : null;
    }
  };

  // Merge costs fall back to the (well-conditioned) plane-fit RMS while a
  // cluster is still too small/flat for its curved primitive to be
  // numerically determined — this kick-starts growth (a 2-face patch is
  // near-coplanar, so the sphere/cylinder fit is degenerate). Once real
  // curvature accumulates the curved fit becomes valid and takes over, so a
  // cluster only keeps growing while it stays sphere/cylinder-like.
  const sphereCost = (m) => {
    const s = sphereFit(m);
    if (s && s.radius > 0 && s.radius < scale) return { cost: Math.sqrt(Math.max(0, s.mse)), rad: s.radius };
    return { cost: Math.sqrt(Math.max(0, planeFit(m).mse)), rad: kickRad };
  };
  const cylCost = (m) => {
    const s = cylinderSignal(m);
    // cylinderSignal.mse is a normal-space (dimensionless) residual; scale it to
    // a length so it compares against alpha*radius. Radius unknown here without a
    // refit, so gate against the nominal kickstart radius (the emit does the
    // exact proportional check).
    if (s) return { cost: Math.sqrt(s.mse) * scale, rad: kickRad * 1.5 };
    return { cost: Math.sqrt(Math.max(0, planeFit(m).mse)), rad: kickRad };
  };
  // plane-RMS merge cost for the sheet/prism pass (near-coplanar faces coalesce)
  const planeCost = (m) => ({ cost: Math.sqrt(Math.max(0, planeFit(m).mse)), rad: kickRad });
  // sphere agglomeration over non-planar faces, then cylinders(+cones) over the
  // rest, then (gated) a SHEET->prism pass over everything still unconsumed —
  // planar wing membranes/spikes that neither sphere nor cylinder can represent.
  runClass((i) => cls[i] === 1 && !consumed[i], 2, sphereCost);
  runClass((i) => cls[i] === 1 && !consumed[i], 1, cylCost);
  if (opts.prism) runClass((i) => !consumed[i], 3, planeCost);

  const residual = [];
  for (let i = 0; i < n; i++) if (!consumed[i]) residual.push(triangles[i]);
  return {
    placements, residual,
    stats: {
      spheres: sphereCount, cylinders: cylCount, cones: coneCount, prisms: prismCount,
      consumed: n - residual.length, dbg,
    },
  };
}

// force a 3-column matrix (given as [col0,col1,col2] each length-3) to an
// orthonormal right-handed rotation matrix, returned row-major [row][col].
function orthoRH(cols) {
  let x = cols[0].slice(), y = cols[1].slice();
  const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  x = nrm(x);
  let d = y[0] * x[0] + y[1] * x[1] + y[2] * x[2];
  y = nrm([y[0] - d * x[0], y[1] - d * x[1], y[2] - d * x[2]]);
  let z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  z = nrm(z);
  return [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
}
