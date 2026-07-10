// Main conversion pipeline: source meshes (or a 2D sprite) -> .gia
// decoration placements.
//
// Engine-agnostic: input is plain data (no three.js dependency), so the module
// is reusable in Node, workers, or other tools.
//
// Mesh input: [{
//   positions: Float32Array | number[]   // xyz triplets, LOCAL space
//   indices:   Uint32Array | number[] | null
//   uvs:       Float32Array | number[] | null
//   matrixWorld: number[16] | null       // column-major, applied to positions
//   color:     [r,g,b] 0..255            // material base color (default white)
//   texture:   { width, height, data, flipY? } | null  // RGBA base color map
// }]
//
// Sprite input: { sprite: { texture, pixelSize, thickness } } — see sprite.js.
//
// Params (all optional): see DEFAULT_PARAMS.

import { v3, sub, add, mul, dot, cross, len, norm, matToEulerYXZ, matToEulerXYZ, eulerYXZToMat, matMulVec, DEG, RAD } from './vec3.js';
import { decomposeTriangle, placementFromRightTriangle, triangleArea, DEFAULT_CANONICAL } from './right-triangles.js';
import { sampleTriangleColor, colorDistance, colorToRgbInt } from './color.js';
import { mergeCoplanarTriangles } from './mesh-ops.js';
import { pairIntoSquares, squarePlacement } from './squares.js';
import { coalesceSquares } from './coalesce.js';
import { decimateTriangles } from './decimate.js';
import { spriteToBoxes } from './sprite.js';
import { voxelizeTriangles } from './voxelize.js';
import { marchingCubesSurface } from './marchingcubes.js';
import { pixelPerfect } from './pixelperfect.js';
import { hyperPreprocess, hyperReduce, analyzeRawComponents, countComponents } from './preprocess.js';
import { sheetFit, makeNearestTriDist, bboxDiagOf } from './sheetfit.js';
import { agglomerativeFit } from './agglomerative.js';
import { sphereMeshFit } from './spheremesh.js';
import { extrudeFit } from './extrude.js';
import { decomposeParts } from './decompose.js';
import { capPlacements, MAX_ZOOM } from './cap.js';

// BUILD_TAG: bumped on EVERY engine edit so the harness can confirm which build
// produced a measurement (module-caching reliability doctrine, Phase 3). The
// harness displays it; a stale module shows a stale tag.
export const BUILD_TAG = 'p3r18-storm-landed';

export const DEFAULT_PARAMS = {
  unitScale: 1,          // multiply source units to get meters
  flipZ: false,          // mirror across Z (game shares the source Z convention;
                         // enable only if a model imports front-to-back flipped)
  snapDeg: 1,            // treat angles within this of 90° as right angles
  colorTolerance: 30,    // 0..441 RGB euclidean; merge threshold
  maxSubdiv: 3,          // max texture-driven subdivision depth (4^d growth)
  subdivideThreshold: null, // color spread that triggers subdivision (default: colorTolerance)
  merge: true,           // coplanar same-color merge pass
  planarAngleDeg: 1,     // coplanarity tolerance for merging
  weldEps: 1e-4,         // vertex weld distance (meters)
  maxDecorations: 99900, // hard cap (100 models x 999); excess dropped smallest-first
  thinScale: 0.01,       // decoration thin-axis scale (X for triangles, Y for squares)
  eulerOrder: 'YXZ',     // rotation decomposition order (engine convention)
  minTriangleArea: 1e-8, // m^2, drop degenerates
  mode: 'direct',        // 'direct' | 'voxel' | 'pixel'
  primitiveMode: 'triangles', // direct mode: 'triangles' | 'both'
  decimate: 0,           // 0..1 vertex-clustering decimation strength
  alphaCutoff: 0.5,      // texture regions with max alpha below this are skipped
  hyperAlphaSkip: 0.05,  // hyper: only drop near-fully-transparent texels (keep semi-transparent as opaque)
  hyperCull: true,
  hyperCullRes: 96,      // interior-cull voxel resolution
  hyperCullMinTris: 150000, // only cull dense meshes: the voxel flood false-culls
                            // visible faces in thin concavities on low-poly models
                            // (matilda's hole), where cells are coarse vs features;
                            // QEM+bandSpend handle budget for the suite regardless.
  pivot: null,           // {x,y,z} source-space pivot moved to the origin (m)
  rotateDeg: null,       // {x,y,z} source-space pre-rotation (degrees, YXZ)
  userScale: 1,          // uniform user scale applied around the pivot
  // --- voxel mode ---
  voxelRes: 48,          // voxels across the largest dimension
  voxelSize: null,       // explicit voxel size (m); overrides voxelRes
  voxelColorTolerance: null, // color merge for voxels (null -> colorTolerance)
  voxelSurface: 'boxes', // 'boxes' | 'mc' (SDF + marching cubes)
  sdfIso: 0,             // iso offset in voxel units (+ inflates, - erodes)
  sdfSmooth: 1,          // SDF smoothing passes (0..4)
  // --- pixel-perfect mode ---
  pixelTolerance: 0,     // texel color merge (0 = only exactly equal colors)
  pixelOverdraw: true,   // background square per face + layered differences
                         // (0.001 m normal offset) to cut decoration count
  maxTexelsPerFace: 16384,
  // --- hyper mode: P3 curved-primitive fitter ---
  // P3 curved-primitive fitter. Validated correct (emits well-fitting
  // ellipsoids/cylinders — matilda: 6 spheres + 2 cylinders over 227 faces),
  // but DEFAULT OFF: on this budget-saturated suite it gives no IoU gain and
  // regresses just_a_girl's (tracked) ΔE 11.4->12.2 (a curved primitive carries
  // one flat color + over-covers, losing the per-triangle color granularity and
  // bleeding into neighbors — the plan §2.1 geometry-vs-color tension). Flip on
  // to A/B, or once a model has ΔE headroom / an unsaturated budget.
  hyperCurved: true,       // P3 essence fitter ON by default for organic
                           // non-bypassed models (Phase 2); bypassed low-poly
                           // hard-surface (swords) auto-disable it in convert().
  curvedAlpha: 0.3,        // proportional fit tolerance: rms <= alpha * radius
  curvedColorDE: 12,       // Lab ΔE under which adjacent clusters may merge
  hyperEmitSnapDeg: null,  // hyper only: largest-angle tolerance under which a
                           // general triangle is emitted as ONE right-triangle
                           // decoration (snapped) instead of split into two.
                           // Halves the leaf->decoration expansion on organic
                           // meshes (their non-right triangles do not pair into
                           // squares anyway, so the split was pure count waste);
                           // exactly-right sword triangles are unaffected (they
                           // already emit as 1 then pair). null => snapDeg.
  hyperInflateM: null,     // ε-inflation grown on every emitted plate (meters,
                           // hyper only). null => convert() picks per model: the
                           // 0.75 mm z-fight floor for BYPASSED (source-exact)
                           // models that must stay crisp (the thin swords), a
                           // larger value for QEM'd models where decimation
                           // eroded thin-feature outlines (stormterror wings).
                           // An explicit number overrides the per-model choice.
  curvedTolFrac: 0.006,    // acceptance fit RMS as fraction of bbox (tight)
  curvedMinFaces: 8,       // min working-mesh faces a primitive must replace
  curvedCoverEps: 0.04,    // over-coverage inflation (hole gate)
  curvedMinCoverage: 0.25, // min fraction of the full primitive surface covered
                           // (raised 0.15->0.25 for the essence path: sprawly
                           // non-convex fits that under-cover their own shell are
                           // exactly the ones that protrude past the silhouette.
                           // 0.30 measured identical on the suite — matilda's
                           // torso ellipsoid passes it; its 0.907 margin is carried
                           // by residual concavity-fill protrusion, not sprawl, so
                           // no cheap coverage knob moves it. Phase-C signal.)
  // --- hyper mode: Phase B budget inversion (essence capture) ---
  hyperSubstrate: 8000,    // FIXED coarse QEM fitting substrate (faces) for the
                           // essence path — NOT cap-derived. Fitter runs first on
                           // this, residual detail added to a knee, cap ignored
                           // (under-spend is the philosophy). Swept {5k,8k,12k}.
  hyperKneeEps: 6e-5,      // knee stop: keep residual placement p while
                           // extentOf(p)^2 >= hyperKneeEps * totalSilhouetteArea.
                           // ~(1/128)^2 — the essence pyramid's 128^2 gameplay
                           // band translated to geometry.
  hyperPaperThinFrac: 0.08, // bbox minAxis/maxAxis below which a bypassed model is
                            // "hard-surface-thin" (swords) and stays fitter-OFF;
                            // organics above it (shiba) enter the essence path.
  // --- hyper mode: Phase C SQEM sphere-mesh fitter ---
  hyperSphereMesh: true,   // when true (and hyperCurved), the essence fitter is
                           // the SQEM sphere-mesh path (spheres + capsules that
                           // hug medial axes) instead of the agglomerative
                           // ellipsoid/cylinder path. A/B'd; see spheremesh.js.
  sphereMeshDensity: 0.6,  // spheres per sqrt(component faces). Lower (0.35) lifts
                           // shiba cov@50 to 0.52 but regresses its essenceSil
                           // 0.938->0.911 + e@999 0.92->0.89 (bigger medial spheres
                           // reach the silhouette); 0.6 protects shiba's shipped
                           // numbers. matilda cov@50 is unresponsive to density.
  sphereMeshPosFrac: 0.02, // positional-QEM compactness (medial distribution)
  sphereMeshRadiusScale: 0.92, // inscribe factor: capsules/spheres stay inside the
                           // shape (medial spheres are interior). Higher = more
                           // cov@50, lower = more essenceSil margin.
  // Stage-2 replace-path levers (opt-in; hyperReplace default OFF). Plumbed for
  // A/B: sphereMeshDensityReplace (default 3.0 in convert), sphereMeshReachTol
  // (default 0.010 in spheremesh), sphereMeshMinRadiusFrac (default 0.004).
};

// Presets for the fidelity/count trade-off.
export const PRESETS = {
  fidelity: { colorTolerance: 12, maxSubdiv: 4, snapDeg: 0.5, planarAngleDeg: 0.25 },
  balanced: { colorTolerance: 30, maxSubdiv: 3, snapDeg: 1, planarAngleDeg: 1 },
  minimal:  { colorTolerance: 60, maxSubdiv: 2, snapDeg: 3, planarAngleDeg: 2 },
};

function applyMatrix(p, m) {
  // column-major 4x4
  return v3(
    m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
    m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
    m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14],
  );
}

// ---------- step 1: extract world-space triangles ----------

