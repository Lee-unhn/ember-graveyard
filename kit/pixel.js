// Pixel-art characters in an HD scene (P6 reskin, stage 3).
// The mage and the monsters are drawn at a low resolution and scaled up with hard pixel edges; the ground, props,
// spells and light stay at full resolution. Tombstones and trees still hide the characters behind them: the low-res
// pass first writes the depth of every opaque prop, then draws the characters against that depth.
//   EGPixel.prepare()      put the characters on their own layer (called every frame by EGPost before rendering)
//   EGPixel.overlay(rt)    draw the pixel characters over a finished frame (rt = render target, or null for the screen)
(function () {
  'use strict';
  const T = THREE, CHAR = 1;
  const state = { on: true, scale: 0, chars: 0, w: 0, h: 0 };
  let low = null;
  const depthOnly = new T.MeshBasicMaterial({ colorWrite: false });
  const quadCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1), quadScene = new T.Scene();
  const blit = new T.Mesh(new T.PlaneGeometry(2, 2), new T.ShaderMaterial({
    uniforms: { tSrc: { value: null } }, transparent: true, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    // premultiplied in the target: straight alpha out
    fragmentShader: 'uniform sampler2D tSrc; varying vec2 vUv; void main(){ vec4 c = texture2D(tSrc, vUv); if (c.a < .5) discard; gl_FragColor = vec4(c.rgb, 1.0); }',
  }));
  blit.frustumCulled = false; quadScene.add(blit);

  const tag = (o) => o.traverse((c) => c.layers.set(CHAR));
  let lightTick = 0;
  function prepare() {
    let n = 0;
    if (window.EGP && EGP.g) { tag(EGP.g); n++; }
    if (typeof enemies !== 'undefined') for (const e of enemies) { tag(e.g); n++; }
    state.chars = n;
    // lights must reach both layers (three.js only uses lights visible to the camera's layers)
    if (lightTick-- <= 0) { lightTick = 30; scene.traverse((o) => { if (o.isLight) o.layers.enableAll(); }); }
  }
  // pixel size: about 270 low-res rows on any screen (2 px on a small window, 4 px at 1080p)
  function ensure() {
    const s = renderer.getDrawingBufferSize(new T.Vector2()), k = Math.max(2, Math.round(s.y / 270));
    const w = Math.ceil(s.x / k), h = Math.ceil(s.y / k);
    if (low && w === state.w && h === state.h) return;
    if (low) low.dispose();
    low = new T.WebGLRenderTarget(w, h, { minFilter: T.NearestFilter, magFilter: T.NearestFilter, format: T.RGBAFormat, depthBuffer: true });
    Object.assign(state, { scale: k, w, h });
  }
  const hidden = [];
  function overlay(target) {
    if (!state.on || !state.chars) return;
    ensure();
    const keepMask = camera.layers.mask, keepAuto = renderer.autoClear, keepAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(low); renderer.setClearAlpha(0); renderer.clear(true, true, true);
    renderer.autoClear = false;
    // 1. depth of the opaque props (transparent things such as particles, decals and the terrain overlay do not hide anyone)
    hidden.length = 0;
    scene.traverse((o) => { if ((o.isMesh || o.isPoints) && o.visible && o.layers.test(camera.layers) && o.material && (Array.isArray(o.material) ? o.material.some((m) => m.transparent) : o.material.transparent)) { o.visible = false; hidden.push(o); } });
    scene.overrideMaterial = depthOnly; camera.layers.set(0); renderer.render(scene, camera);
    scene.overrideMaterial = null; for (const o of hidden) o.visible = true;
    // 2. the characters, tested against that depth
    camera.layers.set(CHAR); renderer.render(scene, camera);
    camera.layers.mask = keepMask; renderer.autoClear = keepAuto; renderer.setClearAlpha(keepAlpha);
    // 3. scaled up with hard edges over the full-resolution frame
    blit.material.uniforms.tSrc.value = low.texture;
    renderer.setRenderTarget(target); renderer.autoClear = false; renderer.render(quadScene, quadCam); renderer.autoClear = keepAuto; // drawn on top, not clearing the frame
  }
  window.EGPixel = { prepare, overlay, state, CHAR };
})();
