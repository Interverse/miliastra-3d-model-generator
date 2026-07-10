// SHEET FITTER (planar-region segmentation -> inscribed oriented slab).
//
// Motivation (docs/decoration-reduction-plan.md, Organics rounds 7-11): cloth
// sheets have NO 1-D medial axis, so the sphere-mesh consumes almost none of a
// garment (matilda: ~752/8,151 faces) and the ~7,180-face residual over-caps by
// ~3,196 with no hole-safe reduction (drop/snap/merge/reach/protect all tear
// >=6 px). This fitter attacks the residual directly: grow near-planar regions on
// the substrate (normal coherence, curvature-bounded by the SEED normal), fit ONE
// inscribed oriented thin-cuboid (slab) per region, and REPLACE the region's
// interior faces (they leave the residual via the same consumed-faces provenance
// the sphere-mesh uses). Boundary/corner faces the slab does not cover stay
// residual and carry the exact silhouette. Each region = 1 decoration, so even a
// few hundred regions consuming a few thousand faces flips matilda under cap.
//
// NOT sphere-mesh 3-cliques (measured 0 yield on cloth). NOT per-row lens/strip
// machinery (the sword-arc lessons). Inscribed-only: over-cover NOTHING past the
// region silhouette (protrusion <=3 is the whole point).

import { eigSym3 } from './agglomerative.js';

export function bboxDiagOf(tris) {
  let mnx = 1/0, mny = 1/0, mnz = 1/0, mxx = -1/0, mxy = -1/0, mxz = -1/0;
  for (const t of tris) for (const q of t.p) {
    if (q.x < mnx) mnx = q.x; if (q.x > mxx) mxx = q.x; if (q.y < mny) mny = q.y;
    if (q.y > mxy) mxy = q.y; if (q.z < mnz) mnz = q.z; if (q.z > mxz) mxz = q.z;
  }
  return Math.max(mxx - mnx, mxy - mny, mxz - mnz) || 1;
}

// area-weighted mean color of a set of faces (glance-scale flat color per slab).
function regionColor(faces, tris, area) {
  let r = 0, g = 0, b = 0, w = 0;
  for (const f of faces) {
    const a = area[f] || 1e-9, c = tris[f].color;
    r += c[0] * a; g += c[1] * a; b += c[2] * a; w += a;
  }
  if (w <= 0) return tris[faces[0]].color;
  return [r / w, g / w, b / w];
}

// squared distance from point p to triangle abc (Ericson, Real-Time Collision
// Detection — closest point on triangle). Point-to-TRIANGLE, not point-to-vertex,
// so the protrusion self-check measures true overhang past the surface, not the
// distance to the nearest coarse-mesh vertex (which underestimates it).
function ptTriDist2(px,py,pz, ax,ay,az, bx,by,bz, cx,cy,cz) {
  const abx=bx-ax,aby=by-ay,abz=bz-az, acx=cx-ax,acy=cy-ay,acz=cz-az, apx=px-ax,apy=py-ay,apz=pz-az;
  const d1=abx*apx+aby*apy+abz*apz, d2=acx*apx+acy*apy+acz*apz;
  if (d1<=0 && d2<=0){ const dx=px-ax,dy=py-ay,dz=pz-az; return dx*dx+dy*dy+dz*dz; }
  const bpx=px-bx,bpy=py-by,bpz=pz-bz, d3=abx*bpx+aby*bpy+abz*bpz, d4=acx*bpx+acy*bpy+acz*bpz;
  if (d3>=0 && d4<=d3){ const dx=px-bx,dy=py-by,dz=pz-bz; return dx*dx+dy*dy+dz*dz; }
  const vc=d1*d4-d3*d2;
  if (vc<=0 && d1>=0 && d3<=0){ const v=d1/(d1-d3); const qx=ax+v*abx,qy=ay+v*aby,qz=az+v*abz; const dx=px-qx,dy=py-qy,dz=pz-qz; return dx*dx+dy*dy+dz*dz; }
  const cpx=px-cx,cpy=py-cy,cpz=pz-cz, d5=abx*cpx+aby*cpy+abz*cpz, d6=acx*cpx+acy*cpy+acz*cpz;
  if (d6>=0 && d5<=d6){ const dx=px-cx,dy=py-cy,dz=pz-cz; return dx*dx+dy*dy+dz*dz; }
  const vb=d5*d2-d1*d6;
  if (vb<=0 && d2>=0 && d6<=0){ const w=d2/(d2-d6); const qx=ax+w*acx,qy=ay+w*acy,qz=az+w*acz; const dx=px-qx,dy=py-qy,dz=pz-qz; return dx*dx+dy*dy+dz*dz; }
  const va=d3*d6-d5*d4;
  if (va<=0 && (d4-d3)>=0 && (d5-d6)>=0){ const w=(d4-d3)/((d4-d3)+(d5-d6)); const qx=bx+w*(cx-bx),qy=by+w*(cy-by),qz=bz+w*(cz-bz); const dx=px-qx,dy=py-qy,dz=pz-qz; return dx*dx+dy*dy+dz*dz; }
  const denom=1/(va+vb+vc), v=vb*denom, w=vc*denom;
  const qx=ax+abx*v+acx*w, qy=ay+aby*v+acy*w, qz=az+abz*v+acz*w;
  const dx=px-qx,dy=py-qy,dz=pz-qz; return dx*dx+dy*dy+dz*dz;
}