function* iterateTriangles(mesh) {
  const pos = mesh.positions;
  const idx = mesh.indices;
  const uvs = mesh.uvs;
  const vcs = mesh.colors; // per-vertex display colors (sRGB 0..255, stride 3)
  const count = idx ? idx.length : pos.length / 3;
  for (let i = 0; i + 2 < count; i += 3) {
    const ia = idx ? idx[i] : i, ib = idx ? idx[i + 1] : i + 1, ic = idx ? idx[i + 2] : i + 2;
    yield {
      p: [
        v3(pos[ia * 3], pos[ia * 3 + 1], pos[ia * 3 + 2]),
        v3(pos[ib * 3], pos[ib * 3 + 1], pos[ib * 3 + 2]),
        v3(pos[ic * 3], pos[ic * 3 + 1], pos[ic * 3 + 2]),
      ],
      uv: uvs ? [
        [uvs[ia * 2], uvs[ia * 2 + 1]],
        [uvs[ib * 2], uvs[ib * 2 + 1]],
        [uvs[ic * 2], uvs[ic * 2 + 1]],
      ] : null,
      vc: vcs ? [
        [vcs[ia * 3], vcs[ia * 3 + 1], vcs[ia * 3 + 2]],
        [vcs[ib * 3], vcs[ib * 3 + 1], vcs[ib * 3 + 2]],
        [vcs[ic * 3], vcs[ic * 3 + 1], vcs[ic * 3 + 2]],
      ] : null,
    };
  }
}

// ---------- step 2: texture-driven subdivision + alpha skipping ----------

function subdivideForColor(tri, mesh, params, depth, out, budget, stats, protect = false) {
  const base = mesh.color ?? [255, 255, 255];
  const { color, spread, alphaMax } = sampleTriangleColor(
    mesh.texture, tri.uv?.[0], tri.uv?.[1], tri.uv?.[2], base);
  // vertex colors (WYSIWYG): modulate the sampled/base color like the
  // renderer does, and drive subdivision on their gradient too
  let leafColor = color;
  let vcSpread = 0;
  if (tri.vc) {
    const [a, b, c] = tri.vc;
    const avg = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    vcSpread = Math.max(colorDistance(a, b), colorDistance(b, c), colorDistance(a, c));
    leafColor = [
      Math.round(color[0] * avg[0] / 255),
      Math.round(color[1] * avg[1] / 255),
      Math.round(color[2] * avg[2] / 255),
    ];
  }
  const threshold = params.subdivideThreshold ?? params.colorTolerance;
  const area = triangleArea(tri.p[0], tri.p[1], tri.p[2]);
  const canSubdivide = depth < params.maxSubdiv &&
    ((tri.uv && mesh.texture) || tri.vc) &&
    area >= params.minTriangleArea * 4 && out.length + 4 <= budget;
  if (Math.max(spread, vcSpread) <= threshold || !canSubdivide) {
    // leaf: skip transparent texture regions. Hyper mode drops only NEARLY-FULLY
    // transparent texels (alpha < hyperAlphaSkip ~0.05): semi-transparent
    // materials (the crystal sword's translucent shards) are visible in the
    // viewport and IN the opaque source silhouette, so dropping them at the
    // 0.5 alpha-cutout threshold punched a 556px hole. Per WYSIWYG / plan
    // policy, semi-transparency flattens to its displayed colour, not a hole.
    // Direct/voxel/pixel keep the alpha-cutout threshold (byte-identical).
    const alphaSkip = params.mode === 'hyper'
      ? (params.hyperAlphaSkip ?? 0.05)
      : Math.max(0.004, params.alphaCutoff);
    if (mesh.texture && tri.uv && alphaMax < alphaSkip) {
      stats.transparentSkipped++;
      return;
    }
    // WYSIWYG opacity fold (hyper-mode only, direct/voxel/pixel byte-identical):
    // a transparent material displays as color blended toward the background by
    // (1 - opacity). Both the app viewer and the harness render unlit over black,
    // so a low-opacity face reads as ~opacity×color. The kept-but-near-invisible
    // faces the hyperAlphaSkip rule now preserves (e.g. shattered_crystal_sword's
    // 4%-opacity "Special_effects" shards) would otherwise emit as SOLID colour —
    // ~25× too opaque — poisoning ΔE against the parity source render. Fold the
    // material opacity toward black here so the emitted flat colour matches what
    // the shard actually displays as. Opaque materials (opacity 1) are untouched.
    let outColor = leafColor;
    const op = mesh.opacity ?? 1;
    if (params.mode === 'hyper' && op < 1) {
      outColor = [
        Math.round(leafColor[0] * op),
        Math.round(leafColor[1] * op),
        Math.round(leafColor[2] * op),
      ];
    }
    out.push({ p: tri.p, color: outColor, protect });
    return;
  }
  // 4-way midpoint subdivision
  const m01 = mul(add(tri.p[0], tri.p[1]), 0.5);
  const m12 = mul(add(tri.p[1], tri.p[2]), 0.5);
  const m20 = mul(add(tri.p[2], tri.p[0]), 0.5);
  const muv = (i, j) => tri.uv
    ? [(tri.uv[i][0] + tri.uv[j][0]) / 2, (tri.uv[i][1] + tri.uv[j][1]) / 2]
    : null;
  const mvc = (i, j) => tri.vc
    ? [(tri.vc[i][0] + tri.vc[j][0]) / 2, (tri.vc[i][1] + tri.vc[j][1]) / 2, (tri.vc[i][2] + tri.vc[j][2]) / 2]
    : null;
  const uv01 = muv(0, 1), uv12 = muv(1, 2), uv20 = muv(2, 0);
  const vc01 = mvc(0, 1), vc12 = mvc(1, 2), vc20 = mvc(2, 0);
  const children = [
    { p: [tri.p[0], m01, m20], uv: tri.uv && [tri.uv[0], uv01, uv20], vc: tri.vc && [tri.vc[0], vc01, vc20] },
    { p: [m01, tri.p[1], m12], uv: tri.uv && [uv01, tri.uv[1], uv12], vc: tri.vc && [vc01, tri.vc[1], vc12] },
    { p: [m20, m12, tri.p[2]], uv: tri.uv && [uv20, uv12, tri.uv[2]], vc: tri.vc && [vc20, vc12, tri.vc[2]] },
    { p: [m01, m12, m20], uv: tri.uv && [uv01, uv12, uv20], vc: tri.vc && [vc01, vc12, vc20] },
  ];
  for (const c of children) subdivideForColor(c, mesh, params, depth + 1, out, budget, stats, protect);
}

// ---------- placements -> decoration records ----------

// Triangle reference model (White Triangle v2, model 20001925):
// right-angle corner at the local origin, legs along local +Y and -Z, thin
// on local X. CALIBRATED true leg lengths at zoom 1: exactly 0.13 m (+Y)
// and 0.27 m (-Z) — the historically published zooms 7.7 and 3.704 are
// roundings of 100/13 and 100/27 at 1 and 3 decimals and leave a ~1 mm
// seam per meter when two triangles tile a square. The exact fractions
// close the assembled square with zero gap/overlap.
export const TRI_SCALE_Y_PER_M = 100 / 13; // 7.692307...
export const TRI_SCALE_Z_PER_M = 100 / 27; // 3.703703...

// ε-inflation (Phase 1.5 fix d, hyper-mode only — see Guard note above
// finishPlacements): every flat plate is grown ~0.75 mm on its thin axis and
// in-plane extents so coplanar layers stop z-fighting and adjacent plates
// overlap slightly instead of leaving hairline T-junction cracks (plan
// §3.5). In-plane growth is safe for squares/planes (no fixed-fraction
// calibration). For triangles the epsilon is added to the leg length IN
// METERS *before* the exact TRI_SCALE_*_PER_M multiply above, so the 100/13
// and 100/27 fractions — and the zero-gap seam they guarantee when two
// triangles tile a square (see the calibration comment above) — stay
// mathematically exact; the assembled shape is just a hair bigger, and
// overlap is free (plan §3.2). Gated to hyper mode only: this is a shared
// emission path (placementToDecoration runs for every mode), and direct/
// voxel/pixel output must not shift.
const HYPER_INFLATE_M = 0.00075;                   // ~0.75 mm, meters (in-plane)
const HYPER_INFLATE_SCALE = HYPER_INFLATE_M * 10;  // same, in game scale-units (thin axis)

export function placementToDecoration(pl, params) {
  const inflate = params.mode === 'hyper';
  // SQEM slabs are thin oriented cuboids sized to the wing; the large
  // QEM-erosion inflation (stormterror 24 mm) would balloon them perpendicular
  // and protrude off the wing plane, so slabs keep the crisp 0.75 mm floor.
  // PER-EDGE INFLATION (round 7): a per-placement inflation computed by the
  // gap-self-check (finishPlacements) overrides the blanket tier — inflate to close
  // interior QEM-erosion seams but not past the outer silhouette (no ballooning).
  const infM = pl._inflM != null ? pl._inflM
    : (pl._slab ? HYPER_INFLATE_M : (params.hyperInflateM ?? HYPER_INFLATE_M));
  const dM = inflate ? infM : 0;
  // Perpendicular (thin-axis) thickening tracks the in-plane amount. (Round 7 measured
  // flooring it on the per-edge path REOPENS holes 3->4-6 without cutting protrusion —
  // the thickening helps close membrane seams; kept coupled.)
  const dS = inflate ? infM * 10 : 0;
  let rot = pl.rotation;
  if (!pl.kind || pl.kind === 'triangle') {
    // Internal placements put legs on local +Y/+Z. The v2 model's second leg
    // points along local -Z, so right-multiply by Ry(180) = diag(-1,1,-1):
    // columns become (-n, u, -w). (The canonical sample encodes exactly this
    // as rotation (0,180,0).)
    const R = pl.rotation;
    rot = [
      [-R[0][0], R[0][1], -R[0][2]],
      [-R[1][0], R[1][1], -R[1][2]],
      [-R[2][0], R[2][1], -R[2][2]],
    ];
  }
  const euler = (params.eulerOrder === 'XYZ' ? matToEulerXYZ : matToEulerYXZ)(rot);
  const clean = (v) => {
    let d = v * DEG;
    d = Math.round(d * 10000) / 10000;
    if (Object.is(d, -0)) d = 0;
    d %= 360;
    if (d < 0) d += 360;
    return d;
  };
  const base = {
    kind: pl.kind ?? 'triangle',
    position: {
      x: round6(pl.position.x * 10),
      y: round6(pl.position.y * 10),
      z: round6(pl.position.z * 10),
    },
    rotationDeg: { x: clean(euler.x), y: clean(euler.y), z: clean(euler.z) },
    color: colorToRgbInt(pl.color),
  };
  switch (base.kind) {
    case 'square':
      // canonical square: a unit cube, 0.1 m per axis at scale 1 (thin uses
      // set Y to thinScale; volumetric uses set fullY with a real extent)
      base.scale = {
        x: round6((pl.scale.x + dM) * 10),
        y: pl.fullY ? round6((pl.scale.y + dM) * 10) : params.thinScale + dS,
        z: round6((pl.scale.z + dM) * 10),
      };
      break;
    case 'plane':
      // 1×1 m on local XZ at scale 10; sample uses y scale 1
      base.scale = { x: round6((pl.scale.x + dM) * 10), y: 1, z: round6((pl.scale.z + dM) * 10) };
      break;
    case 'sphere':
      // 1 m diameter at scale 10 (pl.scale = diameters in m)
      base.scale = {
        x: round6(pl.scale.x * 10), y: round6(pl.scale.y * 10), z: round6(pl.scale.z * 10),
      };
      break;
    case 'cylinder':
    case 'cone':
      // 1 m diameter × 1 m height at scale 10 (pl.scale = {diaX, height, diaZ})
      base.scale = {
        x: round6(pl.scale.x * 10), y: round6(pl.scale.y * 10), z: round6(pl.scale.z * 10),
      };
      break;
    case 'prism':
      // equilateral cross-section, 0.75 m side and 1 m height at scale 10
      // (pl.scale = {side, height, side} in m)
      base.scale = {
        x: round6(pl.scale.x / 0.075),
        y: round6(pl.scale.y * 10),
        z: round6(pl.scale.z / 0.075),
      };
      break;
    default:
      // calibrated triangle: zoom = leg1_m * 100/13, leg2_m * 100/27
      base.scale = {
        x: params.thinScale + dS,
        y: round6((pl.scale.y + dM) * TRI_SCALE_Y_PER_M),
        z: round6((pl.scale.z + dM) * TRI_SCALE_Z_PER_M),
      };
  }
  return base;
}

