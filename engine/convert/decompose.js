// Phase 3 step 3, STAGE 1: near-convex PART DECOMPOSITION (minima rule).
//
// docs/decoration-reduction-plan.md §8 L2: humans segment shapes at concave
// curvature minima (Hoffman/Richards). The "proven convex-protrusion ceiling"
// (matilda's 259 px torso/hip concavity-fill bulge; the whole-limb ellipsoid
// that spans a joint and balloons into the waist) was measured on non-convex
// WHOLES fit by one primitive each. If we first CUT the surface at its concave
// creases, every resulting part is near-convex, so a per-part primitive no
// longer has a concavity to bulge into — the ceiling was in the missing
// decomposition step, not the primitives.
//
// Method (deterministic, non-ML, reuses the qem/agglomerative welded-adjacency
// skeleton):
//   1. weld vertices (scale-relative) -> face adjacency across shared edges.
//   2. per shared edge classify CONVEX vs CONCAVE from the two face normals +
//      centroids (minima rule needs concave-only; a ridge/fingertip is convex
//      and must NOT be cut). concave iff each face's centroid lies on the +side
//      of the OTHER face's outward-normal plane (both agree -> robust to noise).
//      crease strength = dihedral magnitude (1 - n0·n1).
//   3. CUT edges = concave AND strength > creaseThresh. Region-grow faces that
//      do not cross a cut edge -> raw parts (connected comps of the un-cut graph).
//   4. MERGE guard against over-fragmentation: repeatedly fold the smallest part
//      into the adjacent part with which it shares the most NON-cut (within-part,
//      convex/flat) boundary, until every part is >= minPartFrac of the surface
//      (and >= minPartFaces) or the part count hits maxParts. Merging across the
//      deliberate concave cuts is de-prioritized so joints stay separated.
//
// Output: { partOf: Int32Array(nFaces mapped to INPUT triangle order), nParts,
//   parts:[{faces:[inputIdx], area, faceCount}], cutEdges, stats }. Geometry only
//   (color rides along downstream). Input/return use the pipeline triangle format
//   [{ p:[{x,y,z}x3], color }].

