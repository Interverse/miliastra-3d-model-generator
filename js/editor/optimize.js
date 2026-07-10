// Optimization tools operating on decoration arrays (decoration space).
//
// - mergeAdjacent: coalesces same-plane, same-size, same-orientation
//   cuboids/planes with matching colors into larger ones (reuses the
//   engine's greedy grid mesher). Appearance-preserving at tolerance 0.
// - reduceToTarget: escalating-tolerance merging first, then drops the
//   smallest primitives until the target count is met.

import { coalesceSquares } from "../../engine/convert/coalesce.js";
import { matToEulerYXZ, matToEulerXYZ, DEG, RAD } from "../../engine/convert/vec3.js";
import { resolveZFighting } from "../../engine/convert/dezfight.js";
import {
  TRI_SCALE_Y_PER_M,
  TRI_SCALE_Z_PER_M,
} from "../../engine/convert/converter.js";
import { eulerToMat } from "../preview-mesh.js";

const q3 = (v) => Math.round(v * 1000) / 1000;
const r4 = (v) => Math.round(v * 10000) / 10000;

// Decoration zoom == edge length in 0.1 m units, the same unit as decoration
// positions, so both can be passed to the grid mesher unchanged.
export function mergeAdjacent(decorations, { colorTolerance = 0, eulerOrder = "YXZ" } = {}) {
  const passthrough = [];
  const groups = new Map(); // kind|thickness -> squares
  for (const d of decorations) {
    if (d.kind !== "square" && d.kind !== "plane") {
      passthrough.push(d);
      continue;
    }
    const key = d.kind + "|" + q3(d.scale.y);
    let g = groups.get(key);
    if (!g) {
      g = { kind: d.kind, thickness: d.scale.y, items: [] };
      groups.set(key, g);
    }
    g.items.push({
      kind: "square",
      position: { ...d.position },
      rotation: eulerToMat(
        d.rotationDeg.x * RAD,
        d.rotationDeg.y * RAD,
        d.rotationDeg.z * RAD,
        eulerOrder,
      ),
      scale: { x: d.scale.x, y: 1, z: d.scale.z },
      // engine colors are [r,g,b] arrays (colorToRgbInt/colorDistance)
      color: [(d.color >> 16) & 255, (d.color >> 8) & 255, d.color & 255],
      _src: d,
    });
  }

  const out = [...passthrough];
  for (const g of groups.values()) {
    const merged = coalesceSquares(g.items, { colorTolerance });
    for (const sq of merged) {
      if (sq._src) {
        out.push(sq._src); // untouched original decoration
        continue;
      }
      const toEuler = eulerOrder === "XYZ" ? matToEulerXYZ : matToEulerYXZ;
      const e = toEuler(sq.rotation);
      const norm = (v) => {
        let x = r4(v * DEG) % 360;
        if (x < 0) x += 360;
        return x;
      };
      const rotationDeg = { x: norm(e.x), y: norm(e.y), z: norm(e.z) };
      const color =
        ((Math.round(sq.color[0]) & 255) << 16) |
        ((Math.round(sq.color[1]) & 255) << 8) |
        (Math.round(sq.color[2]) & 255);
      // a merged rectangle may exceed the zoom-50 cap: grid-split it along
      // its local x/z axes (columns 0 and 2 of the rotation matrix)
      const u = [sq.rotation[0][0], sq.rotation[1][0], sq.rotation[2][0]];
      const w = [sq.rotation[0][2], sq.rotation[1][2], sq.rotation[2][2]];
      const nx = Math.ceil(sq.scale.x / 50);
      const nz = Math.ceil(sq.scale.z / 50);
      const sx = sq.scale.x / nx;
      const sz = sq.scale.z / nz;
      for (let ix = 0; ix < nx; ix++) {
        for (let iz = 0; iz < nz; iz++) {
          const du = (ix - (nx - 1) / 2) * sx;
          const dw = (iz - (nz - 1) / 2) * sz;
          out.push({
            kind: g.kind,
            position: {
              x: r4(sq.position.x + u[0] * du + w[0] * dw),
              y: r4(sq.position.y + u[1] * du + w[1] * dw),
              z: r4(sq.position.z + u[2] * du + w[2] * dw),
            },
            rotationDeg,
            scale: { x: r4(sx), y: g.thickness, z: r4(sz) },
            color,
          });
        }
      }
    }
  }
  return { decorations: out, merged: decorations.length - out.length };
}