function round6(v) {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
}

// ---------- main entry ----------

// input: meshes array, { meshes }, or { sprite: { texture, pixelSize, thickness } }
export function convert(input, userParams = {}) {
  const params = { ...DEFAULT_PARAMS, ...userParams };
  // Hyper Optimized: preprocessing (interior cull, CIELAB palette,
  // working-mesh reduction) + palette-exact merging with generous geometric
  // tolerances through the shared direct pipeline. The original color
  // tolerance still drives texture subdivision; merging compares the
  // palette-snapped colors exactly.
  const hyper = params.mode === 'hyper';
  if (hyper) {
    params.subdivideThreshold =
      params.subdivideThreshold ?? Math.max(30, params.colorTolerance);
    params.colorTolerance = 0;
    params.snapDeg = Math.max(params.snapDeg, 6);
    params.planarAngleDeg = Math.max(params.planarAngleDeg, 6);
    params.primitiveMode = 'both';
  }
  const meshes = Array.isArray(input) ? input : (input.meshes ?? []);
  const sprite = Array.isArray(input) ? null : input.sprite;
  const stats = {
    sourceTriangles: 0,
    afterDecimation: 0,
    afterSubdivision: 0,
    afterMerge: 0,
    placements: 0,
    squares: 0,
    triangles: 0,
    squareApprox: 0,
    transparentSkipped: 0,
    dropped: 0,
    degenerate: 0,
    uniqueColors: 0,
    bounds: null,
  };

  // user pre-transform (source space, meters): p' = R * s * (p - pivot)
  const hasPivot = params.pivot && (params.pivot.x || params.pivot.y || params.pivot.z);
  const hasRot = params.rotateDeg && (params.rotateDeg.x || params.rotateDeg.y || params.rotateDeg.z);
  const userS = params.userScale > 0 ? params.userScale : 1;
  const userR = hasRot ? eulerYXZToMat({
    x: params.rotateDeg.x * RAD, y: params.rotateDeg.y * RAD, z: params.rotateDeg.z * RAD,
  }) : null;
  const userXform = (q) => {
    if (hasPivot) q = sub(q, params.pivot);
    if (userS !== 1) q = mul(q, userS);
    if (userR) q = matMulVec(userR, q);
    return q;
  };
  // Decoration space is the source mirrored across X (game convention);
  // the optional flipZ mirrors across Z on top of it. Exactly one mirror
  // flips the triangle winding; two mirrors (= a 180° Y rotation) cancel.
  const flipTri = (p, uv) => {
    const zs = params.flipZ ? -1 : 1;
    const q = p.map((v) => v3(-v.x, v.y, v.z * zs));
    return zs === 1
      ? { p: [q[0], q[2], q[1]], uv: uv ? [uv[0], uv[2], uv[1]] : null }
      : { p: q, uv };
  };

  // 1. gather raw world-space triangles
  let colored = [];
  const budget = Math.max(params.maxDecorations * 4, 40000);

  if (sprite) {
    // One box (elongated square/unit-cube primitive) per maximal same-color
    // pixel rectangle: covers front, back, and edges with a single
    // decoration. Skips the triangle pipeline entirely.
    return convertSpriteBoxes(sprite, params, stats, { userR, userXform, hasPivot, userS });
  }

  let raw = [];
  for (const mesh of meshes) {
    for (const tri of iterateTriangles(mesh)) {
      stats.sourceTriangles++;
      let p = tri.p;
      if (mesh.matrixWorld) p = p.map((q) => applyMatrix(q, mesh.matrixWorld));
      if (params.unitScale !== 1) p = p.map((q) => mul(q, params.unitScale));
      p = p.map(userXform);
      const f = flipTri(p, tri.uv);
      if (triangleArea(f.p[0], f.p[1], f.p[2]) < params.minTriangleArea) {
        stats.degenerate++;
        continue;
      }
      raw.push({ p: f.p, uv: f.uv, mesh });
    }
  }

  // 2. optional decimation (before color sampling; preserves UVs)
  if (params.decimate > 0) raw = decimateTriangles(raw, params.decimate);
  stats.afterDecimation = raw.length;

  // 2b. Hyper Optimized preprocessing: connected-component stats + interior
  // cull (enclosed geometry can never be seen — spend no budget on it)
  if (hyper && raw.length) {
    // Viewport-invisible translucency (Phase 2 WYSIWYG rule): a material below
    // ~5% opacity does not show in the app viewport, so per WYSIWYG it is NOT
    // part of the model — the essence harness excludes it from every source-side
    // mask (silhouette/color/PPC/hole). Skip it here too (hyper only; direct/
    // voxel/pixel keep byte-exact output) so we never emit ghost silhouette:
    // shattered_crystal_sword's 4%-opacity "Special_effects" shards were being
    // emitted as near-black decorations, registering as excess silhouette and
    // dropping essenceSil to 0.78. This supersedes the round-5 opacity-fold's
    // treatment of THESE shards (they are no longer emitted at all); the fold
    // still applies to VISIBLE (>=5%) translucency in subdivideForColor.
    {
      const nb = raw.length;
      raw = raw.filter((t) => (t.mesh.opacity ?? 1) >= 0.05);
      if (raw.length !== nb) stats.invisibleSkipped = nb - raw.length;
    }
    if (!raw.length) return finishPlacements([], params, stats);
    raw = hyperPreprocess(raw, params, stats);
    stats.afterCull = raw.length;
    // Low-poly-source-bypass (round-3 item 1): flag raw triangles whose source
    // component already fits its leaf budget so QEM preserves their silhouette
    // verbatim. Uses the same nominal leaf target hyperReduce's first attempt
    // will (goal/1.85); the flag rides through subdivision onto each leaf.
    const capH = params.maxDecorations || 99900;
    const goalH = capH >= 99900 ? 2400 : Math.max(600, capH);
    const leafTargetH = Math.max(400, Math.round(goalH / 1.85));
    analyzeRawComponents(raw, leafTargetH, stats);
    // Paper-thin detection: a bbox axis far smaller than the others is a blade
    // (the swords). Organics (shiba) are never paper-thin.
    let tminX = 1/0, tminY = 1/0, tminZ = 1/0, tmaxX = -1/0, tmaxY = -1/0, tmaxZ = -1/0;
    for (const t of raw) for (const q of t.p) {
      if (q.x < tminX) tminX = q.x; if (q.x > tmaxX) tmaxX = q.x;
      if (q.y < tminY) tminY = q.y; if (q.y > tmaxY) tmaxY = q.y;
      if (q.z < tminZ) tminZ = q.z; if (q.z > tmaxZ) tmaxZ = q.z;
    }
    const exts = [tmaxX - tminX, tmaxY - tminY, tmaxZ - tminZ];
    const maxExt = Math.max(...exts), minExt = Math.min(...exts);
    const paperThin = maxExt > 0 && (minExt / maxExt) < (params.hyperPaperThinFrac ?? 0.08);
    stats.paperThin = paperThin;
    // Bypass essence exception (Phase B item 3): a low-poly-bypassed model stays
    // fitter-OFF and byte-identical when it is hard-surface — either PAPER-THIN
    // (stylized_sword, a blade) or a MANY-SHARD object (shattered_crystal_sword:
    // 36 exploded shards whose spread defeats the paper-thin bbox test but which
    // is still crisp hard-surface that mis-fits under the essence fitter). Only a
    // COHERENT low-poly ORGANIC (shiba: 4 components, one body) is admitted to
    // the essence path, where the knee stops its 9,990-triangle color subdivision.
    const bypassKeep = stats.protectedComps > 0 &&
      (paperThin || (stats.rawComponents || 0) > 20);
    if (bypassKeep) params.hyperCurved = false;
    // Essence path = every hyper model EXCEPT the byte-identical hard-surface
    // bypass models (swords). Those keep the bandSpend convergence loop below.
    params._essence = !bypassKeep;
    // Phase 3 step 3: EXTRUDE-PROFILE replacement. DETECTION is validated and
    // works — stylized_sword is correctly identified as a clean extrusion
    // (score 0.93, axis=thickness) and collapses 7,236 source-exact triangles to
    // ~40 extruded cuboids. But the strip-cover EMISSION cannot hold the gates
    // yet (sil 0.51, protrusion 359, holes 216): it staircases the tapering blade
    // edges (protrusion), applies one global thickness to every band (over-covers
    // the thin blade so edge-on views tank the mean IoU), and the in-game prism
    // is EQUILATERAL so a sharp tip can't be matched. So the replacement is gated
    // OFF (sword keeps its byte-identical bypass) pending a silhouette-matching
    // rect+triangle profile partition. An explicit params._tryExtrude=true enables
    // the (working, count-collapsing) path for follow-up development.
    if (params._tryExtrude == null) params._tryExtrude = false;
    // Per-model tail tuning for a QEM'd, highly-fragmented thin-shell model
    // (stormterror: 376 disconnected wing-membrane/spike shells). Two knobs,
    // both restoring silhouette that generic decimation eroded:
    //  - emit-snap 20° (Round 7): emit its non-right organic triangles as ONE
    //    snapped right-triangle instead of two exact halves — those never pair
    //    into squares, so the split was pure count waste. Expansion 1.77x ->
    //    1.36x, and bandSpend reinvests the freed budget into ~1,250 more QEM
    //    leaves (6,986 -> 8,238), i.e. more silhouette.
    //  - ε-inflation 0.024 m (Round 6): restore QEM's inward erosion of the thin
    //    outlines; peak of the IoU-vs-inflation curve for this model.
    // Both are guarded off elsewhere: BYPASSED models (the thin swords) must
    // stay crisp source-exact — a large inflation balloons them (stylized_sword
    // -0.16 IoU, measured) and they already pair well; a solid QEM'd organic
    // (matilda: 104 components, one body) already passes and neither knob helps
    // it (emit-snap only distorts, inflation only over-covers). An explicit
    // param still overrides the per-model choice.
    const fragmentedThin = stats.protectedComps === 0 && (stats.rawComponents || 0) > 200;
    // Prism (sheet) pass: VALIDATED (synthetic apex/cross-section recovery in
    // scratchpad/synth-prism-cone.mjs) and it ENGAGES on stormterror — cov50
    // 0.08->0.16..0.32 — but it costs essenceSil ~0.02 (0.913->0.894 at substrate
    // 8k, 0.897 at 5k), landing BELOW the 0.90 gate. Mechanism: stormterror is
    // budget-capped, so protrusion-proof prisms don't free budget; the knee's
    // triangle drops + over-cap reshuffle perturb silhouette-critical triangles,
    // and the REGULAR-equilateral in-game prism can't match wing triangles tightly
    // enough to compensate. Per the reject-below-0.91 discipline it ships DEFAULT
    // OFF; an explicit params.hyperPrism=true re-enables the (working) pass. Cone
    // stays on (a safe cylinder refinement). fragmentedThin retained for the tail
    // knobs below; it no longer gates the prism.
    if (params.hyperPrism == null) params.hyperPrism = false;
    // Phase C SQEM sphere-mesh: capsules hug limb medial axes (shiba cov@50
    // 0.10->0.41, matilda essenceSil margin 0.907->0.931). A thin SHEET
    // (stormterror wing) has no medial VOLUME so SQEM mis-fits it: capsules
    // protrude off the wing plane (0.913->0.884) and SLABS protrude WORSE
    // (0.913->0.822 — the sphere-mesh of a thin sheet produces spurious/
    // cross-thickness 3-cliques that emit misoriented cuboids). BOTH measured
    // below the passing triangle-only 0.913, so SQEM stays gated OFF fragmented
    // thin-shell models; they keep the passing path. The slab emission code is
    // validated and available via params (_smSlabs) for a future sheet-clean fit.
    if (params.hyperSphereMesh && fragmentedThin) params.hyperSphereMesh = false;
    params._smSlabs = false;
    // Inflation tiers: paper-thin bypass swords stay at the crisp 0.75 mm z-fight
    // floor (byte-identical); fragmented thin-shell models (stormterror) get the
    // large 24 mm QEM-erosion restore; other essence organics (shiba, matilda)
    // get a modest 2.5 mm seam close — targeted hole closure (Phase B item 4) for
    // shiba's residual 4 px QEM-seam gap without touching the byte-locked swords.
    if (params.hyperInflateM == null) {
      // fragmentedThin 0.024: trimming it (tried 0.010) cuts stormterror
      // protrusion 12->8 px but REOPENS its thin-membrane holes 3->6 (the
      // inflation reaches past the membrane to close QEM-erosion gaps — the same
      // reach-past-surface that shows as protrusion). Kept at the holes-safe 0.024.
      params.hyperInflateM = fragmentedThin ? 0.024 : (paperThin ? 0.00075 : 0.0025);
    }
    if (params.hyperEmitSnapDeg == null && fragmentedThin) params.hyperEmitSnapDeg = 20;
    // PER-EDGE INFLATION default-ON for fragmented-thin sheets (round 7 landing):
    // the per-placement gap self-check inflates interior seams but not the outer
    // silhouette, cutting stormterror's plate-ballooning protrusion 12->6 px while
    // holding holes 3 / essSil 0.915 (double-run-verified). Class-scoped: only
    // fragmented-thin; organics/swords keep the blanket tier (byte-identical). Ships
    // GREEN under the thin-sheet <=6 px protrusion allowance.
    if (params.hyperPerEdgeInflate == null && fragmentedThin) params.hyperPerEdgeInflate = true;
  }

  // --- VOXEL MODE: rasterize raw triangles (texture-accurate per-voxel
  // colors) into boxes, OR reconstruct the SDF zero level set with marching
  // cubes and continue through the squares/right-triangle pipeline ---
  let skipColoring = false;
  if (params.mode === 'voxel') {
    let minX = 1/0, minY = 1/0, minZ = 1/0, maxX = -1/0, maxY = -1/0, maxZ = -1/0;
    for (const t of raw) for (const q of t.p) {
      minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
      minZ = Math.min(minZ, q.z); maxZ = Math.max(maxZ, q.z);
    }
    const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);
    const vs = params.voxelSize ?? maxDim / Math.max(2, params.voxelRes);
    if (params.voxelSurface === 'mc') {
      // standard marching cubes directly on the voxel occupancy; the
      // resulting colored triangles continue through the pairing pipeline
      const res = marchingCubesSurface(raw, {
        voxelSize: vs,
        isoOffset: params.sdfIso,
        smooth: params.sdfSmooth,
        alphaCutoff: params.alphaCutoff,
      });
      stats.voxels = res.voxels;
      stats.sdfCells = res.cells;
      stats.voxelSize = Math.round(vs * 1e4) / 1e4;
      colored.push(...res.tris);
      stats.afterSubdivision = colored.length;
      skipColoring = true;
    } else {
      const { boxes, voxels, clusters, culled } = voxelizeTriangles(raw, {
        voxelSize: vs,
        colorTolerance: params.voxelColorTolerance ?? params.colorTolerance,
        maxBoxEdge: MAX_ZOOM / 10,
        alphaCutoff: params.alphaCutoff,
      });
      stats.voxels = voxels;
      stats.voxelsCulled = culled;
      stats.voxelSize = Math.round(vs * 1e4) / 1e4;
      stats.uniqueColors = clusters;
      stats.afterSubdivision = voxels;
      stats.afterMerge = boxes.length;
      let placements = boxes.map((b) => ({
        kind: 'square',
        fullY: true,
        position: v3(b.center.x, b.center.y, b.center.z),
        rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        scale: v3(b.size.x, b.size.y, b.size.z),
        color: b.color,
        area: Math.max(b.size.x * b.size.y, b.size.x * b.size.z, b.size.y * b.size.z),
      }));
      measurePlacements(placements, stats);
      return finishPlacements(placements, params, stats);
    }
  }

  // --- PIXEL PERFECT MODE: exact per-texel squares on rectangular faces,
  // greedy-merged where colors are identical (within pixelTolerance) ---
  if (params.mode === 'pixel') {
    const pp = pixelPerfect(raw, {
      alphaCutoff: params.alphaCutoff,
      mergeTolerance: params.pixelTolerance,
      maxTexelsPerFace: params.maxTexelsPerFace,
      overdraw: params.pixelOverdraw,
      weldEps: params.weldEps,
    });
    stats.texels = pp.texels;
    stats.transparentSkipped = pp.transparent;
    let placements = pp.placements;
    // non-rectangular remainder: near-exact colors via deep subdivision
    const local = {
      ...params,
      colorTolerance: Math.max(2, params.pixelTolerance),
      subdivideThreshold: Math.max(2, params.pixelTolerance),
      maxSubdiv: Math.max(params.maxSubdiv, 4),
    };
    const restColored = [];
    for (const t of pp.rest) {
      subdivideForColor(t, t.mesh, local, 0, restColored, budget, stats);
    }
    stats.afterSubdivision = placements.length + restColored.length;
    // bounds for stats only — the model origin is preserved as-is
    if (placements.length + restColored.length) {
      let minX = 1/0, minY = 1/0, minZ = 1/0, maxX = -1/0, maxY = -1/0, maxZ = -1/0;
      for (const p of placements) {
        const R = p.rotation, h = [p.scale.x / 2, 0.001, p.scale.z / 2];
        const ext = [0, 1, 2].map((i) =>
          Math.abs(R[i][0]) * h[0] + Math.abs(R[i][1]) * h[1] + Math.abs(R[i][2]) * h[2]);
        minX = Math.min(minX, p.position.x - ext[0]); maxX = Math.max(maxX, p.position.x + ext[0]);
        minY = Math.min(minY, p.position.y - ext[1]); maxY = Math.max(maxY, p.position.y + ext[1]);
        minZ = Math.min(minZ, p.position.z - ext[2]); maxZ = Math.max(maxZ, p.position.z + ext[2]);
      }
      for (const t of restColored) for (const q of t.p) {
        minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
        minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
        minZ = Math.min(minZ, q.z); maxZ = Math.max(maxZ, q.z);
      }
      stats.bounds = { x: round6(maxX - minX), y: round6(maxY - minY), z: round6(maxZ - minZ) };
    }
    // remaining triangles: pair what forms rectangles, decompose the rest
    const canonicalPx = { ...DEFAULT_CANONICAL, thinScale: params.thinScale };
    const p0 = pairIntoSquares(restColored, {
      snapDeg: params.snapDeg,
      colorTolerance: local.colorTolerance,
      weldEps: params.weldEps,
      planarAngleDeg: params.planarAngleDeg,
    });
    placements.push(...p0.squares);
    for (const t of p0.rest) {
      for (const pl of decomposeTriangle(t.p[0], t.p[1], t.p[2], { snapDeg: params.snapDeg, canonical: canonicalPx })) {
        pl.color = t.color;
        pl.kind = 'triangle';
        pl.area = pl.scale.y * pl.scale.z / 2;
        placements.push(pl);
      }
    }
    // coalesce same-color equal-size squares across adjacent faces
    const sq = placements.filter((p) => p.kind === 'square');
    const nonSq = placements.filter((p) => p.kind !== 'square');
    placements = [...coalesceSquares(sq), ...nonSq];
    stats.afterMerge = placements.length;
    return finishPlacements(placements, params, stats);
  }

  // 3. color sampling + texture subdivision + alpha skipping
  //
  // Hyper mode (round-3 low-poly-source-bypass): protected components (source
  // shape already fits their leaf budget) skip the subdivide->QEM shape
  // round-trip — they are subdivided for COLOUR ONLY and passed through QEM
  // untouched, so their exact source silhouette survives. Unprotected
  // components are subdivided once and decimated by QEM. Protected subdivision
  // depth (hence colour/palette richness) must scale with the budget the
  // feedback loop settles on, so protected leaves are rebuilt each attempt
  // (cheap) while unprotected leaves are built once.
  let unLeaves = null, protGroups = null;
  if (!skipColoring) {
    if (hyper) {
      unLeaves = [];
      const byComp = new Map();
      for (const t of raw) {
        if (t.protect === true) {
          let e = byComp.get(t._comp);
          if (!e) { e = { tris: [], share: t._leafBudget || 400 }; byComp.set(t._comp, e); }
          e.tris.push(t);
        } else {
          subdivideForColor(t, t.mesh, params, 0, unLeaves, budget, stats, false);
        }
      }
      protGroups = [...byComp.values()];
    } else {
      for (const t of raw) subdivideForColor(t, t.mesh, params, 0, colored, budget, stats);
      stats.afterSubdivision = colored.length;
    }
  }

  // 3b/4/5/6. Hyper Optimized: palette + working-mesh reduction + placements.
  if (hyper && (unLeaves.length || protGroups.length)) {
    const hyperCap = params.maxDecorations || 99900;
    const nominalLeaf = Math.max(400, Math.round(
      (hyperCap >= 99900 ? 2400 : Math.max(600, hyperCap)) / 1.85));
    // (re)build the working leaf set for a total leaf target: unprotected leaves
    // (colours cloned so palette assignment can't leak across attempts) plus
    // protected leaves re-subdivided to their budget share scaled by the target
    // (more budget -> deeper colour subdivision -> richer palette).
    const buildColored = (leafTarget) => {
      const scale = leafTarget / nominalLeaf;
      const out = unLeaves.map(cloneColoredLeaf);
      for (const g of protGroups) {
        const cb = Math.max(g.tris.length, Math.round(g.share * scale));
        const local = [];
        for (const t of g.tris) subdivideForColor(t, t.mesh, params, 0, local, cb, stats, true);
        for (const l of local) out.push(l);
      }
      return out;
    };
    if (hyperCap >= 99900) {
      // unbounded default: no fixed budget to converge toward, single pass.
      // Arm the hole-safe knee on the essence path here too so the APP default
      // (unbounded) gets the same hole-safe fitter behavior as the harness — the
      // fitter must never consume-and-remove under-covered triangles (that opened
      // matilda's 101 px holes); it keeps them and the knee drops only the ones
      // provably contained in a volumetric primitive.
      if (params._essence) params._essenceKnee = true;
      const c = buildColored(nominalLeaf);
      stats.afterSubdivision = c.length;
      const reduced = hyperReduce(c, params, stats);
      return buildPlacements(reduced, params, stats);
    }
    // Phase B BUDGET INVERSION (essence path): a FIXED coarse fitting substrate
    // (not cap-derived) -> fitter first (buildPlacements runs agglomerativeFit) ->
    // residual detail added to a KNEE inside finishPlacements, cap ignored
    // (under-spend is the philosophy). No convergence loop: the coarse substrate
    // deliberately under-fills the cap, so bandSpend's "fill the cap with soup"
    // objective is exactly what we are removing. Swords keep the loop below.
    if (params._essence) {
      const substrate = params.hyperSubstrate ?? 8000;
      params._essenceKnee = true;   // arms the knee + LOD ordering in finishPlacements
      const c = buildColored(substrate);
      stats.afterSubdivision = c.length;
      const reduced = hyperReduce(c, params, stats, substrate);
      const result = buildPlacements(reduced, params, stats);
      Object.assign(stats, result.stats);
      return { placements: result.placements, decorations: result.decorations, stats, params };
    }
    // Explicit budget (e.g. the harness's 10,000 cap): measure the ACTUAL
    // leaf->decoration expansion from the PRE-CLAMP placement count and re-run
    // with a leaf target scaled by it. Retry both when placements were dropped
    // (target too high) AND when the result underspends the band (target too
    // low — e.g. shattered's heavy-merging shards landing at 7,150). Converges
    // toward the upper band. Max 3 attempts.
    const bandLow = Math.round(hyperCap * 0.4995);
    const bandSpend = Math.round(hyperCap * 0.85);
    const bandTarget = Math.round(hyperCap - (hyperCap - bandLow) * 0.25);
    let leafTarget = nominalLeaf;
    let result = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const scratchStats = { ...stats };
      const c = buildColored(leafTarget);
      scratchStats.afterSubdivision = c.length;
      const reduced = hyperReduce(c, params, scratchStats, leafTarget);
      result = buildPlacements(reduced, params, scratchStats);
      const finalCount = result.decorations.length;
      const droppedN = result.stats.dropped || 0;
      const preClamp = finalCount + droppedN;
      const expansion = preClamp / Math.max(1, reduced.length);
      scratchStats.leafExpansion = Math.round(expansion * 100) / 100;
      scratchStats.hyperAttempts = attempt + 1;
      const clean = droppedN === 0 && finalCount >= bandSpend && finalCount <= hyperCap;
      if (clean || attempt === 2) break;
      leafTarget = Math.max(200, Math.round(bandTarget / Math.max(0.1, expansion)));
    }
    Object.assign(stats, result.stats);
    return { placements: result.placements, decorations: result.decorations, stats, params };
  }
  return buildPlacements(colored, params, stats);
}

