// Z-fighting resolution: coplanar (or nearly coplanar) overlapping THIN
// primitives flicker in-game because the depth buffer cannot order them.
// Sources: double-sided sheets in the input (front + back convert to two
// identical thin decorations), stacked layers at identical depth (decals,
// clothing planes), and independent faces that happen to share a plane.
//
// Used by the editor's manual "Fix Z-Fighting" optimization (NOT part of
// the automatic conversion pipeline).
//
// Resolution, in order of preference (appearance-preserving):
//   1. DUPLICATES — same plane, same color, ≥90% mutual footprint overlap:
//      the redundant copy is dropped entirely (no offset needed).
//   2. OVERLAPS — same plane, different color or partial overlap: the
//      largest primitive keeps the true plane; smaller ones climb an
//      epsilon ladder (1.2 mm per layer) along the OUTWARD plane normal
//      (away from the model centroid), the same proven trick the
//      pixel-perfect overdraw mode uses. 1.2 mm is invisible at gameplay
//      scale but far outside depth-buffer noise and position quantization.
//
// Volumetric primitives (fullY cuboids, spheres, cylinders, …) are left
// alone: coincident faces of touching solids face opposite directions and
// do not fight.

const PLANE_EPS = 0.0008; // m — "same plane" tolerance (±0.8 mm)
const LAYER_STEP = 0.0012; // m — epsilon ladder spacing per layer
const OVERLAP_FRAC = 0.05; // significant overlap = >5% of the smaller area
const DUP_FRAC = 0.9; // duplicate = >90% of the smaller area, same color

// ---------- small 2D polygon helpers (convex) ----------

function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

// Sutherland–Hodgman: clip convex subject polygon by convex clip polygon.
function clipPoly(subject, clip) {
  // handle either winding of the clip polygon
  let sum = 0;
  for (let i = 0; i < clip.length; i++) {
    const p = clip[i], q = clip[(i + 1) % clip.length];
    sum += (q[0] - p[0]) * (q[1] + p[1]);
  }
  const cw = sum > 0;
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const A = clip[i], B = clip[(i + 1) % clip.length];
    const ex = B[0] - A[0], ey = B[1] - A[1];
    const inside = (p) => {
      const cross = ex * (p[1] - A[1]) - ey * (p[0] - A[0]);
      return cw ? cross <= 1e-12 : cross >= -1e-12;
    };
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const P = input[j], Q = input[(j + 1) % input.length];
      const pin = inside(P), qin = inside(Q);
      if (pin) out.push(P);
      if (pin !== qin) {
        const dx = Q[0] - P[0], dy = Q[1] - P[1];
        const denom = ex * dy - ey * dx;
        if (Math.abs(denom) > 1e-15) {
          const t = (ex * (A[1] - P[1]) - ey * (A[0] - P[0])) / denom;
          out.push([P[0] + dx * t, P[1] + dy * t]);
        }
      }
    }
  }
  return out;
}

function overlapArea(a, b) {
  return polyArea(clipPoly(a, b));
}

// ---------- placement geometry ----------

const col = (R, i) => [R[0][i], R[1][i], R[2][i]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// thin primitives only: triangle (thin local X), square/plane (thin local Y,
// unless fullY marks it volumetric)
function thinInfo(pl) {
  if (!pl.kind || pl.kind === 'triangle') {
    return { normal: col(pl.rotation, 0) };
  }
  if ((pl.kind === 'square' || pl.kind === 'plane') && !pl.fullY) {
    return { normal: col(pl.rotation, 1) };
  }
  return null;
}

// polygon corners in 3D (meters)
function corners3(pl) {
  const p = pl.position;
  const R = pl.rotation;
  if (!pl.kind || pl.kind === 'triangle') {
    const u = col(R, 1), w = col(R, 2);
    const B = [p.x + u[0] * pl.scale.y, p.y + u[1] * pl.scale.y, p.z + u[2] * pl.scale.y];
    const C = [p.x + w[0] * pl.scale.z, p.y + w[1] * pl.scale.z, p.z + w[2] * pl.scale.z];
    return [[p.x, p.y, p.z], B, C];
  }
  const u = col(R, 0), w = col(R, 2);
  const hx = pl.scale.x / 2, hz = pl.scale.z / 2;
  const out = [];
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    out.push([
      p.x + u[0] * hx * a + w[0] * hz * b,
      p.y + u[1] * hx * a + w[1] * hz * b,
      p.z + u[2] * hx * a + w[2] * hz * b,
    ]);
  }
  return out;
}

const sameColor = (a, b) =>
  a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

// ---------- main pass ----------

// placements: {kind, fullY?, position{m}, rotation matrix, scale{m}, color[rgb]}.
// Mutates positions of offset layers; returns the filtered array.
// Iterates until convergence: laddering can itself create a new coincidence
// (a lifted layer landing on another primitive's plane), so re-detect up to
// three times — in practice pass 2 resolves the stragglers.
export function resolveZFighting(placements, stats = {}) {
  let total = 0, dropped = 0, layered = 0;
  for (let pass = 0; pass < 3; pass++) {
    const st = {};
    placements = zPass(placements, st);
    if (!st.zfightConflicts) break;
    total += st.zfightConflicts;
    dropped += st.zfightDropped;
    layered += st.zfightLayered;
  }
  if (total) {
    stats.zfightConflicts = total;
    stats.zfightDropped = dropped;
    stats.zfightLayered = layered;
  }
  return placements;
}