export function decomposeParts(triangles, opts = {}) {
  const n = triangles.length;
  const empty = { partOf: new Int32Array(n), nParts: n ? 1 : 0, parts: [], cutEdges: 0, stats: { faces: n, rawParts: 0, merged: 0 } };
  if (n < 2) return empty;

  // ---- bbox / scale ----
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of triangles) for (const q of t.p) {
    if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x;
    if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y;
    if (q.z < minZ) minZ = q.z; if (q.z > maxZ) maxZ = q.z;
  }
  const scale = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (!(scale > 0)) return empty;

  // ---- weld vertices (scale-relative), same scheme as agglomerative.js ----
  const eps = scale * (opts.weldFrac ?? 2e-5);
  const gy = Math.floor((maxY - minY) / eps) + 3, gx = Math.floor((maxX - minX) / eps) + 3;
  const vmap = new Map(); const vx = [], vy = [], vz = [];
  const vid = (q) => {
    const k = ((Math.round((q.z - minZ) / eps) * gy) + Math.round((q.y - minY) / eps)) * gx + Math.round((q.x - minX) / eps);
    let id = vmap.get(k); if (id === undefined) { id = vx.length; vmap.set(k, id); vx.push(q.x); vy.push(q.y); vz.push(q.z); } return id;
  };
  const FA = new Int32Array(n), FB = new Int32Array(n), FC = new Int32Array(n);
  const cx = new Float64Array(n), cy = new Float64Array(n), cz = new Float64Array(n);
  const nx = new Float64Array(n), ny = new Float64Array(n), nz = new Float64Array(n), area = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = triangles[i].p;
    const a = vid(p[0]), b = vid(p[1]), c = vid(p[2]);
    FA[i] = a; FB[i] = b; FC[i] = c;
    const ux = vx[b] - vx[a], uy = vy[b] - vy[a], uz = vz[b] - vz[a];
    const wx = vx[c] - vx[a], wy = vy[c] - vy[a], wz = vz[c] - vz[a];
    let Nx = uy * wz - uz * wy, Ny = uz * wx - ux * wz, Nz = ux * wy - uy * wx;
    const L = Math.hypot(Nx, Ny, Nz);
    area[i] = L * 0.5;
    if (L > 1e-20) { nx[i] = Nx / L; ny[i] = Ny / L; nz[i] = Nz / L; }
    cx[i] = (vx[a] + vx[b] + vx[c]) / 3; cy[i] = (vy[a] + vy[b] + vy[c]) / 3; cz[i] = (vz[a] + vz[b] + vz[c]) / 3;
  }

  // ---- face adjacency across shared welded edges (with edge length) ----
  const V = vx.length;
  const emap = new Map();
  const addE = (u, v, f) => { const k = u < v ? u * V + v : v * V + u; let a = emap.get(k); if (!a) { a = []; emap.set(k, a); } a.push(f); };
  for (let i = 0; i < n; i++) { addE(FA[i], FB[i], i); addE(FB[i], FC[i], i); addE(FA[i], FC[i], i); }
  // adjacency: for each face, list of {f:neighbor, len:sharededgelen, cut:bool}
  const adj = Array.from({ length: n }, () => []);
  const creaseThresh = opts.creaseThresh ?? 0.15;   // 1-cos dihedral; ~32 deg
  const concEps = scale * 1e-4;                      // centroid-side tolerance
  let cutCount = 0;
  const vlen = (u, v) => Math.hypot(vx[u] - vx[v], vy[u] - vy[v], vz[u] - vz[v]);
  for (const [k, arr] of emap) {
    if (arr.length !== 2) continue;                  // only manifold edges join parts
    const f0 = arr[0], f1 = arr[1];
    const u = Math.floor(k / V), v = k % V;
    const len = vlen(u, v);
    // concavity: centroid of f1 on +side of f0's plane AND vice versa.
    const d01 = (cx[f1] - cx[f0]) * nx[f0] + (cy[f1] - cy[f0]) * ny[f0] + (cz[f1] - cz[f0]) * nz[f0];
    const d10 = (cx[f0] - cx[f1]) * nx[f1] + (cy[f0] - cy[f1]) * ny[f1] + (cz[f0] - cz[f1]) * nz[f1];
    const dihed = 1 - (nx[f0] * nx[f1] + ny[f0] * ny[f1] + nz[f0] * nz[f1]);
    const concave = d01 > concEps && d10 > concEps;
    const cut = concave && dihed > creaseThresh;
    if (cut) cutCount++;
    adj[f0].push({ f: f1, len, cut });
    adj[f1].push({ f: f0, len, cut });
  }

  // ---- raw parts = connected components of the graph with cut edges removed ----
  const partOf = new Int32Array(n).fill(-1);
  let rawParts = 0;
  const stack = [];
  for (let s = 0; s < n; s++) {
    if (partOf[s] !== -1) continue;
    const id = rawParts++;
    partOf[s] = id; stack.length = 0; stack.push(s);
    while (stack.length) {
      const f = stack.pop();
      for (const e of adj[f]) { if (e.cut) continue; if (partOf[e.f] === -1) { partOf[e.f] = id; stack.push(e.f); } }
    }
  }

  // ---- part aggregates ----
  const partArea = new Float64Array(rawParts);
  const partFaces = new Int32Array(rawParts);
  for (let f = 0; f < n; f++) { partArea[partOf[f]] += area[f]; partFaces[partOf[f]]++; }
  let totalArea = 0; for (let i = 0; i < rawParts; i++) totalArea += partArea[i];

  // union-find over parts for merging
  const uf = new Int32Array(rawParts).map((_, i) => i);
  const find = (i) => { while (uf[i] !== i) { uf[i] = uf[uf[i]]; i = uf[i]; } return i; };

  // boundary length between part pairs, split into within-part (non-cut) and
  // across-cut. We prefer to dissolve small fragments across their LARGEST
  // non-cut shared boundary (that boundary was never a real joint); across-cut
  // merges are allowed only as a fallback so we never leave a sub-visual sliver.
  const rebuildBoundaries = () => {
    const nonCut = new Map();   // key rootA*R+rootB -> len
    const cutB = new Map();
    const bump = (m, a, b, len) => { if (a === b) return; const lo = Math.min(a, b), hi = Math.max(a, b); const k = lo * rawParts + hi; m.set(k, (m.get(k) || 0) + len); };
    for (let f = 0; f < n; f++) {
      const ra = find(partOf[f]);
      for (const e of adj[f]) {
        if (e.f < f) continue;   // count each shared edge once
        const rb = find(partOf[e.f]);
        if (ra === rb) continue;
        bump(e.cut ? cutB : nonCut, ra, rb, e.len);
      }
    }
    return { nonCut, cutB };
  };

  const minPartFrac = opts.minPartFrac ?? 0.01;     // 1% of surface area
  const minPartFaces = opts.minPartFaces ?? 6;
  const maxParts = opts.maxParts ?? 40;
  const minPartArea = minPartFrac * totalArea;

  const curArea = partArea.slice();
  const curFaces = partFaces.slice();
  let aliveParts = rawParts;
  let merges = 0;

  const mergeInto = (dst, src) => {   // fold src -> dst (roots)
    uf[src] = dst; curArea[dst] += curArea[src]; curFaces[dst] += curFaces[src];
    aliveParts--; merges++;
  };

  // iterate: dissolve the smallest under-min / over-cap part into its best
  // neighbor. A part with NO mergeable neighbor (a disconnected mesh island —
  // matilda has ~104 components) is FINALIZED and skipped, never aborting the
  // loop (the original break here disabled merging entirely).
  const finalized = new Uint8Array(rawParts);
  let guard = 0;
  while (guard++ < rawParts * 2 + 5) {
    let worst = -1, worstA = Infinity;
    let overCap = aliveParts > maxParts;
    for (let i = 0; i < rawParts; i++) {
      if (find(i) !== i || finalized[i]) continue;   // root, not yet finalized
      const tooSmall = curArea[i] < minPartArea || curFaces[i] < minPartFaces;
      if (!tooSmall && !overCap) continue;
      if (curArea[i] < worstA) { worstA = curArea[i]; worst = i; }
    }
    if (worst === -1) break;                          // nothing left to dissolve
    const { nonCut, cutB } = rebuildBoundaries();
    // best neighbor of `worst`: largest non-cut boundary, else largest cut boundary
    // prefer the largest NON-cut (within-part) shared boundary; only fall back to
    // a cut boundary when no non-cut neighbor exists. Each scan is single-class,
    // so within a scan we just take the longest boundary (best===-1 accepts the
    // first candidate — an earlier bug rejected cut neighbors here entirely).
    let best = -1, bestLen = -1;
    const scan = (m) => {
      for (const [k, len] of m) {
        const lo = Math.floor(k / rawParts), hi = k % rawParts;
        let other = -1;
        if (lo === worst) other = hi; else if (hi === worst) other = lo; else continue;
        if (best === -1 || len > bestLen) { best = other; bestLen = len; }
      }
    };
    scan(nonCut);
    if (best === -1) scan(cutB);
    if (best === -1) { finalized[worst] = 1; continue; }   // island: keep, skip
    const ra = worst, rb = find(best);
    if (ra === rb) { finalized[worst] = 1; continue; }
    if (curArea[ra] >= curArea[rb]) mergeInto(ra, rb); else mergeInto(rb, ra);
  }

  // ---- relabel to dense part ids in INPUT triangle order ----
  const rootToId = new Map(); let nParts = 0;
  const finalOf = new Int32Array(n);
  for (let f = 0; f < n; f++) {
    const r = find(partOf[f]);
    let id = rootToId.get(r); if (id === undefined) { id = nParts++; rootToId.set(r, id); }
    finalOf[f] = id;
  }
  const parts = Array.from({ length: nParts }, () => ({ faces: [], area: 0, faceCount: 0 }));
  for (let f = 0; f < n; f++) { const p = parts[finalOf[f]]; p.faces.push(f); p.area += area[f]; p.faceCount++; }

  return {
    partOf: finalOf, nParts, parts, cutEdges: cutCount,
    stats: { faces: n, verts: V, rawParts, merged: merges, aliveParts: nParts, totalArea, minPartArea },
  };
}