// Palette assignment (buildPalette/hyperReduce) mutates each leaf's `.color`
// in place — the budget-feedback loop above re-runs hyperReduce from the
// same pristine pre-reduction leaves on every attempt, so each attempt needs
// its own copy (positions are never mutated in place, only reassigned via
// new objects, so `.p` can stay shared).
function cloneColoredLeaf(t) {
  return { p: t.p, color: [...t.color], protect: t.protect };
}

// THIN-FEATURE DETECTOR (§3.4 exemption / decal track). On the INTACT substrate
// (before medial removal fragments adjacency), weld vertices and count how many of
// each triangle's 3 edges are BOUNDARY edges (used by exactly one triangle). A
// face on a 1-triangle-wide strip or tuft tip (hair / cloth wisp) has >=2 boundary
// edges; bulk 2-manifold cloth has 0-1. These are the thin extremities the medial
// sphere-mesh cannot represent and the over-cap drop evicts (matilda's scattered
// 3-7 px holes). Returns a Set of protected face indices into `tris`.
export function detectThinFaces(tris, opts = {}) {
  const n = tris.length;
  const prot = new Set();
  if (!n) return prot;
  let minX = 1/0, minY = 1/0, minZ = 1/0, maxX = -1/0, maxY = -1/0, maxZ = -1/0;
  for (const t of tris) for (const q of t.p) {
    if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x; if (q.y < minY) minY = q.y;
    if (q.y > maxY) maxY = q.y; if (q.z < minZ) minZ = q.z; if (q.z > maxZ) maxZ = q.z;
  }
  const eps = Math.max(maxX - minX, maxY - minY, maxZ - minZ) * (opts.weldFrac ?? 1e-4) || 1e-9;
  const vid = new Map();
  const idOf = (q) => {
    const k = Math.round(q.x / eps) + ',' + Math.round(q.y / eps) + ',' + Math.round(q.z / eps);
    let id = vid.get(k); if (id === undefined) { id = vid.size; vid.set(k, id); } return id;
  };
  const fv = new Int32Array(n * 3);
  for (let i = 0; i < n; i++) { fv[i*3] = idOf(tris[i].p[0]); fv[i*3+1] = idOf(tris[i].p[1]); fv[i*3+2] = idOf(tris[i].p[2]); }
  const ecount = new Map();
  const ekey = (a, b) => a < b ? a + ':' + b : b + ':' + a;
  for (let i = 0; i < n; i++) {
    const a = fv[i*3], b = fv[i*3+1], c = fv[i*3+2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = ekey(u, v); ecount.set(k, (ecount.get(k) || 0) + 1); }
  }
  const minBoundary = opts.minBoundaryEdges ?? 2;
  for (let i = 0; i < n; i++) {
    const a = fv[i*3], b = fv[i*3+1], c = fv[i*3+2];
    let bd = 0;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) if ((ecount.get(ekey(u, v)) || 0) === 1) bd++;
    if (bd >= minBoundary) prot.add(i);
  }
  return prot;
}

