// Ground detail (P6 reskin, stage 5): grass tufts on grass, pebbles on paving and soil, bone shards on bone ground.
// Everything is drawn by code (no downloads) as three instanced meshes, so 2,000+ pieces cost three draw calls.
// The detail follows the terrain: grass that burns, floods or turns to ash loses its tufts (checked twice a second).
//   EGDetail.update(dt)   called by EGPost every frame
(function () {
  'use strict';
  const T = THREE;
  // seeded so every page load places the same pieces (the world props use a fixed seed too)
  let s = 0x5eed1e; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const kinds = [
    // on which ground, how many per cell (expected), geometry, colour
    { on: [TER.GRASS], per: .55, geo: () => { const g = new T.ConeGeometry(.07, .42, 3, 1, true); g.translate(0, .21, 0); return g; }, col: 0x3d5a34 },
    { on: [TER.PAVE, TER.SOIL, TER.MUD], per: .18, geo: () => new T.DodecahedronGeometry(.1, 0), col: 0x3e3b44 },
    { on: [TER.BONE], per: .5, geo: () => { const g = new T.CylinderGeometry(.03, .03, .32, 5); g.rotateZ(Math.PI / 2); return g; }, col: 0xcfc6ae },
  ];
  const sets = [];
  const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), v = new T.Vector3(), sc = new T.Vector3();
  function build() {
    for (const k of kinds) {
      const spots = [];
      for (let i = 0; i < GN * GN; i++) {
        if (!k.on.includes(TT[i])) continue;
        let n = k.per; while (n > 0) { if (rnd() < n) spots.push({ cell: i, x: (i % GN) - GH + rnd(), z: ((i / GN) | 0) - GH + rnd(), r: rnd() * 6.283, tilt: (rnd() - .5) * .5, size: .7 + rnd() * .7 }); n -= 1; }
      }
      const mesh = new T.InstancedMesh(k.geo(), new T.MeshLambertMaterial({ color: k.col }), spots.length);
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
      mesh.userData.detail = true; scene.add(mesh);
      sets.push({ k, mesh, spots, shown: new Uint8Array(spots.length) });
    }
    refresh(true);
  }
  function refresh(all) {
    for (const S of sets) {
      let changed = false;
      for (let j = 0; j < S.spots.length; j++) {
        const p = S.spots[j], want = S.k.on.includes(TT[p.cell]) ? 1 : 0;
        if (!all && want === S.shown[j]) continue;
        S.shown[j] = want; changed = true;
        e.set(p.tilt, p.r, p.tilt * .5); q.setFromEuler(e); v.set(p.x, 0, p.z); sc.setScalar(want ? p.size : 0);
        S.mesh.setMatrixAt(j, m4.compose(v, q, sc));
      }
      if (changed) S.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  let built = false, acc = 0, last = 0;
  const state = { pieces: 0, shown: 0 };
  function update() {
    if (!built) { build(); built = true; }
    const now = performance.now(); acc += last ? (now - last) / 1000 : 0; last = now; if (acc < .5) return; acc = 0;
    refresh(false);
    state.pieces = sets.reduce((a, S) => a + S.spots.length, 0); state.shown = sets.reduce((a, S) => a + S.shown.reduce((x, y) => x + y, 0), 0);
  }
  window.EGDetail = { update, refresh, state, sets };
})();
