// Phase C: Sphere-Mesh approximation via Spherical Quadric Error Metrics (SQEM).
// Thiery, Guy, Boubekeur — "Sphere-Meshes: Shape Approximation using Spherical
// Quadric Error Metrics", SIGGRAPH Asia 2013 (ref: github.com/superboubek/SQEM).
//
// WHY (from the Phase-B Pareto evidence): every convex/equilateral primitive that
// covers articulated or thin bulk PROTRUDES and breaks essenceSil (ellipsoid
// concavity-fill, cylinder pancakes, equilateral prism corners). Sphere-meshes
// are an approximate Medial Axis Transform: each sphere sits INSIDE the shape at
// the local half-thickness, so a capsule (sphere-edge) hugs a tapering limb and
// splits at joints without bulging into concavities. Emission maps:
//   sphere-mesh VERTEX  -> in-game sphere (center, per-axis radius)
//   sphere-mesh EDGE    -> in-game cylinder (min-radius core; the end spheres
//                          cover the fat caps -> conservative, no protrusion)
// These are ADDITIVE volumetric primitives; the existing hole-safe containedByVol
// knee (converter.js) drops the triangles they contain, so coverage is guaranteed
// by the kept triangles and budget/cov50 improve exactly where the sphere-mesh
// genuinely covers.
//
// The SQEM error of a sphere s=(c,r) against a face's supporting plane (n,d)
// (unit normal n, n·x+d=0) is (n·c + d + r)^2 — zero when s is tangent to the
// plane from the INSIDE (center at signed distance -r). Summed area-weighted over
// incident faces this is a quadric in u=(cx,cy,cz,r): E(u)=u^T A u + 2 b·u + c
// with A=Σw a⊗a, b=Σw d a, c=Σw d^2, a=(nx,ny,nz,1). Edge-collapse adds quadrics
// (like QEM); the optimal collapsed sphere solves A u = -b (r clamped ≥0).

import { solve4 } from './agglomerative.js';

const MIN_AREA = 1e-14;

// Quadric layout: Float64Array(15) =
//   [A00,A01,A02,A03, A11,A12,A13, A22,A23, A33,  b0,b1,b2,b3,  c]
//     0   1   2   3    4   5   6    7   8    9    10 11 12 13    14
export function newSQEM() { return new Float64Array(15); }
export function sqemAddPlane(Q, nx, ny, nz, d, w) {
  const a0 = nx, a1 = ny, a2 = nz, a3 = 1;
  Q[0] += w * a0 * a0; Q[1] += w * a0 * a1; Q[2] += w * a0 * a2; Q[3] += w * a0 * a3;
  Q[4] += w * a1 * a1; Q[5] += w * a1 * a2; Q[6] += w * a1 * a3;
  Q[7] += w * a2 * a2; Q[8] += w * a2 * a3;
  Q[9] += w * a3 * a3;
  Q[10] += w * d * a0; Q[11] += w * d * a1; Q[12] += w * d * a2; Q[13] += w * d * a3;
  Q[14] += w * d * d;
}
export function sqemAdd(dst, a, b) { for (let i = 0; i < 15; i++) dst[i] = a[i] + b[i]; return dst; }
// Positional QEM term: penalize w·|c - p|² (center-only; radius untouched). This
// breaks the medial-axis degeneracy of a cylinder/slab — without it, zero-cost
// axial merges funnel the whole tube into one sphere; with it, merging distant
// verts costs w·spread², so clusters stay compact and spheres DISTRIBUTE along
// the medial axis.
export function sqemAddPos(Q, x, y, z, w) {
  Q[0] += w; Q[4] += w; Q[7] += w;                       // A_cc += w I
  Q[10] += -w * x; Q[11] += -w * y; Q[12] += -w * z;     // b_c += -w p
  Q[14] += w * (x * x + y * y + z * z);                  // c += w|p|²
}

// E(u) = u^T A u + 2 b·u + c
export function sqemError(Q, cx, cy, cz, r) {
  const uAu =
    Q[0] * cx * cx + Q[4] * cy * cy + Q[7] * cz * cz + Q[9] * r * r +
    2 * (Q[1] * cx * cy + Q[2] * cx * cz + Q[3] * cx * r +
         Q[5] * cy * cz + Q[6] * cy * r + Q[8] * cz * r);
  const bu = Q[10] * cx + Q[11] * cy + Q[12] * cz + Q[13] * r;
  return uAu + 2 * bu + Q[14];
}

// Optimal sphere for a quadric: solve A u = -b (4x4). r clamped ≥ 0; when the
// unconstrained r is negative, re-solve the 3x3 center system with r fixed = 0.
//
// MIDPOINT REGULARIZATION (regPos): a cylinder/slab tangent-plane set is
// rank-deficient along its medial axis (any on-axis radius-R sphere is tangent to
// every wall plane), so the raw solve funnels every collapse to one arbitrary
// point + degenerate stragglers. Adding regPos·|c - fallbackC|² pins the optimum
// near the merged region's own centroid, so spheres DISTRIBUTE along the medial
// axis (well-determined directions are unaffected — regPos is tiny vs the real
// quadric there). fallbackC = midpoint of the merged pair.
export function sqemOptimal(Q, fallbackC, reg = 1e-6) {
  const wscale = (Q[0] + Q[4] + Q[7]) / 3 || 1;      // avg positional plane weight
  const rp = reg * wscale;                           // tiny conditioning only
  const A = [
    Q[0] + rp, Q[1], Q[2], Q[3],
    Q[1], Q[4] + rp, Q[5], Q[6],
    Q[2], Q[5], Q[7] + rp, Q[8],
    Q[3], Q[6], Q[8], Q[9] + 1e-9 * wscale,
  ];
  const b = [-Q[10] + rp * fallbackC[0], -Q[11] + rp * fallbackC[1], -Q[12] + rp * fallbackC[2], -Q[13]];
  const sol = solve4(A, b);
  if (sol && sol[3] >= 0) return { c: [sol[0], sol[1], sol[2]], r: sol[3] };
  const A3 = [Q[0] + rp, Q[1], Q[2], Q[1], Q[4] + rp, Q[5], Q[2], Q[5], Q[7] + rp];
  const b3 = [-Q[10] + rp * fallbackC[0], -Q[11] + rp * fallbackC[1], -Q[12] + rp * fallbackC[2]];
  const c3 = solve3sym(A3, b3);
  if (c3) return { c: c3, r: 0 };
  return { c: fallbackC.slice(), r: 0 };
}

