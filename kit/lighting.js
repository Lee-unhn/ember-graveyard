// Light and shadow (P6 reskin, stage 4): moonlight shadows from props and characters, and a lantern that flickers.
// Shadows only at quality "high" (Settings > 畫質); switching quality recompiles the materials once.
//   EGLight.update(on)   called by EGPost every frame before drawing
(function () {
  'use strict';
  const T = THREE, SIZE = 26;                       // the shadow box follows the mage: 52 x 52 units around it
  const state = { shadows: false, casters: 0 };
  let tick = 0, t = 0;
  function setup() {
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    moon.shadow.mapSize.set(2048, 2048);
    Object.assign(moon.shadow.camera, { left: -SIZE, right: SIZE, top: SIZE, bottom: -SIZE, near: 1, far: 90 });
    moon.shadow.camera.updateProjectionMatrix();
    moon.shadow.bias = -0.0008; moon.shadow.normalBias = 0.04;
    moon.shadow.camera.layers.enableAll();          // the pixel-art characters live on another layer and must still cast
    scene.add(moon.target);
  }
  let ready = false;
  function mark() {                                  // opaque things cast; the ground and the terrain receive
    let n = 0;
    scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (o === ground || m === terrMat) { o.receiveShadow = true; return; }
      if (o.userData.detail) { o.receiveShadow = true; return; }   // grass and pebbles: too small to matter, 2,000+ of them
      if ((m.transparent && !egShadowBody(m)) || o.geometry.type === 'PlaneGeometry' || o.geometry.isInstancedBufferGeometry) return;
      o.castShadow = true; o.receiveShadow = true; n++;
    });
    state.casters = n;
  }
  function recompile() { scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; }); }
  function update(on) {
    if (!ready) { setup(); ready = true; }
    if (on !== state.shadows) { state.shadows = on; renderer.shadowMap.enabled = on; moon.castShadow = on; recompile(); }
    t += 1 / 60;
    // lantern flicker: two slow waves and a little noise, about +-10 %
    if (lampLight.intensity > 0) lampLight.intensity *= 1 + .06 * Math.sin(t * 7.3) + .04 * Math.sin(t * 13.1 + 1.7) + (Math.random() - .5) * .04;
    if (!on) return;
    // draw the shadow map once per frame: the pixel pass renders the scene twice more and must reuse it
    renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
    if (tick-- <= 0) { tick = 20; mark(); }           // monsters and loot come and go; re-mark a few times a second
    const p = player.pos;
    moon.position.set(p.x - 20, 30, p.z + 10); moon.target.position.set(p.x, 0, p.z); moon.target.updateMatrixWorld();
  }
  window.EGLight = { update, state };
})();