// Largest face area — comparable "visual importance" proxy across kinds.
export function sizeProxy(d) {
  const { x, y, z } = d.scale;
  if (d.kind === "triangle") return (y * 0.13) * (z * 0.27) * 50; // leg area, rescaled
  if (d.kind === "plane") return x * z;
  return Math.max(x * y, y * z, x * z);
}

// Manual "Fix Z-Fighting": adapt decorations (0.1 m units, Euler degrees)
// into the engine's placement format (meters, rotation matrices), run the
// coplanar-overlap resolver, and write the results back. Only positions
// change (minimal outward offsets) and redundant duplicates are removed —
// rotations, zooms, and colors stay untouched.
//
// indices: restrict the fix to these decoration indices (the selection);
// null/empty = the whole model.
export function fixZFighting(decorations, indices, { eulerOrder = "YXZ" } = {}) {
  const idxs = indices && indices.length ? indices : decorations.map((_, i) => i);
  const adapted = [];
  for (const i of idxs) {
    const d = decorations[i];
    const kind = d.kind ?? "triangle";
    let rot = eulerToMat(
      d.rotationDeg.x * RAD,
      d.rotationDeg.y * RAD,
      d.rotationDeg.z * RAD,
      eulerOrder,
    );
    let scale;
    let fullY = false;
    if (kind === "triangle") {
      // decoration rotation is the placement rotation conjugated by Ry(180)
      // (the v2 model's -Z leg) — the conjugation is involutive, apply again
      rot = [
        [-rot[0][0], rot[0][1], -rot[0][2]],
        [-rot[1][0], rot[1][1], -rot[1][2]],
        [-rot[2][0], rot[2][1], -rot[2][2]],
      ];
      scale = {
        x: 0.001,
        y: d.scale.y / TRI_SCALE_Y_PER_M, // leg lengths in meters
        z: d.scale.z / TRI_SCALE_Z_PER_M,
      };
    } else if (kind === "square" || kind === "plane") {
      scale = {
        x: d.scale.x / 10,
        y: kind === "plane" ? 0.002 : d.scale.y / 10,
        z: d.scale.z / 10,
      };
      // thicker than 1 cm = a real cuboid, not a sheet — volumetric solids
      // don't z-fight and are skipped
      fullY = kind === "square" && d.scale.y > 0.1;
    } else {
      continue; // spheres/cylinders/cones/prisms: volumetric, never fight
    }
    adapted.push({
      kind,
      fullY,
      position: { x: d.position.x / 10, y: d.position.y / 10, z: d.position.z / 10 },
      rotation: rot,
      scale,
      color: [(d.color >> 16) & 255, (d.color >> 8) & 255, d.color & 255],
      _i: i,
    });
  }

  const stats = {};
  const result = resolveZFighting(adapted, stats);

  // write back: surviving entries may have offset positions; missing ones
  // were redundant duplicates
  const kept = new Set();
  for (const pl of result) {
    kept.add(pl._i);
    const d = decorations[pl._i];
    d.position = {
      x: r4(pl.position.x * 10),
      y: r4(pl.position.y * 10),
      z: r4(pl.position.z * 10),
    };
  }
  const removed = new Set(idxs.filter((i) => !kept.has(i)));
  return {
    decorations: removed.size
      ? decorations.filter((_, i) => !removed.has(i))
      : decorations,
    removed: removed.size,
    layered: stats.zfightLayered ?? 0,
    conflicts: stats.zfightConflicts ?? 0,
  };
}

export function reduceToTarget(decorations, target, { eulerOrder = "YXZ" } = {}) {
  let decs = decorations;
  let merged = 0;
  for (const tol of [0, 12, 24, 48, 96]) {
    if (decs.length <= target) break;
    const res = mergeAdjacent(decs, { colorTolerance: tol, eulerOrder });
    decs = res.decorations;
    merged += res.merged;
  }
  let dropped = 0;
  if (decs.length > target) {
    const order = decs
      .map((d, i) => ({ i, a: sizeProxy(d) }))
      .sort((p, q) => p.a - q.a);
    const drop = new Set();
    for (let k = 0; k < decs.length - target; k++) drop.add(order[k].i);
    dropped = drop.size;
    decs = decs.filter((_, i) => !drop.has(i));
  }
  return { decorations: decs, merged, dropped };
}