function solve3sym(A, b) {
  const M = A.slice(), y = b.slice();
  for (let col = 0; col < 3; col++) {
    let piv = col, best = Math.abs(M[col * 3 + col]);
    for (let r = col + 1; r < 3; r++) { const v = Math.abs(M[r * 3 + col]); if (v > best) { best = v; piv = r; } }
    if (best < 1e-18) return null;
    if (piv !== col) {
      for (let k = 0; k < 3; k++) { const t = M[col * 3 + k]; M[col * 3 + k] = M[piv * 3 + k]; M[piv * 3 + k] = t; }
      const t = y[col]; y[col] = y[piv]; y[piv] = t;
    }
    const d = M[col * 3 + col];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = M[r * 3 + col] / d;
      for (let k = col; k < 3; k++) M[r * 3 + k] -= f * M[col * 3 + k];
      y[r] -= f * y[col];
    }
  }
  return [y[0] / M[0], y[1] / M[4], y[2] / M[8]];
}

// tiny growable binary min-heap over (cost,u,v,vu,vv)
class MinHeap {
  constructor(cap = 4096) {
    this.cost = new Float64Array(cap); this.u = new Int32Array(cap); this.v = new Int32Array(cap);
    this.vu = new Int32Array(cap); this.vv = new Int32Array(cap); this.size = 0;
  }
  _grow() { const n = this.cost.length * 2; const g = (a, T) => { const b = new T(n); b.set(a); return b; };
    this.cost = g(this.cost, Float64Array); this.u = g(this.u, Int32Array); this.v = g(this.v, Int32Array);
    this.vu = g(this.vu, Int32Array); this.vv = g(this.vv, Int32Array); }
  _swap(i, j) { const c = this.cost, u = this.u, v = this.v, vu = this.vu, vv = this.vv;
    let t = c[i]; c[i] = c[j]; c[j] = t; t = u[i]; u[i] = u[j]; u[j] = t; t = v[i]; v[i] = v[j]; v[j] = t;
    t = vu[i]; vu[i] = vu[j]; vu[j] = t; t = vv[i]; vv[i] = vv[j]; vv[j] = t; }
  push(cost, u, v, vu, vv) { if (this.size >= this.cost.length) this._grow();
    let i = this.size++; this.cost[i] = cost; this.u[i] = u; this.v[i] = v; this.vu[i] = vu; this.vv[i] = vv;
    while (i > 0) { const p = (i - 1) >> 1; if (this.cost[p] <= this.cost[i]) break; this._swap(i, p); i = p; } }
  pop() { const c = this.cost; this.oCost = c[0]; this.oU = this.u[0]; this.oV = this.v[0]; this.oVU = this.vu[0]; this.oVV = this.vv[0];
    const last = --this.size; if (last > 0) { c[0] = c[last]; this.u[0] = this.u[last]; this.v[0] = this.v[last]; this.vu[0] = this.vu[last]; this.vv[0] = this.vv[last];
      let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < last && c[l] < c[s]) s = l; if (r < last && c[r] < c[s]) s = r; if (s === i) break; this._swap(i, s); i = s; } } }
}

