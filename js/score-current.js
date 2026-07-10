// In-app "Score current model" action (js/ui-shell.js Result panel).
//
// Runs the same 26-view silhouette-IoU + 6-face ΔE2000 pass the standalone
// test harness uses (test/metrics.js + test/views26.js — see
// docs/decoration-reduction-plan.md, "Phase 1.5 — Similarity test suite"),
// plus the Phase 2 essence metric suite (2A: MSSA/LFCF/PPC/EssenceScore) and
// an object-space efficiency histogram, against whatever is currently loaded
// and converted. This is how the three reference models too large for
// test/similarity-harness.html (amber, higokumaru, stylized_emerald_sword —
// over the 10 MB harness limit) still get scored: manually, in-app, one at a
// time.
import * as THREE from "three";
import {
  silhouetteIoU, meanDeltaE, faithScore, interiorMisses,
  HOLE_EROSION_RADIUS, HOLE_REGION_THRESHOLD_PX,
  exteriorExcess, PROTRUSION_DILATION_RADIUS, PROTRUSION_REGION_THRESHOLD_PX,
  jaggednessRatio, JAGGEDNESS_FAIL_THRESHOLD,
  multiScaleSilhouette, coarseLabField, partProportionAgreement, essenceScore,
  shapeHistogram, areaPercentiles, decorationSize,
} from "../test/metrics.js";
import {
  VIEW_DIRS, FACE_VIEW_INDEXES, buildOrthoCamera, renderToPixels,
  maskFromSilhouette, unionBox,
} from "../test/views26.js";

const RENDER_SIZE = 512;
const WHITE_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });

// viewer: the app's live Viewer (js/viewer.js) — rendered as-is (its own
// renderer, its own lights, the model's live user transform), with the
// helper grid/axes/overlay/selection temporarily hidden so they don't
// pollute the silhouette. reconPositions/reconColors: the active
// reconstruction's buildPreview() output (js/preview-mesh.js) — already in
// the same display space the viewer's own overlay uses, so no re-alignment
// is needed. reconDecorations: the same reconstruction's decoration records
// (lastResult.decorations in js/app.js) — used only for the efficiency
// histogram below, no rendering involved.
export function scoreCurrentModel(viewer, { reconPositions, reconColors, reconDecorations }) {
  const { renderer, scene, modelGroup } = viewer;

  const reconGeo = new THREE.BufferGeometry();
  reconGeo.setAttribute("position", new THREE.BufferAttribute(reconPositions, 3));
  reconGeo.setAttribute("color", new THREE.BufferAttribute(reconColors, 3));
  const reconMesh = new THREE.Mesh(
    reconGeo,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  );
  const reconScene = new THREE.Scene();
  reconScene.background = new THREE.Color(0);
  reconScene.add(reconMesh);

  const boxSrc = new THREE.Box3().setFromObject(modelGroup);
  const boxRecon = new THREE.Box3().setFromBufferAttribute(reconGeo.attributes.position);
  const box = unionBox(boxSrc, boxRecon);

  // Borrow the live scene for the source pass — hide everything except the
  // model itself so the grid/axes/overlay/selection helpers don't leak into
  // the silhouette or the union bounding box.
  const hidden = [viewer.grid, viewer.axes, viewer.ref1m, viewer.overlayGroup, viewer.selGroup];
  const prevVisible = hidden.map((o) => o.visible);
  for (const o of hidden) o.visible = false;
  const prevModelVisible = modelGroup.visible;
  modelGroup.visible = true;

  let iouSum = 0, minIoU = Infinity;
  const faceDEs = [];
  // Hole gate (docs/decoration-reduction-plan.md "Hole gate") — reuses the
  // silhouette masks computed for IoU below, same as the standalone harness
  // (test/similarity-harness.html); tracks the single worst view across all
  // 26 so the gate can key off the largest interior-miss region seen.
  let worstHolesRegion = -1, worstHolesView = -1, worstHolesTotal = 0;
  // Protrusion gate (Phase 3 metric hardening, docs/decoration-reduction-
  // plan.md § 8) — exact mirror of the hole gate above, same standalone-
  // harness regime (test/similarity-harness.html).
  let worstProtRegion = -1, worstProtView = -1, worstProtTotal = 0;
  // Jaggedness gate (Phase 3 metric hardening) — mean + worst-view
  // roughness ratio across all 26 views.
  let jagSum = 0, worstJag = -Infinity, worstJagView = -1;
  // Phase 2 essence accumulators (2A) — same regime as the standalone
  // harness: MSSA/PPC over all 26 views, LFCF over the 6 face views.
  let essenceSilSum = 0, minSil = Infinity, ppcSum = 0, lfcfSum = 0;

  try {
    for (let i = 0; i < VIEW_DIRS.length; i++) {
      const dir = VIEW_DIRS[i];
      const cam = buildOrthoCamera(dir, box, 1);

      scene.overrideMaterial = WHITE_MAT;
      reconScene.overrideMaterial = WHITE_MAT;
      const maskA = maskFromSilhouette(renderToPixels(renderer, scene, cam, RENDER_SIZE));
      const maskB = maskFromSilhouette(renderToPixels(renderer, reconScene, cam, RENDER_SIZE));
      const iou = silhouetteIoU(maskA, maskB);
      iouSum += iou;
      if (iou < minIoU) minIoU = iou;

      const holes = interiorMisses(maskA, maskB, RENDER_SIZE, RENDER_SIZE, HOLE_EROSION_RADIUS);
      if (holes.largestRegion > worstHolesRegion) {
        worstHolesRegion = holes.largestRegion;
        worstHolesView = i;
        worstHolesTotal = holes.totalPixels;
      }

      const prot = exteriorExcess(maskB, maskA, RENDER_SIZE, RENDER_SIZE, PROTRUSION_DILATION_RADIUS);
      if (prot.largestRegion > worstProtRegion) {
        worstProtRegion = prot.largestRegion;
        worstProtView = i;
        worstProtTotal = prot.totalPixels;
      }

      const jag = jaggednessRatio(maskA, maskB, RENDER_SIZE, RENDER_SIZE);
      jagSum += jag;
      if (jag > worstJag) {
        worstJag = jag;
        worstJagView = i;
      }

      const sil = multiScaleSilhouette(maskA, maskB, RENDER_SIZE, RENDER_SIZE);
      essenceSilSum += sil;
      if (sil < minSil) minSil = sil;
      ppcSum += partProportionAgreement(maskA, maskB, RENDER_SIZE, RENDER_SIZE);

      if (FACE_VIEW_INDEXES.includes(i)) {
        scene.overrideMaterial = null;
        reconScene.overrideMaterial = null;
        // srgb:true: offscreen render targets read back raw linear values —
        // encode to display sRGB before feeding the Lab-based ΔE (see
        // test/views26.js renderToPixels for the full explanation).
        const colA = renderToPixels(renderer, scene, cam, RENDER_SIZE, { srgb: true });
        const colB = renderToPixels(renderer, reconScene, cam, RENDER_SIZE, { srgb: true });
        const intersection = new Uint8Array(maskA.length);
        for (let p = 0; p < intersection.length; p++) intersection[p] = maskA[p] && maskB[p] ? 1 : 0;
        faceDEs.push(meanDeltaE(colA, colB, intersection));
        lfcfSum += coarseLabField(colA, colB, maskA, maskB, RENDER_SIZE, RENDER_SIZE, 32);
      }
    }
  } finally {
    scene.overrideMaterial = null;
    hidden.forEach((o, idx) => { o.visible = prevVisible[idx]; });
    modelGroup.visible = prevModelVisible;
    reconGeo.dispose();
    reconMesh.material.dispose();
  }

  const meanIoU = iouSum / VIEW_DIRS.length;
  const meanDE = faceDEs.reduce((a, b) => a + b, 0) / faceDEs.length;
  const essenceSil = essenceSilSum / VIEW_DIRS.length;
  const ppc = ppcSum / VIEW_DIRS.length;
  const lfcf = lfcfSum / faceDEs.length;
  const meanJaggedness = jagSum / VIEW_DIRS.length;

  // Efficiency (2A "efficiency via object-space decorationSize histogram" —
  // the in-app parity path skips the 26-view GPU ID render the standalone
  // harness uses (test/views26.js renderOwnerAreas): reconDecorations is
  // already in hand with no extra rendering, so triangleShare/volumetricShare
  // and size percentiles come from each decoration's OBJECT-SPACE size
  // (decorationSize: a volume for volumetric kinds, an area for the flat
  // residual triangle) instead of its screen-space visible pixel footprint.
  // wasteShare/coverage@N/bottomHalfArea are intentionally NOT reproduced
  // here: their thresholds/definitions are calibrated against screen-space
  // pixel counts (see test/similarity-harness.html), which don't translate
  // to object-space volume/area units without a re-calibration this in-app
  // parity path does not attempt.
  //
  // Efficiency gate scheme (2026-07-09, docs/decoration-reduction-plan.md
  // "User decision: RECALIBRATE NOW + PHASE C LATER"): the standalone harness
  // demoted triShare/cov@50/waste to informative-only and made e@999/
  // frontLoad the only efficiency GATES. This in-app path was already
  // display-parity-consistent with that outcome before the change landed —
  // triangleShare below has never been gated here (no PASS/FAIL styling in
  // js/app.js's renderStats for it, unlike holesPass), and e@999/frontLoad
  // were never computed in-app at all (they need the quality-vs-count
  // prefix-render curve, which this lightweight parity path doesn't run).
  // Nothing to change here; noted for anyone diffing the two paths.
  const decorations = reconDecorations ?? [];
  const shapeHist = shapeHistogram(decorations);
  const sizePercentiles = areaPercentiles(decorations.map((d) => decorationSize(d.kind, d.scale)));

  return {
    faithScore: faithScore(meanIoU, meanDE), // legacy headline, reported only
    meanIoU,
    minIoU,
    meanDeltaE: meanDE,
    holes: { worstRegionPx: worstHolesRegion, worstView: worstHolesView, totalPx: worstHolesTotal },
    holesPass: worstHolesRegion <= HOLE_REGION_THRESHOLD_PX,
    // Phase 3 metric hardening (docs/decoration-reduction-plan.md § 8) —
    // protrusion is the exact mirror of holes above; jaggedness reports both
    // the worst-view ratio (what the HARD gate keys off, same "one bad view
    // fails" convention as holes/protrusion) and the mean.
    protrusion: { worstRegionPx: worstProtRegion, worstView: worstProtView, totalPx: worstProtTotal },
    protrusionPass: worstProtRegion <= PROTRUSION_REGION_THRESHOLD_PX,
    jaggedness: { worst: worstJag, mean: meanJaggedness, worstView: worstJagView },
    jaggednessPass: worstJag <= JAGGEDNESS_FAIL_THRESHOLD,
    essence: {
      score: essenceScore(essenceSil, lfcf, ppc),
      sil: essenceSil,
      minSil,
      lfcf,
      ppc,
    },
    efficiency: {
      triangleShare: shapeHist.triangleShare,
      volumetricShare: shapeHist.volumetricShare,
      sizePercentiles,
    },
  };
}
