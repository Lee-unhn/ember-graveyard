// Layered ground mist (P6 reskin): three thin sheets of drifting fog between 0.3 and 1.2 m above the ground.
// Each sheet is a large plane with a soft noise texture drawn by code, scrolling at its own speed and direction,
// following the mage so the mist never ends. Lit like any other surface, so lanterns and spells light it up.
//   EGMist.update()   called by EGPost every frame
(function () {
  'use strict';
  const T = THREE, SIZE = 70, LAYERS = [{ y: .3, a: .16, sx: .010, sz: .004 }, { y: .7, a: .11, sx: -.006, sz: .007 }, { y: 1.2, a: .07, sx: .004, sz: -.009 }];
  // soft tileable noise, 256 x 256, white with varying alpha
  function noiseTex() {
    const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N);
    let s = 0x6d157; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const grid = (k) => { const a = []; for (let i = 0; i < k * k; i++) a.push(rnd()); return a; };
    const oct = [[4, grid(4), .5], [8, grid(8), .3], [16, grid(16), .2]];
    const smooth = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let v = 0;
      for (const [k, G, w] of oct) {                       // value noise that wraps at the edges, so the texture tiles
        const fx = x / N * k, fy = y / N * k, ix = Math.floor(fx), iy = Math.floor(fy), tx = smooth(fx - ix), ty = smooth(fy - iy);
        const at = (i, j) => G[((j % k) * k) + (i % k)];
        v += w * ((at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty);
      }
      const o = (y * N + x) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = 235;
      img.data[o + 3] = Math.max(0, Math.min(255, (v - .38) * 2.2 * 255));
    }
    g.putImageData(img, 0, 0);
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(5, 5); return t;
  }
  const sheets = [], state = { on: true, layers: 0 };
  let built = false, t0 = 0;
  function build() {
    const tex = noiseTex();
    for (const L of LAYERS) {
      const map = tex.clone(); map.needsUpdate = true;
      // 35 x 35 segments: Lambert lights per vertex, a bare quad would show no lantern glow (DEVLOG #54)
      const m = new T.Mesh(new T.PlaneGeometry(SIZE, SIZE, 35, 35), new T.MeshLambertMaterial({ map, color: 0xb8c4dc, transparent: true, opacity: L.a, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = L.y; m.renderOrder = 3; m.userData.mist = true; scene.add(m);
      sheets.push({ m, L });
    }
    state.layers = sheets.length;
  }
  function update() {
    if (!built) { build(); built = true; t0 = performance.now(); }
    const t = (performance.now() - t0) / 1000;
    for (const { m, L } of sheets) {
      m.visible = state.on;
      m.position.x = player.pos.x; m.position.z = player.pos.z;
      // the texture moves with the world, not with the sheet: offset by the sheet's position plus the drift
      const r = m.material.map.repeat.x / SIZE;
      m.material.map.offset.set(player.pos.x * r + t * L.sx, -player.pos.z * r + t * L.sz);
    }
  }
  window.EGMist = { update, state, sheets };
})();