// ---------- core: collapse a triangle set to a sphere-mesh ----------
// triangles: [{ p:[{x,y,z}x3], color }]. Returns { spheres:[{c,r,color}],
// edges:[[i,j]], stats }. targetFn(componentFaceCount) -> desired sphere count.
export function sphereMeshCollapse(triangles, opts = {}) {
  const n = triangles.length;
  const weldFrac = opts.weldFrac ?? 2e-5;
  const flipDot = opts.flipDot ?? 0.05;
  const empty = { spheres: [], edges: [], stats: { verts: 0, faces: 0, collapses: 0 } };
  if (!n) return empty;

  // bbox + weld
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of triangles) for (const q of t.p) {
    if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x; if (q.y < minY) minY = q.y;
    if (q.y > maxY) maxY = q.y; if (q.z < minZ) minZ = q.z; if (q.z > maxZ) maxZ = q.z;
  }
  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (!(maxDim > 0)) return empty;
  const eps = maxDim * weldFrac;
  const nx = Math.floor((maxX - minX) / eps) + 3, ny = Math.floor((maxY - minY) / eps) + 3;
  const key = (q) => ((Math.round((q.z - minZ) / eps) * ny) + Math.round((q.y - minY) / eps)) * nx + Math.round((q.x - minX) / eps);
  const vmap = new Map(); const vxa = [], vya = [], vza = [];
  const vid = (q) => { const k = key(q); let id = vmap.get(k); if (id === undefined) { id = vxa.length; vmap.set(k, id); vxa.push(q.x); vya.push(q.y); vza.push(q.z); } return id; };
  const fa = [], fb = [], fc = [], fcol = [], forig = [];
  for (let i = 0; i < n; i++) {
    const t = triangles[i]; const a = vid(t.p[0]), b = vid(t.p[1]), c = vid(t.p[2]);
    if (a === b || b === c || a === c) continue;
    fa.push(a); fb.push(b); fc.push(c); fcol.push(t.color); forig.push(i);  // provenance: input index
  }
  const V = vxa.length, F = fa.length;
  if (F === 0) return empty;
  const vx = Float64Array.from(vxa), vy = Float64Array.from(vya), vz = Float64Array.from(vza);
  // ORIGINAL surface vertex positions (vx/vy/vz get overwritten with optimized
  // sphere centers during collapse) — used to INSCRIBE each emitted sphere:
  // clamp radius to the distance to the nearest surface vertex so no sphere pokes
  // out, and surface-sphere CONTAMINANTS (center on the surface, the shiba rind)
  // collapse to r~0 and drop. Medial spheres are already ~inscribed (nearest
  // surface point is at ~r) so they are unaffected.
  const ox = Float64Array.from(vxa), oy = Float64Array.from(vya), oz = Float64Array.from(vza);
  const FA = Int32Array.from(fa), FB = Int32Array.from(fb), FC = Int32Array.from(fc);

  // face normals + areas, per-vertex quadrics + color accum
  const fnx = new Float64Array(F), fny = new Float64Array(F), fnz = new Float64Array(F), farea = new Float64Array(F);
  const computeFace = (f) => {
    const a = FA[f], b = FB[f], c = FC[f];
    const ux = vx[b] - vx[a], uy = vy[b] - vy[a], uz = vz[b] - vz[a];
    const wx = vx[c] - vx[a], wy = vy[c] - vy[a], wz = vz[c] - vz[a];
    let Nx = uy * wz - uz * wy, Ny = uz * wx - ux * wz, Nz = ux * wy - uy * wx;
    const L = Math.hypot(Nx, Ny, Nz); farea[f] = L * 0.5;
    if (L > 1e-20) { fnx[f] = Nx / L; fny[f] = Ny / L; fnz[f] = Nz / L; } else { fnx[f] = fny[f] = fnz[f] = 0; }
  };
  const Q = new Array(V);
  for (let i = 0; i < V; i++) Q[i] = newSQEM();
  // area-weighted color + POSITION-CENTROID accumulators per vertex (both ride
  // through collapse). The centroid (px/cw) is the medial regularization target:
  // it stays on a symmetric tube's axis, so it distributes spheres along the
  // medial axis without dragging them off it (unlike a surface pair-midpoint).
  const cr = new Float64Array(V), cg = new Float64Array(V), cb = new Float64Array(V), cw = new Float64Array(V);
  const px = new Float64Array(V), py = new Float64Array(V), pz = new Float64Array(V);
  for (let f = 0; f < F; f++) {
    computeFace(f);
    if (farea[f] <= 0) continue;
    const a = FA[f], b = FB[f], c = FC[f];
    const nX = fnx[f], nY = fny[f], nZ = fnz[f];
    const d = -(nX * vx[a] + nY * vy[a] + nZ * vz[a]);   // plane through face
    const w = farea[f] / 3;
    for (const vtx of [a, b, c]) sqemAddPlane(Q[vtx], nX, nY, nZ, d, w);
    const col = fcol[f];
    for (const vtx of [a, b, c]) { cr[vtx] += w * col[0]; cg[vtx] += w * col[1]; cb[vtx] += w * col[2]; cw[vtx] += w; }
  }
  for (let i = 0; i < V; i++) { px[i] = vx[i] * cw[i]; py[i] = vy[i] * cw[i]; pz[i] = vz[i] * cw[i]; }
  // positional QEM per vertex (compactness — distributes spheres along medial
  // axes instead of funneling a degenerate tube into one sphere). Tiny: a large
  // value pulls centers onto off-axis surface patches (radius collapses).
  const posFrac = opts.posFrac ?? 0.02;
  for (let i = 0; i < V; i++) if (cw[i] > 0) sqemAddPos(Q[i], vx[i], vy[i], vz[i], posFrac * cw[i]);

  // connected components (union-find) for per-component sphere budgets
  const parent = new Int32Array(V); for (let i = 0; i < V; i++) parent[i] = i;
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  for (let f = 0; f < F; f++) { uni(FA[f], FB[f]); uni(FB[f], FC[f]); }
  const compId = new Map(); let C = 0;
  const compOf = (i) => { const r = find(i); let c = compId.get(r); if (c === undefined) { c = C++; compId.set(r, c); } return c; };
  const vcomp = new Int32Array(V); for (let i = 0; i < V; i++) vcomp[i] = compOf(i);
  const compFaceCount = new Int32Array(C);
  for (let f = 0; f < F; f++) compFaceCount[vcomp[FA[f]]]++;
  // per-component target sphere count (medial skeleton resolution)
  const targetFn = opts.targetFn || ((fcnt) => Math.max(2, Math.min(opts.maxSpheresPerComp ?? 48, Math.round(Math.sqrt(fcnt) * (opts.sphereDensity ?? 0.6)))));
  const compTarget = new Int32Array(C); for (let c = 0; c < C; c++) compTarget[c] = targetFn(compFaceCount[c]);
  const compAlive = new Int32Array(V.length); // count of alive verts per comp
  const aliveVertsPerComp = new Int32Array(C);
  for (let i = 0; i < V; i++) aliveVertsPerComp[vcomp[i]]++;

  // EXPLICIT sphere-mesh adjacency graph (Sets), independent of faces — heavy
  // collapse degenerates every face, so face-derived adjacency loses the skeleton
  // connectivity. Collapsing (u,v)->u rewires v's neighbours onto u; the final
  // graph IS the sphere-mesh (spheres = alive verts, edges = surviving links).
  const dead = new Uint8Array(V);
  const version = new Int32Array(V);
  // PROVENANCE: `into[v]` = the vertex v folded into (chain to its final survivor).
  // Lets us map every original face to the sphere(s) that ended up representing it.
  const into = new Int32Array(V).fill(-1);
  const nbr = new Array(V); for (let i = 0; i < V; i++) nbr[i] = new Set();
  for (let f = 0; f < F; f++) {
    const a = FA[f], b = FB[f], c = FC[f];
    nbr[a].add(b); nbr[b].add(a); nbr[b].add(c); nbr[c].add(b); nbr[a].add(c); nbr[c].add(a);
  }
  const merged = newSQEM();
  const centroid = (u, v) => { const w = cw[u] + cw[v] || 1; return [(px[u] + px[v]) / w, (py[u] + py[v]) / w, (pz[u] + pz[v]) / w]; };
  const evalPair = (u, v) => {
    sqemAdd(merged, Q[u], Q[v]);
    const opt = sqemOptimal(merged, centroid(u, v));
    const cost = Math.max(0, sqemError(merged, opt.c[0], opt.c[1], opt.c[2], opt.r));
    return { opt, cost };
  };
  const heap = new MinHeap(Math.max(4096, F));
  const pushEdge = (u, v) => { const { cost } = evalPair(u, v); heap.push(cost, u, v, version[u], version[v]); };
  for (let i = 0; i < V; i++) for (const g of nbr[i]) if (g > i) pushEdge(i, g);

  let collapses = 0;
  while (heap.size > 0) {
    heap.pop();
    const u = heap.oU, v = heap.oV;
    if (dead[u] || dead[v]) continue;
    if (!nbr[u].has(v)) continue;
    const comp = vcomp[u];
    if (aliveVertsPerComp[comp] <= compTarget[comp]) continue;
    if (version[u] !== heap.oVU || version[v] !== heap.oVV) { pushEdge(u, v); continue; }
    // commit: fold v into u at the optimal sphere center; quadric + color add
    const { opt } = evalPair(u, v);
    sqemAdd(Q[u], Q[u], Q[v]);
    vx[u] = opt.c[0]; vy[u] = opt.c[1]; vz[u] = opt.c[2];
    cr[u] += cr[v]; cg[u] += cg[v]; cb[u] += cb[v]; cw[u] += cw[v];
    px[u] += px[v]; py[u] += py[v]; pz[u] += pz[v];
    // rewire v's neighbours onto u
    nbr[u].delete(v); nbr[v].delete(u);
    for (const g of nbr[v]) { if (g === u || dead[g]) continue; nbr[g].delete(v); nbr[g].add(u); nbr[u].add(g); }
    nbr[v] = null; dead[v] = 1; into[v] = u; version[u]++; aliveVertsPerComp[comp]--; collapses++;
    for (const g of nbr[u]) if (!dead[g]) pushEdge(Math.min(u, g), Math.max(u, g));
  }

  // extract spheres (alive verts) + radius from each vertex's own quadric.
  // (Inscribe clamp + contaminant rejection happen in sphereMeshFit, where both
  // spheres AND capsules can be clamped against the surface — ox/oy/oz returned.)
  const idOf = new Int32Array(V).fill(-1);
  const spheres = [];
  for (let i = 0; i < V; i++) {
    if (dead[i]) continue;
    const w = cw[i] || 1;
    const cen = [px[i] / w, py[i] / w, pz[i] / w];
    const opt = sqemOptimal(Q[i], cen);
    idOf[i] = spheres.length;
    spheres.push({ c: opt.c, r: Math.max(0, opt.r), color: [Math.round(cr[i] / w), Math.round(cg[i] / w), Math.round(cb[i] / w)] });
  }
  const S = spheres.length;
  // FORENSICS: map each emitted sphere back to its connected component (alive
  // vertex -> component). Cheap, always built; used by the opt-in per-component
  // consumption dump in sphereMeshFit.
  const sphereComp = new Int32Array(S);
  for (let i = 0; i < V; i++) if (!dead[i] && idOf[i] >= 0) sphereComp[idOf[i]] = vcomp[i];
  const eset = new Set(); const edges = [];
  const sadj = new Array(S); for (let i = 0; i < S; i++) sadj[i] = new Set();
  for (let i = 0; i < V; i++) {
    if (dead[i] || !nbr[i]) continue;
    for (const g of nbr[i]) {
      if (g <= i || dead[g]) continue;
      const ia = idOf[i], ib = idOf[g]; if (ia < 0 || ib < 0) continue;
      const k = ia < ib ? ia * S + ib : ib * S + ia;
      if (!eset.has(k)) { eset.add(k); edges.push([ia, ib]); sadj[ia].add(ib); sadj[ib].add(ia); }
    }
  }
  // sphere-TRIANGLES (3-cliques a<b<c) = slab faces of the sphere-mesh (wings)
  const tris3 = [];
  for (const [a, b] of edges) {
    const lo = a < b ? a : b, hi = a < b ? b : a;
    const na = sadj[lo], nb = sadj[hi];
    const [small, other] = na.size < nb.size ? [na, nb] : [nb, na];
    for (const c of small) { if (c > hi && other.has(c)) tris3.push([lo, hi, c]); }
  }
  // PROVENANCE map: for each original face, the sphere index its 3 vertices ended
  // up in (follow the `into` merge chain to the final survivor). A face is later
  // droppable iff ALL 3 spheres it maps to are RETAINED (not contaminant-rejected)
  // — exact replacement, no geometric coverage guessing, hole-safe by construction.
  const resolveV = (v) => { let g = 0; while (into[v] !== -1 && g++ < V) v = into[v]; return v; };
  const faceSpheres = new Int32Array(F * 3);
  const faceVerts = new Int32Array(F * 3);          // welded vertex id per corner (for the reach check)
  const faceOrig = Int32Array.from(forig);
  for (let f = 0; f < F; f++) {
    faceSpheres[f * 3] = idOf[resolveV(FA[f])];
    faceSpheres[f * 3 + 1] = idOf[resolveV(FB[f])];
    faceSpheres[f * 3 + 2] = idOf[resolveV(FC[f])];
    faceVerts[f * 3] = FA[f]; faceVerts[f * 3 + 1] = FB[f]; faceVerts[f * 3 + 2] = FC[f];
  }
  return { spheres, edges, tris3, ox, oy, oz, faceSpheres, faceVerts, faceOrig, sphereComp, vcomp, compFaceCount, compTarget, stats: { verts: V, faces: F, comps: C, spheresOut: S, edgesOut: edges.length, trisOut: tris3.length, collapses } };
}

