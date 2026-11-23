// Night look and light (optional engine module). A content pack that sets CONTENT.look restyles the night and its lights
// without touching rules, collisions or the random sequence: clear colour, fog, ambient and moon colours and strengths,
// the ground mist, stepped point light on the ground with dithered band edges, a tint and self-glow per terrain type,
// fill light for pixel sprites, the towers' lights, halos and flame, and decorations placed by the pack (with optional lights).
// kit/character.js loads this file only when CONTENT.look exists, so a page without it never runs it.
// Field format: kit/CONTENT-API.md, section CONTENT.look.
//   EGLook.state         on, frames, counts, what was patched, last error
//   EGLook.validate(v)   problems in a CONTENT.look value ([] = usable)
// Draws no random numbers: seeded measurements (EG.seed) get the same sequence with or without this module.
(function () {
  'use strict';
  const T = THREE, L = window.CONTENT && CONTENT.look;
  const state = { on: false, frames: 0, mats: 0, glowCells: 0, glowUploads: 0, decor: 0, lights: 0, halos: 0, decorReady: false, patched: [], flame: 'engine', err: '' };
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v), num = (v) => typeof v === 'number' && isFinite(v);
  const warn = (m) => { if (typeof cwarn === 'function') cwarn(m); else console.warn('[content] ' + m); };
  const NEAR = ['tower', 'tomb', 'tree', 'sarc'], MAX_LIGHTS = 16;

  // ---------------------------------------------------------------- validation (wrong types switch the whole module off; unknown keys only warn)
  const colOk = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) || Number.isInteger(v) && v >= 0 && v <= 0xffffff;
  function validate(v) {
    const bad = [], C = 'CONTENT.look', W = (w, m) => bad.push(w + ' 要是' + m);
    const keys = (o, known, w) => { for (const k of Object.keys(o)) if (!known.includes(k)) warn(w + '.' + k + ' 不是可用的欄位，略過'); };
    const obj = (x, w) => { if (x === undefined) return false; if (!isObj(x)) { W(w, '物件'); return false; } return true; };
    const col = (x, w) => { if (x !== undefined && !colOk(x)) W(w, '顏色（"#rrggbb" 或 0 到 0xffffff 的整數）'); };
    const nn = (x, w) => { if (x !== undefined && !(num(x) && x >= 0)) W(w, '0 以上的數字'); };
    const pos = (x, w) => { if (x !== undefined && !(num(x) && x > 0)) W(w, '大於 0 的數字'); };
    const unit = (x, w) => { if (x !== undefined && !(num(x) && x >= 0 && x <= 1)) W(w, '0 到 1 的數字'); };
    const any = (x, w) => { if (x !== undefined && !num(x)) W(w, '數字'); };
    const halo = (h, w) => { if (!obj(h, w)) return; keys(h, ['color', 'size', 'y', 'peak'], w); col(h.color, w + '.color'); pos(h.size, w + '.size'); any(h.y, w + '.y'); nn(h.peak, w + '.peak'); };
    if (!isObj(v)) return [C + ' 要是物件'];
    keys(v, ['clear', 'fog', 'hemi', 'moon', 'highMul', 'mist', 'terrain', 'steps', 'towers', 'actors', 'props', 'decor'], C);
    col(v.clear, C + '.clear'); nn(v.highMul, C + '.highMul');
    for (const [k, cs] of [['fog', ['color']], ['hemi', ['sky', 'ground']], ['moon', ['color']], ['mist', ['color']]]) {
      const o = v[k], w = C + '.' + k; if (!obj(o, w)) continue; keys(o, [...cs, 'mul'], w); for (const c of cs) col(o[c], w + '.' + c); nn(o.mul, w + '.mul'); }
    if (obj(v.terrain, C + '.terrain')) for (const [k, o] of Object.entries(v.terrain)) { const w = C + '.terrain.' + k;
      if (k !== 'default' && !(k in TER)) { warn(w + ' 不是地形名（' + Object.keys(TER).join('、') + '），略過'); continue; }
      if (!obj(o, w)) continue; keys(o, ['tint', 'glow'], w);
      if (o.tint !== undefined && !(Array.isArray(o.tint) && o.tint.length === 3 && o.tint.every((x) => num(x) && x >= 0 && x <= 1))) W(w + '.tint', '三個 0 到 1 的數字 [r, g, b]');
      unit(o.glow, w + '.glow'); }
    if (obj(v.steps, C + '.steps')) { const w = C + '.steps'; keys(v.steps, ['perUnit', 'dither'], w); nn(v.steps.perUnit, w + '.perUnit'); unit(v.steps.dither, w + '.dither'); }
    if (obj(v.towers, C + '.towers')) { const o = v.towers, w = C + '.towers'; keys(o, ['y', 'distance', 'mul', 'colors', 'halo', 'flame'], w);
      any(o.y, w + '.y'); pos(o.distance, w + '.distance'); nn(o.mul, w + '.mul'); halo(o.halo, w + '.halo');
      if (o.colors !== undefined) { if (!Array.isArray(o.colors)) W(w + '.colors', '顏色陣列（依塔的順序）'); else o.colors.forEach((c, i) => col(c, w + '.colors[' + i + ']')); }
      if (o.flame !== undefined && typeof o.flame !== 'boolean' && !num(o.flame)) W(w + '.flame', ' true（照舊）、false（不放火焰粒子）或火焰的高度（公尺）'); }
    for (const k of ['actors', 'props']) { const o = v[k], w = C + '.' + k; if (!obj(o, w)) continue; keys(o, ['diffuse', 'fill', 'fillColor'], w); nn(o.diffuse, w + '.diffuse'); nn(o.fill, w + '.fill'); col(o.fillColor, w + '.fillColor'); }
    if (v.decor !== undefined) {
      if (!Array.isArray(v.decor)) W(C + '.decor', '陣列（每項一組裝飾）');
      else v.decor.forEach((d, i) => { const w = C + '.decor[' + i + ']'; if (!obj(d, w)) return;
        keys(d, ['atlas', 'image', 'meta', 'cell', 'shrink', 'near', 'at', 'share', 'block', 'light', 'halo', 'flicker'], w);
        const sp = window.CONTENT && CONTENT.sprites, atl = sp && isObj(sp.atlases) ? sp.atlases : {};
        if (d.atlas !== undefined) { if (!(typeof d.atlas === 'string' && isObj(atl[d.atlas]))) W(w + '.atlas', ' CONTENT.sprites.atlases 裡的一個名字'); }
        else if (!(typeof d.image === 'string' && d.image && (typeof d.meta === 'string' && d.meta || isObj(d.meta)))) W(w, '有 atlas（圖集名），或 image（圖檔路徑）加 meta（JSON 路徑或物件）');
        if (!(Number.isInteger(d.cell) && d.cell >= 0 || Array.isArray(d.cell) && d.cell.length === 2 && d.cell.every((x) => Number.isInteger(x) && x >= 0))) W(w + '.cell', '格子編號（0 起的整數）或 [排, 欄]');
        if (d.shrink !== undefined && !(Number.isInteger(d.shrink) && d.shrink >= 1 && d.shrink <= 8)) W(w + '.shrink', ' 1 到 8 的整數');
        if (d.near !== undefined && !NEAR.includes(d.near)) W(w + '.near', NEAR.join('、') + ' 其中之一');
        const pts = d.at === undefined && d.near ? [[0, 0]] : d.at;
        if (!(Array.isArray(pts) && pts.length > 0 && pts.every((p) => Array.isArray(p) && p.length === 2 && p.every(num)))) W(w + '.at', d.near ? '[[x, z], …]（相對每個擺設的位移）' : '[[x, z], …]（場地上的位置；沒有 near 時必填）');
        unit(d.share, w + '.share'); nn(d.block, w + '.block'); nn(d.flicker, w + '.flicker'); halo(d.halo, w + '.halo');
        if (d.share !== undefined && !d.near) warn(w + '.share 只有設了 near 才有作用');
        if (d.block > 0 && d.near && d.near !== 'tower') warn(w + '.block：依附在會倒下或破開的擺設旁的裝飾不擋路，略過');
        if (obj(d.light, w + '.light')) { const o = d.light, x = w + '.light'; keys(o, ['color', 'distance', 'intensity', 'y'], x); col(o.color, x + '.color'); pos(o.distance, x + '.distance'); nn(o.intensity, x + '.intensity'); any(o.y, x + '.y'); } });
    }
    return bad;
  }

  if (!L) { window.EGLook = { state, validate }; return; }    // nothing to do: the page stays exactly as it is
  const problems = validate(L);
  if (problems.length) {
    for (const p of problems) warn(p);
    const ld = document.getElementById('loading'); if (ld && !ld.hidden) { const d = document.createElement('div'); d.textContent = 'CONTENT.look 格式不對，夜色與光維持原樣：' + problems[0]; ld.appendChild(d); }
    window.EGLook = { state, validate, problems }; return;
  }
  const col = (s, d) => new T.Color(s === undefined ? d : s), pick = (v, d) => (v === undefined ? d : v);
  const SP = CONTENT.sprites || {}, PPU = num(SP.ppu) ? SP.ppu : 27.5;
  const flashOff = () => !!(window.EG && EG.flashingReduced && EG.flashingReduced());
  // flicker without random numbers: three sines, about ±12 %; a third of that with reduced flashing
  const wob = (t, s) => 1 + (flashOff() ? 0.3 : 1) * (0.06 * Math.sin(t * 7.3 + s) + 0.04 * Math.sin(t * 13.1 + s * 1.7) + 0.02 * Math.sin(t * 23.7 + s * 2.3));

  // ---------------------------------------------------------------- 1. the night: colours once, strengths every frame (after the engine set them)
  if (L.clear !== undefined) renderer.setClearColor(col(L.clear));
  if (L.fog && L.fog.color !== undefined && scene.fog) scene.fog.color.copy(col(L.fog.color));
  if (L.hemi) { if (L.hemi.sky !== undefined) hemi.color.copy(col(L.hemi.sky)); if (L.hemi.ground !== undefined) hemi.groundColor.copy(col(L.hemi.ground)); }
  if (L.moon && L.moon.color !== undefined) moon.color.copy(col(L.moon.color));
  const MUL = { fog: pick(L.fog && L.fog.mul, 1), hemi: pick(L.hemi && L.hemi.mul, 1), moon: pick(L.moon && L.moon.mul, 1), high: pick(L.highMul, 1), tower: pick(L.towers && L.towers.mul, 1) };
  const postOn = () => !!(window.EGPost && EGPost.state && EGPost.state.on);

  // ---------------------------------------------------------------- 2. terrain tint and glow, stepped point light (ground materials, three.js r128 Lambert)
  const TR = L.terrain || {}, tintOf = (k) => (TR[k] && TR[k].tint) || (TR.default && TR.default.tint) || null;
  const outer = tintOf('SOIL'); if (outer) ground.material.color.setRGB(outer[0], outer[1], outer[2]);   // beyond the fence the ground is soil
  // one pixel per terrain cell: RGB = tint before lighting, A = how much the tile glows by itself; only changed cells are re-sent
  const CELL = new Uint8Array(GN * GN * 4), cellTex = new T.DataTexture(CELL, GN, GN, T.RGBAFormat);
  cellTex.magFilter = cellTex.minFilter = T.NearestFilter; cellTex.generateMipmaps = false; cellTex.needsUpdate = true;
  const cellOfT = [];
  for (const [k, i] of Object.entries(TER)) { const t = tintOf(k) || [1, 1, 1], g = pick(TR[k] && TR[k].glow, pick(TR.default && TR.default.glow, 0)); cellOfT[i] = [...t.map((x) => Math.round(x * 255)), Math.round(g * 255)]; }
  const U = { uLookK: { value: pick(L.steps && L.steps.perUnit, 0) }, uLookW: { value: pick(L.steps && L.steps.dither, 0) }, tLookCell: { value: cellTex }, uLookCell: { value: L.terrain ? 1 : 0 } };
  const STEP_AT = 'reflectedLight.directDiffuse *= BRDF_Diffuse_Lambert( diffuseColor.rgb ) * getShadowMask();';
  // the point-light part (direct light minus the directional lights) becomes uLookK steps per unit; uLookW wide band edges are
  // dithered with a 4x4 Bayer pattern. The ground is flat, so its normal is world up
  const STEP_GLSL = `
uniform float uLookK; uniform float uLookW;
float egBayer2( vec2 a ) { return mod( a.x * 2.0 + a.y * 3.0, 4.0 ); }
float egBayer( vec2 p ) { vec2 a = mod( floor( p ), 4.0 ); return ( 4.0 * egBayer2( mod( a, 2.0 ) ) + egBayer2( floor( a / 2.0 ) ) + 0.5 ) / 16.0; }
vec3 egLookStep( vec3 L ) {
  if ( uLookK <= 0.0 ) return L;
  vec3 base = vec3( 0.0 );
#if NUM_DIR_LIGHTS > 0
  vec3 nV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) base += PI * directionalLights[ i ].color * max( dot( nV, directionalLights[ i ].direction ), 0.0 );
#endif
  vec3 ex = max( L - base, 0.0 );
  float m = max( ex.r, max( ex.g, ex.b ) );
  if ( m < 1e-4 ) return L;
  float q = floor( m * uLookK + 0.5 + ( egBayer( gl_FragCoord.xy ) - 0.5 ) * uLookW ) / uLookK;
  return base + ex * ( max( q, 0.0 ) / m );
}
`;
  function patch(mat, name, cells) {
    if (!mat || mat.userData.egLook) return;
    mat.userData.egLook = { name, step: false, cell: false };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uLookK = U.uLookK; sh.uniforms.uLookW = U.uLookW;
      let f = sh.fragmentShader;
      const step = f.includes('#include <lights_pars_begin>') && f.includes(STEP_AT);
      if (step) f = f.replace('#include <lights_pars_begin>', '#include <lights_pars_begin>\n' + STEP_GLSL).replace(STEP_AT, 'reflectedLight.directDiffuse = egLookStep( reflectedLight.directDiffuse );\n\t' + STEP_AT);
      let cell = false;
      if (cells && f.includes('#include <emissivemap_fragment>') && f.includes('#include <map_fragment>')) {
        sh.uniforms.tLookCell = U.tLookCell; sh.uniforms.uLookCell = U.uLookCell;
        // the tint multiplies the tile colour before lighting; the glow adds the tile's own (untinted) colour times its brightness
        // squared, so bright cracks and flames glow and dark ground does not (per pixel: no smooth gradient)
        f = f.replace('#include <common>', '#include <common>\nuniform sampler2D tLookCell; uniform float uLookCell;')
          .replace('#include <map_fragment>', '#include <map_fragment>\n#ifdef USE_MAP\n\tvec4 egCell = texture2D( tLookCell, vUv );\n\tdiffuseColor.rgb *= mix( vec3( 1.0 ), egCell.rgb, uLookCell );\n#endif')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_MAP\n\tfloat egL = max( texelColor.r, max( texelColor.g, texelColor.b ) );\n\ttotalEmissiveRadiance += texelColor.rgb * egCell.a * uLookCell * egL * egL * 1.6;\n#endif');
        cell = true;
      }
      sh.fragmentShader = f; mat.userData.egLook = { name, step, cell };
      if (!step) warn('CONTENT.look：' + name + ' 的著色器原文和 three.js r128 不同，燈光分階略過');
    };
    // three.js keys programs by the onBeforeCompile source text: two materials sharing one function would share whichever compiled first
    mat.customProgramCacheKey = () => 'egLook:' + name + (cells ? ':cell' : '');
    mat.needsUpdate = true; state.patched.push(name);
  }
  if (L.steps || L.terrain) { patch(terrMat, 'terrain', true); patch(ground.material, 'ground', false); }
  let seen = null;
  function updateCells() {
    if (!L.terrain) return;
    if (!seen) seen = new Uint8Array(GN * GN).fill(255);
    let changed = false, n = 0;
    for (let i = 0; i < GN * GN; i++) {
      const t = TT[i], v = cellOfT[t] || cellOfT[TER.SOIL]; if (v[3]) n++;
      if (seen[i] === t) continue; seen[i] = t;
      const k = ((GN - 1 - Math.floor(i / GN)) * GN + (i % GN)) * 4;      // row gz sits in texture row GN-1-gz (same as the terrain texture)
      CELL[k] = v[0]; CELL[k + 1] = v[1]; CELL[k + 2] = v[2]; CELL[k + 3] = v[3]; changed = true;
    }
    state.glowCells = n;
    if (changed) { cellTex.needsUpdate = true; state.glowUploads++; }
  }

  // ---------------------------------------------------------------- 3. fill light for pixel sprites (once the atlases are in)
  function tune(mat, o) {
    if (!mat || mat.userData.egLookTuned || !mat.isMeshLambertMaterial) return 0;
    mat.color.setScalar(pick(o.diffuse, 1)); mat.emissive.copy(col(o.fillColor, 0xffffff)).multiplyScalar(pick(o.fill, 0));
    mat.emissiveMap = mat.map; mat.needsUpdate = true; mat.userData.egLookTuned = true; return 1;
  }
  let tuned = !(L.actors || L.props);
  function tuneSprites() {
    const S = window.EGSprites; if (tuned || !S || !S.state || !S.state.ready) return;
    tuned = true;
    if (L.actors) for (const c of Object.values(S.actorCfg || {})) state.mats += tune(c.mat, L.actors);
    if (L.props) for (const R of S.propRecs || []) state.mats += tune(R.cfg && R.cfg.mat, L.props);
  }

  // ---------------------------------------------------------------- pixel halos: stepped rings with dithered edges, one texture pixel per screen pixel (PPU per metre)
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5], haloTexs = {};
  function haloTex(px) {
    if (haloTexs[px]) return haloTexs[px];
    const c = document.createElement('canvas'); c.width = c.height = px;
    const g = c.getContext('2d'), im = g.createImageData(px, px), R = px / 2, K = 4;
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
      const r = Math.hypot(x + 0.5 - R, y + 0.5 - R) / R, v = r >= 1 ? 0 : Math.pow(1 - r, 1.6);
      const q = Math.max(0, Math.min(K, Math.floor(v * K + 0.5 + ((BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * 0.6))) / K;
      const k = (y * px + x) * 4; im.data[k] = im.data[k + 1] = im.data[k + 2] = Math.round(q * 255); im.data[k + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    const t = new T.CanvasTexture(c); t.magFilter = t.minFilter = T.NearestFilter; t.generateMipmaps = false;
    return (haloTexs[px] = t);
  }
  const halos = [];
  function addHalo(o, owner, color) {
    const size = pick(o.size, 2), px = Math.max(8, Math.round(size * PPU / 2) * 2), base = col(pick(o.color, color), 0xffffff);
    const m = new T.Mesh(new T.PlaneGeometry(px / PPU, px / PPU), new T.MeshBasicMaterial({ map: haloTex(px), color: base.clone(), transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false }));
    m.frustumCulled = false; m.renderOrder = 4; m.visible = false; m.userData.egLook = 'halo'; scene.add(m);
    const h = { m, base, peak: pick(o.peak, 0.5), y: pick(o.y, 1), owner, px, k: 0 };
    halos.push(h); state.halos = halos.length; return h;
  }

  // ---------------------------------------------------------------- 4. the towers: light height, reach, colour, strength; halo while lit; flame
  const TW = L.towers || {};
  if (L.towers) TOWERS.forEach((Tw, i) => {
    if (!Tw.light) return;
    if (TW.y !== undefined) Tw.light.position.y = TW.y;
    if (TW.distance !== undefined) { Tw.light.distance = TW.distance; Tw.light.decay = 2; }
    if (Array.isArray(TW.colors) && TW.colors[i] !== undefined) Tw.light.color.copy(col(TW.colors[i]));
    if (TW.halo) addHalo(TW.halo, Tw, pick((TW.colors || [])[i], Tw.col));
  });
  // the flame particles above a lit tower (engine height 3.8 m): off, or at another height. "Off" still emits them, at size 0 and
  // fully transparent, so every random number the engine draws for them (arguments and inside emit) is drawn as before: seeded scenes do not change
  let towers0 = null;
  if (TW.flame === false || num(TW.flame)) {
    const ut = towers0 = window.updateTowers, y = TW.flame;
    let emit0 = null;
    const flame = function (o) { if (y === false) { o.s0 = o.s1 = 0; o.a0 = o.a1 = 0; } else o.y = y; return emit0.call(ADD, o); };
    window.updateTowers = Object.assign(function (dt) {
      const own = Object.prototype.hasOwnProperty.call(ADD, 'emit'), keep = ADD.emit; emit0 = keep; ADD.emit = flame;
      try { return ut.apply(this, arguments); } finally { if (own) ADD.emit = keep; else delete ADD.emit; }
    }, ut);
    state.flame = y === false ? 'off' : 'y=' + y;
  }

  // ---------------------------------------------------------------- 5. decorations: sprites placed by the pack, with optional lights and halos
  const decor = [], groups = [], snapV = new T.Vector3(), lights = [];
  // where: absolute points, or offsets around every tower / tombstone / tree / sarcophagus picked by a fixed position hash
  for (const d of L.decor || []) {
    const G = { cfg: d, items: [], ready: false }, pts = d.at || [[0, 0]], share = pick(d.share, 1);
    const owners = !d.near ? [null] : d.near === 'tower' ? TOWERS : props.filter((p) => p.kind === d.near);
    for (const o of owners) {
      if (o && share < 1 && !(h2(Math.round(o.x * 16) + 31, Math.round(o.z * 16) - 17) < share)) continue;
      for (const [dx, dz] of pts) {
        const x = (o ? o.x : 0) + dx, z = (o ? o.z : 0) + dz;
        const I = { group: G, owner: o, x, z, seed: x * 1.3 + z * 0.7, m: null, light: null, halo: null, i0: 0, rate: pick(d.flicker, 1) };
        if (d.light) {
          if (lights.length >= MAX_LIGHTS) { if (lights.length === MAX_LIGHTS) warn('CONTENT.look.decor：裝飾的燈超過 ' + MAX_LIGHTS + ' 盞，之後的不加燈'); lights.push(null); }
          else { const c = d.light; I.light = new T.PointLight(col(c.color, 0xff9a3c), 0, pick(c.distance, 6), 2); I.light.position.set(x, pick(c.y, 1.2), z); I.light.userData.egLook = 'decor'; scene.add(I.light); I.i0 = pick(c.intensity, 1.5); lights.push(I.light); }
        }
        if (d.halo) I.halo = addHalo(d.halo, I, pick(d.light && d.light.color, 0xffd36a));
        if (d.block > 0 && (!d.near || d.near === 'tower')) obstacles.push({ x, z, r: d.block });
        G.items.push(I); decor.push(I);
      }
    }
    groups.push(G);
  }
  state.lights = lights.filter(Boolean).length; state.decor = decor.length;
  // the picture: one atlas cell; shrink n = every n x n block becomes its most frequent opaque colour (same pixel density as other sprites)
  function cellCanvas(img, meta, cell, shrink) {
    const fw = meta.frameW, fh = meta.frameH, c0 = Array.isArray(cell) ? cell[1] : cell % meta.cols, r0 = Array.isArray(cell) ? cell[0] : Math.floor(cell / meta.cols), s = shrink || 1;
    const src = document.createElement('canvas'); src.width = fw; src.height = fh; const sg = src.getContext('2d', { willReadFrequently: true }); sg.drawImage(img, c0 * fw, r0 * fh, fw, fh, 0, 0, fw, fh);
    if (s === 1) return src;
    const a = sg.getImageData(0, 0, fw, fh).data, w = Math.floor(fw / s), h = Math.floor(fh / s), out = document.createElement('canvas'); out.width = w; out.height = h;
    const og = out.getContext('2d'), im = og.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const cnt = new Map(); let solid = 0;
      for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) { const k = ((y * s + j) * fw + x * s + i) * 4; if (a[k + 3] < 128) continue; solid++; const key = (a[k] << 16) | (a[k + 1] << 8) | a[k + 2]; cnt.set(key, (cnt.get(key) || 0) + 1); }
      if (solid * 2 < s * s) continue;
      let best = 0, bn = -1; for (const [key, n] of cnt) if (n > bn) { bn = n; best = key; }
      const k = (y * w + x) * 4; im.data[k] = best >> 16; im.data[k + 1] = (best >> 8) & 255; im.data[k + 2] = best & 255; im.data[k + 3] = 255;
    }
    og.putImageData(im, 0, 0); return out;
  }
  function spriteMesh(cv, meta) {
    const tex = new T.CanvasTexture(cv); tex.magFilter = tex.minFilter = T.NearestFilter; tex.generateMipmaps = false;
    const w = cv.width / PPU, h = cv.height / PPU, an = Array.isArray(meta.anchor) ? meta.anchor : [0.5, 1];
    const g = new T.PlaneGeometry(w, h); g.translate(w / 2 - an[0] * w, an[1] * h - h / 2, 0);
    const m = new T.Mesh(g, new T.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: T.DoubleSide }));
    m.frustumCulled = false; m.renderOrder = 3; m.visible = false; m.userData.egLook = 'decor'; scene.add(m); return m;
  }
  const loadImg = (src) => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error('讀不到 ' + src)); im.src = src; });
  const loadMeta = (m) => (isObj(m) ? Promise.resolve(m) : fetch(m).then((r) => { if (!r.ok) throw new Error('讀不到 ' + m + '（HTTP ' + r.status + '）'); return r.json(); }));
  Promise.all(groups.map((G) => {
    const d = G.cfg, src = d.atlas ? SP.atlases[d.atlas] : d;
    return Promise.all([loadImg(src.image), loadMeta(src.meta)]).then(([im, meta]) => {
      const cv = cellCanvas(im, meta, d.cell, d.shrink); for (const I of G.items) I.m = spriteMesh(cv, meta); G.ready = true;
    }).catch((e) => { state.err = state.err || 'decor: ' + (e && e.message || e); warn('CONTENT.look.decor：' + (e && e.message || e) + '，這組裝飾不畫'); });
  })).then(() => { state.decorReady = true; });

  // ---------------------------------------------------------------- every frame, after the engine's own visual update (light strengths and fog density are set by then)
  const up = (o) => !o || !o.state || o.state === 'up';
  const at = (m, x, y, z) => { snapV.set(x, 0, z); if (window.EGSprites && EGSprites.snap) EGSprites.snap(snapV); m.position.set(snapV.x, y, snapV.z); m.quaternion.copy(camera.quaternion); };
  const towersLit = !!L.towers;
  function frame() {
    const t = typeof time === 'number' ? time : 0;
    // the engine resets these every frame (updateTowers: boss darkness, brightness setting, lit towers), so one multiply per frame never compounds
    const hq = postOn() ? MUL.high : 1;
    hemi.intensity *= MUL.hemi * hq; moon.intensity *= MUL.moon * hq; if (scene.fog && scene.fog.density !== undefined) scene.fog.density *= MUL.fog;
    if (towersLit && MUL.tower !== 1) for (const Tw of TOWERS) if (Tw.light) Tw.light.intensity *= MUL.tower;
    if (L.mist && !state.mist && window.EGMist && EGMist.sheets && EGMist.sheets.length) {
      for (const s of EGMist.sheets) { if (L.mist.color !== undefined) s.m.material.color.copy(col(L.mist.color)); s.m.material.opacity = s.L.a * pick(L.mist.mul, 1); }
      state.mist = true;
    }
    updateCells(); tuneSprites();
    for (const I of decor) {
      const show = !!I.m && up(I.owner);
      if (I.m) { I.m.visible = show; if (show) at(I.m, I.x, 0, I.z); }
      if (I.light) I.light.intensity = show ? I.i0 * wob(t * I.rate, I.seed) : 0;
    }
    for (const h of halos) {
      const o = h.owner; let k = 0, x = 0, z = 0;
      if (o.group) { k = o.m && o.m.visible ? wob(t * o.rate, o.seed + 1) : 0; x = o.x; z = o.z; }                                                        // decoration
      else { k = o.lit ? 0.92 + 0.08 * Math.sin(t * 1.7 + o.x) : o.pulse && o.light ? Math.min(1, o.light.intensity / (1.25 * MUL.tower)) : 0; x = o.x; z = o.z; }   // tower (or its heartbeat)
      h.k = k; h.m.visible = k > 0.01;
      if (h.m.visible) { at(h.m, x, h.y, z); h.m.material.color.copy(h.base).multiplyScalar(h.peak * k); }
    }
    state.frames++;
  }
  const visuals0 = window.visuals;
  window.visuals = Object.assign(function (dt) {
    visuals0(dt);
    try { frame(dt); } catch (e) { if (!state.err) { state.err = String(e && e.message || e); warn('CONTENT.look：' + state.err); } }
  }, visuals0);
  state.on = true;
  window.EGLook = { state, validate, cfg: L, uniforms: U, cellTex, cellOfT, halos, decor, groups, haloTex, frame, patch, towers0 };   // patch: the ground step patch (tests try it on a plain material); towers0: the engine's own updateTowers when the flame is changed
})();
