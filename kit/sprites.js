// Pixel-art sprites (optional engine module). A content pack that sets CONTENT.sprites turns the scene into 2.5D pixel art:
// characters, props and spell effects become camera-facing sprites cut from PNG atlases, the ground becomes pixel tiles that
// follow the terrain, and (optional) the whole scene renders at about 360 rows, scaled up by a whole number with hard edges.
// kit/character.js loads this file only when CONTENT.sprites exists, so a page without sprite assets never runs it.
// Field format: kit/CONTENT-API.md, section CONTENT.sprites.
//   EGSprites.state        active, ready, counts, low-resolution size and scale
//   EGSprites.validate(v)  problems in a CONTENT.sprites value ([] = usable)
//   EGSprites.debug(x)     what the player, a monster or a prop shows now (animation, direction, cell, mirror, size)
(function () {
  'use strict';
  const T = THREE, SP = window.CONTENT && CONTENT.sprites;
  const state = { active: false, ready: false, atlases: 0, actors: 0, props: 0, fx: 0, fxPeak: 0, tiles: false, lowRes: false, scale: 1, w: 0, h: 0, rows: 0, step: [0, 0], failed: [] };
  const ACTORS = ['player', 'spider', 'lizard', 'ghost', 'lord'], ANIMS = ['idle', 'walk', 'cast', 'hurt', 'die'], DIRS = ['down', 'up', 'side', 'left', 'right'];
  const PROPS = { tomb: ['up', 'fallen'], tree: ['up', 'burning', 'burnt'], sarc: ['up', 'broken'], tower: ['unlit', 'lit'] };
  const FX = { fireball: 1.2, orb: 1.2, explosion: 3, zap: 2, chain: .7, meteor: 2, impact: 5, ring: 1, hit: 1 }; // effect -> default size (world units)
  const FOLLOW = ['fireball', 'orb', 'meteor', 'ring'];                                                         // these loop while their object lives
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v), num = (v) => typeof v === 'number' && isFinite(v);
  const warn = (m) => { if (typeof cwarn === 'function') cwarn(m); else console.warn('[content] ' + m); };

  // ---------------------------------------------------------------- validation (types and names; cell ranges are checked once the atlas is loaded)
  const refOk = (x) => Number.isInteger(x) && x >= 0 || Array.isArray(x) && x.length === 2 && (Number.isInteger(x[0]) && x[0] >= 0 || typeof x[0] === 'string') && Number.isInteger(x[1]) && x[1] >= 0
    || isObj(x) && (Number.isInteger(x.row) && x.row >= 0 || typeof x.row === 'string') && [x.from, x.to].every((v) => v === undefined || Number.isInteger(v) && v >= 0);
  const listOk = (l) => Array.isArray(l) && l.length > 0 && l.every(refOk);
  const seqOk = (s) => listOk(s) || isObj(s) && (listOk(s.frames) || s.row !== undefined && refOk({ row: s.row, from: s.from, to: s.to })) && (s.fps === undefined || num(s.fps) && s.fps > 0) && (s.loop === undefined || typeof s.loop === 'boolean');
  const animOk = (a) => seqOk(a) || isObj(a) && DIRS.some((d) => a[d] !== undefined) && DIRS.every((d) => a[d] === undefined || seqOk(a[d])) && (a.mirror === undefined || typeof a.mirror === 'boolean');
  const setOk = (s) => listOk(s) || isObj(s) && (listOk(s.frames) || Array.isArray(s.variants) && s.variants.length > 0 && s.variants.every(listOk)) && (s.fps === undefined || num(s.fps) && s.fps >= 0) && (s.sync === undefined || typeof s.sync === 'boolean');
  function validate(v) {
    const bad = [], C = 'CONTENT.sprites', W = (w, m) => bad.push(w + ' 要是' + m);
    const keys = (o, known, w, re) => { for (const k of Object.keys(o)) if (!known.includes(k) && !(re && re.test(k))) warn(w + '.' + k + ' 不是可用的欄位，略過'); };
    if (!isObj(v)) return [C + ' 要是物件'];
    keys(v, ['atlases', 'actors', 'props', 'ground', 'fx', 'pixelScreen', 'ppu'], C);
    const pos = (x, w) => { if (x !== undefined && !(num(x) && x > 0)) W(w, '大於 0 的數字'); };
    pos(v.ppu, C + '.ppu');
    if (!isObj(v.atlases)) W(C + '.atlases', '物件：{ 名字: { image, meta } }');
    const names = isObj(v.atlases) ? Object.keys(v.atlases) : [];
    for (const n of names) { const a = v.atlases[n], w = C + '.atlases.' + n;
      if (!isObj(a) || typeof a.image !== 'string' || !a.image || !(typeof a.meta === 'string' && a.meta || isObj(a.meta))) W(w, ' { image: 圖檔路徑, meta: JSON 路徑或物件 }'); else keys(a, ['image', 'meta'], w); }
    const atl = (o, w) => { if (!names.includes(o.atlas)) W(w + '.atlas', ' atlases 裡的一個名字'); };
    const obj = (x, w) => { if (x === undefined) return false; if (!isObj(x)) { W(w, '物件'); return false; } return true; };
    if (obj(v.actors, C + '.actors')) for (const [k, a] of Object.entries(v.actors)) { const w = C + '.actors.' + k;
      if (!ACTORS.includes(k)) { warn(w + ' 不是可用的角色（' + ACTORS.join('、') + '），略過'); continue; }
      if (!obj(a, w)) continue; atl(a, w); keys(a, ['atlas', 'ppu', 'shadow', 'lit', 'corpse', ...ANIMS], w, /^cast:(fire|bolt|meteor|blood)$/);
      pos(a.ppu, w + '.ppu'); if (a.shadow !== undefined && !(num(a.shadow) && a.shadow >= 0)) W(w + '.shadow', '0 以上的數字');
      if (a.corpse !== undefined && !(num(a.corpse) && a.corpse >= 0)) W(w + '.corpse', '0 以上的數字'); if (a.lit !== undefined && typeof a.lit !== 'boolean') W(w + '.lit', ' true 或 false');
      if (a.idle === undefined) W(w + '.idle', '動作（每個角色至少要有待機）');
      for (const n of Object.keys(a)) if ((ANIMS.includes(n) || /^cast:/.test(n)) && a[n] !== undefined && !animOk(a[n])) W(w + '.' + n, '動作：格子清單、{ frames, fps, loop }、{ row, from, to, fps }，或依方向 { down, up, side, left, right }'); }
    if (obj(v.props, C + '.props')) for (const [k, p] of Object.entries(v.props)) { const w = C + '.props.' + k;
      if (!PROPS[k]) { warn(w + ' 不是可用的擺設（' + Object.keys(PROPS).join('、') + '），略過'); continue; }
      if (!obj(p, w)) continue; atl(p, w); keys(p, ['atlas', 'ppu', 'lit', ...PROPS[k]], w); pos(p.ppu, w + '.ppu');
      if (p[PROPS[k][0]] === undefined) W(w + '.' + PROPS[k][0], '格子（這種擺設的基本樣子）');
      for (const s of PROPS[k]) if (p[s] !== undefined && !setOk(p[s])) W(w + '.' + s, '格子清單（每個擺設固定挑一格）或 { frames, fps } 動畫'); }
    if (obj(v.ground, C + '.ground')) { const g = v.ground, w = C + '.ground'; atl(g, w); keys(g, ['atlas', 'tiles', 'detail', 'glow'], w);
      if (!isObj(g.tiles)) W(w + '.tiles', '物件：{ 地形名: 地磚 }');
      else for (const [k, s] of Object.entries(g.tiles)) { if (k !== 'default' && !(k in TER)) { warn(w + '.tiles.' + k + ' 不是地形名（' + Object.keys(TER).join('、') + '），略過'); continue; }
        if (!setOk(s)) W(w + '.tiles.' + k, '地磚清單（每格依座標固定挑一塊）或 { frames, fps } 動畫'); }
      for (const b of ['detail', 'glow']) if (g[b] !== undefined && typeof g[b] !== 'boolean') W(w + '.' + b, ' true 或 false'); }
    if (obj(v.fx, C + '.fx')) for (const [k, f] of Object.entries(v.fx)) { const w = C + '.fx.' + k;
      if (!(k in FX)) { warn(w + ' 不是可用的特效（' + Object.keys(FX).join('、') + '），略過'); continue; }
      if (!obj(f, w)) continue; atl(f, w); keys(f, ['atlas', 'frames', 'fps', 'size', 'blend', 'particles'], w);
      if (!listOk(f.frames)) W(w + '.frames', '格子清單'); pos(f.fps, w + '.fps'); pos(f.size, w + '.size');
      if (f.blend !== undefined && f.blend !== 'add' && f.blend !== 'alpha') W(w + '.blend', ' "add" 或 "alpha"'); if (f.particles !== undefined && typeof f.particles !== 'boolean') W(w + '.particles', ' true 或 false'); }
    const ps = v.pixelScreen;
    if (ps !== undefined && typeof ps !== 'boolean' && !(isObj(ps) && (ps.rows === undefined || Number.isInteger(ps.rows) && ps.rows >= 120 && ps.rows <= 1080))) W(C + '.pixelScreen', ' true、false 或 { rows: 120 到 1080 的整數 }');
    return bad;
  }

  if (!SP) { window.EGSprites = { state, validate }; return; }    // nothing to do: the page stays exactly as it is
  const problems = validate(SP);
  if (problems.length) {
    for (const m of problems) warn(m + '（像素素材整組停用）');
    if (typeof egFail === 'function') egFail(problems[0]);
    window.EGSprites = { state, validate, problems }; return;
  }
  state.active = true;
  const pixelOn = !!SP.pixelScreen, ROWS = isObj(SP.pixelScreen) && SP.pixelScreen.rows || 360, PPU = SP.ppu || 27.5;
  state.rows = pixelOn ? ROWS : 0;
  // characters drawn as sprites (or the whole screen in low resolution) make the separate low-res character pass unnecessary:
  // anything still drawn as a 3D model is then rendered in the main pass with the rest of the scene, against the same depth
  if (pixelOn || isObj(SP.actors) && Object.keys(SP.actors).some((k) => ACTORS.includes(k))) { if (window.EGPixel) { EGPixel.state.on = false; camera.layers.enable(EGPixel.CHAR); } }

  // ---------------------------------------------------------------- atlases
  const A = {};
  function loadAtlas(name, a) {
    const meta = typeof a.meta === 'string' ? fetch(a.meta).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }) : Promise.resolve(a.meta);
    const img = new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image')); im.src = a.image; });
    return Promise.all([meta, img]).then(([m, im]) => {
      const w = 'CONTENT.sprites.atlases.' + name + ' 的 meta', int = (x) => Number.isInteger(x) && x > 0;
      if (!isObj(m) || !['sprite', 'tile', 'fx'].includes(m.kind)) throw new Error(w + ' 的 kind 要是 sprite、tile 或 fx');
      if (m.kind === 'tile') { if (!int(m.size)) throw new Error(w + ' 的 size 要是正整數'); m.frameW = m.frameH = m.size; }
      if (!int(m.frameW) || !int(m.frameH) || !int(m.cols) || !int(m.rows)) throw new Error(w + ' 要有正整數的 frameW、frameH、cols、rows');
      if (m.frameW * m.cols > im.width || m.frameH * m.rows > im.height) throw new Error(w + '：格子超出圖檔（' + im.width + '×' + im.height + '）');
      const an = Array.isArray(m.anchor) && m.anchor.length === 2 && m.anchor.every(num) ? m.anchor : m.kind === 'sprite' ? [.5, 1] : [.5, .5];
      const empty = new Set((Array.isArray(m.frames) ? m.frames : []).filter((f) => f && f.empty).map((f) => f.row * m.cols + f.col));
      const tex = new T.Texture(im); tex.magFilter = tex.minFilter = T.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
      const at = { name, meta: m, img: im, tex, W: im.width, H: im.height, ax: an[0], ay: an[1], empty, mats: {}, rows: Array.isArray(m.rowNames) ? m.rowNames : [] };
      if (m.kind === 'tile') { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); at.px = g.getImageData(0, 0, im.width, im.height).data; }
      A[name] = at; state.atlases++;
    }).catch((e) => { state.failed.push(name); warn('CONTENT.sprites.atlases.' + name + ' 讀不到或格式不對（' + (e && e.message || e) + '），用到它的部分維持原樣'); });
  }
  // cell references: a cell number (row-major), [row, col] (row by number or by rowNames) or { row, from, to } (a run of columns)
  function cells(list, at, w) {
    const m = at.meta, out = [], row = (r) => (typeof r === 'string' ? at.rows.indexOf(r) : r);
    const add = (r, c) => { if (!(r >= 0 && r < m.rows && c >= 0 && c < m.cols)) return warn(w + ' 的格子 [' + r + ', ' + c + '] 不在圖集裡，略過');
      if (at.empty.has(r * m.cols + c)) return warn(w + ' 的格子 [' + r + ', ' + c + '] 是空格，略過'); out.push(r * m.cols + c); };
    for (const x of list) {
      if (typeof x === 'number') add(Math.floor(x / m.cols), x % m.cols); else if (Array.isArray(x)) add(row(x[0]), x[1]);
      else { const r = row(x.row), a = x.from ?? 0, b = x.to ?? m.cols - 1, s = b >= a ? 1 : -1; for (let c = a; c !== b + s; c += s) add(r, c); }
    }
    return out;
  }
  const seq = (s, at, w, loop) => { if (Array.isArray(s)) s = { frames: s }; const c = cells(s.frames || [{ row: s.row, from: s.from, to: s.to }], at, w);
    return c.length ? { cells: c, fps: s.fps || 8, loop: s.loop ?? loop } : null; };
  function anim(a, at, w, loop) {
    if (!DIRS.some((d) => isObj(a) && a[d] !== undefined)) { const s = seq(a, at, w, loop); return s && { down: s, up: s, side: s, mirror: !(isObj(a) && a.mirror === false) }; }
    const o = { mirror: a.mirror !== false }; for (const d of DIRS) if (a[d] !== undefined) o[d] = seq(a[d], at, w + '.' + d, loop);
    return DIRS.some((d) => o[d]) ? o : null;
  }
  // which cells a direction shows; `side` faces right and is mirrored for left
  function pick(an, dir) {
    if (dir === 'right') return an.right ? [an.right, false] : an.side ? [an.side, false] : [an.down || an.up, false];
    if (dir === 'left') return an.left ? [an.left, false] : an.side ? [an.side, an.mirror] : [an.down || an.up, false];
    const s = an[dir] || an.down || an.up || an.side || an.right || an.left; return [s, false];
  }
  // frame sets for props and tiles: a list = one fixed cell per object (picked from its position), { frames, fps } = animation, { variants: [[...], ...], fps }
  function fset(s, at, w) {
    if (Array.isArray(s)) { const c = cells(s, at, w); return c.length ? { v: c.map((x) => [x]), fps: 0 } : null; }
    const v = (s.variants || [s.frames]).map((x, i) => cells(x, at, w + (s.variants ? '.variants[' + i + ']' : '.frames'))).filter((x) => x.length);
    return v.length ? { v, fps: s.fps || 0, sync: !!s.sync } : null;
  }
  const pickSet = (S, a, b, t) => { const v = S.v[Math.min(S.v.length - 1, Math.floor(a * S.v.length))]; return S.fps ? v[Math.floor(t * S.fps + (S.sync ? 0 : b * v.length)) % v.length] : v[0]; };
  function mat(at, lit, fx) {
    const k = fx ? 'f' + fx : lit ? 'l' : 'b'; if (at.mats[k]) return at.mats[k];
    const o = { map: at.tex, vertexColors: true, side: T.DoubleSide };
    return (at.mats[k] = fx ? new T.MeshBasicMaterial(Object.assign(o, { transparent: true, depthWrite: false, fog: false, blending: fx === 'add' ? T.AdditiveBlending : T.NormalBlending, alphaTest: fx === 'add' ? 0 : .02 }))
      : new (lit ? T.MeshLambertMaterial : T.MeshBasicMaterial)(Object.assign(o, { alphaTest: .5 })));
  }

  // ---------------------------------------------------------------- quads: one small geometry each (own cell and corners), pooled so the count never grows
  const pool = [], shPool = [];
  function quad(material) {
    let m = pool.pop();
    if (!m) { const g = new T.PlaneGeometry(1, 1); g.setAttribute('color', new T.BufferAttribute(new Float32Array(12).fill(1), 3)); m = new T.Mesh(g, material); m.frustumCulled = false; }
    m.material = material; m.renderOrder = material.transparent ? 0 : 3; m.visible = true; m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1); tint(m, 1, 1, 1); scene.add(m); return m;
  }
  const free = (m) => { if (m) { scene.remove(m); pool.push(m); } };
  function tint(m, r, g, b) { const c = m.geometry.attributes.color; if (c.array[0] === r && c.array[1] === g && c.array[2] === b) return; for (let i = 0; i < 4; i++) c.setXYZ(i, r, g, b); c.needsUpdate = true; }
  // put one atlas cell on a quad: w x h world units, the anchor (fraction of the cell from its top-left) at the quad's origin
  function setCell(m, at, cell, flip, w, h, ax = at.ax, ay = at.ay) {
    const M = at.meta, c = cell % M.cols, r = Math.floor(cell / M.cols), e = .001, P = m.geometry.attributes.position, U = m.geometry.attributes.uv;
    let u0 = (c * M.frameW + e) / at.W, u1 = ((c + 1) * M.frameW - e) / at.W; const v1 = 1 - (r * M.frameH + e) / at.H, v0 = 1 - ((r + 1) * M.frameH - e) / at.H;
    if (flip) { [u0, u1] = [u1, u0]; ax = 1 - ax; }
    const x0 = -ax * w, x1 = (1 - ax) * w, y1 = ay * h, y0 = (ay - 1) * h;
    P.setXYZ(0, x0, y1, 0); P.setXYZ(1, x1, y1, 0); P.setXYZ(2, x0, y0, 0); P.setXYZ(3, x1, y0, 0);
    U.setXY(0, u0, v1); U.setXY(1, u1, v1); U.setXY(2, u0, v0); U.setXY(3, u1, v0); P.needsUpdate = U.needsUpdate = true;
  }
  // a small hard-edged ellipse for the shadow under a sprite
  const shTex = (() => { const c = document.createElement('canvas'); c.width = 16; c.height = 8; const g = c.getContext('2d'); g.fillStyle = '#000';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) if (((x - 7.5) / 8) ** 2 + ((y - 3.5) / 4) ** 2 <= 1) g.fillRect(x, y, 1, 1);
    const t = new T.CanvasTexture(c); t.magFilter = t.minFilter = T.NearestFilter; t.generateMipmaps = false; return t; })();
  // drawn with the opaque things, after the ground (0) and the terrain overlay (1) and before the sprites (3), so it never covers a sprite's feet