function zPass(placements, stats) {
  // model centroid (for the outward direction heuristic)
  let cx = 0, cy = 0, cz = 0, n = 0;
  for (const pl of placements) { cx += pl.position.x; cy += pl.position.y; cz += pl.position.z; n++; }
  if (!n) return placements;
  cx /= n; cy /= n; cz /= n;

  // collect thin primitives grouped by quantized plane (normal + offset)
  const groups = new Map();
  for (let i = 0; i < placements.length; i++) {
    const info = thinInfo(placements[i]);
    if (!info) continue;
    let nrm = info.normal;
    // sign-normalize the normal so both sides of a sheet share a key
    if (nrm[0] < -1e-9 || (Math.abs(nrm[0]) <= 1e-9 && (nrm[1] < -1e-9 ||
        (Math.abs(nrm[1]) <= 1e-9 && nrm[2] < 0)))) {
      nrm = [-nrm[0], -nrm[1], -nrm[2]];
    }
    const p = placements[i].position;
    const d = dot3(nrm, [p.x, p.y, p.z]);
    const e = { i, nrm, d, pl: placements[i] };
    const nk = Math.round(nrm[0] * 200) + ',' + Math.round(nrm[1] * 200) + ',' + Math.round(nrm[2] * 200);
    const dk = Math.round(d / PLANE_EPS);
    // register in own bucket and the neighbor buckets so near-coplanar pairs
    // across a bucket boundary still meet
    for (const k of [dk - 1, dk, dk + 1]) {
      const key = nk + '@' + k;
      let arr = groups.get(key);
      if (!arr) { arr = []; groups.set(key, arr); }
      arr.push(e);
    }
  }

  const drop = new Set();
  const layered = new Map(); // index -> layer number
  let conflicts = 0;

  for (const arr of groups.values()) {
    if (arr.length < 2 || arr.length > 400) continue;
    // plane basis from the first member
    const base = arr[0];
    const nz = base.nrm;
    let u = Math.abs(nz[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const un = dot3(u, nz);
    u = [u[0] - un * nz[0], u[1] - un * nz[1], u[2] - un * nz[2]];
    const ul = Math.hypot(u[0], u[1], u[2]);
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    const w = [
      nz[1] * u[2] - nz[2] * u[1],
      nz[2] * u[0] - nz[0] * u[2],
      nz[0] * u[1] - nz[1] * u[0],
    ];
    const proj = (e) => corners3(e.pl).map((c) => [dot3(c, u), dot3(c, w)]);

    // sort large-first: the largest keeps the true plane
    const members = arr
      .filter((e) => !drop.has(e.i))
      .map((e) => {
        const poly = proj(e);
        return { e, poly, area: polyArea(poly) };
      })
      .sort((a, b) => b.area - a.area);

    for (let a = 0; a < members.length; a++) {
      if (drop.has(members[a].e.i)) continue;
      for (let b = a + 1; b < members.length; b++) {
        const A = members[a], B = members[b];
        if (drop.has(B.e.i)) continue;
        if (Math.abs(A.e.d - B.e.d) > PLANE_EPS) continue; // not actually coplanar
        if (layered.has(A.e.i) !== layered.has(B.e.i)) continue; // already separated
        const inter = overlapArea(A.poly, B.poly);
        const minA = Math.min(A.area, B.area) || 1e-12;
        if (inter < minA * OVERLAP_FRAC) continue;
        conflicts++;
        if (inter >= minA * DUP_FRAC && sameColor(A.e.pl.color, B.e.pl.color)) {
          drop.add(B.e.i); // redundant duplicate (double-sided sheet, etc.)
        } else {
          // epsilon ladder: B (smaller) climbs above A's layer
          const next = (layered.get(A.e.i) ?? 0) + 1;
          layered.set(B.e.i, Math.max(layered.get(B.e.i) ?? 0, next));
        }
      }
    }
  }

  // apply ladder offsets along the OUTWARD normal (away from the centroid)
  for (const [i, layer] of layered) {
    if (drop.has(i)) continue;
    const pl = placements[i];
    const info = thinInfo(pl);
    if (!info) continue;
    let nrm = info.normal;
    const p = pl.position;
    const outward = dot3(nrm, [p.x - cx, p.y - cy, p.z - cz]);
    if (outward < 0) nrm = [-nrm[0], -nrm[1], -nrm[2]];
    const off = layer * LAYER_STEP;
    pl.position = {
      x: p.x + nrm[0] * off,
      y: p.y + nrm[1] * off,
      z: p.z + nrm[2] * off,
    };
  }

  if (conflicts) {
    stats.zfightConflicts = conflicts;
    stats.zfightDropped = drop.size;
    stats.zfightLayered = layered.size;
  }
  if (!drop.size) return placements;
  return placements.filter((_, i) => !drop.has(i));
}
