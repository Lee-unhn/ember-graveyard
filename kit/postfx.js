// Post effects (P6 reskin): bloom, tilt-shift blur at the top and bottom of the screen, colour grading, vignette.
// Self-contained, no extra downloads. The page calls EGPost.render() instead of renderer.render(scene, camera);
// when the effects are off (Settings > 畫質 > 低) or WebGL cannot make the targets, it falls back to the plain render.
(function () {
  'use strict';
  const T = THREE;
  const quadCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new T.Scene();
  const quad = new T.Mesh(new T.PlaneGeometry(2, 2), null); quad.frustumCulled = false; quadScene.add(quad);
  const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const mat = (fs, uniforms) => new T.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });

  // bright parts only (for bloom)
  const brightMat = mat(`uniform sampler2D tSrc; uniform float uThr; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tSrc, vUv).rgb; float l = max(c.r, max(c.g, c.b));
      gl_FragColor = vec4(c * smoothstep(uThr, uThr + .25, l), 1.0); }`, { tSrc: { value: null }, uThr: { value: .62 } });
  // 9-tap separable blur
  const blurMat = mat(`uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
    void main(){ vec3 s = texture2D(tSrc, vUv).rgb * .227;
      s += (texture2D(tSrc, vUv + uDir * 1.385).rgb + texture2D(tSrc, vUv - uDir * 1.385).rgb) * .316;
      s += (texture2D(tSrc, vUv + uDir * 3.231).rgb + texture2D(tSrc, vUv - uDir * 3.231).rgb) * .070;
      gl_FragColor = vec4(s, 1.0); }`, { tSrc: { value: null }, uDir: { value: new T.Vector2() } });
  // final: sharp band in the middle, soft top and bottom; bloom added; grade; vignette
  const finalMat = mat(`uniform sampler2D tMain; uniform sampler2D tSoft; uniform sampler2D tBloom;
    uniform float uBloom, uTilt, uSat, uCon, uVig, uExp, uCA, uCAk; uniform vec3 uTint; varying vec2 vUv;
    void main(){
      vec3 sharp = texture2D(tMain, vUv).rgb, soft = texture2D(tSoft, vUv).rgb; if (uCA * uCAk > 0.0) { vec2 o = (vUv - .5) * uCA * uCAk; sharp.r = texture2D(tMain, vUv + o).r; sharp.b = texture2D(tMain, vUv - o).b; soft.r = texture2D(tSoft, vUv + o).r; soft.b = texture2D(tSoft, vUv - o).b; }
      float band = smoothstep(.18, .48, abs(vUv.y - .52));           // 0 in the middle band, 1 at the top and bottom edges
      vec3 c = mix(sharp, soft, band * uTilt);
      c += texture2D(tBloom, vUv).rgb * uBloom;
      c *= uExp;                                                     // lift: this scene is dark, contrast must not crush it further
      float l = dot(c, vec3(.299, .587, .114));
      c = mix(vec3(l), c, uSat);                                     // saturation
      c = max((c - .22) * uCon + .22, 0.0);                          // contrast around a dark pivot, so shadows are not pushed to black
      c *= mix(vec3(.92, .96, 1.08), vec3(1.08, 1.0, .9), smoothstep(.05, .6, l)); // cool shadows, warm highlights
      vec2 d = vUv - .5; c *= 1.0 - uVig * smoothstep(.35, .85, length(d * vec2(1.25, 1.0)));
      gl_FragColor = vec4(clamp(c * uTint, 0.0, 1.0), 1.0); }`,
  { tMain: { value: null }, tSoft: { value: null }, tBloom: { value: null }, uBloom: { value: .9 }, uTilt: { value: 1 }, uSat: { value: .9 }, uCon: { value: 1.1 }, uVig: { value: .3 }, uExp: { value: 1.22 }, uCA: { value: 0 }, uCAk: { value: 1 }, uTint: { value: new T.Vector3(1, 1, 1) } });

  let rt = null, soft = [], bloom = [], w = 0, h = 0, failed = false;
  const mk = (x, y) => new T.WebGLRenderTarget(x, y, { minFilter: T.LinearFilter, magFilter: T.LinearFilter, format: T.RGBAFormat, depthBuffer: false });
  function ensure() {
    const s = renderer.getDrawingBufferSize(new T.Vector2());
    if (rt && s.x === w && s.y === h) return true;
    w = s.x; h = s.y;
    for (const t of [rt, ...soft, ...bloom]) if (t) t.dispose();
    try {
      const MS = renderer.capabilities.isWebGL2 && T.WebGLMultisampleRenderTarget;
      rt = MS ? new T.WebGLMultisampleRenderTarget(w, h, { format: T.RGBAFormat }) : new T.WebGLRenderTarget(w, h, { format: T.RGBAFormat });
      if (MS) rt.samples = 4;
      soft = [mk(w >> 1, h >> 1), mk(w >> 1, h >> 1)];
      bloom = [mk(w >> 2, h >> 2), mk(w >> 2, h >> 2)];
      return true;
    } catch (e) { failed = true; return false; }
  }
  function pass(m, target) { quad.material = m; renderer.setRenderTarget(target); renderer.render(quadScene, quadCam); }
  function blur(src, a, b, steps) {
    let from = src;
    for (let i = 0; i < steps; i++) {
      blurMat.uniforms.tSrc.value = from; blurMat.uniforms.uDir.value.set(1 / a.width, 0); pass(blurMat, b);
      blurMat.uniforms.tSrc.value = b.texture; blurMat.uniforms.uDir.value.set(0, 1 / a.height); pass(blurMat, a);
      from = a.texture;
    }
  }
  const state = { on: false, frames: 0 };
  function render() {
    // SET is a top-level const of the page: shared by name between classic scripts, but not a property of window
    state.on = typeof SET !== 'undefined' && SET.fx === 'high' && !failed && ensure();
    if (window.EGDetail) EGDetail.update();                          // grass tufts and pebbles follow the terrain
    if (state.lite) {                                                // no graphics card: lighter picture (DEVLOG #59)
      if (window.EGMist) EGMist.state.on = false;
      if (window.EGDetail) for (const S of EGDetail.sets) S.mesh.visible = false;
      if (renderer.getPixelRatio() > .75) renderer.setPixelRatio(.75);
    }
    if (window.EGMist) EGMist.update();                              // drifting ground mist in three layers
    if (window.EGPixel) EGPixel.prepare();                            // characters move to their own layer, drawn as pixel art below
    if (window.EGLight) EGLight.update(typeof SET !== 'undefined' && SET.fx === 'high' && !failed); // shadows only at quality high
    if (!state.on) { renderer.setRenderTarget(null); renderer.render(scene, camera); if (window.EGPixel) EGPixel.overlay(null); return; }
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, camera);
    if (window.EGPixel) EGPixel.overlay(rt);                         // pixel-art characters drawn into the frame (stage 3)
    // soft copy for the tilt-shift edges
    blurMat.uniforms.tSrc.value = rt.texture; blur(rt.texture, soft[0], soft[1], 2);
    // bloom: bright pass at quarter size, blurred twice
    brightMat.uniforms.tSrc.value = rt.texture; pass(brightMat, bloom[0]); blur(bloom[0].texture, bloom[0], bloom[1], 2);
    Object.assign(finalMat.uniforms.tMain, { value: rt.texture }); finalMat.uniforms.tSoft.value = soft[0].texture; finalMat.uniforms.tBloom.value = bloom[0].texture;
    finalMat.uniforms.uCAk.value = SET.reduceShake ? 0 : 1; pass(finalMat, null);
    state.frames++;
  }
  // no graphics card (software rendering such as SwiftShader or llvmpipe): start at quality low on a first visit,
  // the effects and shadows would roughly double the frame time there (measured 112 vs 245 ms per frame)
  let swRender = false;
  try {
    const g = renderer.getContext(), ext = g.getExtension('WEBGL_debug_renderer_info');
    swRender = /swiftshader|llvmpipe|software|basic render/i.test(String(g.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : g.RENDERER)));
    let saved = null; try { saved = localStorage.getItem(EG_KEY('eg-settings')); } catch (e) {}
    if (swRender && !saved && typeof SET !== 'undefined') SET.fx = 'low';
  } catch (e) {}
  // lite picture without a graphics card: no mist, no ground detail, 0.75 render scale (measured 76.5 -> about 18 ms per frame)
  state.lite = swRender;
  state.software = swRender; state.bootFx = typeof SET !== 'undefined' ? SET.fx : '';
  window.EGPost = { render, state, uniforms: finalMat.uniforms, finalMat };
})();