// nearest original-surface-vertex distance to a point (uniform spatial grid for
// O(1) queries; used to INSCRIBE every emitted primitive so nothing pokes out).
function makeNearestDist(ox, oy, oz) {
  const n = ox.length;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    if (ox[i] < minX) minX = ox[i]; if (ox[i] > maxX) maxX = ox[i];
    if (oy[i] < minY) minY = oy[i]; if (oy[i] > maxY) maxY = oy[i];
    if (oz[i] < minZ) minZ = oz[i]; if (oz[i] > maxZ) maxZ = oz[i];
  }
  const dim = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const res = Math.max(1, Math.min(64, Math.round(Math.cbrt(n))));
  const cell = dim / res;
  const gx = Math.floor((maxX - minX) / cell) + 1, gy = Math.floor((maxY - minY) / cell) + 1, gz = Math.floor((maxZ - minZ) / cell) + 1;
  const key = (ix, iy, iz) => (iz * gy + iy) * gx + ix;
  const buckets = new Map();
  const clampi = (v, m) => (v < 0 ? 0 : v >= m ? m - 1 : v);
  for (let i = 0; i < n; i++) {
    const ix = clampi(Math.floor((ox[i] - minX) / cell), gx), iy = clampi(Math.floor((oy[i] - minY) / cell), gy), iz = clampi(Math.floor((oz[i] - minZ) / cell), gz);
    const k = key(ix, iy, iz); let b = buckets.get(k); if (!b) { b = []; buckets.set(k, b); } b.push(i);
  }
  return (x, y, z) => {
    const cx = clampi(Math.floor((x - minX) / cell), gx), cy = clampi(Math.floor((y - minY) / cell), gy), cz = clampi(Math.floor((z - minZ) / cell), gz);
    let best2 = Infinity;
    for (let rad = 0; rad < Math.max(gx, gy, gz); rad++) {
      for (let iz = cz - rad; iz <= cz + rad; iz++) { if (iz < 0 || iz >= gz) continue;
        for (let iy = cy - rad; iy <= cy + rad; iy++) { if (iy < 0 || iy >= gy) continue;
          for (let ix = cx - rad; ix <= cx + rad; ix++) { if (ix < 0 || ix >= gx) continue;
            if (rad > 0 && Math.abs(ix - cx) < rad && Math.abs(iy - cy) < rad && Math.abs(iz - cz) < rad) continue; // shell only
            const b = buckets.get(key(ix, iy, iz)); if (!b) continue;
            for (const j of b) { const dx = x - ox[j], dy = y - oy[j], dz = z - oz[j]; const d2 = dx * dx + dy * dy + dz * dz; if (d2 < best2) best2 = d2; }
          } } }
      // once we have a candidate and have searched one shell beyond it, stop
      if (best2 < Infinity && (rad * cell) * (rad * cell) > best2) break;
    }
    return Math.sqrt(best2);
  };
}