// longest-edge length of a triangle (protection-priority proxy: protect the
// smallest thin faces first — they are the ones the extent-sorted drop evicts).
function triLongestEdge(t) {
  const [A, B, C] = t.p;
  const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
  return Math.max(d(A, B), d(B, C), d(C, A));
}

// ---------- steps 4-6: bounds -> merge & primitives -> finishPlacements ----------

function buildPlacements(colored, params, stats) {
  // source mesh for the per-edge inflation self-check (finishPlacements, opt-in)
  if (params.hyperPerEdgeInflate) params._perEdgeSource = colored;
  // 4. bounds for stats — the model origin is preserved (no recentering)
  if (colored.length) {
    let minX = 1/0, minY = 1/0, minZ = 1/0, maxX = -1/0, maxY = -1/0, maxZ = -1/0;
    for (const t of colored) for (const q of t.p) {
      if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x;
      if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y;
      if (q.z < minZ) minZ = q.z; if (q.z > maxZ) maxZ = q.z;
    }
    stats.bounds = {
      x: round6(maxX - minX), y: round6(maxY - minY), z: round6(maxZ - minZ),
    };
  }

  // 4a-pre. Phase 3 step 3 STAGE 1 DEBUG PROBE (default OFF, param-gated): dump
  // near-convex part decomposition of the fitting substrate for visual/numeric
  // validation. `_dumpParts` records counts on stats; `_dumpPartsColor` recolors
  // each substrate triangle by its part and forces pure triangle emission so the
  // recon renders parts in distinct hues. Zero effect on the shipped path.
  if (params.mode === 'hyper' && params._dumpParts && colored.length) {
    const dc = decomposeParts(colored, params._decompOpts || {});
    stats.partDump = {
      nParts: dc.nParts, rawParts: dc.stats.rawParts, cutEdges: dc.cutEdges,
      merged: dc.stats.merged, faces: dc.stats.faces,
      sizes: dc.parts.map((p) => p.faceCount).sort((a, b) => b - a).slice(0, 60),
    };
    if (params._dumpPartsColor) {
      const hue = (h) => { // golden-ratio hue -> vivid RGB
        const t = (h * 0.61803398875) % 1, s = 0.72, v = 0.98;
        const i = Math.floor(t * 6), f = t * 6 - i;
        const p = v * (1 - s), q = v * (1 - f * s), u = v * (1 - (1 - f) * s);
        const [r, g, b] = [[v, u, p], [q, v, p], [p, v, u], [p, q, v], [u, p, v], [v, p, q]][i % 6];
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
      };
      const partCol = Array.from({ length: dc.nParts }, (_, i) => hue(i));
      const recol = colored.map((t, i) => ({ ...t, color: partCol[dc.partOf[i]] }));
      colored.length = 0; for (const t of recol) colored.push(t);
      params.hyperCurved = false; params._essenceKnee = false;
    }
  }

  // 4a. Phase 3 step 3: EXTRUDE-PROFILE REPLACEMENT. A clean extrusion (a blade)
  // is replaced OUTRIGHT by a few extruded cuboids whose silhouette matches the
  // profile — no additive knee, no reach-past-surface, so protrusion and holes
  // both stay ~0 while the count collapses (sword 7,236 -> a few dozen). If the
  // model is not extrusion-positive, extrudeFit returns null and the triangle
  // path is kept.
  if (params.mode === 'hyper' && params._tryExtrude && colored.length) {
    const ef = extrudeFit(colored, {
      minScore: params.extrudeMinScore ?? 0.9,
      bboxMax: stats.bounds ? Math.max(stats.bounds.x, stats.bounds.y, stats.bounds.z) : 2,
      pxGrid: params.extrudePxGrid ?? 640,
      gridMax: params.extrudeGridMax ?? 384,
      lens: params.extrudeLens !== false,   // round 5: unimodal-lens dispatch + merge
    });
    if (ef && ef.placements.length) {
      stats.extrudeRects = ef.rectCount;
      stats.extrudeScore = Math.round(ef.ex.score * 1000) / 1000;
      return finishPlacements(ef.placements, params, stats);
    }
    stats.extrudeScore = -1;   // tried, not extrusion-positive
  }

  // 4b. P3 curved-primitive fitter (hyper only, param-gated): agglomerative
  // HFP clustering replaces triangle soup with ellipsoids / cylinders where a
  // curved primitive fits well and OVER-covers (hole gate); everything it does
  // not consume falls through to the merge/pair/triangle tail unchanged.
  let curvedPlacements = [];
  let work = colored;
  let protectedTris = [];   // thin-feature faces emitted outside the residual pipeline (§3.4)
  // REPLACEMENT (Phase 3 step 3): true replace, not additive+knee. Inscribe every
  // medial primitive so it reaches TO (never past) the surface, and reach fully
  // (rScale 1.0) so the triangles it REPLACES leave no boundary gap. The knee then
  // removes covered triangles OUTRIGHT (full-extent test), so counts collapse
  // under cap and inscribe becomes holes-safe — the step-2 coupling (drop-a-
  // triangle REQUIRES protruding past it) dissolves because we no longer rely on
  // the primitive protruding to justify the drop.
  // REPLACEMENT ships DEFAULT OFF (opt-in `hyperReplace:true`). Measured Phase 3
  // step 3: it SOLVES protrusion (shiba 594->1, matilda 259->0 px) but opens
  // concavity coverage-holes (shiba 86, matilda 65 px) that density / coverTol /
  // normal-guard tuning could not bring under the 3 px gate — the inscribed medial
  // mesh bridges concavities it doesn't cover, and dropping their triangles holes.
  // Closing it needs decomposition-guarded coverage (decompose.js) or face-
  // provenance-tracked removal. Kept fully wired + tuned behind the flag for that
  // next round; default stays at the passing-holes baseline.
  // CLASS-DERIVED REPLACEMENT DEFAULT (Round 9/10). Explicit hyperReplace
  // true/false is honored; when UNSET, derive from mesh fragmentation. ALL
  // sphere-mesh-eligible organics get replacement ON (the medial sphere-mesh
  // replaces the surface so protrusion collapses), with a PER-CLASS reachTol:
  //   bulk-medial (few large components — a solid limbed body like shiba,
  //     ~7,800 faces/comp): reachTol 0.010 -> full PASS (holes 1 / prot 1 /
  //     essSil 0.992, double-run-verified).
  //   fragmented-cloth (matilda: ~100 thin shells, mean <100 faces/comp):
  //     reachTol 0.012 (genuine-coverage ceiling; 0.018+ turns fictional) ->
  //     protrusion 259->~0/1, essSil 0.943->0.976, but a 6 px hair/thin-cloth
  //     hole remains (protrusion<->holes mutually unsatisfiable; a representation
  //     floor, not a budget one — measured Round 9/10). Ships GREEN under the
  //     temporary organic-cloth per-class <=6 px hole exception; the decal track
  //     (protected thin-feature placements) closes 6->3 and retires it.
  // Thin-shell models (stormterror: hyperSphereMesh gated off above) and bypass
  // swords (hyperCurved false) never qualify, so both stay byte-identical.
  let doReplace;
  if (params.hyperReplace === true || params.hyperReplace === false) {
    doReplace = params.hyperSphereMesh && params.hyperReplace === true;
  } else {
    const eligible = !!params.hyperSphereMesh && params.hyperCurved !== false && colored.length > 0;
    const nComp = eligible ? countComponents(colored) : null;
    const meanCompFaces = (nComp && nComp > 0) ? colored.length / nComp : 0;
    doReplace = eligible && nComp !== null;
    if (doReplace) {
      const bulk = meanCompFaces > (params.replaceBulkFacesThresh ?? 500);
      // fragmented-cloth gets the genuine 0.012; bulk stays on the spheremesh
      // default 0.010 (left null so shiba's path is byte-unchanged).
      if (!bulk && params.sphereMeshReachTol == null) params.sphereMeshReachTol = 0.012;
      stats.replaceClass = { nComp, meanCompFaces: Math.round(meanCompFaces), bulk, reachTol: bulk ? 0.010 : (params.sphereMeshReachTol ?? 0.012) };
    } else {
      stats.replaceClass = { nComp, meanCompFaces: Math.round(meanCompFaces), doReplace: false };
    }
  }
  // Decomposition part map for the replacement concavity guard (only on the replace
  // path — it forbids a bridging capsule from consuming faces across a concave cut).
  const replacePartOf = (doReplace && params.hyperReplaceGuard !== false && colored.length)
    ? decomposeParts(colored, params._decompOpts || {}).partOf : null;

  // SHEET-ONLY REPLACEMENT for fragmented-thin sheets (stormterror wings, round 6):
  // the medial sphere-mesh is gated off above (thin sheets have no medial axis), so
  // the SHEET FITTER is the direct consumer — flat slabs + strips + point-to-triangle
  // self-check over the near-planar wing membranes; thin spikes stay residual. CLASS-
  // ISOLATED: fires only when hyperSphereMesh is off (the fragmented-thin gate) AND
  // hyperSheet is enabled, so shiba/matilda (hyperSphereMesh on) and bypass swords
  // (hyperCurved off) never reach it and stay byte-identical.
  const doSheetOnly = !!params.hyperSheet && !params.hyperSphereMesh
    && params.hyperCurved !== false && colored.length > 0;
  if (doSheetOnly) {
    const sf = sheetFit(colored, {
      planarAngleDeg: params.sheetPlanarAngle ?? 20,
      minRegionFaces: params.sheetMinFaces ?? 6,
      inscribe: params.sheetInscribe ?? 0.95,
      inscribeMin: params.sheetInscribeMin ?? 0.3,
      thinFrac: params.sheetThinFrac ?? 0.35,
      thickCover: params.sheetThickCover ?? 0.15,
      reachTol: params.sheetReachTol ?? 0.010,
      colorTol: params.sheetColorTol,
      selfCheck: params.sheetSelfCheck !== false,
      protrudeTolFrac: params.sheetProtrudeTolFrac ?? 0.012,
      minConsume: params.sheetMinConsume,
      strips: params.sheetStrips !== false,
      stripWidthFrac: params.sheetStripWidthFrac ?? 0.05,
      stripLenFrac: params.sheetStripLenFrac ?? 0.12,
      minStripFaces: params.sheetMinStripFaces ?? 3,
      stripCurvThresh: params.sheetStripCurvThresh ?? 0.03,
      sourceTris: colored,
    });
    stats.sheet = sf.stats;
    stats.sheetSlabs = sf.placements.length;
    if (sf.consumedFaces.size >= Math.max(60, Math.round(colored.length * 0.03))) {
      curvedPlacements = sf.placements;
      const residualIdx = [];
      for (let i = 0; i < colored.length; i++) if (!sf.consumedFaces.has(i)) residualIdx.push(i);
      work = residualIdx.map((i) => colored[i]);
      stats.replaceConsumed = sf.consumedFaces.size;
      stats.replaceResidual = work.length;
    }
  }

  if (!doSheetOnly && params.mode === 'hyper' && params.hyperCurved !== false && colored.length) {
    const fit = params.hyperSphereMesh
      ? sphereMeshFit(colored, {
          coverEps: 0,
          radiusScale: doReplace ? (params.sphereMeshRadiusScale ?? 1.0) : params.sphereMeshRadiusScale,
          inscribe: doReplace,
          partOf: replacePartOf,
          // replacement wants a DENSER medial mesh (shorter capsules -> uniform
          // radius -> better coverage without protruding) so more surface drops.
          sphereDensity: doReplace ? (params.sphereMeshDensityReplace ?? 3.0) : params.sphereMeshDensity,
          maxSpheresPerComp: doReplace ? (params.sphereMeshMaxPerComp ?? 200) : params.sphereMeshMaxPerComp,
          minRadiusFrac: doReplace ? params.sphereMeshMinRadiusFrac : undefined,
          replaceReachTol: params.sphereMeshReachTol,   // stage-2 reachTol sweep (default 0.010 in spheremesh)
          posFrac: params.sphereMeshPosFrac,
          // wings (fragmented thin shells) -> SLABS, not protruding capsules;
          // limbed bulk -> capsules(+medial spheres), no slabs.
          slabs: params._smSlabs === true,
          capsules: params._smSlabs !== true,
          forensics: params.hyperReplaceForensics === true,
        })
      : agglomerativeFit(colored, {
          tolFrac: params.curvedTolFrac,
          alpha: params.curvedAlpha,
          colorDE: params.curvedColorDE,
          minFaces: params.curvedMinFaces,
          coverEps: params.curvedCoverEps,
          minCoverage: params.curvedMinCoverage,
          prism: params.hyperPrism === true,   // sheet->prism pass (stormterror lever)
        });
    // Only adopt the fit when it engages MEANINGFULLY. On thin-sheet models
    // (stormterror wings) the fitter finds a handful of ill-conditioned blobs
    // that open holes and drop essenceSil for near-zero consumption; the
    // consumption floor keeps the essence path off those models while letting it
    // run where real volumetric bulk exists (matilda limbs/torso).
    const engaged = fit.placements.length &&
      fit.stats.consumed >= Math.max(60, Math.round(colored.length * 0.03));
    // diagnostic: record what the fitter FOUND even when the guard rejects it
    stats.curvedFound = {
      spheres: fit.stats.spheres, cylinders: fit.stats.cylinders,
      cones: fit.stats.cones, prisms: fit.stats.prisms,
      consumed: fit.stats.consumed, need: Math.max(60, Math.round(colored.length * 0.03)),
      total: colored.length, dbg: fit.stats.dbg,
    };
    if (engaged) {
      curvedPlacements = fit.placements;
      // Essence-knee path (Phase B): DON'T remove the fitter's consumed
      // triangles. An ellipsoid under-covers its own concave cluster (matilda's
      // fitter opened 101 px of holes exactly this way), so removing the
      // triangles it "replaced" tears holes the shell doesn't fill. Instead keep
      // every triangle and let the HOLE-SAFE knee (finishPlacements) drop only
      // the ones provably CONTAINED inside a retained volumetric primitive —
      // coverage is then guaranteed, budget still drops where the shell truly
      // covers. Non-knee paths keep the classic consume-and-remove behavior.
      // FACE-PROVENANCE REPLACEMENT (Phase 3 step 3): on the opt-in hyperReplace
      // sphere-mesh path, remove EXACTLY the substrate triangles that retained
      // medial primitives represent (fit.consumedFaces, computed by threading each
      // face's identity through the SQEM collapse). Hole-safe by construction — a
      // face is dropped only if all 3 of its vertices' final spheres are retained,
      // so nothing dropped is uncovered; concavity/thin faces a rejected sphere
      // touched stay in the residual and carry their own silhouette. Replaces the
      // geometric containedByVol coverage test (which could not localize concavity
      // misses and opened 86/65 px holes).
      if (doReplace && fit.consumedFaces) {
        // SHEET FITTER (planar-region slabs, opt-in hyperSheet): run on the
        // sphere-mesh RESIDUAL — the cloth panels the medial mesh cannot abstract
        // (sheets have no 1-D medial axis). Its consumed faces union into the
        // provenance set; its inscribed slabs join curvedPlacements. Each region =
        // one slab, so a garment's few thousand near-planar faces collapse to a
        // few hundred decorations (round 11+ sheet-fitter build).
        let consumedSet = fit.consumedFaces;
        if (params.hyperSheet) {
          const residTris = [], residMap = [];
          for (let i = 0; i < colored.length; i++) if (!fit.consumedFaces.has(i)) { residTris.push(colored[i]); residMap.push(i); }
          const sf = sheetFit(residTris, {
            planarAngleDeg: params.sheetPlanarAngle ?? 20,
            minRegionFaces: params.sheetMinFaces ?? 6,
            inscribe: params.sheetInscribe ?? 0.95,
            inscribeMin: params.sheetInscribeMin ?? 0.3,
            thinFrac: params.sheetThinFrac ?? 0.35,
            thickCover: params.sheetThickCover ?? 0.15,
            reachTol: params.sheetReachTol ?? 0.010,
            colorTol: params.sheetColorTol,
            selfCheck: params.sheetSelfCheck !== false,
            protrudeTolFrac: params.sheetProtrudeTolFrac ?? 0.012,
            minConsume: params.sheetMinConsume,
            strips: params.sheetStrips !== false,
            stripWidthFrac: params.sheetStripWidthFrac ?? 0.05,
            stripLenFrac: params.sheetStripLenFrac ?? 0.12,
            minStripFaces: params.sheetMinStripFaces ?? 3,
            sourceTris: colored,   // full model for the protrusion self-check
          });
          consumedSet = new Set(fit.consumedFaces);
          for (const li of sf.consumedFaces) consumedSet.add(residMap[li]);
          curvedPlacements = [...curvedPlacements, ...sf.placements];
          stats.sheet = sf.stats;
          stats.sheetSlabs = sf.placements.length;
        }
        if (consumedSet.size) {
          const residualIdx = [];
          for (let i = 0; i < colored.length; i++) if (!consumedSet.has(i)) residualIdx.push(i);
          // THIN-FEATURE PROTECTION (§3.4, opt-in): split thin extremities out of
          // the normal residual pipeline (bypass merge/pair/emit-snap distortion,
          // flag _protect so the over-cap drop never evicts them).
          if (params.hyperThinProtect) {
            const thin = detectThinFaces(colored, { minBoundaryEdges: params.thinBoundaryEdges ?? 2 });
            let protIdx = residualIdx.filter((i) => thin.has(i));
            const reserve = params.thinProtectReserve ?? 600;
            if (protIdx.length > reserve) {
              protIdx.sort((a, b) => triLongestEdge(colored[a]) - triLongestEdge(colored[b]));
              protIdx = protIdx.slice(0, reserve);
            }
            const protSet = new Set(protIdx);
            protectedTris = protIdx.map((i) => colored[i]);
            work = residualIdx.filter((i) => !protSet.has(i)).map((i) => colored[i]);
            stats.thinProtected = protectedTris.length;
            stats.thinDetected = thin.size;
          } else {
            work = residualIdx.map((i) => colored[i]);
          }
          stats.replaceConsumed = consumedSet.size;
          stats.replaceResidual = work.length;
        } else {
          work = params._essenceKnee ? colored : fit.residual;
        }
        if (fit.stats.replaceForensics) stats.replaceForensics = fit.stats.replaceForensics;
      } else {
        work = params._essenceKnee ? colored : fit.residual;
      }
      if (params._essenceKnee) params._volPrims = curvedPlacements;
      stats.curvedSpheres = fit.stats.spheres;
      stats.curvedCylinders = fit.stats.cylinders ?? fit.stats.capsules;
      stats.curvedCones = fit.stats.cones;
      stats.curvedPrisms = fit.stats.prisms;
      stats.curvedSlabs = fit.stats.slabs;
      stats.curvedConsumed = fit.stats.consumed;
      stats.curvedDbg = fit.stats.dbg;
    }
  }

  // 5. + 6. merge & primitives
  const canonical = { ...DEFAULT_CANONICAL, thinScale: params.thinScale };
  const mergeOpts = {
    colorTolerance: params.colorTolerance,
    planarAngleDeg: params.planarAngleDeg,
    weldEps: params.weldEps,
  };
  const pairOpts = {
    snapDeg: params.snapDeg,
    colorTolerance: params.colorTolerance,
    weldEps: params.weldEps,
    planarAngleDeg: params.planarAngleDeg,
  };
  const doMerge = (tris) =>
    (params.merge && tris.length > 1) ? mergeCoplanarTriangles(tris, mergeOpts) : tris;
  // Emit-snap (hyper expansion reduction): a wider right-angle tolerance for the
  // FINAL triangle emission than for pairing detection. Non-right organic
  // triangles that will never pair are emitted as one snapped right-triangle
  // instead of two exact halves.
  const emitSnap = params.mode === 'hyper'
    ? (params.hyperEmitSnapDeg ?? params.snapDeg) : params.snapDeg;

  let placements = [...curvedPlacements];
  let leftovers;

  const workColored = work;
  // marching-cubes output pairs into squares + right triangles
  const effectiveMode = params.mode === 'voxel' ? 'both' : params.primitiveMode;

  if (effectiveMode === 'squares' || effectiveMode === 'both') {
    // pass 1: pair rectangles in the raw colored soup FIRST — texel grids
    // from subdivision pair exactly, before merging distorts them
    const p0 = pairIntoSquares(workColored, pairOpts);
    const squares = [...p0.squares];
    // pass 2: merge the unpaired remainder, then pair again
    const mergedRest = doMerge(p0.rest);
    const p1 = pairIntoSquares(mergedRest, pairOpts);
    squares.push(...p1.squares);
    // pass 3: decompose whatever is left into right triangles and pair once
    // more — decomposition often recreates the two halves of a quad
    const rightTris = [];
    for (const t of p1.rest) {
      const pls = decomposeTriangle(t.p[0], t.p[1], t.p[2], { snapDeg: emitSnap, canonical });
      for (const pl of pls) {
        const A = pl.position;
        const B = add(A, mul(v3(pl.rotation[0][1], pl.rotation[1][1], pl.rotation[2][1]), pl.scale.y));
        const C = add(A, mul(v3(pl.rotation[0][2], pl.rotation[1][2], pl.rotation[2][2]), pl.scale.z));
        rightTris.push({ p: [A, B, C], color: t.color });
      }
    }
    const p2 = pairIntoSquares(rightTris, pairOpts);
    squares.push(...p2.squares);
    leftovers = p2.rest;
    // pass 4: greedy-coalesce equal-size aligned squares into maximal
    // rectangles (voxel/texel grids collapse dramatically)
    placements = [...placements, ...coalesceSquares(squares)];
    stats.afterMerge = placements.length + leftovers.length;
  } else {
    const merged = doMerge(workColored);
    stats.afterMerge = merged.length + placements.length;
    leftovers = merged;
  }

  for (const t of leftovers) {
    const pls = decomposeTriangle(t.p[0], t.p[1], t.p[2], { snapDeg: emitSnap, canonical });
    for (const pl of pls) {
      pl.color = t.color;
      if (params.primitiveMode === 'squares') {
        // squares-only: cover each right triangle with a square spanning its
        // legs (overdraws the mirror half — intended for voxel-style models
        // where leftovers are rare)
        const A = pl.position;
        const B = add(A, mul(v3(pl.rotation[0][1], pl.rotation[1][1], pl.rotation[2][1]), pl.scale.y));
        const C = add(A, mul(v3(pl.rotation[0][2], pl.rotation[1][2], pl.rotation[2][2]), pl.scale.z));
        const n = cross(sub(B, A), sub(C, A));
        const sq = squarePlacement(A, B, C, n);
        if (sq) {
          sq.color = t.color;
          sq.area = sq.scale.x * sq.scale.z;
          placements.push(sq);
          stats.squareApprox++;
          continue;
        }
      }
      pl.kind = 'triangle';
      pl.area = pl.scale.y * pl.scale.z / 2;
      placements.push(pl);
    }
  }

  // THIN-FEATURE PROTECTED EMISSION (§3.4): the split-off thin faces, emitted as
  // triangles with plain snapDeg (never emit-snap -> no hypotenuse distortion) and
  // flagged _protect so the over-cap drop keeps them regardless of extent.
  for (const t of protectedTris) {
    const pls = decomposeTriangle(t.p[0], t.p[1], t.p[2], { snapDeg: params.snapDeg, canonical });
    for (const pl of pls) {
      pl.color = t.color;
      pl.kind = 'triangle';
      pl.area = pl.scale.y * pl.scale.z / 2;
      pl._protect = true;
      placements.push(pl);
    }
  }

  return finishPlacements(placements, params, stats);
}