// Nearest source-TRIANGLE distance (uniform-grid spatial hash over triangle AABBs).
// Each triangle is bucketed into every cell its AABB overlaps so a large triangle
// passing near the query is found from a near cell. Used for the protrusion
// self-check: a slab sample farther than protrudeTol from every source triangle is
// poking into empty space past the model silhouette.
export function makeNearestTriDist(tris) {
  const n = tris.length;
  const V = new Float64Array(n * 9);
  let mnx=1/0,mny=1/0,mnz=1/0,mxx=-1/0,mxy=-1/0,mxz=-1/0;
  for (let f=0; f<n; f++){ const p=tris[f].p;
    for (let k=0;k<3;k++){ const q=p[k]; V[f*9+k*3]=q.x; V[f*9+k*3+1]=q.y; V[f*9+k*3+2]=q.z;
      if(q.x<mnx)mnx=q.x; if(q.x>mxx)mxx=q.x; if(q.y<mny)mny=q.y; if(q.y>mxy)mxy=q.y; if(q.z<mnz)mnz=q.z; if(q.z>mxz)mxz=q.z; } }
  const dim = Math.max(mxx-mnx,mxy-mny,mxz-mnz) || 1;
  const res = Math.max(1, Math.min(64, Math.round(Math.cbrt(n))));
  const cell = dim / res;
  const gx = Math.floor((mxx-mnx)/cell)+1, gy = Math.floor((mxy-mny)/cell)+1, gz = Math.floor((mxz-mnz)/cell)+1;
  const key = (ix,iy,iz) => (iz*gy+iy)*gx+ix;
  const clampi = (v,m) => v<0?0:v>=m?m-1:v;
  const ci = (v,mn,m) => clampi(Math.floor((v-mn)/cell), m);
  const buckets = new Map();
  for (let f=0; f<n; f++){
    let tnx=1/0,tny=1/0,tnz=1/0,txx=-1/0,txy=-1/0,txz=-1/0;
    for (let k=0;k<3;k++){ const x=V[f*9+k*3],y=V[f*9+k*3+1],z=V[f*9+k*3+2];
      if(x<tnx)tnx=x;if(x>txx)txx=x;if(y<tny)tny=y;if(y>txy)txy=y;if(z<tnz)tnz=z;if(z>txz)txz=z; }
    const ix0=ci(tnx,mnx,gx),ix1=ci(txx,mnx,gx),iy0=ci(tny,mny,gy),iy1=ci(txy,mny,gy),iz0=ci(tnz,mnz,gz),iz1=ci(txz,mnz,gz);
    for(let iz=iz0;iz<=iz1;iz++)for(let iy=iy0;iy<=iy1;iy++)for(let ix=ix0;ix<=ix1;ix++){ const kk=key(ix,iy,iz); let b=buckets.get(kk); if(!b){b=[];buckets.set(kk,b);} b.push(f); }
  }
  const seen = new Int32Array(n).fill(-1);
  let gen = 0;
  return (x,y,z) => {
    const cxi=ci(x,mnx,gx),cyi=ci(y,mny,gy),czi=ci(z,mnz,gz);
    let best2 = Infinity; gen++;
    const maxg = Math.max(gx,gy,gz);
    for (let rad=0; rad<maxg; rad++){
      for (let iz=czi-rad; iz<=czi+rad; iz++){ if(iz<0||iz>=gz)continue;
        for (let iy=cyi-rad; iy<=cyi+rad; iy++){ if(iy<0||iy>=gy)continue;
          for (let ix=cxi-rad; ix<=cxi+rad; ix++){ if(ix<0||ix>=gx)continue;
            if(rad>0 && Math.abs(ix-cxi)<rad && Math.abs(iy-cyi)<rad && Math.abs(iz-czi)<rad) continue;
            const b=buckets.get(key(ix,iy,iz)); if(!b)continue;
            for(const f of b){ if(seen[f]===gen)continue; seen[f]=gen;
              const d2=ptTriDist2(x,y,z, V[f*9],V[f*9+1],V[f*9+2], V[f*9+3],V[f*9+4],V[f*9+5], V[f*9+6],V[f*9+7],V[f*9+8]);
              if(d2<best2)best2=d2; } } } }
      if (best2<Infinity && (rad*cell)*(rad*cell)>best2) break;
    }
    return Math.sqrt(best2);
  };
}