const shGeo = new T.PlaneGeometry(1, 1), shMat = new T.MeshBasicMaterial({ map: shTex, opacity: .45, depthWrite: false, color: 0, blending: T.CustomBlending, blendSrc: T.SrcAlphaFactor, blendDst: T.OneMinusSrcAlphaFactor });
  const shadow = () => { const m = shPool.pop() || Object.assign(new T.Mesh(shGeo, shMat), { frustumCulled: false, renderOrder: 2 }); m.rotation.set(-Math.PI / 2, 0, 0); m.visible = true; scene.add(m); return m; };
  const freeSh = (m) => { if (m) { scene.remove(m); shPool.push(m); } };

  // ---------------------------------------------------------------- camera: facing direction, foreshortening, low-resolution pixel steps
  const cam = { gx: 0, gz: -1, sin: 1 }, v3 = new T.Vector3(), v2 = new T.Vector2();
  function camFrame() {
    camera.getWorldDirection(v3); const gl = Math.hypot(v3.x, v3.z) || 1;
    Object.assign(cam, { gx: v3.x / gl, gz: v3.z / gl, sin: Math.max(.2, -v3.y) });
    if (pixelOn && state.h) { const ppx = 2 * (camera.position.y / cam.sin) * Math.tan(camera.fov * Math.PI / 360) / state.h; state.step = [ppx, ppx / cam.sin]; }
  }
  // snap a ground position to the low-resolution pixel lattice (screen right and screen up, at the focus distance)
  function snap(p) {
    const [sx, sz] = state.step; if (!pixelOn || !sx) return p;
    const a = Math.round((p.x * -cam.gz + p.z * cam.gx) / sx) * sx, b = Math.round((p.x * cam.gx + p.z * cam.gz) / sz) * sz;
    p.x = a * -cam.gz + b * cam.gx; p.z = a * cam.gx + b * cam.gz; return p;
  }
  // which of down / up / left / right a ground direction is on screen (a little stickiness near the diagonals)
  function dirOf(dx, dz, prev) {
    const sx = dx * -cam.gz + dz * cam.gx, sy = dx * cam.gx + dz * cam.gz; if (Math.hypot(sx, sy) < 1e-6) return prev;
    const side = Math.abs(sx) > Math.abs(sy) * (prev === 'left' || prev === 'right' ? .8 : 1.25);
    return side ? (sx > 0 ? 'right' : 'left') : sy > 0 ? 'up' : 'down';
  }

  // ---------------------------------------------------------------- characters
  const actorCfg = {};
  function buildActors() {
    for (const [k, a] of Object.entries(isObj(SP.actors) ? SP.actors : {})) {
      const at = A[a.atlas]; if (!ACTORS.includes(k) || !at) continue;
      if (at.meta.kind !== 'sprite') { warn('CONTENT.sprites.actors.' + k + ' 的圖集要是 sprite 種類，略過'); continue; }
      const an = {}; for (const n of Object.keys(a)) if (ANIMS.includes(n) || /^cast:/.test(n)) { const x = anim(a[n], at, 'CONTENT.sprites.actors.' + k + '.' + n, n === 'idle' || n === 'walk'); if (x) an[n] = x; }
      if (!an.idle) { warn('CONTENT.sprites.actors.' + k + '.idle 沒有可用的格子，這個角色維持原樣'); continue; }
      actorCfg[k] = { at, an, ppu: a.ppu || PPU, shadow: a.shadow ?? .5, corpse: a.corpse || 0, mat: mat(at, a.lit !== false) };
    }
  }
  const rec = (cfg) => ({ cfg, m: quad(cfg.mat), sh: cfg.shadow ? shadow() : null, anim: '', t: 0, dir: 'down', hurt: 0, pf: 0, cell: -1, flip: false, x: 0, y: 0, z: 0 });
  const dur = (an, dir) => { const s = an && pick(an, dir)[0]; return s ? s.cells.length / s.fps : 0; };
  // s: { x, y, z, dx, dz (facing on the ground), moving, dead, cast (spell id or ''), castK (0..1), hurt (true on the frame a hit lands), flash }
  function show(R, s, dt) {
    const C = R.cfg; R.dir = dirOf(s.dx, s.dz, R.dir);
    if (s.hurt && C.an.hurt) R.hurt = dur(C.an.hurt, R.dir);
    R.hurt = Math.max(0, R.hurt - dt);
    let a = s.dead ? 'die' : s.cast ? (C.an['cast:' + s.cast] ? 'cast:' + s.cast : 'cast') : R.hurt > 0 ? 'hurt' : s.moving ? 'walk' : 'idle';
    if (!C.an[a]) a = 'idle';
    if (a !== R.anim) { R.anim = a; R.t = 0; } else R.t += dt;
    const [S, flip] = pick(C.an[a], R.dir), n = S.cells.length;
    const i = s.cast && a !== 'idle' ? Math.min(n - 1, Math.floor(s.castK * n)) : S.loop ? Math.floor(R.t * S.fps) % n : Math.min(n - 1, Math.floor(R.t * S.fps));
    const M = C.at.meta, w = M.frameW / C.ppu, h = M.frameH / C.ppu, p = snap(v3.set(s.x, 0, s.z));
    R.cell = S.cells[i]; R.flip = flip; R.x = p.x; R.y = s.y; R.z = p.z; R.w = w; R.h = h;
    setCell(R.m, C.at, R.cell, flip, w, h); R.m.position.set(p.x, s.y, p.z); R.m.quaternion.copy(camera.quaternion);
    const f = s.flash ? 1 + 2.5 * (typeof egFlashOff !== 'undefined' && egFlashOff ? .3 : 1) : 1; tint(R.m, f, f, f);
    if (R.sh) { R.sh.position.set(p.x, .03, p.z); R.sh.scale.set(C.shadow * 2, C.shadow, 1); }
  }
  let you = null; const mons = new Map();
  function releaseRec(R) { free(R.m); freeSh(R.sh); }
  function updateActors(dt) {
    const pc = actorCfg.player;
    if (pc) {
      if (!you) { you = rec(pc); you.lx = player.pos.x; you.lz = player.pos.z; }
      const c = player.cast, mv = !!player.moving && player.alive && !c, ph = player.hurtT;
      const dx = mv ? player.pos.x - you.lx : Math.sin(player.face), dz = mv ? player.pos.z - you.lz : Math.cos(player.face);
      show(you, { x: player.pos.x, y: player.float, z: player.pos.z, dx, dz, moving: mv, dead: !player.alive, cast: c ? c.id : '', castK: c ? c.t / c.dur : 0, hurt: ph > you.pf + 1e-9 }, dt);
      you.pf = ph; you.lx = player.pos.x; you.lz = player.pos.z;
      EGP.g.visible = false; EGP.shadow.visible = !you.sh;
    }
    for (const R of mons.values()) R.seen = false;
    for (const e of enemies) {
      const C = actorCfg[e.type]; if (!C) continue;
      let R = mons.get(e); if (!R) { R = rec(C); R.lx = e.pos.x; R.lz = e.pos.z; mons.set(e, R); }
      R.seen = true; R.dying = e.dying >= 0;
      const mx = e.pos.x - R.lx, mz = e.pos.z - R.lz, mv = dt > 0 && Math.hypot(mx, mz) / dt > .25;
      show(R, { x: e.pos.x, y: e.pos.y, z: e.pos.z, dx: Math.sin(e.rotY), dz: Math.cos(e.rotY), moving: mv && e.alive, dead: !e.alive, cast: '', castK: 0, hurt: (e.flinch || 0) > R.pf + 1e-9, flash: e.flash > 0 }, dt);
      R.pf = e.flinch || 0; R.lx = e.pos.x; R.lz = e.pos.z; e.g.visible = false;
    }
    // a monster that left the list: a dying one finishes its fall animation (and lies for `corpse` seconds), anything else goes at once
    for (const [e, R] of mons) if (!R.seen) {
      const left = R.dying ? dur(R.cfg.an.die, R.dir) + R.cfg.corpse - R.t : 0;
      if (left > 0) { R.t += dt; const [S, flip] = pick(R.cfg.an[R.anim] || R.cfg.an.idle, R.dir); R.cell = S.cells[Math.min(S.cells.length - 1, Math.floor(R.t * S.fps))]; setCell(R.m, R.cfg.at, R.cell, flip, R.w, R.h); R.m.quaternion.copy(camera.quaternion); }
      else { releaseRec(R); mons.delete(e); }
    }
    state.actors = mons.size + (you ? 1 : 0);
  }
  function dropMonsters() { for (const R of mons.values()) releaseRec(R); mons.clear(); }

  // ---------------------------------------------------------------- props: tombstones, trees, sarcophagi, towers (logic, collision and breaking stay as they are)
  const propRecs = [];
  function buildProps() {
    const P = isObj(SP.props) ? SP.props : {};
    for (const [k, c] of Object.entries(P)) {
      const at = A[c.atlas]; if (!PROPS[k] || !at) continue;
      const st = {}; for (const s of PROPS[k]) if (c[s] !== undefined) { const x = fset(c[s], at, 'CONTENT.sprites.props.' + k + '.' + s); if (x) st[s] = x; }
      if (!st[PROPS[k][0]]) continue;
      const cfg = { at, st, ppu: c.ppu || PPU, mat: mat(at, c.lit !== false) };
      const list = k === 'tower' ? TOWERS.map((t) => ({ tower: t, x: t.x, z: t.z })) : props.filter((p) => p.kind === k);
      for (const p of list) { const g = p.tower ? p.tower.beam.parent : p.g; propRecs.push({ kind: k, p, g, cfg, m: quad(cfg.mat), h1: h2(Math.round(p.x * 16), Math.round(p.z * 16)), h2: h2(Math.round(p.z * 16) + 7, Math.round(p.x * 16) - 3), name: '', cell: -1 }); }
    }
    state.props = propRecs.length;
  }
  const propState = (R) => {
    const p = R.p; if (R.kind === 'tower') return p.tower.lit || p.tower.pulse ? 'lit' : 'unlit';
    if (p.state === 'up') return 'up'; if (R.kind === 'tomb') return 'fallen'; if (R.kind === 'sarc') return 'broken';
    return p.state === 'burning' ? (R.cfg.st.burning ? 'burning' : 'up') : 'burnt';
  };
  function updateProps() {
    for (const R of propRecs) {
      if (R.p.tower) { for (const o of R.g.children) if (o !== R.p.tower.beam) o.visible = false; } else R.g.visible = false;
      const s = R.name = propState(R), S = R.cfg.st[s]; R.m.visible = !!S; if (!S) continue;
      const M = R.cfg.at.meta, w = M.frameW / R.cfg.ppu, h = M.frameH / R.cfg.ppu, p = snap(v3.set(R.p.x, 0, R.p.z));
      R.cell = pickSet(S, R.h1, R.h2, time); setCell(R.m, R.cfg.at, R.cell, false, w, h); R.m.position.set(p.x, 0, p.z); R.m.quaternion.copy(camera.quaternion);
    }
  }

  // ---------------------------------------------------------------- ground tiles: one tile per terrain cell, repainted when the cell changes or its animation steps
  const G = { on: false };
  function buildGround() {
    const g = SP.ground; if (!isObj(g)) return; const at = A[g.atlas]; if (!at) return;
    if (at.meta.kind !== 'tile') return warn('CONTENT.sprites.ground 的圖集要是 tile 種類，地面維持原樣');
    const S = at.meta.size, TS = GN * S;
    if (TS > renderer.capabilities.maxTextureSize) return warn('CONTENT.sprites.ground：地磚 ' + S + ' 像素時地面貼圖 ' + TS + ' 超過顯示卡上限，地面維持原樣');
    const spec = {}; for (const [k, s] of Object.entries(g.tiles)) { const x = fset(s, at, 'CONTENT.sprites.ground.tiles.' + k); if (x) spec[k] = x; }
    const fall = spec.default || spec.SOIL || Object.values(spec)[0]; if (!fall) return;
    const byT = []; for (const [k, i] of Object.entries(TER)) byT[i] = spec[k] || fall;
    const H1 = new Float32Array(GN * GN), H2 = new Float32Array(GN * GN);
    for (let i = 0; i < GN * GN; i++) { H1[i] = h2((i % GN) * 7 + 101, Math.floor(i / GN) * 13 + 57); H2[i] = h2((i % GN) * 3 + 911, Math.floor(i / GN) * 5 + 3); }
    const data = new Uint8Array(TS * TS * 4), tex = new T.DataTexture(data, TS, TS, T.RGBAFormat);
    tex.magFilter = tex.minFilter = T.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
    Object.assign(G, { on: true, at, S, TS, byT, H1, H2, data, tex, shown: new Int32Array(GN * GN).fill(-1), lo: new Int16Array(GN), hi: new Int16Array(GN), full: true, up: 0, buf: new Uint8Array(TS * S * 4), src: { isDataTexture: true, image: { data: null, width: 0, height: 0 } }, at2: new T.Vector2() });
    terrMat.map = tex; terrMat.transparent = false; terrMat.needsUpdate = true;
    // outside the 88 x 88 terrain grid the ground keeps going: give it the soil tile, one tile per unit
    const c = document.createElement('canvas'); c.width = c.height = S; const cx = c.getContext('2d'), im = cx.createImageData(S, S); paintTile(im.data, S, 0, 0, pickSet(byT[TER.SOIL], 0, 0, 0)); cx.putImageData(im, 0, 0);
    const gt = new T.CanvasTexture(c); gt.wrapS = gt.wrapT = T.RepeatWrapping; gt.repeat.set(140, 140); gt.magFilter = gt.minFilter = T.NearestFilter; gt.generateMipmaps = false;
    ground.material.map = gt; ground.material.needsUpdate = true;
    G.glow = scene.children.find((o) => o.material === glowMat); if (G.glow && g.glow !== true) G.glow.visible = false;
    G.detail = g.detail === true; state.tiles = true;
  }
  // copy tile `cell` of the tile atlas into an RGBA buffer `dst` (row length `dw`) at x, y, top row last (textures start at the bottom)
  function paintTile(dst, dw, x, y, cell) {
    const at = G.at || A[SP.ground.atlas], M = at.meta, S = M.size, sx = (cell % M.cols) * S, sy = Math.floor(cell / M.cols) * S, px = at.px;
    for (let r = 0; r < S; r++) { const s = ((sy + r) * at.W + sx) * 4, d = ((y + S - 1 - r) * dw + x) * 4; for (let k = 0; k < S * 4; k++) dst[d + k] = px[s + k]; }
  }
  const tileFor = (i) => pickSet(G.byT[TT[i]], G.H1[i], G.H2[i], time);
  function updateGround() {
    if (!G.on) return; const { S, TS, shown, lo, hi } = G; let area = 0; lo.fill(GN); hi.fill(-1);
    for (let i = 0; i < GN * GN; i++) { const c = tileFor(i); if (c === shown[i]) continue; shown[i] = c;
      const gx = i % GN, gz = Math.floor(i / GN); paintTile(G.data, TS, gx * S, (GN - 1 - gz) * S, c); if (gx < lo[gz]) lo[gz] = gx; if (gx > hi[gz]) hi[gz] = gx; }
    for (let z = 0; z < GN; z++) if (hi[z] >= 0) area += hi[z] - lo[z] + 1;
    if (!area) return;
    if (G.full || area > GN * GN * .35) { G.tex.needsUpdate = true; G.full = false; G.up++; return; }
    for (let z = 0; z < GN; z++) if (hi[z] >= 0) {                                     // send only the changed strip of each row of cells
      const x = lo[z] * S, y = (GN - 1 - z) * S, w = (hi[z] - lo[z] + 1) * S, n = w * 4;
      for (let r = 0; r < S; r++) { const s = ((y + r) * TS + x) * 4; G.buf.set(G.data.subarray(s, s + n), r * n); }
      Object.assign(G.src.image, { data: G.buf.subarray(0, n * S), width: w, height: S }); G.at2.set(x, y); renderer.copyTextureToTexture(G.at2, G.src, G.tex); G.up++;
    }
  }

  // ---------------------------------------------------------------- spell effects: flipbooks that play once, or loop while the object they follow lives
  const fxCfg = {}, fxList = [];
  function buildFx() {
    for (const [k, f] of Object.entries(isObj(SP.fx) ? SP.fx : {})) {
      const at = A[f.atlas]; if (!(k in FX) || !at) continue;
      const c = cells(f.frames, at, 'CONTENT.sprites.fx.' + k + '.frames'); if (!c.length) continue;
      const blend = f.blend || at.meta.blend || 'add';
      fxCfg[k] = { at, cells: c, fps: f.fps || 12, size: f.size || FX[k], loop: FOLLOW.includes(k), particles: f.particles === true, mat: mat(at, false, blend === 'alpha' ? 'alpha' : 'add') };
    }
  }
  // o: { pos | follow (anything with .pos and .dead) | beam: [a, b], scale, tint: [r, g, b], ground: object whose scale.x sizes a ground ring }
  function spawn(key, o) {
    const C = fxCfg[key]; if (!C || fxList.length >= 400) return null;
    const f = { key, C, m: quad(C.mat), t: 0, follow: o.follow || null, pos: o.pos ? o.pos.clone() : null, scale: o.scale || 1, beam: o.beam || null, ground: o.ground || null, cell: C.cells[0] };
    if (o.tint) tint(f.m, o.tint[0], o.tint[1], o.tint[2]);
    fxList.push(f); placeFx(f); state.fx = fxList.length; state.fxPeak = Math.max(state.fxPeak, fxList.length); return f;
  }
  const qa = new T.Vector3(), qb = new T.Vector3(), qs = new T.Vector3();
  function placeFx(f) {
    const C = f.C, M = C.at.meta, size = C.size * f.scale * (f.ground ? f.ground.scale.x : 1), w = size, h = size * M.frameH / M.frameW, m = f.m;
    setCell(m, C.at, f.cell, false, w, h, .5, .5);
    if (f.beam) {                                                         // stretched from a to b, turned to face the camera
      qa.copy(f.beam[0]); qb.copy(f.beam[1]); camera.getWorldDirection(qs); qs.crossVectors(qs, v3.subVectors(qb, qa)).normalize().multiplyScalar(C.size * f.scale / 2);
      const P = m.geometry.attributes.position; P.setXYZ(0, qa.x + qs.x, qa.y + qs.y, qa.z + qs.z); P.setXYZ(1, qb.x + qs.x, qb.y + qs.y, qb.z + qs.z);
      P.setXYZ(2, qa.x - qs.x, qa.y - qs.y, qa.z - qs.z); P.setXYZ(3, qb.x - qs.x, qb.y - qs.y, qb.z - qs.z); P.needsUpdate = true; m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); return;
    }
    const p = f.follow ? f.follow.pos : f.pos;
    if (f.ground) { m.position.set(p.x, .06, p.z); m.rotation.set(-Math.PI / 2, 0, 0); } else { m.position.copy(p); m.quaternion.copy(camera.quaternion); }
  }
  function updateFx(dt) {
    for (let i = fxList.length - 1; i >= 0; i--) {
      const f = fxList[i], C = f.C, n = C.cells.length; f.t += dt;
      const k = Math.floor(f.t * C.fps), done = f.follow ? f.follow.dead : k >= n;
      if (done) { free(f.m); fxList.splice(i, 1); continue; }
      f.cell = C.cells[C.loop ? k % n : Math.min(n - 1, k)]; placeFx(f);
    }
    state.fx = fxList.length;
  }
  function clearFx() { for (const f of fxList) free(f.m); fxList.length = 0; state.fx = 0; }
  // particles off while an engine effect runs, so its flipbook replaces it; the effect's light, shake and sound stay
  let muted = false; const NOOP = () => null;
  function mute(on) { const was = muted; muted = on; if (on) ADD.emit = SMOKE.emit = NOOP; else { delete ADD.emit; delete SMOKE.emit; } return was; }
  const quiet = (on, fn) => { const was = mute(on); try { return fn(); } finally { mute(was); } };
  let inMeteor = false;
  function hookFx() {
    const has = (k) => !!fxCfg[k] && !fxCfg[k].particles, wrap = (name, fn) => { const o = window[name], w = function () { return fn(o, arguments); }; window[name] = Object.assign(w, o); }; // the replacement carries the original's own properties (a content pack may have tagged it)
    if (fxCfg.fireball) { wrap('fireballVisual', (o, a) => { spawn('fireball', { follow: a[0], scale: a[2] || 1, tint: a[1] }); if (fxCfg.fireball.particles) o.apply(null, a); });
      if (has('fireball')) wrap('fireTrail', () => {}); }
    if (fxCfg.orb) wrap('spawnOrb', (o, a) => { quiet(has('orb'), () => o.apply(null, a)); spawn('orb', { follow: projs[projs.length - 1] }); });
    wrap('explode', (o, a) => { const key = inMeteor && fxCfg.impact ? 'impact' : fxCfg.explosion ? 'explosion' : '';
      if (!key) return quiet(false, () => o.apply(null, a)); quiet(!fxCfg[key].particles, () => o.apply(null, a)); spawn(key, { pos: a[0], scale: a[1] ?? 1, tint: a[2] }); });
    if (fxCfg.zap) wrap('zapBurst', (o, a) => { quiet(has('zap'), () => o.apply(null, a)); spawn('zap', { pos: a[0] }); });
    if (fxCfg.chain) wrap('bolt', (o, a) => { if (!a[4]) return o.apply(null, a); spawn('chain', { beam: [a[0].clone(), a[1].clone()] }); if (fxCfg.chain.particles) o.apply(null, a); });
    wrap('updateMeteors', (o, a) => {
      if (fxCfg.meteor) for (const m of meteors) if (!m.egFx) { m.egFx = 1; m.mesh.visible = false; spawn('meteor', { follow: m }); }
      inMeteor = true; try { quiet(has('meteor') || muted, () => o.apply(null, a)); } finally { inMeteor = false; }
      if (has('meteor')) for (const r of rocks) r.mesh.visible = false;
    });
    if (fxCfg.ring) wrap('startBlood', (o, a) => { o.apply(null, a); const r = rites[rites.length - 1]; if (!fxCfg.ring.particles) r.mesh.visible = false; spawn('ring', { follow: r, ground: r.mesh }); });
    if (fxCfg.hit) wrap('dealDamage', (o, a) => { const e = a[0], was = !!e && e.alive; o.apply(null, a); if (was) spawn('hit', { pos: v3.set(e.pos.x, e.T.float ? 1.6 : .8, e.pos.z) }); });
  }

  // ---------------------------------------------------------------- whole screen in low resolution, scaled up by a whole number
  const keep = new T.Vector3();
  function lowSize() {
    const dpr = window.devicePixelRatio || 1; let k = Math.max(1, Math.round(innerHeight * dpr / ROWS));
    if (EGPost.state.lite && dpr / k > .75) k = Math.ceil(dpr / .75);           // postfx caps the pixel ratio at .75 without a graphics card
    if (renderer.getPixelRatio() !== dpr / k) renderer.setPixelRatio(dpr / k);
    const s = renderer.getDrawingBufferSize(v2), cw = s.x * k / dpr + 'px', ch = s.y * k / dpr + 'px';
    if (canvas.style.width !== cw || canvas.style.height !== ch) Object.assign(canvas.style, { width: cw, height: ch, imageRendering: 'pixelated' });
    Object.assign(state, { lowRes: true, scale: k, w: s.x, h: s.y });
  }
  const render0 = EGPost.render;
  EGPost.render = function () {
    if (!pixelOn) return render0();
    lowSize(); camFrame(); keep.copy(camera.position); snap(camera.position); camera.updateMatrixWorld();
    const U = EGPost.uniforms.uTilt, tilt = U.value; U.value = 0;           // no tilt-shift blur in this mode
    try { render0(); } finally { U.value = tilt; camera.position.copy(keep); camera.updateMatrixWorld(); }
  };

  // ---------------------------------------------------------------- every frame, after the engine's own visual update
  function update(dt) {
    camFrame(); updateActors(dt); updateProps(); updateGround(); updateFx(dt);
    if (G.on && !G.detail && window.EGDetail) for (const S of EGDetail.sets) S.mesh.visible = false;
  }
  Promise.all(Object.entries(SP.atlases).map(([n, a]) => loadAtlas(n, a))).then(() => {
    buildActors(); buildProps(); buildGround(); buildFx(); hookFx();
    // take visuals at the moment of wrapping, not when this file ran: another module (kit/look.js) may have wrapped it while the atlases loaded
    const visuals0 = window.visuals; window.visuals = Object.assign(function (dt) { visuals0(dt); update(dt); }, visuals0);
    const cw = window.clearWorld; window.clearWorld = function () { cw.apply(null, arguments); dropMonsters(); clearFx(); };
    const ce = EG.clearEffects; EG.clearEffects = function () { ce.apply(EG, arguments); clearFx(); };
    camFrame(); update(0); state.ready = true;
  });
  // tests read what is shown; nothing here changes the game
  function debug(x) {
    const R = x === player ? you : mons.get(x) || propRecs.find((r) => r.p === x || r.p.tower === x); if (!R) return null;
    const M = (R.cfg.at || {}).meta, c = R.cell;
    return { anim: R.anim || R.name, dir: R.dir, cell: c, row: M ? Math.floor(c / M.cols) : -1, col: M ? c % M.cols : -1, flip: !!R.flip, visible: R.m.visible, x: R.m.position.x, y: R.m.position.y, z: R.m.position.z, w: R.w, h: R.h, mesh: R.m };
  }
  window.EGSprites = { state, validate, debug, snap, actorCfg, fxCfg, fxList, propRecs, ground: G, tileFor: (i) => (G.on ? tileFor(i) : -1), shown: (i) => (G.on ? G.shown[i] : -1), pool, update };
})();