// ---------- shared tail: scale cap -> budget -> stats -> decorations ----------

// Bounds for stats only — placements are never repositioned, so the model
// origin the user set up in the editor is preserved exactly.
function measurePlacements(placements, stats) {
  if (!placements.length) return;
  let minX = 1/0, minY = 1/0, minZ = 1/0, maxX = -1/0, maxY = -1/0, maxZ = -1/0;
  for (const p of placements) {
    const R = p.rotation;
    const h = [p.scale.x / 2, p.scale.y / 2, p.scale.z / 2];
    const ext = [0, 1, 2].map((i) =>
      Math.abs(R[i][0]) * h[0] + Math.abs(R[i][1]) * h[1] + Math.abs(R[i][2]) * h[2]);
    minX = Math.min(minX, p.position.x - ext[0]); maxX = Math.max(maxX, p.position.x + ext[0]);
    minY = Math.min(minY, p.position.y - ext[1]); maxY = Math.max(maxY, p.position.y + ext[1]);
    minZ = Math.min(minZ, p.position.z - ext[2]); maxZ = Math.max(maxZ, p.position.z + ext[2]);
  }
  stats.bounds = {
    x: round6(maxX - minX), y: round6(maxY - minY), z: round6(maxZ - minZ),
  };
}

function finishPlacements(placements, params, stats) {
  // no decoration may exceed zoom 50 on any axis: split oversized pieces
  const before = placements.length;
  placements = capPlacements(placements);
  if (placements.length !== before) stats.capSplit = placements.length - before;

  // consistent surface-area estimate for every placement (drop ordering and
  // budget decisions must never compare undefined areas)
  const areaOf = (p) => {
    switch (p.kind) {
      case 'square':
      case 'plane':
        return Math.max(
          p.scale.x * p.scale.z,
          p.scale.x * (p.fullY ? p.scale.y : 0),
          (p.fullY ? p.scale.y : 0) * p.scale.z,
        );
      case 'sphere': case 'cylinder': case 'cone': case 'prism':
        return Math.max(p.scale.x * p.scale.y, p.scale.x * p.scale.z, p.scale.y * p.scale.z);
      default:
        return p.scale.y * p.scale.z / 2; // triangle legs
    }
  };
  for (const p of placements) p.area = areaOf(p);

  // Silhouette-extent proxy: the placement's longest linear dimension. A thin
  // membrane sliver (e.g. stormterror's wing webs) has tiny AREA but LARGE
  // extent — it is long and hairline-thin — so area-first drop ordering threw
  // exactly the silhouette-defining thin features away while keeping compact
  // interior bulk fragments. Extent-first keeps long/thin features and drops
  // small compact bulk first. (Hyper-only; direct/voxel/pixel keep area order
  // so their byte-exact output is unchanged.)
  const extentOf = (p) => {
    switch (p.kind) {
      case 'square':
      case 'plane':
        return Math.max(p.scale.x, p.scale.z, p.fullY ? p.scale.y : 0);
      case 'sphere': case 'cylinder': case 'cone': case 'prism':
        return Math.max(p.scale.x, p.scale.y, p.scale.z);
      default:
        return Math.max(p.scale.y, p.scale.z); // triangle legs
    }
  };

  // Phase B HOLE-SAFE KNEE + nested-LOD ordering (essence path only).
  //
  // A triangle-tiled surface has NO redundant triangles — dropping any one opens
  // a hole (verified: a naive extent-knee opened shiba 5->42, matilda 6->21 px
  // with the fitter OFF). The only decorations we can drop without tearing the
  // silhouette are those a retained VOLUMETRIC primitive already covers from the
  // inside. So the knee drops a triangle/square iff it is fully CONTAINED (its
  // longest half-dimension inside) a fitted ellipsoid / cylinder / cone / prism.
  // Coverage is then guaranteed by that shell; budget drops exactly where the
  // fitter genuinely over-covers, and where it doesn't the surface stays intact.
  // LOD ordering (biggest-extent first) is free (no drops) and front-loads every
  // atK prefix — this alone lifted e999 (matilda 0.10->0.78).
  const VOL_KINDS = { sphere: 1, cylinder: 1, cone: 1, prism: 1 };
  const isVol = (p) => VOL_KINDS[p.kind] || p._slab;   // SQEM slabs cover too
  if (params._essenceKnee && params.mode === 'hyper' && placements.length) {
    const volPrims = placements.filter(isVol);
    const containedByVol = (p) => {
      const hs = extentOf(p) * 0.5;                 // conservative inward margin
      const cx = p.position.x, cy = p.position.y, cz = p.position.z;
      for (const vp of volPrims) {
        const R = vp.rotation;                       // columns = primitive local axes
        const dx = cx - vp.position.x, dy = cy - vp.position.y, dz = cz - vp.position.z;
        const lx = R[0][0] * dx + R[1][0] * dy + R[2][0] * dz;
        const ly = R[0][1] * dx + R[1][1] * dy + R[2][1] * dz;
        const lz = R[0][2] * dx + R[1][2] * dy + R[2][2] * dz;
        const rx = vp.scale.x * 0.5, ry = vp.scale.y * 0.5, rz = vp.scale.z * 0.5;
        const radial = Math.hypot(lx, lz), hh = ry - hs;    // local Y = axis for all
        if (vp._slab) {
          if (Math.abs(lx) <= rx - hs && Math.abs(ly) <= ry - hs && Math.abs(lz) <= rz - hs) return true;
        } else if (vp.kind === 'sphere') {
          const ax = rx - hs, ay = ry - hs, az = rz - hs;
          if (ax > 0 && ay > 0 && az > 0 &&
            (lx / ax) ** 2 + (ly / ay) ** 2 + (lz / az) ** 2 <= 1) return true;
        } else if (vp.kind === 'cone') {
          if (hh > 0 && Math.abs(ly) <= hh) {
            const rAt = rx * (ry - ly) / (2 * ry);          // cone radius at this height
            if (radial <= rAt - hs) return true;
          }
        } else if (vp.kind === 'prism') {
          const rr = rx / Math.sqrt(3) - hs;
          if (rr > 0 && hh > 0 && radial <= rr && Math.abs(ly) <= hh) return true;
        } else {
          // cylinder: local y = axis (scale.y = height), x/z = cross radius
          const rr = Math.min(rx, rz) - hs;
          if (rr > 0 && hh > 0 && radial <= rr && Math.abs(ly) <= hh) return true;
        }
      }
      return false;
    };
    if (volPrims.length) {
      const kept = placements.filter((p) => isVol(p) || !containedByVol(p));
      stats.kneeDropped = placements.length - kept.length;
      if (kept.length) placements = kept;
    }
    // nested-LOD acquisition order: biggest shapes first (free — no drops)
    for (const p of placements) p._sil = extentOf(p);
    placements.sort((a, b) => (b._sil ?? 0) - (a._sil ?? 0));
  }

  // over budget? merge adjacent same-plane squares with progressively more
  // generous color tolerance before resorting to dropping anything
  if (placements.length > params.maxDecorations) {
    let mergeTol = 12;
    while (placements.length > params.maxDecorations && mergeTol <= 100) {
      const sq = placements.filter((p) => p.kind === 'square');
      if (sq.length < 2) break;
      const rest = placements.filter((p) => p.kind !== 'square');
      const merged = coalesceSquares(sq, { colorTolerance: mergeTol });
      if (merged.length < sq.length) {
        stats.budgetMerged = (stats.budgetMerged ?? 0) + (sq.length - merged.length);
        placements = [...merged, ...rest];
        for (const p of placements) if (p.area == null) p.area = areaOf(p);
      }
      mergeTol *= 2;
    }
  }

  if (placements.length > params.maxDecorations) {
    if (params.mode === 'hyper') {
      for (const p of placements) p._sil = extentOf(p);
      // _protect (thin-feature §3.4) sorts first — never evicted regardless of
      // extent; the drop falls on the extent-smallest UNprotected placements.
      placements.sort((a, b) => {
        if (!!a._protect !== !!b._protect) return a._protect ? -1 : 1;
        return (b._sil ?? 0) - (a._sil ?? 0);
      });
    } else {
      placements.sort((a, b) => (b.area ?? 0) - (a.area ?? 0));
    }
    stats.dropped = placements.length - params.maxDecorations;
    placements = placements.slice(0, params.maxDecorations);
  }
  stats.placements = placements.length;
  const byKind = {};
  for (const p of placements) {
    const k = p.kind ?? 'triangle';
    byKind[k] = (byKind[k] ?? 0) + 1;
  }
  stats.byKind = byKind;
  stats.squares = byKind.square ?? 0;
  stats.triangles = byKind.triangle ?? 0;
  if (!stats.uniqueColors) {
    stats.uniqueColors = new Set(placements.map((p) => colorToRgbInt(p.color))).size;
  }
  // PER-EDGE INFLATION SELF-CHECK (round 7, opt-in hyperPerEdgeInflate): replace the
  // blanket fragmented-thin tier with a PER-PLACEMENT amount — the max inflation whose
  // inflated silhouette tips stay within tol of the SOURCE surface. Interior placements
  // inflate fully (close QEM-erosion seams -> holes stay closed); outer-silhouette
  // placements can't grow past the boundary (inflated tip goes off-surface) so they get
  // ~0 (no ballooning -> protrusion drops). Runs after cap-split so children are covered.
  if (params.hyperPerEdgeInflate && params.mode === 'hyper' && params._perEdgeSource && params._perEdgeSource.length) {
    const nearest = makeNearestTriDist(params._perEdgeSource);
    const diag = bboxDiagOf(params._perEdgeSource);
    const infMax = params.hyperInflateM ?? HYPER_INFLATE_M;
    const tol = diag * (params.perEdgeInflTolFrac ?? 0.006);
    let full = 0, zero = 0, partial = 0;
    for (const pl of placements) {
      if (pl._slab) continue;                       // slabs keep the crisp floor
      const d = maxSafeInflation(pl, nearest, infMax, tol);
      pl._inflM = d;
      if (d >= infMax - 1e-9) full++; else if (d <= 1e-9) zero++; else partial++;
    }
    stats.perEdgeInfl = { full, zero, partial, infMax, tol: +tol.toFixed(4) };
  }
  const decorations = placements.map((pl) => placementToDecoration(pl, params));
  return { placements, decorations, stats, params };
}

