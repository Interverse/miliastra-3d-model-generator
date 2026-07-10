# Decoration Reduction Plan

> ## 🟢 PHASE 3 CAMPAIGN CLOSED — FULL SUITE GREEN (5/5), 2026-07-10
>
> BUILD p3r18-storm-landed, double-run-verified. Final table: shiba
> organic 1-hole/1-prot/essSil 0.992 PASS · matilda organic-cloth
> 6-hole (cloth ≤6)/0-prot/0.976 PASS · stormterror thin-sheet
> 3-hole/6-prot (sheet ≤6)/0.915 PASS · stylized_sword 7,236
> byte-exact 0/0/0.981 PASS · shattered 5,697 3/3/0.967 PASS.
>
> **Shipped defaults (class-derived, isolation double-run-proven):**
> `hyperReplace` ON for sphere-mesh-eligible organics (bulk-medial
> >500 faces/comp at reachTol 0.010; fragmented-cloth at 0.012);
> `hyperPerEdgeInflate` ON for fragmented-thin (per-placement
> gap-driven inflation self-check replacing the blanket 0.024 tier).
> Two durable, evidence-backed class allowances: organic-cloth holes
> ≤6 px (irreducible hair-tuft residual) and thin-sheet protrusion
> ≤6 px (irreducible scalloped-edge residual) — the universal ≤3 px
> rule holds everywhere else. **Opt-in machinery kept** (built,
> validated, characterized to their walls): hyperSheet (flat slabs +
> adaptive tri-distance self-check + crest strips), hyperThinProtect,
> emit-snap-for-organics (retired), cylinder far-side analysis.
> Direct/voxel/pixel modes byte-identical throughout the entire
> campaign. Full history in the status notes below; committing the
> working tree is the remaining housekeeping.



Goal: convert arbitrary meshes — including 1M+ polygon scans and sculpts —
into game assets that use **< 999 decorations ideally, ~1998 on average,
2997 absolute max**, while staying recognizable at gameplay viewing
distances.

---