export function sheetFit(triangles, opts = {}) {
  const n = triangles.length;
  const consumedFaces = new Set();
  const placements = [];
  const stats = { regions: 0, accepted: 0, consumed: 0, rejSmall: 0, rejThick: 0, rejConsume: 0, rejProtrude: 0, faces: n };
  if (!n) return { placements, residual: triangles, consumedFaces, stats };

  const diag = bboxDiagOf(triangles);
  const eps = diag * (opts.weldFrac ?? 1e-4) || 1e-9;

  // --- weld vertices, per-face normal / centroid / area / welded vert ids ---
  const vmap = new Map();
  const vpos = [];
  const idOf = (q) => {
    const k = Math.round(q.x / eps) + ',' + Math.round(q.y / eps) + ',' + Math.round(q.z / eps);
    let id = vmap.get(k);
    if (id === undefined) { id = vpos.length; vpos.push([q.x, q.y, q.z]); vmap.set(k, id); }
    return id;
  };
  const fv = new Int32Array(n * 3);
  const fn = new Float64Array(n * 3);   // face unit normal
  const fcent = new Float64Array(n * 3); // face centroid (strip bucketing)
  const farea = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    const [A, B, C] = triangles[f].p;
    fv[f*3] = idOf(A); fv[f*3+1] = idOf(B); fv[f*3+2] = idOf(C);
    const ux = B.x - A.x, uy = B.y - A.y, uz = B.z - A.z;
    const vx = C.x - A.x, vy = C.y - A.y, vz = C.z - A.z;
    let nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    fn[f*3] = nx/nl; fn[f*3+1] = ny/nl; fn[f*3+2] = nz/nl;
    fcent[f*3] = (A.x+B.x+C.x)/3; fcent[f*3+1] = (A.y+B.y+C.y)/3; fcent[f*3+2] = (A.z+B.z+C.z)/3;
    farea[f] = 0.5 * nl;
  }

  // --- edge adjacency (welded) ---
  const emap = new Map();  // "a:b" -> first face; on second hit record neighbor pair
  const nbr = Array.from({ length: n }, () => []);
  const ekey = (a, b) => a < b ? a + ':' + b : b + ':' + a;
  for (let f = 0; f < n; f++) {
    const a = fv[f*3], b = fv[f*3+1], c = fv[f*3+2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = ekey(u, v);
      const prev = emap.get(k);
      if (prev === undefined) emap.set(k, f);
      else { nbr[f].push(prev); nbr[prev].push(f); }
    }
  }

  // --- region growing: BFS bounded by SEED normal (|cos| >= cos(planarAngle))
  //     so each region is a near-planar patch (curvature-bounded). Double-sided
  //     safe: absolute dot treats a flipped-winding neighbor as coherent. Optional
  //     color bound keeps a slab one-color (avoids muddying across a seam). ---
  const planarCos = Math.cos((opts.planarAngleDeg ?? 20) * Math.PI / 180);
  const colorTol = opts.colorTol ?? 1e9;   // Euclidean sRGB distance bound (optional)
  const region = new Int32Array(n).fill(-1);
  const regions = [];
  for (let seed = 0; seed < n; seed++) {
    if (region[seed] >= 0) continue;
    const snx = fn[seed*3], sny = fn[seed*3+1], snz = fn[seed*3+2];
    const sc = triangles[seed].color;
    const rid = regions.length;
    region[seed] = rid;
    const faces = [seed];
    const stack = [seed];
    while (stack.length) {
      const f = stack.pop();
      for (const g of nbr[f]) {
        if (region[g] >= 0) continue;
        const d = Math.abs(fn[g*3]*snx + fn[g*3+1]*sny + fn[g*3+2]*snz);
        if (d < planarCos) continue;
        if (colorTol < 1e8) {
          const gc = triangles[g].color;
          const cd = Math.hypot(gc[0]-sc[0], gc[1]-sc[1], gc[2]-sc[2]);
          if (cd > colorTol) continue;
        }
        region[g] = rid; faces.push(g); stack.push(g);
      }
    }
    regions.push(faces);
  }
  stats.regions = regions.length;

  // --- per-region inscribed slab fit ---
  const minRegionFaces = opts.minRegionFaces ?? 6;
  const thinFrac = opts.thinFrac ?? 0.35;       // reject regions thicker than this * inPlane
  const inscribeMax = opts.inscribe ?? 0.95;    // upper bound of the in-plane shrink search
  const inscribeMin = opts.inscribeMin ?? 0.3;  // below this, the non-poking core is too small -> reject
  const thickCover = opts.thickCover ?? 0.15;   // slab thickness over-cover (close the membrane)
  const reachTol = diag * (opts.reachTol ?? 0.010);
  const minConsume = opts.minConsume ?? minRegionFaces;  // acceptance floor (sweep lever)
  // PROTRUSION SELF-CHECK (round 2): source-surface nearest-distance. A slab sample
  // whose nearest source vertex is farther than protrudeTol is poking into empty
  // space past the model silhouette. Built from the FULL model (opts.sourceTris)
  // so poking toward the (hidden, interior) body is allowed and only silhouette
  // overhang is rejected. selfCheck:false restores round-1 uniform-inscribe behavior.
  const selfCheck = opts.selfCheck !== false;
  const protrudeTol = diag * (opts.protrudeTolFrac ?? 0.012);
  const nearest = selfCheck ? makeNearestTriDist(opts.sourceTris ?? triangles) : null;
  // STRIP MACHINERY (round 4): curved regions can't be one flat slab without tangent
  // protrusion past the silhouette (round-3 diagnosis). Split a curved region into
  // strips NARROW across the fold's high-curvature direction (long along the crest),
  // each strip near-flat across its width -> minimal tangent protrusion. Crest axis =
  // smallest eigenvector of the face-normal covariance (normals are constant along
  // the crest, sweep across it). stripWidth is the protrusion<->count tunable.
  const strips = opts.strips !== false;
  const stripWidth = diag * (opts.stripWidthFrac ?? 0.05);
  const stripLen = diag * (opts.stripLenFrac ?? 0.12);   // cap length too (crest curvature -> end protrusion)
  const minStripFaces = opts.minStripFaces ?? 3;
  const stripCurvThresh = opts.stripCurvThresh ?? 0.03;  // normal-cov mid/largest above which a region is stripped
  stats.rejProtrude = 0; stats.strips = 0; let sSum = 0;

  // Fit + emit one slab for a face list (its own PCA + adaptive self-check). Returns
  // consumed count; 0 on any rejection (faces stay in the residual — provenance).
  const tryFitSlab = (fl) => {
    if (fl.length < 1) return 0;
    const vset = new Set();
    for (const f of fl) { vset.add(fv[f*3]); vset.add(fv[f*3+1]); vset.add(fv[f*3+2]); }
    const verts = [...vset];
    if (verts.length < 3) return 0;
    let cx=0,cy=0,cz=0;
    for (const id of verts) { const p=vpos[id]; cx+=p[0]; cy+=p[1]; cz+=p[2]; }
    cx/=verts.length; cy/=verts.length; cz/=verts.length;
    let c00=0,c01=0,c02=0,c11=0,c12=0,c22=0;
    for (const id of verts) { const p=vpos[id], dx=p[0]-cx,dy=p[1]-cy,dz=p[2]-cz;
      c00+=dx*dx; c01+=dx*dy; c02+=dx*dz; c11+=dy*dy; c12+=dy*dz; c22+=dz*dz; }
    const eig = eigSym3([c00,c01,c02,c11,c12,c22]);
    const nrm=eig.vectors[0], u1=eig.vectors[1], u2=eig.vectors[2];
    let e0=0,e1=0,e2=0;
    for (const id of verts) { const p=vpos[id], dx=p[0]-cx,dy=p[1]-cy,dz=p[2]-cz;
      e0=Math.max(e0,Math.abs(dx*nrm[0]+dy*nrm[1]+dz*nrm[2]));
      e1=Math.max(e1,Math.abs(dx*u1[0]+dy*u1[1]+dz*u1[2]));
      e2=Math.max(e2,Math.abs(dx*u2[0]+dy*u2[1]+dz*u2[2])); }
    const inPlane=Math.max(e1,e2);
    if (inPlane<eps) return 0;
    if (e0 > thinFrac*inPlane) { stats.rejThick++; return 0; }   // still too curved -> stays residual
    const thick=Math.max(2*e0,eps)*(1+thickCover), halfT=thick/2;
    let s = inscribeMax;
    if (nearest) {
      const pokes = (ss) => {
        const a=e1*ss,b=e2*ss;
        for (let si=-1;si<=1;si+=2) for (let sj=-1;sj<=1;sj+=2) for (let sk=-1;sk<=1;sk+=2) {
          if (nearest(cx+si*a*u1[0]+sj*b*u2[0]+sk*halfT*nrm[0], cy+si*a*u1[1]+sj*b*u2[1]+sk*halfT*nrm[1], cz+si*a*u1[2]+sj*b*u2[2]+sk*halfT*nrm[2]) > protrudeTol) return true;
        }
        for (const [ma,mb] of [[a,0],[-a,0],[0,b],[0,-b]]) {
          if (nearest(cx+ma*u1[0]+mb*u2[0], cy+ma*u1[1]+mb*u2[1], cz+ma*u1[2]+mb*u2[2]) > protrudeTol) return true;
        }
        return false;
      };
      if (pokes(inscribeMax)) {
        if (pokes(inscribeMin)) { stats.rejProtrude++; return 0; }
        let lo=inscribeMin, hi=inscribeMax;
        for (let it=0; it<7; it++) { const mid=(lo+hi)/2; if (pokes(mid)) hi=mid; else lo=mid; }
        s=lo;
      }
    }
    const h1=e1*s, h2=e2*s;
    const insideV = (id) => { const p=vpos[id], dx=p[0]-cx,dy=p[1]-cy,dz=p[2]-cz;
      return Math.abs(dx*nrm[0]+dy*nrm[1]+dz*nrm[2])<=thick/2+reachTol && Math.abs(dx*u1[0]+dy*u1[1]+dz*u1[2])<=h1+reachTol && Math.abs(dx*u2[0]+dy*u2[1]+dz*u2[2])<=h2+reachTol; };
    const cover=[];
    for (const f of fl) if (insideV(fv[f*3])&&insideV(fv[f*3+1])&&insideV(fv[f*3+2])) cover.push(f);
    if (cover.length < minConsume) { stats.rejConsume++; return 0; }
    sSum += s;
    const R = [[u1[0],nrm[0],u2[0]],[u1[1],nrm[1],u2[1]],[u1[2],nrm[2],u2[2]]];
    placements.push({ kind:'square', fullY:true, _slab:true, position:{x:cx,y:cy,z:cz},
      rotation:R, scale:{x:2*h1,y:thick,z:2*h2}, color:regionColor(cover,triangles,farea), area:4*h1*h2 });
    for (const f of cover) consumedFaces.add(f);
    stats.accepted++;
    return cover.length;
  };

  for (const faces of regions) {
    if (faces.length < minRegionFaces) { stats.rejSmall++; continue; }
    // region PCA to decide flat vs curved and get the tangent frame + centroid
    const vset = new Set();
    for (const f of faces) { vset.add(fv[f*3]); vset.add(fv[f*3+1]); vset.add(fv[f*3+2]); }
    const verts = [...vset];
    let cx=0,cy=0,cz=0;
    for (const id of verts) { const p=vpos[id]; cx+=p[0]; cy+=p[1]; cz+=p[2]; }
    cx/=verts.length; cy/=verts.length; cz/=verts.length;
    let c00=0,c01=0,c02=0,c11=0,c12=0,c22=0;
    for (const id of verts) { const p=vpos[id], dx=p[0]-cx,dy=p[1]-cy,dz=p[2]-cz;
      c00+=dx*dx; c01+=dx*dy; c02+=dx*dz; c11+=dy*dy; c12+=dy*dz; c22+=dz*dz; }
    const reig = eigSym3([c00,c01,c02,c11,c12,c22]);
    const rnrm = reig.vectors[0];
    let inPlane=0;
    for (const id of verts) { const p=vpos[id], dx=p[0]-cx,dy=p[1]-cy,dz=p[2]-cz;
      inPlane=Math.max(inPlane, Math.abs(dx*reig.vectors[1][0]+dy*reig.vectors[1][1]+dz*reig.vectors[1][2]), Math.abs(dx*reig.vectors[2][0]+dy*reig.vectors[2][1]+dz*reig.vectors[2][2])); }
    if (inPlane < eps) { stats.rejSmall++; continue; }
    // face-normal covariance: a FLAT region has one dominant eigenvalue (normals
    // parallel); a CURVED/cylindrical region has TWO (normals sweep a plane) with the
    // crest = smallest eigenvector. curv = mid/largest is the strip trigger (position
    // thinness underestimates curvature — a wide shallow arc is thin but curved).
    let m00=0,m01=0,m02=0,m11=0,m12=0,m22=0;
    for (const f of faces) { const nx=fn[f*3],ny=fn[f*3+1],nz=fn[f*3+2];
      m00+=nx*nx; m01+=nx*ny; m02+=nx*nz; m11+=ny*ny; m12+=ny*nz; m22+=nz*nz; }
    const neig = eigSym3([m00,m01,m02,m11,m12,m22]);
    const curv = neig.values[2] > 1e-12 ? neig.values[1]/neig.values[2] : 0;
    if (!strips || curv < stripCurvThresh) { tryFitSlab(faces); continue; }
    const crest = neig.vectors[0];   // least normal variation = fold crest / cylinder axis
    // crest projected into the region tangent plane, then across = rnrm x crestT
    let ctx = crest[0]-(crest[0]*rnrm[0]+crest[1]*rnrm[1]+crest[2]*rnrm[2])*rnrm[0];
    let cty = crest[1]-(crest[0]*rnrm[0]+crest[1]*rnrm[1]+crest[2]*rnrm[2])*rnrm[1];
    let ctz = crest[2]-(crest[0]*rnrm[0]+crest[1]*rnrm[1]+crest[2]*rnrm[2])*rnrm[2];
    let cl = Math.hypot(ctx,cty,ctz);
    if (cl < 1e-9) { tryFitSlab(faces); continue; }   // degenerate crest -> single slab
    ctx/=cl; cty/=cl; ctz/=cl;
    const ax = rnrm[1]*ctz - rnrm[2]*cty, ay = rnrm[2]*ctx - rnrm[0]*ctz, az = rnrm[0]*cty - rnrm[1]*ctx;
    const al = Math.hypot(ax,ay,az) || 1;
    const acx=ax/al, acy=ay/al, acz=az/al;
    // bucket faces by across-projection (strip index) AND along-crest projection
    // (length segment) so a strip whose crest curves is cut into near-flat pieces.
    const byStrip = new Map();
    for (const f of faces) {
      const dx=fcent[f*3]-cx, dy=fcent[f*3+1]-cy, dz=fcent[f*3+2]-cz;
      const across = dx*acx+dy*acy+dz*acz, along = dx*ctx+dy*cty+dz*ctz;
      const si = Math.floor(across/stripWidth), li = Math.floor(along/stripLen);
      const key = si*100000 + li;
      let g=byStrip.get(key); if(!g){g=[];byStrip.set(key,g);} g.push(f);
    }
    for (const g of byStrip.values()) { if (g.length >= minStripFaces) { stats.strips++; tryFitSlab(g); } }
  }
  stats.consumed = consumedFaces.size;
  stats.avgInscribe = stats.accepted ? +(sSum / stats.accepted).toFixed(3) : 0;
  return { placements, residual: triangles, consumedFaces, stats };
}