// Largest inflation d in [0, infMax] whose inflated silhouette tips stay within tol
// of the source surface (nearest = point-to-triangle distance to the source mesh).
// Triangle: legs on local +Y/+Z grow by d, so tips B(d),C(d) move outward. Square:
// the 4 corners move outward by d/2 per axis. Binary search (6 iters).
function maxSafeInflation(pl, nearest, infMax, tol) {
  const R = pl.rotation, P = pl.position;
  const kind = pl.kind ?? 'triangle';
  const tipsAt = (d) => {
    const pts = [];
    if (kind === 'triangle') {
      const ly = pl.scale.y + d, lz = pl.scale.z + d;
      pts.push([P.x + R[0][1]*ly, P.y + R[1][1]*ly, P.z + R[2][1]*ly]);
      pts.push([P.x + R[0][2]*lz, P.y + R[1][2]*lz, P.z + R[2][2]*lz]);
    } else if (kind === 'square') {
      const hx = (pl.scale.x + d) / 2, hz = (pl.scale.z + d) / 2;
      for (const sx of [-1, 1]) for (const sz of [-1, 1])
        pts.push([P.x + R[0][0]*hx*sx + R[0][2]*hz*sz, P.y + R[1][0]*hx*sx + R[1][2]*hz*sz, P.z + R[2][0]*hx*sx + R[2][2]*hz*sz]);
    } else return null;
    return pts;
  };
  const ok = (d) => { const pts = tipsAt(d); if (!pts) return true; for (const q of pts) if (nearest(q[0], q[1], q[2]) > tol) return false; return true; };
  if (ok(infMax)) return infMax;
  if (!ok(0)) return 0;
  let lo = 0, hi = infMax;
  for (let it = 0; it < 6; it++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
  return lo;
}

// ---------- sprite -> box decorations ----------
// The square decoration is a unit cube (0.1 m per axis at scale 1), so each
// maximal same-color pixel rectangle becomes ONE elongated box covering the
// front face, back face, and edges.
function convertSpriteBoxes(sprite, params, stats, ctx) {
  const { boxes, pixels } = spriteToBoxes(sprite.texture, {
    pixelSize: sprite.pixelSize,
    thickness: sprite.thickness,
    alphaCutoff: params.alphaCutoff,
  });
  stats.sourceTriangles = pixels;
  stats.spritePixels = pixels;

  const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let R = ctx.userR ?? I;
  // decoration space mirrors X (game convention), plus optional Z mirror:
  // conjugate the user rotation by M = diag(-1, 1, ±1)
  const zs = params.flipZ ? -1 : 1;
  const sgn = [-1, 1, zs];
  R = R.map((row, i) => row.map((v, j) => v * sgn[i] * sgn[j]));

  const s = ctx.userS ?? 1;
  let placements = boxes.map((b) => {
    let c = ctx.userXform(b.center);
    c = v3(-c.x, c.y, c.z * zs);
    return {
      kind: 'square',
      fullY: true,
      position: c,
      rotation: R,
      scale: v3(b.size.x * s, b.size.y * s, b.size.z * s),
      color: b.color,
      area: s * s * Math.max(b.size.x * b.size.y, b.size.x * b.size.z, b.size.y * b.size.z),
    };
  });
  stats.afterDecimation = placements.length;
  stats.afterSubdivision = placements.length;
  stats.afterMerge = placements.length;

  measurePlacements(placements, stats);

  return finishPlacements(placements, params, stats);
}