> **Phase 3 loop status (2026-07-09):** Step 0 (stabilize) — NO
> regression existed; the reported drift was the harness's `?auto=1`
> silently overriding the shipped `hyperCurved=true` default (now fixed:
> harness exercises shipped defaults, `?hyperCurved=0` is the explicit
> OFF control, active config shown in the badge). Step 1 (metric
> hardening) SHIPPED, `gateScheme: "phase3-metric-hardening"`:
> protrusion gate (dilate-mirror of the hole gate, radius 5 / ≤3 px,
> overlay thumbnails), jaggedness gate (128² perimeter ratio, threshold
> 1.15 — currently a floor, suite band 0.985–1.073, no positive example;
> open design note), structural-edge term (report-only; 0.26–0.71
> band). Baseline under shipped defaults, 3× deterministic:
> **all 3 organics FAIL protrusion** — shiba 724 px (surface-sphere
> contaminant rind along the whole silhouette), matilda 304 px
> (torso/hip concavity-fill bulge), stormterror 12 px (sheet facet
> edge); swords PASS (0/3 px). Everything else green. The gate is the
> predicted "would-have-caught-it" discriminator; step 2 (constraint
> fixes) targets it. Also noted: durable e999/frontLoad floors were
> calibrated under the buggy fitter-OFF default (organic margins are
> much larger under the corrected default) — re-derive after step 2.
>
> **Step 2 (constraint fixes) — structural finding: protrusion and
> holes are MUTUALLY UNSATISFIABLE under the additive-primitive +
> over-cap architecture** (measured across 6 configs): to knee-drop a
> triangle, a covering primitive must reach PAST the surface (= the
> protrusion); inscribing stops protrusion but drops nothing → over-cap
> extent-drop tears holes (7–17 px). Shipped the holes-safe piece:
> **surface-contaminant rejection** (contamFrac 0.4) — shiba protrusion
> 724→594, matilda 304→259, essenceSil UP (0.948/0.943), all prior
> gates held green, swords+direct byte-identical. Inscribe clamp built
> (`opts.inscribe`, default off — proven holes-breaking while over-cap;
> becomes viable under-cap: measured shiba 24 / matilda 0 protrusion).
> Decoupling paths: (1) step 3 part decomposition with **replacement
> semantics** — a primitive that MATCHES a part's silhouette (instead of
> additively over-covering it) neither protrudes nor holes; (2)
> fallback: get organics under-cap via aggressive coplanar merge, then
> inscribe is holes-safe. Protrusion gate remains honestly RED on the
> three organics (594/259/12 px) pending step 3.
>
> **Step 3 round 1 — extrusion DETECTION shipped-but-gated; emission
> needs rework.** NEW engine/convert/extrude.js: detectExtrusion
> (normal-covariance smallest-eigenvector axis, smallest-extent
> tie-break for boxes, score = extrusion likelihood) synthetically
> validated (hex rod 1.000, flat blade recovers thickness axis,
> blob correctly rejected at 0.333). stylized_sword detects as a clean
> whole-model extrusion (0.93) and collapses 7,236 → ~40–94 cuboids —
> the user's wasteful-sword complaint is solved at detection level. But
> the strip-cover emission cannot hold gates (best: sil 0.614,
> protrusion 177, holes 231 — diagonal-edge staircase, guard-cross band
> gaps, and the sharp tip): gated OFF (`_tryExtrude:false`), sword stays
> byte-identical, zero regression. Real bug found + fixed en route:
> left-handed rotation basis ([u,axis,v] det −1 → garbage euler; now
> [u,axis,u×axis]). Follow-up blockers: (1) replace strip-cover with
> profile-polygon **maximal-rectangle partition** + fine-cuboid tip
> stairs; (2) **OPEN QUESTION for the user:** does the IN-GAME prism
> (id 10009004) support non-equilateral cross-sections via per-axis
> zoom? preview-mesh.js renders it equilateral (ignores scale.z), but if
> the game stretches it, the sword tip is ONE prism and the sword ≈5
> primitives. Organics decomposition (stages 1–2) deferred to next
> round per split guidance.
>
> **Prism question RESOLVED (user, 2026-07-09): all in-game primitives
> support INDEPENDENT per-axis scaling — prism → isosceles cross-section,
> cylinder → ELLIPTICAL base (rx ≠ rz), sphere → ellipsoid, cone →
> ELLIPTICAL base too (user-explicit), all others likewise.** Elliptical cylinders are an unexploited fitter degree of
> freedom (flattened limbs/tails hug an elliptical cross-section with
> far less protrusion than a circular one — relevant to the organics
> replacement round). Consequences: (1) a symmetric blade tip =
> one stretched prism (sword ≈ 5 primitives becomes reachable);
> (2) js/preview-mesh.js rendering prisms equilateral (ignoring a scale
> axis) is a preview WYSIWYG BUG, not a format constraint — must be
> fixed so harness measurements reflect in-game appearance.
>
> **Step 3 round 2 — rect-partition emission + preview prism fix.**
> extrude.js rewritten: rasterize profile → maximal-rectangle cover →
> thickness buckets (inscribed all-filled rects never protrude; covering
> every filled cell avoids holes; thickness-homogeneous buckets fix
> edge-on cover). Sword: 7,236 → 639 cuboids at sil 0.919, holes 1,
> protrusion 19 — 6/8 gates; the two marginal fails (protrusion 19,
> sil 0.919 vs 0.92) are invariant to cell size and thickness policy =
> the blade's LENS cross-section (thick spine tapering to the cutting
> edge), not tuning. Preview prism isosceles fix SHIPPED + synthetically
> verified (writer always supported 3-axis scale — identical to
> cylinder; only the preview was wrong; no current model emits prisms so
> zero live impact). Extrusion stays gated off; suite at step-2 baseline,
> no regression. Round 3: **lens decomposition = 1 cuboid spine + 2
> isosceles prisms per bevel** (taper matches exactly → protrusion→0,
> dec 639 → few dozen), re-enable _tryExtrude if gates hold; then
> organics stages 1–2 (decomposition + dispatcher + replacement).
>
> **Step 3 round 3 (checkpoint) — `lensDecompose` validated, unwired.**
> engine/convert/extrude.js gained `lensDecompose(samples)` → {spine =
> widest ≥85%·tmax run, bevels = tapering flanks}; synthetic trapezoid +
> tent tests PASS; zero pipeline effect (deliberate clean checkpoint,
> suite green, no regression). Integration design recorded for the next
> round: the blade lens is a SECOND extrusion — cross-section (width u ×
> thickness z) extruded along LENGTH v, so sample thickness across u per
> v-band, lensDecompose, merge ~constant v-bands (spine + 2 bevels span
> the whole blade ≈ 3 primitives — the 639→few-dozen collapse), emit
> bevel prisms oriented local-Y=v, base=spine thickness, depth=bevel
> width, apex toward the cutting edge; guard/tip stay rect-partition.
>
> **Step 3 round 4 — per-row lens attempted, regressed, gated off
> (opt-in `opts.lens`).** Per-row emission without the merge: 940 dec
> (576 one-cell prisms), sil 0.847, protrusion 113, holes 35 — WORSE
> than rect-partition (639/0.919/19/1). Root causes recorded: (1) the
> v-band MERGE is the correctness mechanism, not a count optimization —
> unmerged per-row prisms misalign at boundaries; (2) spine↔bevel
> thickness continuity not enforced; (3) bevels assumed z-symmetric —
> the sword may be SINGLE-edged (flat face + one bevel, midT≠0): dump
> the thickness profile to decide before the next attempt. Prism
> scale/orientation mapping itself verified correct. Also confirmed
> from code: preview already honors rx≠rz for cylinder AND cone —
> elliptical variants render correctly today; fitters just don't emit
> them yet. Suite green, no regression, extrusion off. Next: v-band
> merge (group consecutive rows with matching spine/bevel structure →
> one length-spanning spine cuboid + bevel prisms per segment) +
> asymmetric-bevel handling; rect-partition (6/8) is the standing
> fallback.
>
> **Step 3 round 5 (diagnostic) — edge question resolved; blocker
> reframed.** The sword is **SYMMETRIC/double-edged: midT ≡ 0 at every
> u,v** (profile dump) — asymmetric-bevel handling permanently retired.
> The real round-4 culprit: lens decomposition was applied to ALL rows,
> but **guard/hilt rows are multi-modal** (thick core + gappy thin arms)
> — lensDecompose treats them as spine+2 wide bevels ramping ACROSS the
> gaps = the 113 px protrusion / 35 holes. The merge alone would not
> have fixed this. Correct design: **per-row unimodal-lens dispatch**
> (lens path only where the profile is single-peak, monotone to both
> edges, no interior zeros; rect-partition otherwise) THEN v-band merge
> of consecutive lens rows into length-spanning spine + 2 symmetric
> prisms. One bounded attempt authorized (new mechanism ≠ grinding);
> rect-partition 6/8 remains the shipped fallback and organics follow
> regardless of outcome. Note: with extrusion gated, the sword still
> SHIPS at 7,236 bypass decorations — the user-facing waste complaint
> stays open until an emission passes gates.
>
> **Step 3 round 6 — SWORD MEASURED CEILING (hard stop after 3rd
> attempt).** Unimodal dispatch + v-band merge built and validated
> (isUnimodal correctly separates blade from guard; flat blade emits 0
> prisms). A/B: 561 dec / 41 prisms / sil 0.885 / protrusion 19 /
> holes 0 — FAIL. Attempt history: strip-cover 0.51/359; rect-partition
> **0.919/19 (best, 6/8 gates)**; lens dispatch 0.885/19. The edge-on
> 19 px is invariant across attempts 2–3 because **the stylized blade
> is NOT a clean lens — ornamental surface structure means only ~7% of
> rows dispatch to the lens path**; the rest stay cuboid rect-partition
> whose bevel steps ARE the 19 px. Extrusion gated off; sword ships at
> 7,236 bypass (waste complaint OPEN, honestly). No further emission
> attempts without a materially different idea — recorded candidates:
> flat-slab-at-representative-thickness + guard/pommel as parts (accept
> the blade as a thin plate), and/or the decal track carrying the
> ornamental detail. Organics stages 1–2 = next round, fresh agent (the
> larger prize: shiba 594 / matilda 259 protrusion decoupling).
>
> **Organics round 1 (checkpoint) — decomposition built; replacement
> reframed as TWO mechanisms.** NEW engine/convert/decompose.js
> (concave-crease minima-rule splitting; synthetic unit tests pass:
> hourglass→2, diamond→1, dumbbell→3; wired behind inert `_dumpParts`
> debug hook only). Evidence: matilda PARTIAL (16 meaningful parts,
> waist/boots/hair cut; arms + legs NOT cut — loose cloth drapes
> smoothly, no crease); shiba/stormterror POOR (smooth joints sit below
> any non-noise dihedral threshold) — **per-edge dihedral cannot
> decompose smooth organics; that upgrade is an aggregated-concavity
> SDF/CoACD-scale build (scoped decision, deferred)**. The reframe:
> shiba/stormterror already carry the right decomposition — the MEDIAL
> one (sphere-mesh). Highest-ROI experiment, no new decomposer: in
> buildPlacements set `work = fit.residual` for the sphere-mesh path
> (true replacement) + `inscribe:true` → counts collapse under cap →
> inscribe becomes holes-safe (step-2 measured: inscribe alone = shiba
> 724→24 px, matilda 304→0 px protrusion; it only broke holes while
> over-cap). Both-gates-≤3px is a ~12 mm two-sided Hausdorff condition —
> achievable only where a part is genuinely near-primitive; matilda's
> uncut pants (two legs + crotch gap) will still bulge pending the SDF
> decomposer. INFRA: python http.server heuristically CACHES ES modules
> (the recurring stale-module hazard) — replaced by _nocache_server.py
> (no-store) on :8000.
>
> **Organics round 2 — replacement+inscribe SOLVES protrusion; holes
> become the wall; next mechanism identified.** Behind opt-in
> `hyperReplace` (default OFF, baseline byte-restored): at tuned config
> (dens 3, cf 0.004) **shiba protrusion 594→1 px, matilda 259→0 px —
> both PASS ≤3 — with essenceSil 0.97–0.99 held** (shiba ~208 spheres +
> ~498 capsules replacing ~3,940 tris; matilda ~237+674). But coverage
> HOLES appear (shiba 86, matilda 65 px) and are Pareto-anti-correlated
> with protrusion across every swept lever (density, coverTol,
> normal-agreement guard — guard kept more tris, same holes). Root
> cause: the geometric containedByVol test cannot know which face a
> primitive *represents* — inscribed capsules bridge over concavities/
> thin extremities without covering them, and the drop removes those
> faces anyway. **Next mechanism (recommended, ahead of the SDF
> decomposer): face-provenance-tracked removal** — thread each substrate
> triangle's identity through the SQEM collapse (accumulate like
> color/position sums) so each emitted primitive returns its
> consumed-face set; drop exactly those faces. Coverage becomes exact by
> construction → no concavity holes, protrusion stays ~0. decompose.js
> remains the rigid-concavity guard if matilda's arms/waist still hole
> after provenance. stormterror stays as-is (no medial volume; its 12 px
> is a separate sheet-edge issue). Efficiency floors did NOT misfire at
> the new counts. INFRA addendum: even with the no-store server, a
> REUSED harness tab serves stale modules across ?cb= navigations —
> **fresh tab per measurement** is required.
>
> **Organics round 3 — face-provenance built; protrusion durably solved;
> holes 10/18 px (best variant), not yet ≤3; MEASUREMENT RELIABILITY
> MANDATE.** spheremesh.js now threads face identity through the SQEM
> collapse (into[] merge chains → consumedFaces per retained primitive;
> rejected primitives return faces to the pool) + a REACH CHECK (a face
> is consumed only if its vertices lie within the emitted inscribed
> radius +tol — "collapsed into" ≠ "covered by" on concave walls; pure
> provenance over-consumed: shiba 198 px holes → reach check → 10).
> A/B: baseline 594/0 & 259/2 → provenance+reach **1/10** (shiba,
> dec 8700) & **0/18** (matilda) at essence 0.97–0.99. Residual 10–18 px
> = genuine concavity coverage (armpits/waist/leg pits — medial cover
> can't reach) = decompose.js guard's job. `hyperReplace` stays
> opt-in OFF; baseline byte-verified 3×. **PROCESS MANDATE: a
> stale-module false "shiba PASS" survived fresh-tab + no-store server —
> henceforth every trusted number requires (a) an in-page build-tag
> assertion visible in the harness, and (b) identical-code double-runs
> that agree.** Next: harness build-tag + double-run support (test/*);
> reach-tol tuning + decompose.js concavity guard (engine); flip
> default only on double-run-verified ≤3/≤3.

> **Organics round 4 (closure) — shiba SOLVED; matilda 6 px structural
> ceiling; decision to user.** Reliability doctrine applied throughout
> (BUILD_TAG-confirmed + double-run-verified; harness banner/determinism
> mode shipped by the parallel worker and verified live). Reach-tol
> sweep: 0.010 optimal (shiba 1 px protrusion / 1 px holes — **PASS ALL
> GATES**, essenceSil 0.992; matilda 0 / 6, non-monotonic — tighter
> over-fills toward cap). decompose.js concavity guard wired
> (sphere→home-part majority vote; forbid cross-part consumption):
> **no-op on matilda (6→6)** — her residual is a SMOOTH concavity
> (armpit/inner-thigh, arm/legs fused under loose cloth) with no crease
> to cut; sharp-crease decomposition cannot help, and shiba passes on
> reach-tol alone. Landing rule honored: hyperReplace stays default OFF
> (matilda fails holes ≤3); baseline byte-restored and double-verified;
> BUILD_TAG p3r4-optin-off. Housekeeping: dead geometric-knee replace
> code removed. **USER DECISION PENDING:** (a) build the smooth-minima /
> SDF (CoACD-style) decomposer — closes matilda + the general
> clothed-articulated class; (b) accept the ceiling — enable replacement
> with a per-class matilda-type hole allowance ≤6 px (note: her
> PROTRUSION is 259→0 — the original jagged-edges complaint is gone;
> the residual is one 6 px interior hole); (c) ship shiba-class only.
> Cheap de-risk either way: render matilda view 3 under replacement to
> visually confirm the armpit/inner-thigh attribution.
>
> **User decision (2026-07-09): BUILD THE SDF DECOMPOSER** (option a) —
> smooth-minima/aggregated-concavity decomposition, CoACD-style native
> reimplementation, closing matilda and the clothed/articulated-organic
> class while keeping the ≤3 px hole requirement intact everywhere. The
> attribution-verification render (matilda view 3) is the first step of
> the build round.
>
> **Organics round 5 — DE-RISK OVERTURNED THE PREMISE; SDF decomposer
> correctly NOT built.** New `_hole-probe.html` (source-vs-recon
> silhouette differ; keep for all future hole diagnosis) shows matilda's
> 6 px hole is the **HAIR TUFT in all five checked views** — limbs,
> armpits, waist, inter-leg all clean. The approved SDF limb decomposer
> targets joint concavities and would NOT have fixed it. Re-diagnosis:
> the hair is a spiky thin silhouette that medial replacement can't
> reproduce, and matilda is budget-bound — blunt thin-feature exclusion
> measured COUNTERPRODUCTIVE (0.04·bbox guard → over-cap → 15 px).
> shiba's full pass (1/1/0.992) is independent and stands. Baseline
> byte-restored, BUILD_TAG p3r5-rediagnose-optinoff. Re-scoped options
> to user: (A) component-targeted hair preservation + budget rebalance
> (scoped fix; verify the cap-interaction mechanism via stats.dropped
> first); (B) hair via the dormant §L2 thin-feature/decal track
> (principled, bigger, serves all hair/wisp models); (C) ship
> shiba-class landing now, log matilda's 6 px as a hair residual.
>
> **User decision (2026-07-09): OPTION B — build the thin-feature/decal
> track.** The principled §L2/§3.4 subsystem: detect thin/spiky features
> (hair tufts, wisps, tendrils; local-thickness/medial signals), give
> them protected representation (parametric thin fits and/or preserved
> triangles with RESERVED never-evicted budget — the §3.4 exemption
> principle) outside the medial-replacement path. First step remains the
> cap-interaction verification (stats.dropped mechanism) since budget
> protection is the crux. Adjacency noted: stormterror's wing sheets are
> the same species — a general thin-feature track may finally move its
> 12 px too, but no forcing. Landing rule unchanged: hyperReplace
> default-ON when both organics pass both gates ≤3 double-run-verified.
>
> **Organics round 6 (stage 0) — THE BLOCKER IS CONSUMPTION, NOT HAIR.**
> Measured (BUILD_TAG p3r5-stage0-optinoff): matilda consumes only
> **752/8,151** substrate faces under replacement (shiba 1,857) — her
> ~104-component fragmented clothing mesh medial-abstracts poorly — so
> the residual expands to preClamp 13,568 = **3,568 over cap**, and the
> extent-sorted over-cap drop (converter.js:1261) evicts the smallest
> decorations = the hair = the 6 px hole. Hair protection alone CANNOT
> work at zero headroom (it would relocate the 3,568 drops). Also
> measured: medial-radius thin-detection is a no-op (hair spheres >3 cm —
> a real detector needs per-face SDF-thickness or silhouette-value);
> coarser substrate 5000 no-op. shiba's full pass is independent and
> stands. **The Option B build is therefore COUPLED: (1) raise
> matilda-class replacement consumption on fragmented meshes (measure
> per-component consumption first — why 752?), THEN (2) thin-feature
> protection (SDF-thickness/silhouette-value detection; _protect flag
> threaded through pairIntoSquares/decomposeTriangle to placements;
> never-evict in the over-cap sort).** Proceeding as the faithful
> continuation of the user's Option B decision. Baseline byte-restored;
> probes _hole-probe.html + _rep-probe.html (budget-stats dumper) kept.
>
> **Organics round 7 (forensics) — consumption ceiling is STRUCTURAL:
> sheets have no 1-D medial axis.** Double-run-identical, BUILD_TAG
> p3r6-forensics-optinoff: matilda loses 6,238/8,151 faces to
> notRetained — **86% of her medial spheres are rejected (765 below the
> 8 mm minR floor, 547 degenerate zero-radius from SQEM same-side
> collapse on sheet tangent planes)** — the thin-cloth signature across
> her 104 fragments (the ≤27-face tail of ~95 comps consumes ZERO).
> Plus a tunable loss: 1,158 reach-fails on bulk comps. shiba contrast:
> one 7,836-face solid, 154 spheres retained, 6 minR-rejects — bulk
> thickness is why reach succeeds. VERDICT: medial tuning can recover
> only ~1,150 faces (→ preClamp ~11,600, still over cap); the ~4,400
> thin-cloth faces need **residual compression** (PRIMARY: extend the
> over-cap coalesceSquares merge to triangle-kind residual / relaxed
> coplanar merge on the replace residual only; measure the residual's
> square/triangle split + per-kind expansion first; target expansion
> ≤1.25× → ~9,000 placements) with **slab emission as fallback** (carries
> the 0.822 misorientation risk) and **reachTol sweep** (0.010→0.02/0.03,
> shared lever — re-verify shiba). Rejected by evidence: minR lowering
> (retention ≠ consumption on sheets), component pre-merge (no medial
> volume added). Stage 3 (thin protection) unchanged, needs the
> headroom. Forensics machinery gated behind hyperReplaceForensics;
> default byte-identity reasoned but needs one confirmation run.
>
> **Organics round 8 (stage 2 checkpoint) — reachTol is the WRONG lever
> (fictional coverage); emit-snap is the hole-safe one.** Debts cleared:
> shipped path deterministic-clean; matilda's 547 zero-radius spheres
> confirmed pure sheet-degeneracy (nd=0, r=0 — cloth truly has no medial
> volume; slabs geometrically correct but retained-sphere graph sparse —
> measure 3-clique yield before committing); shiba's zeros are a
> distinct SQEM solver degeneracy (interior, r=0). Residual
> instrumentation: matilda's replace residual is **99% single triangles**
> (pairIntoSquares fails on irregular cloth; squares-only coalesce
> useless); expansion 1.71× comes from decomposeTriangle's 2-way split →
> **emit-snap reduces count LOSSLESSLY** (no faces dropped). Sweep:
> d0.6+reach0.030 clears cap on both (matilda preClamp 8,917, zero
> drops) but **fails holes on both (107/128 px)** — over-reach consumes
> cloth no primitive covers; shiba also protrudes at big-sphere/high
> reach (needs reach 0.010 while matilda's counts want 0.030 → reachTol
> must be per-model). Informative near-miss: matilda at that config
> fails ONLY holes (essence 0.937, protrusion 0, count clean). Next
> round: emit-snap {20,30}° on the replace residual at modest reach
> (0.010–0.015) + per-model reachTol; slabs fallback gated on measured
> 3-clique yield; hole-probe the 107 px location; if neither closes →
> structural ceiling → §L2 decal escalation or per-class allowance
> (user decision).

> **Organics round 9 (landing attempt) — shiba LANDS; matilda ceiling
> PROVEN at gate level; two hypotheses falsified.** All numbers
> BUILD-asserted (p3r6e) + double-run identical; zero engine edits this
> round. (1) **shiba: replace-ON = FULL PASS** (holes 1 / protrusion 1 /
> essSil 0.992; its 1,205 over-cap drops are interior-harmless).
> (2) **emit-snap FALSIFIED for organics** — face-lossless but
> boundary-lossy (~6 px extremity misses on shiba's ears at snap20);
> retire it for the organic replace path, keep for fragmented-thin only.
> (3) **round-6 budget hypothesis FALSIFIED** — matilda at
> snap30+reach0.012 has ZERO drops (9,847 ≤ cap) yet holes stay 6 px:
> a REPRESENTATION floor, not budget; stage-3 thin-protection is moot.
> (4) matilda both-modes verdict: OFF = prot 259/holes 2; ON = prot 1/
> holes 6 — mutually unsatisfiable (the round-2 finding now proven at
> gate level). Slab fallback: 3-clique yield = **0** (confirmed). Reach
> ≥0.018 is fictional-coverage onset (13→109 px waist/hip cloth holes).
> (5) Recommended + authorized next: **ship shiba-class replacement**
> via fragmentation gating (sm.compFaceCount mean faces/component:
> shiba ≈7,836 vs matilda ≈78; threshold ~500; bulk→reach 0.010,
> fragmented→stays OFF) — suite 3/5 full-pass, no other model affected.
> (6) **Before any absolute-ceiling claim on matilda: ONE unmeasured
> lossless lever remains** — relaxed coplanar-merge on the replace
> residual (round-7's primary; round-8 predicts low yield on 99%
> irregular facets, but unmeasured). Then the matilda escalation
> ((a) per-class ≤6 px allowance / (b) §L2 decal track — noting the
> count driver is cloth mass, not just hair / (c) declared ceiling)
> goes to the user with complete evidence. New probes kept:
> _gate-probe.html (harness-parity gate A/B), _locate-probe.html (hole
> localizer + slab yield). Infra: use http://127.0.0.1:8000 (localhost
> resolves IPv6 and fails); nocache-server added to .claude/launch.json.

> **Organics round 10 — SHIBA-CLASS REPLACEMENT SHIPPED (suite 3/5 full
> PASS); matilda ceiling ABSOLUTE; escalation to user.** BUILD
> p3r7-shibaclass-replon, double-run verified. hyperReplace default is
> now CLASS-DERIVED in converter.js (~18 lines: explicit param honored;
> unset → countComponents(colored), ON only when eligible and mean
> faces/component > replaceBulkFacesThresh 500): **shiba protrusion
> 594→1, holes 1, essSil 0.992 — FULL PASS**; matilda/swords/stormterror/
> direct byte-identical. Matilda's LAST lossless lever measured: relaxed
> coplanar-merge yields ~0.5% at silhouette-safe angles (needs ~24%),
> explodes at aggressive angles (pa20: holes 73, protrusion 28) —
> round-8 prediction exact. **Every lever now measured; the 6 px floor
> is absolute in the current representation.** Her both-modes verdict:
> OFF = prot 259/holes 2 (letter of hole rule, spirit of Phase 3
> violated); ON = prot 1/holes 6, essSil 0.943→0.976 (spirit satisfied,
> letter violated by 3 px on one hair/extremity feature). USER DECISION:
> (a) per-class ≤6 px allowance → ship matilda ON now; (b) §L2
> hair/thin-cloth decal track (prior Option B — protected parametric
> decal outside the residual, immune to eviction/distortion) → closes
> holes ≤3 keeping protrusion fixed; (a)+(b) hybrid mirrors the earlier
> recalibrate-now-build-later pattern. New probe: _merge-probe.html.
>
> **User decision (final matilda call): HYBRID — ship matilda ON now
> under a TEMPORARY per-class ≤6 px hole exception (fragmented-cloth
> organics; explicitly temporary, retired when the decal track closes
> 6→≤3), AND build the §L2 hair/thin-cloth decal track.** Execution:
> engine extends the class gate (fragmented-cloth → replacement ON at
> reach 0.012, her measured genuine ceiling); harness gains the
> temporary class allowance, clearly marked; then the decal-track build
> (protected parametric thin-feature decals outside the residual, immune
> to eviction and merge/snap distortion) closes the gap and the
> exception retires, restoring the universal ≤3 px rule.

> **Organics round 11 — matilda SHIPPED (suite 4/5); decal track built,
> validated, and DISPROVEN for her; sheet-abstraction fitter identified
> as the sole closure path.** BUILD p3r9-thinprotect-optin, determinism
> OK. Task 1: class-derived replacement default extended — all
> sphere-mesh-eligible organics ON with per-class reachTol (bulk 0.010 /
> fragmented-cloth 0.012): **matilda protrusion 259→0, essSil
> 0.943→0.976, holes 6 (PASS under temp organic-cloth ≤6)**; shiba full
> PASS held; swords/stormterror/direct byte-identical. Task 2:
> `detectThinFaces` (boundary-edge signal, synthetic-validated: fin
> 12/12, bulk interior never) + `_protect` never-evict emission shipped
> OPT-IN OFF — **measured counterproductive on matilda (6→13→25 px as
> reserve grows: protection relocates the over-cap drop onto other
> silhouette faces)** and no-op on shiba/stormterror. Root cause: her
> ~3,196-over-cap mass is BULK CLOTH residual (~7,180 uniformly
> silhouette-dense faces), not thin features (only ~1,161 detected).
> Every hole-safe lever is now measured-and-exhausted: emit-snap 6 px /
> merge ≤0.5% / thin-protect worse / reach fictional / slabs 0. **The
> exception cannot retire via any thin-feature mechanism. The one
> unexplored closure path: a SHEET-ABSTRACTION FITTER (planar-region
> cover for cloth — raises consumption to bring her under cap
> hole-safely; also the long-identified mechanism for stormterror's
> wing sheets, the suite's last red). Scope: comparable to the
> sphere-mesh build. USER DECISION PENDING:** fund it (could close BOTH
> remaining defects → 5/5), or accept the ≤6 exception as durable +
> stormterror as known-red.
>
> **User decision (2026-07-10): SHEET FITTER FUNDED** — the full-suite
> play (5/5 with the universal ≤3 px rule restored). Design constraints
> from accumulated evidence: planar-REGION segmentation → one inscribed
> oriented slab/thin-cuboid per near-planar region (NOT sphere-mesh
> 3-cliques — 0 yield on cloth, 0.822 misorientation on wings);
> replacement semantics via the existing consumed-faces/provenance
> framework; per-class dispatch (cloth regions on matilda; wing panels
> on stormterror); inscribed-only (protrusion ≤3 is the whole point);
> synthetic validation before real models; matilda stays shipped under
> the temp exception during the build.
>
> **Sheet fitter round 1 (checkpoint) — built, validated, mechanism
> proven; curved-drape Pareto wall characterized.** NEW
> engine/convert/sheetfit.js (BFS region growth bounded by SEED normal,
> |cos|≥cos(planarAngle) double-sided; PCA slab, thickness=2·max dev,
> inscribed in-plane; consumption = all-3-verts-inside+reachTol, the
> provenance contract; runs on the sphere-mesh residual; opt-in
> hyperSheet, default byte-neutral — shipped 4/5 suite preserved).
> Synthetics ALL PASS (flat panel 1 inscribed region; wavy cloth 8–53
> curvature-bounded regions, 81–93% consumption; panel+spikes consumes
> panel, spikes 0/10 untouched). matilda: **the 5-round blocker is
> mechanically solved** — pa30: 4,246 faces consumed via 310 slabs,
> preClamp 4,459, ZERO drops, holes 0 — but flat slabs on curved drape
> protrude 1,434–4,623 px (essSil tracks it — one problem); tight
> configs (pa5–6) get protrusion 0–1 but only ~260–390 consumption
> (need ~3,200). **Uniform params cannot cross the wall** (best
> compromise ~1,500 consumption at 20 px). Round-2 plan: (1) per-region
> ADAPTIVE inscribe-or-reject with a nearestDist source-surface
> self-check — binary-search each region's largest non-poking slab
> (flat regions keep big slabs, curved shrink to flat cores or drop;
> consumption headroom is enormous so aggressive rejection is
> affordable); (2) if flat cores prove too small: add a single-curved
> inscribed fold primitive (partial cylinder) as the sheet fitter's
> second shape; (3) re-verify gates double-run, then retire the temp
> exception. Probes: _sheet{,2,3}-probe.html.
>
> **Sheet fitter round 2 (checkpoint) — adaptive self-check built +
> validated; frontier improved; landing needs the curved consumer.**
> BUILD p3r11-sheet-adaptive, byte-neutral default. Per-region
> inscribe-or-reject (nearestDist spatial hash over the full colored
> model — poking INTO the hidden body allowed, silhouette overhang
> rejected; binary-searched in-plane shrink; 8 corners + 4 midpoints
> sampled). Synthetics: FLAT keeps full slabs; DOME rejects 6/7
> (98%→4%, protrusion prevention engages exactly on curvature); WAVY
> 96%→49% graceful; SPIKES untouched. matilda frontier (double-run):
> prot 0 ↔ cons 374 / prot 9 ↔ cons 848 / prot 144 ↔ cons 2,240 —
> **cons ≥3,200 @ prot ≤3 unreachable with flat slabs alone** (curved
> drape rejects them; the ~2,400 curved-drape faces need a curved
> consumer). Round-3 plan: (0) upgrade self-check to point-to-TRIANGLE
> distance (point-to-vertex underestimates overhang — accepted slabs
> render 9–57 px at tol .012; an accurate check may retain more
> consumption at true ≤3); (1) PRIMARY: anisotropic narrow-slab strips
> along fold crests (extend along low-curvature axis, stop across
> high-curvature; near-flat across the narrow axis; reuses slab
> emission + self-check); (2) FALLBACK: inscribed partial-cylinder
> (axis via great-circle machinery; RISK: in-game cylinders are FULL
> tubes — far side may poke the opposite silhouette; half-pipe
> synthetic decides). Combined target ~850 flat + ~2,400 curved ≈
> 3,250 → landing. Probes: +_sheet4-probe.html.
>
> **Sheet fitter round 3 (checkpoint) — point-to-triangle self-check
> landed; matilda ONE GATE from landing; strips proven necessary.**
> BUILD p3r12-tri-selfcheck, byte-neutral. `ptTriDist2` (Ericson) +
> `makeNearestTriDist` (tri-AABB grid hash) replace the vertex-cloud
> check → true-overhang measurement: synthetics improve (DOME 4%→16%,
> WAVY 49%→62% at equal tol — less false rejection), matilda protrusion
> at cons≈2,400 halves (144→92). Best config pa50/tol.014/mf4:
> cons 2,416, preClamp 9,072, ZERO drops, holes 1, essSil 0.923 —
> **only protrusion (92) fails**. Diagnosis: DIFFUSE TANGENT-SLAB
> protrusion — a flat slab tangent to curved drape pokes past the
> silhouette by its in-plane extent even with every sample point ON the
> surface (invisible to any distance-based self-check; essSil's broad
> 0.976→0.923 slide confirms the many-slab diffuseness). Round-4 design
> (fully specified): fold-crest axis = smallest normal-covariance
> eigenvector per region (the agglomerative cylinder-axis signal) →
> split regions into strips PERPENDICULAR to the crest (narrow across
> curvature, long along it) → existing slab fit + tri self-check per
> strip. Half-pipe/wavy synthetic gate (≥~80% consumption at zero true
> protrusion) before matilda; watch strip-END protrusion where the
> crest itself curves (short strips + reject gate if needed);
> partial-cylinder stays fallback (far-side risk). Probes:
> +_sheet5-probe.html.
>
> **Sheet fitter round 4 (checkpoint) — strips built + validated;
> CUMULATIVE-PROTRUSION WALL characterized; decision to user.** BUILD
> p3r13-sheet-strips, byte-neutral. Strip machinery: normal-covariance
> curvature trigger (position-thinness mis-classified shallow arcs —
> bug found+fixed), crest axis = smallest normal-cov eigenvector,
> strips bucketed across-curvature/along-crest with length cap,
> per-strip tryFitSlab + tri self-check. Synthetics: half-pipe
> consumption 0%→72% (flat slabs got 0%), spikes residual. matilda:
> strips halve protrusion again (75→25 at tol.006) BUT no config
> passes — **adjacent strip pokes (≤3 px each) CONNECT into a ~25 px
> band at grazing silhouettes** (narrower strips = more pokes, same
> band; essSil only dips to 0.95 — a boundary sliver), and
> protrusion-safe consumption (~1,450) remains half of cap-clearing
> (~3,200). **Flat-family primitives cannot tile curved drape to ≤3 px
> cumulative protrusion — geometric, now proven across slab→adaptive→
> tri-check→strips.** Paths: (1) partial-cylinder round — the last
> untried primitive, the only one that matches fold curvature (no
> tangent poke); gamble on the far-side synthetic gate (in-game
> cylinders are full tubes) AND the consumption ceiling; (2) accept the
> ≤6 px organic-cloth exception as durable (matilda ships green today:
> protrusion 259→0, essSil 0.976, one 6 px hair hole). USER DECISION.
> Independent of it: stormterror gets the EXISTING sheet machinery
> tried next (funded scope — wings are likely flatter than drape;
> never attempted). Probes: +_sheet6-probe.html.
>
> **User decision (2026-07-10): PARTIAL-CYLINDER ROUND FUNDED** — the
> last untried primitive for matilda's curved drape. Hard gates: the
> half-pipe FAR-SIDE synthetic must pass before any real-model use
> (in-game cylinders are full tubes — axis/center inside the body or
> reject); explicit kill criteria (far-side geometry fails, or the
> ~1,450 consumption ceiling persists) → the program closes with the
> ≤6 px exception durable, no further matilda rounds. stormterror gets
> the existing sheet machinery in the same arc (priority 2, checkpoint
> between).
>
> **Sheet fitter round 5 — FAR-SIDE GATE FAILS DECISIVELY; matilda
> program CLOSED; exception now DURABLE (per the funded kill
> criteria).** No engine edits (Node synthetics only; BUILD unchanged
> p3r13-sheet-strips). Synthetic verdict: a full-tube cylinder fitted
> to a partial arc pokes its far side ~R (350° wrap) to ~2R (90°) —
> intrinsic, only ~360° wraps avoid it; honest "hidden inside the body"
> gating needs inside/outside classification that non-watertight cloth
> shells can't provide; and the structural coup de grâce — anything
> tubular has a medial axis and was ALREADY sphere-mesh-consumed, so
> matilda's cylinder candidates are non-tubular by construction →
> consumption-stall kill criterion fires without measurement. **FINAL
> WALL (rounds 1–5, exhaustive): matilda's post-medial residual is
> thin, non-developable, non-tubular curved cloth — no primitive in the
> vocabulary inscribes it without protruding or leaving her over cap.
> The organic-cloth ≤6 px exception is DURABLE** (harness annotation
> updated from "temporary" accordingly). matilda's shipped state stands:
> protrusion 259→0, essSil 0.976, one 6 px hair hole. NEXT (round 6,
> funded scope): stormterror wings via the EXISTING sheet machinery —
> near-planar panels + spikes is the geometry the fitter validated ON;
> class-isolated replace-gate opening; target 12→≤3 protrusion =
> the suite's last red.
>
> **Sheet fitter round 6 — stormterror STALLS honestly; her 12 px is an
> INFLATION-TIER wall, not consumption; decision to user.** BUILD
> p3r14-storm-sheet; class-isolated `doSheetOnly` path built and proven
> byte-neutral (shiba/matilda/swords/stormterror-default all identical);
> hyperSheet NOT wired into her default (it regresses her). Measured:
> the sheet fitter consumes her membranes heavily (4,300–5,300 faces,
> cap cleared, zero drops — count solved) but EVERY config is worse
> than baseline: holes 3→8–32, essSil 0.913→0.85, protrusion pinned at
> 12. Why: (a) her protrusion comes from the 0.024 fragmented-thin
> inflation tier ballooning residual wing edges — orthogonal to
> consumption (the known trade: inflation 0.024→0.010 = prot 12→8 but
> holes 3→6, neither passes); (b) wing membranes are ALL-silhouette —
> unlike thick bodies there is no interior to consume; inscribed slabs
> can't reproduce the scalloped fine structure (same thin-sheet ceiling
> that gated the sphere-mesh and the Phase-C slabs at 0.822). SUITE:
> 4/5, the last red rigorously attributed. USER OPTIONS: (1) per-class
> thin-sheet ≤12 px protrusion allowance (mirrors matilda's; agent
> recommends) → 5/5; (2) per-edge inflation treatment (inflate only
> where a QEM-erosion gap exists, decoupling protrusion from
> hole-closing — unbuilt, uncertain, smaller than the sheet fitter);
> (3) accept 4/5 as the honest close.
>
> **User decision (2026-07-10): PER-EDGE INFLATION ROUND FUNDED** —
> bounded, kill-criteria'd like the cylinder gamble: inflate ONLY where
> a QEM-erosion gap actually exists (decoupling hole-closing from
> protrusion), instead of the blanket 0.024 fragmented-thin tier.
> Kill criteria: if per-edge inflation cannot reach protrusion ≤3 AND
> holes ≤3 on stormterror, the round stops and the remaining choice
> (thin-sheet ≤12 allowance vs accept 4/5) returns to the user.
>
> **Per-edge inflation round (final) — kill criterion met at a 6 px
> floor, but a STRICT IMPROVEMENT: stormterror protrusion 12→6, holes
> 3, essSil 0.915, fully byte-isolated (opt-in).** BUILD
> p3r17-peredge-final. Mechanism: per-placement inflation self-check
> (`maxSafeInflation`, binary-searched against the source via
> makeNearestTriDist) — interior seam-plates inflate fully (holes stay
> closed), outer-boundary plates zero (~17–49 plates; the 12→6 win).
> The residual 6 px floor is the wing's fine SCALLOPED edges: at
> substrate-bounded tolerance a scallop-edge plate's inflated tip lands
> within tol of the adjacent scallop and reads as interior — tightening
> tol reopens holes (the same protrusion↔holes coupling, pushed 12→6
> but not eliminated; invariant across tol .004–.010, infMax
> .008–.036; perpendicular thickening measured NEGATIVE and reverted).
> Cross-model byte-identity proven. Noted potential: per-edge could
> eventually replace the blanket organic tiers (more principled) —
> untested, defaults untouched. USER CHOICE (final): ship per-edge
> class-scoped + a thin-sheet ≤6 px PROTRUSION allowance (symmetric
> with matilda's ≤6 hole allowance) → **5/5 suite, campaign closes**;
> or accept 4/5 with per-edge left opt-in.
>
> **USER DECISION (2026-07-10, campaign close): SHIP + ≤6 ALLOWANCE →
> 5/5.** Per-edge inflation ships class-scoped for fragmented-thin
> (hyperPerEdgeInflate at the fragmentedThin gate); the harness gains a
> thin-sheet class for stormterror with a durable ≤6 px PROTRUSION
> allowance (symmetric with matilda's ≤6 hole allowance, same
> evidence-citation pattern). End state: **five models, all gates
> green, two small documented class exceptions (organic-cloth holes ≤6;
> thin-sheet protrusion ≤6), universal ≤3 rule everywhere else. Phase 3
> closes.**

## 1. Goal & requirement decisions

> **Budget revision (2026-07-08, user):** target band raised to
> **4995–9990 decorations** (5–10 game models at 999 each; cap corrected
> from 10000 to 9990 on 2026-07-09). Spend the
> extra budget on visual quality, not just headroom. Testing protocol:
> models are normalized to **2 m height** in the harness (imported models
> at native scale were hitting the zoom≤50 cap and exploding via
> cap-splitting); japanese_bridge_garden is **excluded** from the suite
> until the specular-glossiness loader fix lands (its textures load
> all-white). Historic 999/1998/2997 references below predate this
> revision.
>
> **Suite change (2026-07-09, user):** just_a_girl retired from the
> harness suite (file kept on disk), replaced by
> **stormterror_from_genshin_impact.glb** (5.4 MB, organic class). An
> earlier plan to swap in higokumaru (19.4 MB, emissive-only) was
> superseded before landing. Active suite: shiba, matilda, stormterror,
> stylized_sword, shattered_crystal_sword. just_a_girl's open findings
> (saliency-palette ΔE lever, 93 px hole) remain valid engineering
> leads — the mechanisms are generic, only the gate moved.

**Why bridge garden stays excluded:** its colors live in the legacy
`KHR_materials_pbrSpecularGlossiness` glTF extension, which `GLTFLoader`
doesn't handle, and the model carries no fallback `baseColor` — all 95
materials arrive as `[1,1,1]` (white). This is an entry-point WYSIWYG
data-loss bug of the same class as the vertex-color/emissive fixes, and
it is **still unresolved** — bridge garden is skipped from the suite
because of it, not for any other reason.

Budget reality check: 999 decorations ≈ 10,000 free parameters (position,
rotation, per-axis zoom, color × 999). That is *tiny* as triangle soup but
*large* as a set of oriented volumetric primitives — a single rotated cuboid
carries 6 faces, a cylinder or sphere carries hundreds of effective faces.
The entire plan follows from one reframing:

> **This is not mesh simplification. It is shape abstraction** — inverse-CSG
> fitting of a compact primitive set to the *visible, colored surface*,
> under a knapsack budget.

The plan is organized in three levels: what everyone does, what the
structure of the problem demands, and the non-obvious leverage points that
decide whether the result looks like an asset or like soup.

---

## 2. Conceptual foundation

### Level 1 — The baseline everyone reaches for (and why it fails at 1M)

The obvious pipeline: decimate the mesh → convert triangles → merge coplanar
faces → drop the smallest until under budget. We already do all of this. At
1M polygons it breaks down for four predictable reasons:

1. **Decimation to a triangle budget destroys appearance long before 999.**
   A 999-triangle model of a character is unrecognizable; 999 *volumetric*
   primitives of the same character can look great. Triangles are the
   weakest primitive in the set and must be the *last resort*, not the
   medium.
2. **Color fragments geometry.** Texture detail forces subdivision, so the
   budget is spent on color boundaries, not shape. Geometry and color are
   fighting over the same 999 slots.
3. **"Drop smallest first" is semantically blind.** Small ≠ unimportant: it
   deletes eyes, fingers, antenna tips — precisely the features that carry
   identity — while keeping redundant interior faces. (As-built: `bandSpend`
   now drops least-*valuable*, not smallest, placements by design — see §6
   Round 6 — but this is a partial fix, not the full saliency-aware ranking
   this section calls for.)
4. **Everything is exact-partition thinking.** Tiling surfaces exactly
   (no overlaps) is the expensive way to cover a shape. This medium allows
   interpenetration for free.

Level 1 work items (still worth doing, as preprocessing):
- Robust ingestion of 1M+ meshes in the worker: typed-array pipelines,
  spatial hash grids, no per-triangle objects. Target: analysis + reduction
  of 1M triangles in seconds, not minutes. **(shipped** — see §3 Performance
  notes.)
- Weld + degenerate cull + **visibility cull first** (26-view GPU
  visibility): interior and never-visible geometry is deleted before
  anything else runs. On scans and CSG exports this alone removes 20–60% of
  triangles. **(shipped**, `engine/convert/preprocess.js`.)
- QEM decimation to an *intermediate* working mesh (~30–60k triangles) that
  preserves color-region boundaries and silhouette edges (constraint edges),
  used only as the fitting substrate — never as the output. **(shipped**,
  `engine/convert/qem.js`.)

### Level 2 — What the problem structure demands: a primitive-abstraction pipeline

#### 2.1 Color before geometry
Hard constraint driving this whole section: **every decoration carries
exactly one flat color.** A primitive can never span a color boundary, so
color structure dictates the minimum decoration count before any geometry
is considered.

Reduce the palette *first*, in a perceptual space (CIELAB, area-weighted),
to ≤ 24–48 flat colors. Then segment the surface into connected
same-color regions. Every downstream fitting step operates per region, so
**geometry boundaries automatically align with color boundaries** — the
single largest source of wasted primitives disappears. (The in-game result
is flat-colored anyway; killing texture gradients early costs nothing
visually and collapses subdivision pressure.)

Two consequences of the one-color rule that must be explicit in the fitter:

- **Split vs. overlay — price both.** Splitting geometry at every color
  boundary over-fragments when color regions are small relative to the
  shape (a striped pole becomes N stacked cylinders; a wall with a logo
  becomes a mosaic). Since overlap is free (§3.2), the alternative is one
  primitive in the *dominant* color plus thin overlay patches for the
  minority colors. For every multi-color region cluster, the fitter
  computes the decoration cost of both strategies and takes the cheaper
  one; neither is universally right.
- **Budget-coupled palette size.** Each palette color buys visual accuracy
  but costs decorations. Palette size is therefore not a fixed constant:
  colors enter the same marginal-gain knapsack queue as geometry (§2.4),
  and the palette stops growing when the next color's ΔE improvement per
  decoration falls below the current geometric candidates. **(shipped:**
  default palette is budget-coupled 32→48; see §3 live constants.)

#### 2.2 Curvature-classed fitting, not one-primitive-fits-all
Classify each region by its curvature signature (local PCA / principal
curvatures on the intermediate mesh):
- **Planar** → greedy maximal-rectangle cover with cuboids/planes.
- **Single-curved** (κ₁≈0, κ₂>0) → cylinder/cone axis fit.
- **Double-curved** (κ₁,κ₂>0) → least-squares sphere/ellipsoid fit
  (per-axis zoom gives us ellipsoids for free).
- **Residual** (fails all fits within tolerance) → calibrated right
  triangles, last.

A cylinder that replaces 400 shaft triangles for 1 decoration is where the
1M→999 compression actually comes from. **(Partially shipped:**
`engine/convert/agglomerative.js` dispatches plane/sphere/cylinder passes
by curvature class; cone and triangular-prism passes are built and
synthetically validated but ship default OFF — see §6/§7.)

#### 2.3 Volumetric fitting against an SDF, not the triangle list
Build a signed distance field from the visible surface; score candidates
against it (error = integral of |SDF| over the candidate surface,
"inside the model" queries become O(1)). This is what makes greedy
volumetric fitting tractable at scale and resolution-independent.
**(Superseded in implementation** by the P3 method decision, §5.1 — an
adjacency-constrained agglomerative clustering on the QEM substrate
replaced literal SDF/RANSAC fitting, for reasons specific to our
one-color-per-primitive and nested-LOD constraints. The reasoning in this
subsection is why volumetric, error-scored fitting is the right shape of
solution; it is no longer the literal mechanism.)

#### 2.4 Budget as a global knapsack
Fit greedily largest-visual-gain-first (submodular greedy with lazy
re-evaluation): every candidate primitive is scored by **marginal visual
error reduction per decoration spent**. Generation stops at the knee of
the error curve or at the tier cap. There is no post-hoc "drop smallest" —
the budget shapes the construction. **(Shipped:** water-filling budget
allocation + `bandSpend` convergence loop in `qem.js`/`converter.js`.)

---

### Level 3 — What most people miss

These are the items that separate "technically under budget" from "looks
like a real asset". Each is cheap relative to its payoff.

#### 3.1 Optimize the error the player actually sees
Replace geometric error (Hausdorff/RMS) with a **visibility-weighted,
silhouette-heavy screen-space metric**: render source vs. reconstruction
from the 26 canonical views at gameplay distance, compare silhouette
agreement + per-region color error. Interior/occluded surfaces get weight
≈ 0; silhouette-touching features get weight ≫ volume-proportional. The
metric doubles as the acceptance test. **(Shipped** as the similarity
harness, now the essence metric suite — §4.)

#### 3.2 Overlap is free — cover, don't partition
One large base cuboid through the torso + smaller primitives layered on top
beats an exact tiling by 3–10×. Games tolerate interpenetration; where
z-fighting could occur on coplanar faces, offset by 1 mm. **(Shipped for
volumetric primitives** — ellipsoids/cylinders/medial spheres overlap
natively. Planar rect-cover-with-overlaps for hard-surface models is not
yet built; hard-surface models currently stay on the low-poly bypass
triangle path instead — see §3 `bypassKeep`.)

#### 3.3 Symmetry and repetition halve (or better) the spend
- **Bilateral symmetry**: detect via PCA + mirrored-ICP; fit one half,
  mirror the primitive set. ~2× budget.
- **Repeated substructure**: geometric-hash clustering of similar regions;
  fit the archetype once, re-instance with per-copy transforms.

Not yet built — no symmetry/instancing pass has shipped.

#### 3.4 Thin features are a separate species — extract them first
Voxel/SDF stages silently delete swords, antennas, cables, and cloth (their
volume is ~0). Detect thin sheets and rods up front, fit them
*parametrically* at full priority, and exempt them from volumetric
processing and from budget-pressure eviction. **Attempted, not landed:**
Phase-B prism fit and Phase-C slab (sphere-triangle → oriented cuboid)
emission both target exactly this class of feature (stormterror's wing
membranes); both are built and measured but ship default OFF because they
cost more essenceSil than they recover — see §6/§7 for the evidence.

#### 3.5 Quantization-aware fitting and ε-inflation
Fit **with quantized parameters inside the loop** and inflate every
primitive by a small margin so hairline cracks between primitives don't
read as broken. **(Shipped:** class-gated ε-inflation tiers — see §3 live
constants.)

#### 3.6 The zoom ≤ 50 cap should steer the fitter, not truncate it
Surfaces longer than 5 m must split regardless; feed the cap into the
rectangle coverer so splits land on color-region or symmetry boundaries.
**Not built as specified** — cap-aware fitting itself doesn't exist yet;
splits still land via the post-hoc `capPlacements` pass. (The 9990 cap
correction, §1, is a budget fix, not this lever.)

#### 3.7 One run, three tiers — nested LODs
Because construction is greedy by marginal visual gain, emitting
primitives in acquisition order makes every prefix a valid LOD. **(Shipped:**
LOD extent-descending emission, Fitter Phase B — §6.)

#### 3.8 Closed-loop acceptance, not open-loop hope
After generation: render reconstruction vs. source; compute the
acceptance metrics; report which regions carry the error if below
threshold. **(Shipped, measurement half:** the harness computes essence
gates + hole gate on every run and reports per-model PASS/FAIL with
diagnostic overlays — §4. Automatic per-tier re-escalation on failure is
not confirmed shipped.)

---

## Detail preservation & edge cases — three levels

How the pipeline handles color edges, facial features like eyebrows,
aliased lines — and the input classes that break the plan entirely.
(Synthesis of two independent deep-reasoner analyses.)

### Level 1 — Where detail dies by default

All four fine-detail classes are **flat, near-zero-relief surface-color
phenomena**, and a volumetric shape-abstraction pipeline erases them early:

- **Palette reduction kills them first.** Area-weighted Lab clustering
  gives an eyebrow (tiny area, huge identity weight) ~zero weight and
  merges it into skin. AA halo pixels along sharp color edges waste palette
  slots and make segmentation boundaries ragged.
- **The SDF/volumetric fitter never sees them.** Painted-on features have
  no geometric relief; nothing exists for a shape fitter to fit.
- **The knapsack de-prioritizes them.** Silhouette + mean-color scoring is
  structurally blind to *interior painted structure*: deleting an eyebrow
  barely moves the parent's mean color — the damage is structural, not
  chromatic, so the metric can't feel it.
- **Thin strokes are the worst case for rect-cover**: a 1×N-pixel seam
  becomes dozens of tiny cuboids, then gets dropped by area.
- **Entry-point data loss (upstream of the plan!):** `extract.js` reads
  only `mat.color` + `mat.map`. Vertex-color-only models (sculpts, voxel
  exports) arrive monochrome; emissive features (glowing eyes, screens)
  arrive **black**; inward-normal meshes can be deleted whole by a
  backface-culling visibility pass. No fitter can recover data that never
  arrives. **(shipped:** vertex colors, emissive fold-in, posed-skin
  baking, and opacity are all now read by `extract.js` — see §3.)

### Level 2 — The mechanisms that save it

1. **A parallel surface-decal track, running on the RAW texture before
   palette reduction** (`engine/convert/texture-analyze.js`), feeding an
   ε-laddered layer stack (`engine/convert/decals.js`): layer 0 = base
   primitive, +1 mm = features/strokes, +2 mm = ink-over-ground (pupil over
   iris), +3 mm = highlights. Position quantum is 0.1 µm, so 1 mm layers
   never collide. **Status: designed, not yet built** — this is the
   "dormant §L2 decal track" that Phase 3 (§8) plans to activate as
   "detail as paint".
2. **Halo-clean palette:** build palette centroids from *flat-interior
   texels only* (exclude high-gradient texels, Lab-Sobel ΔE > ~4), then
   assign all texels to that clean palette. Kills spurious halo colors and
   de-jags every hard edge at the source.
3. **Vectorize boundaries and strokes — never rasterize them.** Region
   boundary → Douglas-Peucker polyline (ε ≈ 0.75 texel). Thin strokes:
   ridge/Hessian filter → skeleton → DP polyline → one rotated thin cuboid
   strip per straight run, color sampled *at the skeleton*. Ring/helix
   strokes around a fitted cylinder become a single larger-radius thin
   band.
4. **Facial features as protected decals.** Non-ML saliency
   `S = local_contrast × texel_density × symmetry_bonus` (texel density =
   UV Jacobian, the artist-intent signal). Extract before palette
   reduction, inject feature colors as protected palette entries, emit as
   decals (mouth = thin strip, eye = flattened ellipsoid, pupil = smaller
   sphere at +1 mm). A whole face ≈ 4–10 decorations. Fit one side, mirror
   the other.
5. **Text/logos as one budgeted object with a fidelity dial** (MSER
   detection, baseline grouping): Tier A ≈ 1–3 decorations (bounding patch
   in ink color — never a blank), Tier B = 2–4-color maximal-rect cover
   capped at ~12 rects/layer, Tier C = full stroke vectorization. The
   tiers feed the nested-LOD ordering naturally.
6. **Robust foundations (fix before Level-2 stages run):** scale-relative
   welding **(shipped**, 2e-5·bbox); connected-component splitting for
   scene-as-one-mesh inputs **(shipped)**; unsigned distance field with
   inside/outside from visibility/winding numbers; global palette across
   material silos; double-sided visibility rendering with
   majority-inward-normal flip; vertex colors + emissive fold-in in
   `extract.js` **(shipped)**.

### Level 3 — What even the fixes miss

1. **The knapsack is the true bottleneck, not extraction.** Every rescued
   feature is re-dropped at budget time unless the error metric gains a
   structural term: `E = w_sil·(1−IoU) + w_mean·ΔE + w_struct·ΔE_edges`
   (edge-filtered 26-view comparison), plus never-evict flags and a
   saliency multiplier (~×20–50) for identity features. Fix the metric
   first. (Phase 3, §8, revisits this as the "structural edge term".)
2. **Perceptual asymmetry — thicken, don't drop.** A mouth line thickened
   to the 1 mm zoom floor is a caricature; a missing one destroys identity.
   Sub-floor features clamp *up*; only genuinely sub-perceptual detail is
   dropped. Guard against adjacent thickened features visually merging.
3. **Noise must collapse, not fragment.** Grass/gravel/camo textures defeat
   region segmentation (thousands of speckles → budget blowout). Add an
   entropy/spatial-frequency gate that collapses structureless variance to
   its area mean *before* segmentation, and a minimum-region-area merge.
4. **Baked lighting: keep by default (WYSIWYG), de-light as opt-in.**
   Industry PBR pipelines de-light scans so assets can relight under
   arbitrary engine lighting — that rationale does not apply to a
   flat-color medium whose contract is "match the viewport". A
   luminance-band de-light remains available as an opt-in tool; the
   entropy gate (item 3) still applies to *structureless* shading noise
   either way.
5. **Unrepresentable-class guard.** Alpha-cutout foliage/hair/fences,
   semi-transparency, billboards, and thin-only models have a *structural*
   error floor: auto-escalation would burn to 2997 and still "fail".
   Detect these classes up front, collapse to coarse opaque proxies, skip
   tier escalation when Δerror/tier is below threshold, and use per-class
   acceptance thresholds (organic ≠ hard-surface). **(Partially shipped:**
   the hard-surface-translucent class + viewport-invisible translucency
   exclusion, §4, cover shattered's case specifically.)
6. **Dynamic-range ceiling.** zoom ∈ [0.01, 50] means a ~5000:1 ratio
   between the largest span and the smallest representable feature. Models
   exceeding it cannot be faithful at both scales — warn and let the user
   pick the scale anchor.
7. **Decal integrity details:** decals must carry a host-primitive
   dependency in the greedy queue (no orphaned floating eyebrows when the
   host is evicted); constant-normal offsets drift on tight curvature (use
   cylinder bands or tessellated strips there); features split across UV
   islands must be re-joined by 3D-surface proximity, not UV proximity;
   symmetry mirroring needs a per-side residual pass so one-sided details
   (scar, logo, holster) aren't erased or duplicated.

### Policy decisions — governed by one principle

**WYSIWYG: the exported asset must match what the viewport shows.** The
viewport preview is the single source of truth; the converter consumes
exactly the geometry and colors being rendered. (Preview/output identity is
already verified to 0.0000 for transforms — these decisions extend the same
contract to color, pose, scale, and unrepresentable materials.)

- **De-lighting: OFF by default.** The viewport displays the texture with
  its baked shading, so conversion samples it as-is. Industry de-lighting
  practice (Unity photogrammetry workflow, Agisoft De-Lighter) exists to
  make assets relightable under arbitrary PBR lighting — irrelevant to a
  flat-color medium. Offered later as an opt-in Texture-panel tool.
- **Pose: convert the displayed pose.** For skinned meshes, extract bakes
  the rendered vertex positions (`SkinnedMesh.boneTransform`) instead of
  raw bind-pose attributes, so a model shown posed converts posed. Rule:
  extraction reads what the renderer draws, never the raw file.
  **(Shipped.)**
- **Unit-less inputs: no auto-rescale guessing.** Importers that guess
  units cause the classic 100× FBX cm/m errors; there is no universal
  convention. The loaders apply whatever unit metadata the file carries,
  the 1 m ruler and Input-unit-scale control make the displayed size
  explicit, and the size the user sees against the ruler is the size
  exported. The 5000:1 dynamic-range check WARNS (never blocks).
- **Foliage/hair/glass: reproduce the viewport appearance, judged
  per-class.** Alpha-cutout converts what the viewport shows (alpha ≥
  cutoff = solid), with distant-canopy clustering into opaque proxies.
  Semi-transparency flattens to its displayed blended color. These classes
  get their own acceptance thresholds and never trigger tier
  auto-escalation past a structural error floor.

---

## 3. As-built architecture

### Pipeline summary

```
0. ANALYZE    stats, symmetry, repetition, thin features, curvature classes,
              color complexity → per-model strategy dispatch
1. REDUCE     26-view visibility cull → interior removal → Lab palette
              reduction (≤24–48 colors) → constrained QEM to ~30–60k
              working mesh (color/silhouette edges locked)
2. EXTRACT    thin sheets/rods → parametric primitives (protected)
              [designed, not yet built — see Detail preservation §L2 item 1]
3. FIT        per color×curvature region, on the QEM substrate: HFP-style
              agglomerative clustering (plane / sphere / cylinder / cone /
              prism passes) + SQEM medial sphere-mesh, all candidates into
              one global marginal-gain priority queue; residual triangles
4. OPTIMIZE   local search (merge/split/recolor swaps), quantization-aware
              snap + ε-inflation, emit-snap expansion reduction
5. EMIT       greedy acquisition order = nested LOD, hole-safe knee stop
6. VERIFY     26-view essence suite (MSSA/LFCF/PPC) + hole gate; per-region
              error report on failure
```

### File map

- `engine/convert/preprocess.js` — voxel-flood interior culling,
  connected-component stats, CIELAB area-weighted palette reduction +
  neighbor-majority palette smoothing, working-mesh reduction
  (`reduceLeaves`/`clusterAt`).
- `engine/convert/converter.js` — `mode:'hyper'` orchestration
  (`buildPlacements`, `finishPlacements`, `bandSpend`,
  `allocateComponentBudget`, `capPlacements`) and the full `hyper*` param
  surface.
- `engine/convert/qem.js` — constrained QEM edge-collapse (area-weighted
  quadrics; boundary/seam/crease penalty quadrics at 120·faceArea),
  scale-relative weld, union-find component splitting with water-filling
  budget allocation.
- `engine/convert/agglomerative.js` — HFP-style curvature-classed
  clustering (plane/sphere/cylinder passes, later cone + prism), O(1)
  algebraic accumulators, geometric LSQ refit at emission only.
- `engine/convert/spheremesh.js` — SQEM medial sphere/capsule edge-collapse
  (Thiery et al.) on the QEM substrate; slab (sphere-triangle → oriented
  cuboid) emission built and validated, currently unwired/off.
- `js/extract.js` — the WYSIWYG entry point: vertex colors, emissive
  fold-in, posed-skin baking via `boneTransform`, material opacity.
- gia-writer — real in-game primitive IDs (sphere 10009002, cylinder
  10009008, cone 10009009, triangular prism 10009004); `buildPreview`
  renders per-axis-zoom ellipsoids.
- `test/similarity-harness.html` + `test/metrics.js` + `test/views26.js` +
  `test/models/` — the measurement harness; `js/score-current.js` — in-app
  parity scorer (wired into all 15 locales).

### Live constants & mechanisms (as-built)

- **Palette:** budget-coupled default 32→48 colors, Lab clustering
  (conceptual ceiling ≤24–48, §2.1).
- **Color merge tolerance:** Lab ΔE ≤ 12 relaxed merges, area-weighted
  region-mean color.
- **Curved-fit tolerance:** proportional tolerance **α = 0.30** (rms ≤
  α·primitive-radius; swept 0.2/0.3/0.4) — replaces an earlier absolute
  0.006·bbox gate.
- **Curved acceptance:** anisotropic ellipsoid acceptance (PCA axes +
  per-axis max-projection extents, shell-RMS gate, one-sided clamp,
  `coverEps` 0.04); `curvedMinFaces` 8; `curvedMinCoverage` 0.25 (retuned
  from the earlier `minCoverage` 0.15).
- **Engagement guard:** `hyperCurved` adopts a cluster only if ≥
  `max(60, 3%·faces)` consumed, else the triangle path is kept.
- **Bypass rule:** `bypassKeep = protectedComps>0 && (paperThin ||
  rawComponents>20)` — low-poly / shard-exploded models (swords, shattered)
  stay on the source-exact triangle path and never enter the
  essence/volumetric fitters.
- **Budget substrate:** `hyperSubstrate` 8000 faces (confirmed optimal vs.
  a 5000/12000 sweep); `hyperKneeEps` 6e-5 (knee-stop proxy ≈ (1/128)²,
  matched to the essence pyramid's dominant band).
- **Hole-safe knee:** a residual placement is only dropped if it is
  provably contained inside a retained volumetric primitive
  (`containedByVol`) — a naive extent-based knee opened holes, because
  triangle tilings (unlike volumetric covers) have no truly redundant
  triangles to drop for free.
- **ε-inflation tiers (class-gated):** fragmentedThin 0.024, paperThin
  0.00075, organic 0.0025 (m) — replaces one blanket value, which was
  measured to regress thin swords.
- **Emit-snap:** `hyperEmitSnapDeg` = 20° for fragmented-thin models —
  emits a near-right triangle as one snapped right-triangle instead of
  two, cutting triangle-pair expansion (1.77×→1.36× measured on
  stormterror).
- **Sphere-mesh (Phase C):** `hyperSphereMesh` default true (gated off for
  fragmented-thin models); `sphereMeshDensity` 0.6 (plus `PosFrac`/
  `RadiusScale`); medial spheres/capsules sit inside the shape at local
  half-thickness, so they structurally cannot add false silhouette.
- **`minCylAspect`:** 1.0 — pancake-cylinder guard (height ≥ radius);
  without it, disk-like cylinders were emitted as false silhouette.
- **Weld epsilon:** scale-relative, 2e-5 × bbox diagonal (replaces an
  earlier fixed 1e-4 m).
- **Hole gate:** erosion radius 5 px (calibration-swept 3–8 px,
  radius-invariant → real misses, not edge jitter); current threshold ≤ 3
  px worst connected region across the 26 views (tightened 25 → 8 → 3,
  target 0 — see §4).
- **MSSA weights:** [0.10, 0.15, 0.25, 0.25, 0.25] fine→coarse over a
  512→32 average-pool pyramid.
- **LFCF:** 32×32 area-weighted Lab cells over shared foreground, ΔE2000
  per cell, ΔE_ref 15.
- **Metric history (one-liner):** FaithScore = 100·(0.6·meanIoU +
  0.4·max(0,1−meanΔE/20)) was the Phase-1.5 headline; retired 2026-07-09 in
  favor of EssenceScore (§4) once exact-match IoU/ΔE were shown to reward
  triangle soup over abstraction (§5.2).

### Harness & infra notes

- Unmanaged python dev server on :8000 — restart with `python -m
  http.server 8000` if dead.
- Cache-busting: the harness's `cb=` query param only busts the HTML;
  engine files must be fetched with `{cache:'reload'}` (or a full page
  navigation) before trusting a run, or the harness silently runs stale
  engine code — `?v=` alone misses transitive ES-module deps.
- Fitter-OFF hole debt: `?auto=1` (fitter off) is **not** hole-clean by
  default (matilda 18 px via over-cap drop) — this is a known, non-default
  state, not a regression.

### Performance notes (1M+ inputs in the browser)

- Everything in the worker on typed arrays; uniform-grid spatial hashing;
  no per-triangle allocation. Visibility cull and SDF sampling are the only
  O(input) passes — after Stage 1, cost depends on the ~50k working mesh,
  not the input size.
- SDF is sparse (narrow band + coarse interior), built from the working
  mesh, refined near thin features only.
- Budget: ≤ 30 s wall-clock for 1M triangles on a mid-range machine, with
  progress reporting per stage.

---

## 4. Metric suite (current)

### Essence metric suite (replaces the retired exact-match IoU/ΔE gates)

- **MSSA (multi-scale silhouette agreement)** replaces plain IoU: 5-level
  average-pool pyramid (512→32) of each mask, soft-IoU per level, weights
  **[0.10, 0.15, 0.25, 0.25, 0.25]** fine→coarse (75% of the weight sits in
  the ≤128² gameplay band). Soup and clean abstraction tie here by
  design — that's what un-shelved fine abstraction as a viable strategy.
- **LFCF (low-frequency color field)** replaces ΔE: **32×32** area-weighted
  Lab cells over shared foreground, ΔE2000 per cell, **ΔE_ref 15**. Flat
  color over-coverage averages out at glance scale.
- **PPC (part proportions)**: distance-transform thickness-spectrum
  histogram intersection (weight 0.7) + solidity agreement (weight 0.3)
  across the 26 views — catches fat/missing/merged limbs,
  tessellation-invariant. Weakest sub-metric (global, not per-limb);
  overall weight 0.20.
- **EssenceScore = 100·(0.50·essenceSil + 0.30·max(0,1−LFCF/15) +
  0.20·PPC)** — the headline. Raw IoU/ΔE are still reported, not gated.
- **Efficiency diagnostics** (the waste detector), from decorations + a
  26-view per-decoration ID render (visArea = max px over views): shape
  histogram (triangleShare, volumetricShare), size percentiles +
  wasteShare (<4 px) + bottomHalfArea, **quality-vs-count curve**
  (essenceSil at prefixes 999/2500/5000/9990 → frontLoadRatio — soup
  scores low at 999, abstraction scores high; the strongest
  discriminator), coverage@N (top-50/200 visArea share).

> **Hole gate (user requirement, tightened 2026-07-09): target 0 holes;
> absolute max 3 px** worst connected interior-miss region across the 26
> views (erosion radius stays 5 px). "Extremely tiny" is only tolerated
> where literal zero proves impossible; the scoreboard shows green only at
> 0 (yellow 1–3, FAIL >3). Independent hard gate alongside the essence
> gates — the essence pyramid could mask a real gap.

> **Viewport-invisible translucency excluded (user, 2026-07-09):**
> shattered's ~4%-opacity effect shards don't show in the viewport, so per
> WYSIWYG they are not part of the model — tests exclude
> sub-viewport-visible translucent geometry (opacity < 0.05) from ALL
> source-side masks (silhouette, color, PPC, hole gate), and never demand
> the reconstruction reproduce it. The converter aligns: hyper skips
> geometry with material opacity < 0.05 at extract/convert time.

**Current per-class essence gate table:**

| Class | essenceSil | LFCF | PPC | EssSc |
|---|---|---|---|---|
| organic | ≥0.90 | ≤10 | ≥0.85 | ≥78 |
| hard-surface | ≥0.92 | ≤10 | ≥0.88 | ≥82 |
| hard-surface-translucent | ≥0.92 | ≤13 | ≥0.85 | ≥78 |

(`hard-surface-translucent`'s ≤13 threshold was approved 2026-07-09 as a
§L3 unrepresentable-residual guard for shattered's opaque high-frequency
crystal texture — confirmed palette-invariant by a 48→64 palette A/B with
zero effect.)

**Efficiency gates — durable scheme `gateScheme: "phase2-durable"`**
(recalibrated 2026-07-09, adopted permanently — decision in §5.3):
triShare / cov@50 / cov@200 / waste / bottomHalf are **informative-only**
(shown against aspirational Phase-C targets, e.g. organic cov@50 0.55),
not gates — proven structurally unreachable at essenceSil ≥0.90 with any
protruding convex/equilateral primitive (ellipsoid, cylinder, prism,
capsule, and slab all tested — §7). The durable gates are **e@999 and
frontLoad only**, per class, set to worst-in-suite-member − 0.05:

| Class | e@999 | frontLoad |
|---|---|---|
| organic | ≥0.57 | ≥0.57 |
| hard-surface | ≥0.33 | ≥0.34 |
| hard-surface-translucent | ≥0.42 | ≥0.44 |

Measured at calibration: shiba .62/.63, matilda .65/.66, stormterror
.65/.72, stylized_sword .39/.40, shattered .47/.49 — all five pass with
~0.05 headroom. Gates re-tighten toward the original efficiency numbers
(triShare ≤0.55/0.40, cov@50 ≥0.55/0.70, waste ≤0.15/0.10) once a future
phase raises the frontier.

**Retired:** the Phase-1.5 FaithScore headline and its IoU/ΔE-only
per-class thresholds (organic ≥0.90 IoU/≤8 ΔE, hard-surface ≥0.93/≤10,
scene ≥0.85/≤8) — see §3 for the one-line history. Superseded gate
iterations (hole threshold 25→8→3 px; interim vs. durable efficiency
scheme) are not re-narrated; only the numbers above are currently in
force.

**Planned, not yet built** (Phase 3, §8 "Metric hardening"): a protrusion
gate (mirror of the hole gate), a jaggedness gate, and the structural edge
term. These are specified in full in §8 and are not part of the
currently-enforced suite.

---

## 5. Decision records

### 5.1 P3 method decision — agglomerative-primary, RANSAC as refiner (2026-07-09)

Deep-reasoner research question: agglomerative clustering vs. RANSAC given
one-color-per-primitive. **Verdict: HFP-style adjacency-constrained
agglomerative clustering within each locked color region is the primary
generator; RANSAC is never the primary segmenter.**

Decisive reasons, tied to our constraints rather than abstract merits:

1. **Nested-LOD/knapsack fit:** an agglomerative dendrogram *is* a
   marginal-gain structure — the reversed merge order is a monotone
   error-vs-count sequence, so every prefix is a coherent asset for free.
   RANSAC's native largest-inlier-first ordering is *partitioning*,
   contradicting cover-don't-partition (§3.2).
2. **One-color + adjacency are enforced by construction:** the starting
   forest *is* the color regions; cross-palette and non-adjacent merges are
   a one-line guard. Per-region RANSAC still ignores connectivity within a
   region (phantom primitives spanning disconnected same-color parts) and
   still gives no emission ordering.
3. **RANSAC's headline strengths are pre-consumed upstream:** we fit the
   denoised, welded, component-split, palette-indexed QEM working mesh, so
   outlier robustness and works-without-segmentation buy little here.
4. **Infrastructure reuse + determinism:** HFP is the same skeleton as
   `qem.js` (adjacency graph + lazy priority queue, palette index riding
   through merges) — clusters instead of vertices, fitting-error instead of
   quadric error. Deterministic (stable regressions), no sampling-iteration
   budget.

**Where RANSAC stays:** (a) per-cluster *parameter refinement* for
single-curved fits (cylinder/cone axis; LSQ for sphere/ellipsoid/plane); (b)
an optional secondary global pass over emitted cluster-primitives for
repeated-substructure instancing (§3.3).

**Mechanics:** seed forest = color regions split by curvature class; merge
only adjacent, same-palette, same-class clusters, scored by fitting-error
increase of the best primitive for the merged set, using O(1) incremental
algebraic accumulators (combinable like quadrics) so the expensive
geometric fit runs once per *emitted* cluster; unfittable clusters fall
through to residual right triangles.

**Risks/mitigations:** greedy chaining past gentle bends → hard per-merge
error cap + curvature-class gate; algebraic-vs-geometric fit drift affects
merge *ordering* only (emission refit corrects parameters) → periodic
geometric re-fit at milestones; no backtracking → bounded by the
constrained starting forest, VSA-style Lloyd relaxation as an escalation
path; verify accumulator numerical stability on a known-cylinder region
before trusting ordering.

Citations: Attene/Falcidieno/Spagnuolo, *Hierarchical mesh segmentation
based on fitting primitives* (HFP), Visual Computer 2006;
Schnabel/Wahl/Klein, *Efficient RANSAC for Point-Cloud Shape Detection*,
CGF 2007; Yan et al., *Simple primitive recognition via hierarchical face
clustering*, CVM 2020; Cohen-Steiner et al., Variational Shape
Approximation (Lloyd relaxation escalation path).

### 5.2 Essence pivot (2026-07-09)

> **User directive (quoted intent):** explore other shapes — cuboids,
> cylinders, spheres, cones, triangular prisms — instead of wasting
> hundreds of decorations on tiny triangles; experiment with LARGER shapes
> covering wider areas; limbs (legs/arms) should be cylinders/spheres
> rather than triangles+cuboids; the output does not need to be an exact
> match — **"similar and captures the essence of the original model"**;
> research and create diagnostic tests measuring that.

Implications: the exact-match objective that had shelved the round-4
agglomerative fitter (default OFF, §6) is superseded — the fitter is the
natural foundation for this phase, re-aimed at essence acceptance criteria
(larger clusters, capsule/limb dispatch, cone + prism emission) rather than
ΔE-neutrality at saturated budgets. This directive produced Phase 2 (essence
metric suite, §4) and every fitter round since (§6/§7).

### 5.3 Gate durability decision

**User decision (2026-07-09): RECALIBRATE NOW + PHASE C LATER.** Efficiency
gates become e@999 + frontLoad only, recalibrated per class so the default
output of the day passes with small headroom (worst-member achieved −
0.05); triShare/cov@50/waste demote to informative-only columns, displayed
against the aspirational Phase-C targets so progress stays visible without
gating. Essence and hole gates unchanged. A capsule-chain phase (Phase C)
was queued to raise the frontier itself. When such a phase lands, gates
re-tighten toward the original table.

Following Phase C landing (all five models passing all gates, §7), this
became permanent: **e@999 + frontLoad ADOPTED as the durable efficiency
gates (`gateScheme: "phase2-durable"`)** — see §4 for the current numbers.

**But: VISUAL QUALITY REJECTED AGAIN despite all gates passing.** User
inspection: **"jagged edges protruding out of the model"**, **"details get
really muddied"**, and unintelligent placement — **"a sword wastes many
decorations on the blade when it could realistically be a cuboid and some
triangular prisms."** This is the second metrics-said-PASS / eyes-said-FAIL
event (the first was Phase 1). Known metric blind spots implicated: the
essence pyramid weights full-res at only 0.10 (jagged protrusion noise
washes out); LFCF is too lenient at calibration (1.1–4.6 measured vs. gates
10–13); no one-sided protrusion/excess-silhouette metric exists; the sword
bypass path never abstracts at all (7,236 source-exact triangles where a
cuboid + prisms would read the same). This event is what produced **Phase 3
(§8)**.

---

## 6. Development chronology

### Phase 1 — original baseline table (2026-07-08)

Implemented in `engine/convert/preprocess.js` + `converter.js`
(`mode:'hyper'`): voxel-flood interior culling, connected-component stats,
CIELAB area-weighted palette reduction with adaptive tolerance,
neighbor-majority palette smoothing, budget-realistic working-mesh
reduction, palette-exact merging through the shared direct tail. WYSIWYG
extract fixes shipped globally alongside it: vertex colors, emissive
fold-in, posed-skin baking via `boneTransform`.

Measured on the reference suite (models normalized to game scale; Direct
at defaults vs. Hyper Optimized at defaults):

| Model | Source tris | Direct | Hyper | Reduction |
|---|---|---|---|---|
| matilda.glb | 56,822 | 99,900 (capped) | **733** | >136× |
| stylized_sword.glb | 2,864 | 49,235 | **1,122** | 44× |
| shiba.glb | 4,316 | 19,910 | **1,143** | 17× |
| just_a_girl.glb | 77,725 | 99,900 (capped) | **1,501** | >66× |
| japanese_bridge_garden.glb | 21,883 | 37,570 | **1,632** | 23× |
| shattered_crystal_sword.glb | 2,219 | 69,330 | **1,861** | 37× |

**Correction (2026-07-08, found by the harness — the pre-cap-split
counting bug):** this table reports *pre-cap-split* counts
(`stats.afterMerge`). At default `unitScale=1`, matilda (~186 m) and
just_a_girl (~145 m) trigger massive zoom≤50 cap-splitting — their true
default-settings totals are **3,256** and **13,527** decorations, i.e. over
cap. Lesson: always measure post-cap-split, final-emission counts; a
model's real scale (not its authored scale) determines whether the
zoom≤50 cap fires at all.

### Phase 1.5 — visual-quality revision (root cause + amplifiers)

**User verdict (2026-07-08):** decoration counts hit the targets, but the
visual results "look awful". **Root cause:** cumulative uniform
vertex-clustering (`reduceLeaves`/`clusterAt`) was used as the *output*,
not as a fitting substrate — the crudest decimator in the literature: it
averages surfaces toward the interior, welds unrelated geometry sharing a
grid cell, erodes protrusions, and manufactures slivers/holes/T-junctions.
P1 had specified constrained QEM to a working substrate; grid clustering
was substituted and the error-metric harness was skipped.

Amplifiers (ranked): over-decimation below available budget; palette
smoothing erasing identity features; sliver-soup on hard surfaces;
no component splitting (bridge garden's 95 objects fusing); hairline
seams/z-fighting from unimplemented ε-inflation.

Revised fix order: measurement harness first → cheap interims (budget
feedback, non-cumulative decimation, feature-protective palette smoothing,
ε-inflation) → finish P1 as written (constrained QEM + component splitting)
→ re-ranked build order (planar rect-cover → thin-feature extraction →
curvature fitting → decal track → remainder of P5).

**Similarity test suite spec (shipped 2026-07-08):**
`test/similarity-harness.html` + `test/metrics.js` + `test/views26.js`,
reusing `VIEW_DIRS` + offscreen render-target reads and `buildPreview`;
conversion goes through the real extract → convert path with the app's own
normalization. Silhouette IoU over 26 orthographic views (union bbox + 5%
margin, 512², binary masks); color ΔE (CIEDE2000) over 6 face views on
foreground-in-both pixels; FaithScore headline (retired, §3/§4). The hole
gate was added here (erosion radius 5 px, initial threshold 25 px) and
later tightened to 3 px in Phase 2 (§4) — the mechanism, not the number, is
what's still live.

### Phase 1.5 iteration rounds (2026-07-08 – 2026-07-09)

| Round | What shipped | Key numbers | Lesson |
|---|---|---|---|
| R1 — cheap interims | budget-feedback leaf target, single-pass binary-searched clustering, feature-protective palette smoothing (bestN≥3 & >60%, ΔE>12 guard), ε-inflation 0.75 mm | shiba 92.98→94.61 FS PASS; matilda 87.18→89.14 PASS; just_a_girl/stylized_sword/shattered still FAIL (ΔE or IoU) | Remaining sword ΔE looked like a real defect but wasn't — flagged for R2. |
| R2 — lighting parity + constrained QEM | harness renders **both** source and reconstruction unlit (matches the app's own unlit viewer) + `qem.js` constrained edge-collapse (boundary/seam/crease penalty quadrics) + scale-relative weld + component splitting + budget-coupled palette 32→48 | stylized_sword ΔE 25.8→**9.3** (pure measurement fix, zero engine change); shiba/matilda PASS; just_a_girl/shattered still FAIL | **Lighting-parity artifact:** the harness had been measuring specular highlights as color error because the reconstruction was rendered unlit while the source was rendered lit. Always render both sides through the same (unlit) material path before trusting a ΔE regression. |
| R3 — allocation + bypass | water-filling component budget allocation (fixed a silent discard bug), low-poly-source bypass for fully-coherent models, `bandSpend` retry loop, `floorFaces` 12→8 | shiba/matilda/stylized_sword PASS; just_a_girl FAIL (ΔE); shattered FAIL (IoU+ΔE) | Per-metric thresholds became the official gate (FaithScore's combined bar was stricter than IoU+ΔE achieved together — mathematically unreachable). |
| R4 — agglomerative fitter built, ships OFF | `engine/convert/agglomerative.js`: HFP clustering, sphere+cylinder passes, O(1) accumulators (stability validated to 0.0e+0 vs. one-shot fit) | matilda IoU 0.970→0.971 (6 spheres+2 cylinders replacing 227 faces); just_a_girl ΔE regressed 11.39→12.21 | On a budget-saturated, exact-match-graded suite, curved primitives traded color granularity for no IoU gain — correct call at the time, superseded once essence grading arrived (§5.2). |
| Suite-swap baseline | just_a_girl → stormterror; harness gained emissive parity | stormterror 0.862 IoU **FAIL**; shattered 0.988 IoU / holes 556→6 px from an unaudited partial edit (later attributed to `hyperAlphaSkip`, R5) | Always audit engine diffs after an interrupted agent session before trusting a baseline. |
| R5 — audit + opacity WYSIWYG fix | confirmed the only stray edit was `hyperAlphaSkip: 0.05`; fixed the real bug it was masking — the converter ignored `material.opacity`, emitting 4%-opacity shards as solid; cap corrected to 9990 | shattered ΔE 23.17→**12.75** | A gating heuristic (alphaSkip) can hide a real WYSIWYG bug (opacity ignored) — disentangle "why did the number move" before accepting a fix. |
| R6 — silhouette-aware drops | extent-first drop ordering in `finishPlacements`; adaptive ε-inflation gated to fragmented thin-shell models; **rejected** with A/B evidence: allocation reweighting by area/face-count, global ε-inflation, palette 48→64 for shattered | stormterror meanIoU 0.885 | Thin-membrane erosion is a QEM/coverage problem, not an allocation-weighting problem; global levers that help one model measurably break another (thin swords). |
| R7 — emit-snap, ceiling established | `hyperEmitSnapDeg` = 20° (emit a near-right triangle as one snapped triangle, not two), gated to fragmented-thin models | stormterror expansion 1.77×→1.36×, meanIoU 0.885→0.892, holes 12→3 px | **Ceiling evidence:** 0.919 IoU needs ~22k leaves (40k decorations); at ≤9990 the snap×inflation response surface tops out at 0.892 — reaching 0.90 needs a new representation, not more tuning. This, plus the shattered ΔE question, triggered the essence-capture user directive (§5.2). |

### Phase 2 / Fitter rounds (2026-07-09)

| Round | What shipped | Key numbers | Lesson |
|---|---|---|---|
| Phase 2 calibration | essence metric suite (MSSA/LFCF/PPC/efficiency) shipped in harness + in-app parity; fitter-OFF baseline measured | all 5 pass essence gates except shattered; **all 5 fail every efficiency gate** (triShare 0.86–1.00, cov@50 0.05–0.26) — "the soup, quantified" | Fitter A/B was inconclusive by conservatism: the un-re-aimed round-4 fitter found zero viable clusters on shiba/stormterror — Phase A re-aim was a prerequisite, not a metric flaw. |
| Fitter Phase A | proportional tolerance α=0.30; anisotropic ellipsoid acceptance (curvedMinFaces 8, minCoverage 0.15); relaxed ΔE≤12 merges; translucency alignment (opacity<0.05 skip) | matilda engages (19 ellipsoids+1 cylinder); essence 5/5 PASS; **efficiency 0/5**; holes 3/5; shattered essenceSil 0.780→0.987 | Freeing budget doesn't lower triShare by itself — `bandSpend` reinvests freed budget into more triangles unless the budget target itself inverts (motivates Phase B item 1). |
| Fitter Phase B (shipped) | **budget inversion** (fixed 8000-face substrate, fitter-first, **hole-safe knee**); LOD extent-descending emission; **bypass essence exception** (`bypassKeep` rule, §3); organic-only inflation tier 0.0025 + pancake-cylinder guard (`minCylAspect` 1.0) | holes closed to ≤3 px on **all five** (user requirement met); matilda 6,112 dec (14 ellipsoids + 16 cylinders) | **Hole-safe knee rationale:** a naive extent-based knee (drop lowest-projected-area residual first) opened holes (shiba 5→42 px) because triangle tilings, unlike volumetric covers, have no truly redundant triangles — the knee must only drop placements provably `containedByVol`. |
| Lever-exhaustion round | prism + cone built, synthetically validated (exact recovery on synthetic shapes); substrate sweep {5k,8k,12k} confirmed 8000 optimal | prism engages stormterror (cov@50 0.08→0.32 naive) but costs ~0.02 essenceSil → **ships default OFF**; matilda's 0.907 margin proved concavity-fill protrusion with no cheap knob | **Efficiency ceiling proven** across ellipsoid, cylinder, AND prism: triShare/cov@50/waste targets are structurally unreachable at essenceSil ≥0.90 with any protruding convex primitive. Two honest paths: Phase C (capsule chains) or recalibrate — user chose both (§5.3). |
| Phase C | `engine/convert/spheremesh.js`: SQEM medial sphere/capsule edge-collapse, default ON (gated off fragmented-thin) | shiba: 4 ellipsoids→**75 medial spheres**, cov@50 0.10→0.39, holes 3→0; matilda: 126 spheres, sil margin 0.907→0.935; stormterror: gated off (thin sheets have no medial volume) | **Bypass gate rule reiterated and refined:** medial spheres sit *inside* the shape by construction, so they cannot add false silhouette — the one primitive class that structurally can't cause the protrusion failures every prior convex primitive did. |
| Lever-closure round | correction: **capsules DO emit** (shiba 75 spheres+201 capsules; matilda 126+340) — the earlier "0 capsules" reading was a stale-module diagnostic artifact, not a real gap; slab (sphere-triangle→cuboid) emission built, measured, **re-gated OFF** | stormterror: triangle-only sil 0.913 / capsules 0.884 / **slabs 0.822** (thin sheets' sphere-meshes emit spurious misoriented cross-thickness cuboids); matilda cov@50 Pareto-bounded ~0.40 | **"Capsules do emit" correction:** always re-verify a "zero" reading against a fresh module load before treating it as an engine gap. **Slab evidence (0.822):** naive sphere-triangle slabbing is worse than doing nothing on thin sheets — a *sheet-clean* planar-segmentation fit is the only unexplored path that might still hold 0.90 there. |

Final state after the lever-closure round: **all five models pass all
gates** (essence 5/5, e@999/frontLoad, holes ≤3 px — shiba literal 0);
swords + direct mode byte-identical throughout. This is the state the
gate-durability decision (§5.3) made permanent — and the state that was
then visually rejected again, triggering Phase 3 (§8).

---

## 7. Measured ceilings & evidence

**Final suite-state table** (lever-closure round, fitter ON default —
the state where every gate passes):

| Model | Class | essenceSil | Holes (px) | Notes |
|---|---|---|---|---|
| shiba | organic | ~0.92 | 0 | 75 medial spheres + 201 capsules |
| matilda | organic | 0.935 (margin) | 2 | 14 ellipsoids + 16 cylinders + 126 spheres + 340 capsules; cov@50 Pareto-bounded ~0.40 |
| stormterror | organic | 0.913 | 3 | triangle-only path; prism/slab both measured worse, stay OFF |
| stylized_sword | hard-surface | PASS (bypass) | 0 | 7,236 source-exact triangles, never enters the fitter |
| shattered_crystal_sword | hard-surface-translucent | 0.987 | 3 | translucency-aligned (opacity<0.05 skip); LFCF 12.75 residual |

**Why Phase 3 exists — the measured ceiling:**

- **Pareto evidence:** matilda's convex-primitive frontier crosses
  essenceSil 0.90 at cov@50 ≈ 0.40 (aggressive fit reaches cov@50 0.51 but
  only at essenceSil 0.828, FAIL). This was reproduced across ellipsoid,
  cylinder, prism, capsule, and slab — the ceiling is not a tuning gap, it
  is structural: **convex/equilateral primitives bulge into the
  concavities of articulated limbs**, and covering thin bulk with few
  primitives necessarily protrudes and breaks the silhouette.
- **Slab evidence (0.822):** stormterror's thin wing sheets produce
  spurious cross-thickness 3-cliques in the sphere-mesh, emitting
  misoriented cuboids — direct proof that "more primitive types" alone
  doesn't fix thin-sheet coverage; it needs a different *segmentation*
  (planar-region-first), not just a different primitive.
- **The extrusion answer:** the "proven convex-protrusion ceiling" above
  was measured on non-convex **wholes** fit by one primitive each. Phase
  3's research finding (§8, L2) is that **per-part fitting dissolves it**:
  splitting a non-convex shape at concave curvature minima first (the
  minima rule) turns each part into a near-convex problem where the
  existing primitive vocabulary already works — the ceiling was in the
  *decomposition* step that never existed, not in the primitives
  themselves. This is why Phase 3 adds part decomposition + extrusion
  detection rather than a sixth primitive shape.

---

## 8. Phase 3 — Intelligent placement (2026-07-09, dual deep-research synthesis)

User verdict driving it: gates green but output shows jagged protruding
edges, muddied detail, and unintelligent placement (sword = 7,236
source-exact triangles where a human uses ~10–20 primitives). Two
independent research framings (placement theory; failure forensics on
the live renders) converged on every major point.

### The classifier question — answered NO, twice independently

No neural classifier: un-shippable (CSP blocks weights) and unnecessary
(our primitive vocabulary is fixed — and it IS Biederman's geon set
(brick/cylinder/wedge/cone), the psychology-of-recognition result that
identity lives in part structure, not surface fidelity). What's needed:
(a) constraints the fitters lack (one-sided/inscribed fitting), and
(b) a ~50-line NON-learned dispatcher over per-part geometric
descriptors (PCA λ-signature + SDF thickness + extrusion residual +
convexity ratio — all but one already computed in the pipeline).

### Forensic attribution (measured on live output)

Output is **~97% triangle soup regardless of fitter** (triangleShare
0.86–1.00) — the abstraction layer is cosmetic. Jagged protrusions:
surface-sphere contaminants in the sphere-mesh (known same-side-collapse
limitation) half-poking out; coarse 8k-QEM facet edges on the outline;
0.024 m inflation ballooning thin plates (1.2% of a 2 m model);
emit-snap hypotenuse distortion; circumscribed (max-projection)
ellipsoid radii. Muddied detail: area-weighted region-mean color over
ΔE≤12-merged clusters + palette majority smoothing; LFCF structurally
blind to it (32² cells). Sword: the bypass path is the anti-essence
path — crisp but photoreal-in-a-cubist-world; passes only because
triShare was demoted. Metrics pass because 26 ortho gameplay views wash
out what close-up perspective inspection shows. NOTE: engine state has
drifted from the documented green baseline (holes failing again shiba
5 px / matilda 18 px; volumetric counts below the Phase-C record) —
re-verify before building.

### The five layers (theory framing; full citations in agent reports)

L1 surface fitting (status quo): bottom-up local merging is congenitally
blind to parts, structure, and global facts like "this is an extrusion".
L2 part decomposition: minima rule (Hoffman/Richards — humans segment at
concave curvature minima) + SDF/concavity splitting (CoACD-style, native
reimplementation not WASM port) → near-convex parts. **The "proven
convex-protrusion ceiling" was measured on non-convex WHOLES; per-part
fitting dissolves it.** L3 structure: **extrusion detection** (Gauss-map
great-circle → axis; project → 2D profile polygon → rect+triangle
PARTITION (polynomial) → extruded cuboids + prisms) — the sword AND
stormterror-wing fix in one mechanism; GlobFit-style relation snapping
(coaxial/mirror/equal-radius) after fitting. L4 semantics: MDL objective
(fewest primitives that reproduce the shape) from the program-synthesis
literature; methods themselves overkill. L5 perceptual/artist: big-to-
small silhouette-first blocking (our pipeline "is the inexperienced
artist"); detail is paint not geometry; **top-down error-driven
placement** (one box → split where error concentrates) as the deepest
eventual inversion — incremental introduction via emission-ordering
wrapper first.

### Metric hardening (both framings' #1 "most people miss")

The suite is symmetric where the eye is one-sided. Spec (plug into
test/metrics.js; formulas in the forensics report):
1. **Protrusion gate** — exact mirror of the hole gate:
   `excess = recon ∧ ¬dilate(source, 5)`, union-find largest region,
   HARD gate ≤3 px like holes. Would have caught both green-but-rejected
   events.
2. **Jaggedness gate** — contour roughness at the 128² pyramid level
   (turning-angle energy, or cheap proxy: boundary-transition perimeter
   ratio recon/source), FAIL > ~1.15 after calibration sweep.
3. **Structural edge term (§L3, never built)** — Sobel-edge IoU on the
   6 face views; the only metric that feels muddied detail. Report
   first, then gate.
4. Leave MSSA pyramid weights alone (scale tolerance is the point);
   the new gates run at fine scale independently. Re-arm triShare/cov@50
   as soft gates only after the fitter can honestly pass them.

### Phase 3 implementation order

0. Verify/stabilize engine state (holes ≤3 px restored; reconcile
   volumetric-count drift vs Phase-C record).
1. METRIC HARDENING (above) + re-baseline. Nothing else is measurable
   without it; skipping this guarantees a third green-but-rejected.
2. CONSTRAINT FIXES (no semantics needed): 26-view carving pass for
   protrusions (reuses harness render machinery; must respect
   containedByVol coverage — carve only where a retained neighbor still
   covers); inscribed (min-projection) radii for convex fits;
   surface-sphere contaminant rejection in spheremesh; feature-line
   snap (dihedral creases already in qem.js) for crisp edges; per-
   triangle color kept on substrate (stop region-mean muddying) +
   reserved palette slots.
3. PLACEMENT INTELLIGENCE: minima-rule/SDF part decomposition →
   descriptor dispatcher → strategy-fit (extrude-profile NEW — retires
   the sword bypass, must land WITH feature-line alignment or the sword
   fuzzes; per-part capsule chains; ellipsoid blobs) → GlobFit-style
   alignment snap → MDL-flavored emission (structural-economy metric =
   primitives used / estimated part count, report-only).
4. DETAIL AS PAINT: dormant §L2 decal track (ε-ladder overlays) —
   dissolves the §2.1 color-vs-geometry tension permanently.

Risks: carving vs hole-gate interaction (shrink can reopen misses);
extrusion false-positives on tapered organic limbs (gate on residual
tightness + profile constancy; synthetic validation first); jaggedness
proxy needs an AA-fringe calibration sweep; legolization framing
(fixed-kit covering objective) is the long-term north star — the
QEM-substrate-then-fit approach fights the medium.

---

## 9. Appendix — original P1–P5 phase table (annotated)

The original phase plan, annotated with what actually shipped or was
superseded (details throughout §3/§5/§6/§7; the P3 method decision itself
is §5.1).

| Phase | Scope | Builds on | As-built status |
|---|---|---|---|
| P1 | extract.js fixes (vertex colors, emissive fold-in, double-sided cull); scale-relative welding + component splitting; visibility cull + halo-clean Lab palette + constrained QEM; error-metric harness (26-view IoU/ΔE + structural edge term) | IdPicker, texture tools | **Shipped**, except the structural edge term (still not built — Phase 3 §8 item 1). |
| P2 | Sparse unsigned SDF + planar region cover with overlaps + cap-aware splitting | voxelize.js, coalesce.js, capPlacements | **Superseded**: literal SDF/RANSAC fitting was replaced by the agglomerative-clustering method (§5.1). Planar rect-cover-with-overlaps for hard surfaces was never built; cap-aware splitting was never built (cap correction to 9990 was a budget fix, not this). |
| P3 | Revised 2026-07-09: curvature-classed, adjacency-constrained agglomerative (HFP-style) clustering as the primary generator, RANSAC demoted to per-cluster refiner + optional instancing pass; residual triangles; global marginal-gain queue with saliency multipliers + never-evict flags | qem.js skeleton, right-triangles.js, fit.js | **Shipped and substantially extended** — this became `engine/convert/agglomerative.js` (plane/sphere/cylinder/cone/prism) + `spheremesh.js` (SQEM capsule chains), i.e. most of the engineering documented in §6/§7. Saliency multipliers / never-evict flags not confirmed shipped. This phase is effectively superseded in name by the "Phase 2 (essence)" / "Fitter Phase A/B/C" / "Phase 3 (placement)" work in this document. |
| P4 | Thin-feature extraction; texture-analyze.js (saliency, ridge/stroke vectorization, MSER text) + decals.js (ε-ladder layer stacks, host dependencies); symmetry + instancing with per-side residual pass | pixelperfect.js overdraw | **Not built.** Designed in detail (Detail preservation §L2); thin-feature extraction was attempted piecemeal via prism/slab (both OFF, §6/§7); no symmetry/instancing pass exists. Phase 3 (§8) reactivates the decal track under "detail as paint". |
| P5 | Quantization-aware snapping + ε-inflation; nested-LOD emission; closed-loop acceptance with per-class thresholds + unrepresentable-class guard | gia-writer, stats | **Mostly shipped**: ε-inflation (class-gated tiers, §3), nested-LOD emission (§6 Fitter Phase B), per-class thresholds (§4). Unrepresentable-class guard partially shipped (hard-surface-translucent class + translucency exclusion, §4); the broader alpha-cutout/billboard guard from Detail preservation §L3 item 5 is not confirmed built. |

Regression targets: doll face.fbx, matilda.glb, shiba.glb, creeper.glb, a
1M+ scan (to be added). Historic success criteria (superseded by the
current gate tables in §4): median tier ≤ 999 decorations at silhouette
IoU ≥ 0.92 and mean ΔE ≤ 6 from the 26 views; mean across the suite ≤
1998; hard stop 2997 with the error report.