// ---------- emission: sphere-mesh -> in-game placements ----------
// Sphere -> sphere decoration (per-axis radius = r). Edge -> cylinder from cA to
// cB at the MIN endpoint radius (the end spheres cover the fat caps -> no
// protrusion). Skips degenerate spheres/edges. Over-covers by coverEps.
export function sphereMeshFit(triangles, opts = {}) {
  const sm = sphereMeshCollapse(triangles, opts);
  const placements = [];
  // Medial spheres sit INSIDE the shape, so we INSCRIBE (radiusScale ≤ 1) rather
  // than over-cover — max-radius + coverEps protruded (shiba essenceSil
  // 0.989->0.897). The kept triangles carry the fine silhouette; the sphere-mesh
  // is an interior filler that lifts cov50/e999 without adding false silhouette.
  const rScale = opts.radiusScale ?? 0.9;
  const cov1 = 1 + (opts.coverEps ?? 0);
  const minR = (opts.minRadiusFrac ?? 0.004) * bboxDiag(triangles);
  const maxR = (opts.maxRadiusFrac ?? 0.5) * bboxDiag(triangles);
  // Phase 3 fix 1: INSCRIBE against the source surface. `nearestDist(c)` is the
  // distance from a point to the nearest original surface vertex. A medial sphere
  // has nearestDist ≈ r (tangent from inside), a surface CONTAMINANT has
  // nearestDist ≈ 0 (center on the surface, half-poking). Reject contaminants
  // (they are the shiba silhouette rind) and clamp every radius to nearestDist so
  // nothing pokes out — spheres AND capsules (sampled along the axis).
  const nearestDist = makeNearestDist(sm.ox, sm.oy, sm.oz);
  const contamFrac = opts.contamFrac ?? 0.4;
  // Reject CONTAMINANTS only (center within contamFrac·r of the surface — these
  // half-poke and form the shiba rind). Medial spheres (center ≈ r inside) are
  // KEPT AT FULL radius: they must reach the surface to keep dropping surface
  // triangles (the count-reduction the hole gate depends on — a truly inscribed
  // sphere drops nothing and the mesh over-caps back into holes). depth = dsurf/r
  // is the medial-ness score.
  // INSCRIBE (clamp radius to surface distance) is DEFAULT OFF: measured to
  // eliminate protrusion (shiba 724->24, matilda 304->0) but it destroys the
  // count-reduction the hole gate depends on — a truly inscribed sphere no longer
  // reaches past the surface to drop the surface triangles it covers, so the mesh
  // over-caps back into holes (matilda 2->17). That coupling (drop-a-surface-
  // triangle REQUIRES protruding past it) is structural to the additive-primitive
  // + hole-safe-knee architecture and only dissolves with Phase-3 part
  // decomposition (replace a part rather than additively cover it). So we ship
  // only the holes-safe half: reject CONTAMINANT spheres (center on the surface).
  const inscribe = opts.inscribe === true;
  // FORENSICS: per-sphere rejection reason ('retained'|'contam'|'minR'|'maxR'|
  // 'zero'). Populated below; no behavioral effect (opt-in dump only).
  const rejReason = new Array(sm.spheres.length).fill('zero');
  for (let si = 0; si < sm.spheres.length; si++) {
    const s = sm.spheres[si];
    const dsurf = nearestDist(s.c[0], s.c[1], s.c[2]);
    if (dsurf < s.r * contamFrac) { s.r = 0; rejReason[si] = 'contam'; continue; } // contaminant -> drop
    if (inscribe) s.r = Math.min(s.r, dsurf);               // clamp so it can't poke
  }
  let sphereCount = 0, capCount = 0, rejected = 0;
  // RETAINED spheres = those that survive contaminant rejection + radius filters
  // and become an actual placement. Provenance drop uses this to keep the faces of
  // rejected spheres in the residual (they are represented by nothing).
  const retained = new Uint8Array(sm.spheres.length);
  const sphR = new Float64Array(sm.spheres.length);        // emitted radius per retained sphere
  const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let si = 0; si < sm.spheres.length; si++) {
    const s = sm.spheres[si];
    if (s.r <= 0) { rejected++; if (rejReason[si] !== 'contam') rejReason[si] = 'zero'; continue; }
    const sr = s.r * rScale;
    if (sr < minR) { rejReason[si] = 'minR'; continue; }
    if (sr > maxR) { rejReason[si] = 'maxR'; continue; }
    const d = 2 * sr * cov1;
    placements.push({ kind: 'sphere', position: { x: s.c[0], y: s.c[1], z: s.c[2] }, rotation: I, scale: { x: d, y: d, z: d }, color: s.color, area: Math.PI * sr * sr });
    retained[si] = 1; sphR[si] = sr; rejReason[si] = 'retained';
    sphereCount++;
  }
  if (opts.capsules !== false) for (const [ia, ib] of sm.edges) {
    const A = sm.spheres[ia], B = sm.spheres[ib];
    if (A.r <= 0 || B.r <= 0) continue;                    // endpoint was a contaminant
    const ax = B.c[0] - A.c[0], ay = B.c[1] - A.c[1], az = B.c[2] - A.c[2];
    const len = Math.hypot(ax, ay, az);
    if (len < minR) continue;
    // radius = larger inscribed endpoint, then clamped along the axis to the
    // nearest surface so the straight capsule can't bulge past a curving limb.
    let r = Math.max(A.r, B.r) * rScale;
    if (inscribe) for (let t = 1; t <= 5; t++) {
      const f = t / 6, d = nearestDist(A.c[0] + ax * f, A.c[1] + ay * f, A.c[2] + az * f) * rScale;
      if (d < r) r = d;
    }
    if (r < minR || r > maxR) continue;
    const uy = [ax / len, ay / len, az / len];
    // build an orthonormal frame with local Y = axis
    let ux = Math.abs(uy[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let dp = ux[0] * uy[0] + ux[1] * uy[1] + ux[2] * uy[2];
    ux = [ux[0] - dp * uy[0], ux[1] - dp * uy[1], ux[2] - dp * uy[2]];
    const ul = Math.hypot(ux[0], ux[1], ux[2]) || 1; ux = [ux[0] / ul, ux[1] / ul, ux[2] / ul];
    const uz = [ux[1] * uy[2] - ux[2] * uy[1], ux[2] * uy[0] - ux[0] * uy[2], ux[0] * uy[1] - ux[1] * uy[0]];
    const R = [[ux[0], uy[0], uz[0]], [ux[1], uy[1], uz[1]], [ux[2], uy[2], uz[2]]];
    const col = A.color;   // capsule takes one end's mean color (glance scale)
    placements.push({
      kind: 'cylinder',
      position: { x: (A.c[0] + B.c[0]) / 2, y: (A.c[1] + B.c[1]) / 2, z: (A.c[2] + B.c[2]) / 2 },
      rotation: R, scale: { x: 2 * r * cov1, y: len, z: 2 * r * cov1 }, color: col, area: 2 * r * len,
    });
    capCount++;
  }
  // SLABS (sphere-triangles): a flat 3-clique -> thin oriented cuboid covering
  // the wing in-plane, thin (half-thickness) perpendicular. This is the
  // stormterror-wing lever: a thin SHEET has no medial volume, so its spheres are
  // tiny in-plane beads; the SLAB fills the triangular area between them. In-plane
  // extent is INSCRIBED (slabScale) so the cuboid corners stay inside the wing
  // silhouette; the thin axis over-covers slightly to close the membrane.
  let slabCount = 0;
  if (opts.slabs) {
    const slabScale = opts.slabScale ?? 0.85;
    for (const [ia, ib, ic] of sm.tris3) {
      const A = sm.spheres[ia], B = sm.spheres[ib], Cc = sm.spheres[ic];
      const meanR = (A.r + B.r + Cc.r) / 3, maxRr = Math.max(A.r, B.r, Cc.r);
      const cen = [(A.c[0] + B.c[0] + Cc.c[0]) / 3, (A.c[1] + B.c[1] + Cc.c[1]) / 3, (A.c[2] + B.c[2] + Cc.c[2]) / 3];
      // plane normal
      const e1 = [B.c[0] - A.c[0], B.c[1] - A.c[1], B.c[2] - A.c[2]];
      const e2 = [Cc.c[0] - A.c[0], Cc.c[1] - A.c[1], Cc.c[2] - A.c[2]];
      let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
      const nl = Math.hypot(nx, ny, nz); if (nl < 1e-12) continue;
      nx /= nl; ny /= nl; nz /= nl;
      // in-plane basis: ux along e1, uz = n x ux
      const e1l = Math.hypot(e1[0], e1[1], e1[2]) || 1;
      const ux = [e1[0] / e1l, e1[1] / e1l, e1[2] / e1l];
      const uz = [ny * ux[2] - nz * ux[1], nz * ux[0] - nx * ux[2], nx * ux[1] - ny * ux[0]];
      // in-plane half-extents of the 3 centers about the centroid
      let ex = 0, ez = 0;
      for (const P of [A.c, B.c, Cc.c]) {
        const dx = P[0] - cen[0], dy = P[1] - cen[1], dz = P[2] - cen[2];
        ex = Math.max(ex, Math.abs(dx * ux[0] + dy * ux[1] + dz * ux[2]));
        ez = Math.max(ez, Math.abs(dx * uz[0] + dy * uz[1] + dz * uz[2]));
      }
      const inPlane = Math.max(ex, ez);
      if (inPlane < minR) continue;
      // only genuine THIN sheets (radius = half-thickness << in-plane extent)
      if (meanR > (opts.slabThinFrac ?? 0.5) * inPlane) continue;
      const halfX = ex * slabScale, halfZ = ez * slabScale;
      if (halfX < minR || halfZ < minR) continue;
      const thickness = Math.max(2 * maxRr, minR) * (1 + (opts.slabCoverEps ?? 0.15));
      const R = [[ux[0], nx, uz[0]], [ux[1], ny, uz[1]], [ux[2], nz, uz[2]]]; // cols: X, Y=normal, Z
      placements.push({
        kind: 'square', fullY: true, _slab: true,
        position: { x: cen[0], y: cen[1], z: cen[2] },
        rotation: R, scale: { x: 2 * halfX, y: thickness, z: 2 * halfZ },
        color: A.color, area: 4 * halfX * halfZ,
      });
      slabCount++;
    }
  }
  // PROVENANCE consumed set (input-triangle indices genuinely REPLACED by retained
  // primitives): a face is consumed iff all 3 of its vertices' final spheres are
  // retained. Faces touching a rejected sphere stay in the residual (nothing covers
  // that corner). Returned as a Set for O(1) filtering in the converter.
  // REACH CHECK (best-measured variant, prov3): "a face collapsed INTO a retained
  // sphere" does NOT guarantee that inscribed sphere COVERS the face — on a concave
  // wall inscribe shrinks the sphere below the original surface. So additionally
  // require each corner's ORIGINAL vertex to lie within its sphere's emitted radius
  // (+tol). Pure provenance without this over-consumes and holes badly (shiba
  // 198 px); with it shiba/matilda land ~10-11 px (still > the 3 px gate — the
  // remaining gap is the concavity residual for the decompose.js guard / a tighter
  // per-face coverage test next round).
  const reachTol = bboxDiag(triangles) * (opts.replaceReachTol ?? 0.010);
  const reaches = (id, s) => {
    const c = sm.spheres[s].c;
    const dd = Math.hypot(sm.ox[id] - c[0], sm.oy[id] - c[1], sm.oz[id] - c[2]);
    return dd <= sphR[s] + reachTol;
  };
  // DECOMPOSE.JS CONCAVITY GUARD (opts.partOf = per-input-triangle decomposition
  // part id): a capsule bridging two near-convex parts (across a concave crease —
  // matilda's waist) consumes faces whose vertices land in DIFFERENT parts, and
  // the straight capsule passes outside the concave dip -> hole. Assign each sphere
  // a home part (majority vote of the faces landing on it); a face is consumable
  // only when its 3 vertices' spheres share one part (not a bridge across a cut).
  const partOf = opts.partOf;
  let spherePart = null;
  if (partOf && sm.faceSpheres && sm.faceOrig) {
    const votes = new Map();                       // sphere -> Map(part -> count)
    for (let f = 0; f < sm.faceOrig.length; f++) {
      const p = partOf[sm.faceOrig[f]];
      for (let k = 0; k < 3; k++) {
        const si = sm.faceSpheres[f * 3 + k]; if (si < 0) continue;
        let mm = votes.get(si); if (!mm) { mm = new Map(); votes.set(si, mm); }
        mm.set(p, (mm.get(p) || 0) + 1);
      }
    }
    spherePart = new Int32Array(sm.spheres.length).fill(-1);
    for (const [si, mm] of votes) { let best = -1, bc = -1; for (const [p, c] of mm) if (c > bc) { bc = c; best = p; } spherePart[si] = best; }
  }
  const sameParty = (a, b, c) => !spherePart || (spherePart[a] === spherePart[b] && spherePart[b] === spherePart[c]);
  const consumedFaces = new Set();
  if (sm.faceSpheres && sm.faceOrig && sm.faceVerts) {
    for (let f = 0; f < sm.faceOrig.length; f++) {
      const sa = sm.faceSpheres[f * 3], sb = sm.faceSpheres[f * 3 + 1], sc = sm.faceSpheres[f * 3 + 2];
      if (sa >= 0 && sb >= 0 && sc >= 0 && retained[sa] && retained[sb] && retained[sc] &&
          reaches(sm.faceVerts[f * 3], sa) && reaches(sm.faceVerts[f * 3 + 1], sb) && reaches(sm.faceVerts[f * 3 + 2], sc) &&
          sameParty(sa, sb, sc)) {
        consumedFaces.add(sm.faceOrig[f]);
      }
    }
  }
  // ---------- FORENSICS (opt-in, opts.forensics): per-component consumption ----------
  // Answers "why is total consumption low?" by attributing every substrate face to
  // its connected component and classifying WHY it was / was not consumed:
  //   notRetained -> at least one corner sphere was rejected (contam/minR/maxR/zero)
  //   reach       -> all 3 spheres retained but a corner vertex lies outside sphR+tol
  //   party       -> retained+reach but the 3 spheres span >1 decompose part (guard)
  //   consumed    -> genuinely replaced
  // plus the per-component sphere rejection tally. No behavioral effect.
  let replaceForensics = null;
  if (opts.forensics && sm.faceSpheres && sm.faceOrig && sm.faceVerts && sm.vcomp && sm.sphereComp) {
    const comps = new Map();
    const getC = (c) => { let a = comps.get(c); if (!a) { a = { comp: c, faces: 0, consumed: 0, notRetained: 0, reach: 0, party: 0, faceCount: sm.compFaceCount ? sm.compFaceCount[c] : undefined, target: sm.compTarget ? sm.compTarget[c] : undefined, retained: 0, contam: 0, minR: 0, maxR: 0, zero: 0 }; comps.set(c, a); } return a; };
    for (let f = 0; f < sm.faceOrig.length; f++) {
      const comp = sm.vcomp[sm.faceVerts[f * 3]];
      const a = getC(comp); a.faces++;
      const sa = sm.faceSpheres[f * 3], sb = sm.faceSpheres[f * 3 + 1], sc = sm.faceSpheres[f * 3 + 2];
      const allRet = sa >= 0 && sb >= 0 && sc >= 0 && retained[sa] && retained[sb] && retained[sc];
      if (!allRet) { a.notRetained++; continue; }
      if (!(reaches(sm.faceVerts[f * 3], sa) && reaches(sm.faceVerts[f * 3 + 1], sb) && reaches(sm.faceVerts[f * 3 + 2], sc))) { a.reach++; continue; }
      if (!sameParty(sa, sb, sc)) { a.party++; continue; }
      a.consumed++;
    }
    for (let si = 0; si < sm.spheres.length; si++) { const a = getC(sm.sphereComp[si]); const rr = rejReason[si] || 'zero'; a[rr] = (a[rr] || 0) + 1; }
    const arr = [...comps.values()].sort((x, y) => y.faces - x.faces);
    const tot = { faces: 0, consumed: 0, notRetained: 0, reach: 0, party: 0, retained: 0, contam: 0, minR: 0, maxR: 0, zero: 0 };
    for (const a of arr) for (const k of Object.keys(tot)) tot[k] += a[k] || 0;
    // 0b: sample the 'zero'-radius spheres — degenerate because they sit in THIN
    // sheet regions (nearestDist << minR => no medial volume) or a solver bug
    // (r=0 with a fat local thickness)? Compare nearestDist vs retained spheres.
    const rnd = (v) => Math.round(v * 1e4) / 1e4;
    const zeroSamples = [], retSamples = [];
    for (let si = 0; si < sm.spheres.length && zeroSamples.length < 20; si++) {
      if (rejReason[si] !== 'zero') continue;
      const c = sm.spheres[si].c;
      zeroSamples.push({ nd: rnd(nearestDist(c[0], c[1], c[2])), rRaw: rnd(sm.spheres[si].r) });
    }
    for (let si = 0; si < sm.spheres.length && retSamples.length < 12; si++) {
      if (rejReason[si] !== 'retained') continue;
      const c = sm.spheres[si].c;
      retSamples.push({ nd: rnd(nearestDist(c[0], c[1], c[2])), r: rnd(sphR[si]) });
    }
    replaceForensics = {
      cfg: { minR, reachTol, bboxDiag: bboxDiag(triangles), contamFrac, inscribe, rScale, guardActive: !!spherePart, comps: arr.length },
      totals: tot, zeroSamples, retSamples,
      top: arr.slice(0, 40),
    };
  }
  return { placements, residual: triangles, consumedFaces, stats: { spheres: sphereCount, capsules: capCount, slabs: slabCount, consumed: triangles.length, replacedFaces: consumedFaces.size, replaceForensics, sm: sm.stats } };
}

function bboxDiag(triangles) {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of triangles) for (const q of t.p) {
    if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x; if (q.y < minY) minY = q.y;
    if (q.y > maxY) maxY = q.y; if (q.z < minZ) minZ = q.z; if (q.z > maxZ) maxZ = q.z;
  }
  return Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
}
