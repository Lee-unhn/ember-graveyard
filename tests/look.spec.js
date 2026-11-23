// Night look and light tests (kit/look.js). Injected into a page that received the test CONTENT.look (tests/lib/look-fixture.js),
// with or without the test atlases. Game time is advanced by calling the engine's own logic()/visuals(); nothing waits on wall-clock time.
//   __runLook('full')    the whole fixture with the test atlases: colours, strengths, steps, tints and glow, fill light, towers, decorations, validation
//   __runLook('flameY')  no atlases, no decorations, the tower flame moved to 2.1 m
window.__runLook = async (mode) => {
  const tests = [], results = [];
  const test = (name, fn) => tests.push([name, fn]);
  class AssertError extends Error {}
  const ok = (c, m) => { if (!c) throw new AssertError(m || 'expected truthy'); };
  const eq = (a, b, m) => { if (a !== b) throw new AssertError(`${m || 'eq'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
  const near = (a, b, tol, m) => { if (!(Math.abs(a - b) <= tol)) throw new AssertError(`${m || 'near'}: expected ${b}±${tol}, got ${a}`); };
  const K = EGLook, C = CONTENT.look, hex = (c) => '#' + c.getHexString();
  const step = (n, dt = 1 / 60) => { for (let k = 0; k < n; k++) { time += dt; shared.uTime.value = time; logic(dt); visuals(dt); } };
  const vis = (n, dt = 1 / 60) => { for (let k = 0; k < n; k++) { time += dt; visuals(dt); } };
  const fresh = () => {
    while (dlg) endDialog();
    for (const k in keys) keys[k] = false; lmb = false;
    clearWorld(); resetTerrain(); running = true; paused = false;
    Object.assign(story, { on: false, phase: 'idle', act: 0, unlocked: new Set(['fire', 'bolt', 'meteor', 'blood']), tier: { fire: 1 }, seen: new Set(), boss: null });
    player.pos.set(0, 0, 0); player.maxhp = player.hp = 1e6; player.alive = true; player.cast = null;
    for (const T of TOWERS) { T.lit = false; T.acc = {}; }
    for (const k in cds) cds[k] = 0; for (const id of MENUS) document.querySelector('#' + id).hidden = true; syncMenu();
    if (window.EG) { EG.resetSpellParams(); EG.seed(null); EG.reduceFlashing(false); }
    camSnap = true; step(2);
  };
  const lit = (i) => { const T = TOWERS[i]; T.lit = true; if (T.beam) T.beam.visible = true; return T; };
  // read the canvas after one plain render (no post effects): rows of [r, g, b]
  const grab = (cam = camera, sc = scene) => { renderer.setRenderTarget(null); renderer.render(sc, cam); const c = document.createElement('canvas'), W = renderer.domElement.width, H = renderer.domElement.height;
    c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(renderer.domElement, 0, 0); const d = g.getImageData(0, 0, W, H).data;
    return { W, H, px: (x, y) => { const k = (Math.round(y) * W + Math.round(x)) * 4; return [d[k], d[k + 1], d[k + 2]]; } }; };
  const lum = ([r, g, b]) => 0.3 * r + 0.59 * g + 0.11 * b;
  const flick = (n, f) => { const out = []; for (let k = 0; k < n; k++) { time += 1 / 60; K.frame(1 / 60); out.push(f()); } return out; };

  // ---------------------------------------------------------------- both pages
  test('module on, no error, and it replaced only visuals (plus updateTowers when the flame changes), keeping their own properties', () => {
    ok(K.state.on, 'on'); eq(K.state.err, '', 'no error');
    if (C.towers && C.towers.flame !== undefined && C.towers.flame !== true) { ok(K.towers0 && updateTowers !== K.towers0, 'updateTowers wrapped'); eq(updateTowers.egTag, 'updateTowers', 'the tag a content pack put on updateTowers survives'); }
  });
  test('one call of visuals() runs the look frame once, also after the sprite module wrapped visuals later (it must not drop the look wrapper)', () => {
    const f0 = K.state.frames; visuals(1 / 60); eq(K.state.frames, f0 + 1, 'look frames');
    if (window.EGSprites && EGSprites.state.ready) { visuals(1 / 60); eq(K.state.frames, f0 + 2, 'look ran again with the sprite wrapper in the chain'); }
  });
  test('the look frame never calls Math.random (seeded measurements draw the same sequence with the module)', () => {
    const real = Math.random; let n = 0; Math.random = () => { n++; return real(); };
    try { for (let k = 0; k < 30; k++) { time += 1 / 60; K.frame(1 / 60); } } finally { Math.random = real; }
    eq(n, 0, 'random calls');
  });
  test('ambient, moon and fog strengths = the engine value x the multipliers on every frame (no compounding); highMul only with post effects on', () => {
    fresh(); const keep = EGPost.state.on;
    try {
      for (const post of [false, true, false]) {
        EGPost.state.on = post; vis(3);
        const B = SET.bright, hq = post ? (C.highMul ?? 1) : 1;
        near(hemi.intensity, (0.6 - 0.44 * dark) * B * (C.hemi ? C.hemi.mul ?? 1 : 1) * hq, 1e-9, 'hemi post=' + post);
        near(moon.intensity, (0.5 - 0.38 * dark) * B * (C.moon ? C.moon.mul ?? 1 : 1) * hq, 1e-9, 'moon post=' + post);
        near(scene.fog.density, (0.026 + 0.032 * dark) / Math.max(1, B) * (C.fog ? C.fog.mul ?? 1 : 1), 1e-12, 'fog post=' + post);
      }
    } finally { EGPost.state.on = keep; }
  });

  if (mode === 'flameY') {
    test('flame height: a lit tower emits its flame particles at towers.flame (2.1 m), not 3.8 m, with the same random draws', () => {
      fresh(); const T = lit(0), n0 = ADD.list.length; EG.seed(5); for (let k = 0; k < 60; k++) updateTowers(1 / 60);
      const mine = ADD.list.slice(n0).filter((q) => Math.abs(q.x - T.x) < 0.5 && Math.abs(q.z - T.z) < 0.5), r1 = Math.random();
      ok(mine.length >= 10, `flame particles emitted (${mine.length})`); ok(mine.every((q) => q.y >= 2.0 && q.y <= 2.6), 'every flame particle starts near 2.1 m: ' + mine.slice(0, 5).map((q) => q.y.toFixed(2)));
      T.acc = {}; const n1 = ADD.list.length; EG.seed(5); for (let k = 0; k < 60; k++) K.towers0(1 / 60); const r2 = Math.random();
      ok(ADD.list.slice(n1).some((q) => q.y > 3.5), 'control: the engine alone emits at 3.8 m'); eq(r2, r1, 'next random number after 60 frames');
      EG.seed(null);
    });
    test('without sprites and decorations: nothing tuned, nothing placed, no extra lights', () => {
      eq(K.state.mats, 0, 'no sprite materials'); eq(K.decor.length, 0, 'no decorations'); eq(scene.children.filter((o) => o.userData.egLook === 'decor').length, 0, 'no decor objects or lights');
    });
  }

  if (mode === 'full') {
    test('colours: clear, fog, sky and ground ambient, moon are the CONTENT.look colours', () => {
      eq(hex(renderer.getClearColor(new THREE.Color())), C.clear, 'clear'); eq(hex(scene.fog.color), C.fog.color, 'fog');
      eq(hex(hemi.color), C.hemi.sky, 'sky'); eq(hex(hemi.groundColor), C.hemi.ground, 'ground side'); eq(hex(moon.color), C.moon.color, 'moon');
    });
    test('ground mist sheets take the mist colour and opacity x mul', () => {
      vis(2); ok(EGMist.sheets.length > 0, 'mist sheets');
      for (const s of EGMist.sheets) { eq(hex(s.m.material.color), C.mist.color, 'mist colour'); near(s.m.material.opacity, s.L.a * C.mist.mul, 1e-9, 'mist opacity'); }
    });
    test('tower lights: height, reach, decay 2, colour per tower; a lit tower burns at 2.2 x (0.85-1.15) x mul', () => {
      fresh(); lit(0); vis(5);
      TOWERS.forEach((T, i) => { eq(T.light.position.y, C.towers.y, 'y ' + i); eq(T.light.distance, C.towers.distance, 'distance ' + i); eq(T.light.decay, 2, 'decay ' + i); eq(hex(T.light.color), C.towers.colors[i], 'colour ' + i); });
      const I = TOWERS[0].light.intensity; ok(I >= 2.2 * 0.85 * C.towers.mul - 1e-9 && I <= 2.2 * 1.15 * C.towers.mul + 1e-9, 'lit intensity ' + I);
    });
    test('flame off: a lit tower shows no flame (particles of size 0, fully transparent) and draws exactly the random numbers the engine draws', () => {
      fresh(); const T = lit(0), n0 = ADD.list.length; EG.seed(9); for (let k = 0; k < 60; k++) updateTowers(1 / 60);
      const add = ADD.list.slice(n0), r1 = Math.random();
      ok(add.length >= 10, `flame particles still emitted (${add.length})`); ok(add.every((q) => q.s0 === 0 && q.s1 === 0 && q.a0 === 0 && q.a1 === 0), 'all invisible');
      T.acc = {}; const n1 = ADD.list.length; EG.seed(9); for (let k = 0; k < 60; k++) K.towers0(1 / 60); const r2 = Math.random();
      ok(ADD.list.slice(n1).some((q) => q.s0 > 0 && q.a0 > 0), 'control: the engine alone draws a visible flame'); eq(r2, r1, 'next random number after 60 frames'); EG.seed(null);
    });
    test('tower halo: only a lit tower shows it; the halo is stepped pixels (3-5 levels, dithered edges), one texel per screen pixel', () => {
      fresh(); lit(1); vis(3); const th = K.halos.filter((h) => h.owner === TOWERS[0] || h.owner === TOWERS[1] || h.owner === TOWERS[2] || h.owner === TOWERS[3]);
      eq(th.length, 4, 'one halo per tower'); eq(th.map((h) => h.m.visible).join(), 'false,true,false,false', 'visible only on the lit tower');
      const h = th[1], img = h.m.material.map.image, d = img.getContext('2d').getImageData(0, 0, img.width, img.height).data, lv = new Set();
      let alt = 0; for (let x = 0; x < img.width; x++) lv.add(d[(Math.floor(img.height / 2) * img.width + x) * 4]);
      for (let y = 1; y < img.height - 1; y++) for (let x = 1; x < img.width - 1; x++) { const k = (y * img.width + x) * 4; if (d[k] !== d[k - 4] && d[k - 4] === d[k + 4]) alt++; }
      ok(lv.size >= 3 && lv.size <= 5 && lv.has(0), 'levels ' + [...lv].sort((a, b) => a - b)); ok(alt > 0, 'dithered edges');
      near(h.m.geometry.parameters.width * (CONTENT.sprites.ppu || 27.5), img.width, 1e-6, 'one texel per screen pixel at the sprite density');
    });
    test('steps are compiled in: the terrain program has the steps and the cell tint, the outer ground program the steps only', () => {
      vis(1); grab(); const gl = renderer.getContext(), src = (p) => gl.getAttachedShaders(p.program).map((s) => gl.getShaderSource(s)).join('\n');
      const P = renderer.info.programs, terr = P.find((p) => /egLook:terrain:cell/.test(p.cacheKey)), grd = P.find((p) => /egLook:ground/.test(p.cacheKey));
      ok(terr && grd, 'both programs compiled'); ok(/egLookStep/.test(src(terr)) && /tLookCell/.test(src(terr)), 'terrain: steps + cells'); ok(/egLookStep/.test(src(grd)) && !/tLookCell/.test(src(grd)), 'ground: steps only');
      eq(terrMat.userData.egLook.step && terrMat.userData.egLook.cell, true, 'terrain patch flags'); eq(K.state.patched.join(), 'terrain,ground', 'patched');
    });
    // a plain grey Lambert plane with the same patch, lit from above, filmed straight down: count the brightness levels along one row
    const probe = (fn) => {
      const sc = new THREE.Scene(), mat = new THREE.MeshLambertMaterial({ color: 0x606060 }); K.patch(mat, 'probe', false);
      // r128 Lambert lights per vertex: the plane is as dense as the terrain grid, or the pool is smeared between its 4 corners
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(30, 30, 120, 120), mat); pl.rotation.x = -Math.PI / 2; sc.add(pl);
      const pt = new THREE.PointLight(0xffffff, 1.6, 8, 2); pt.position.set(0, 1.2, 0); sc.add(pt);
      const dl = new THREE.DirectionalLight(0xa0b0f0, 0); dl.position.set(-20, 30, 10); sc.add(dl);
      const cam = new THREE.PerspectiveCamera(42, renderer.domElement.width / renderer.domElement.height, 0.1, 100); cam.position.set(0, 14, 0.001); cam.lookAt(0, 0, 0);
      try { return fn({ sc, cam, pt, dl }); } finally { pl.geometry.dispose(); mat.dispose(); }
    };
    const row = (g) => { const y = Math.round(g.H / 2), out = []; for (let x = Math.round(g.W * 0.3); x < Math.round(g.W * 0.7); x++) out.push(Math.round(lum(g.px(x, y)))); return out; };
    test('light steps: a point-light pool on a grey ground shows a few brightness levels (smooth without the steps), dithered at the band edges', () => {
      const U = K.uniforms, k0 = U.uLookK.value, w0 = U.uLookW.value;
      try {
        const r = probe(({ sc, cam }) => { const on = row(grab(cam, sc)); U.uLookK.value = 0; const off = row(grab(cam, sc)); U.uLookK.value = k0; U.uLookW.value = 0; const flat = row(grab(cam, sc)); return { on, off, flat }; });
        const levels = (a) => new Set(a).size, alt = (a) => { let n = 0; for (let i = 1; i < a.length - 1; i++) if (a[i] !== a[i - 1] && a[i - 1] === a[i + 1]) n++; return n; };
        ok(levels(r.on) <= 14 && levels(r.off) >= levels(r.on) * 3, `levels stepped ${levels(r.on)}, smooth ${levels(r.off)}; samples ${r.on.filter((_, i) => i % 40 === 0)} / ${r.off.filter((_, i) => i % 40 === 0)}`);
        ok(Math.max(...r.on) - Math.min(...r.on) >= 25, 'the pool still spans a range of brightness');
        ok(alt(r.on) >= 2 && alt(r.flat) === 0 && alt(r.off) === 0, `dither runs: stepped ${alt(r.on)}, without dither ${alt(r.flat)}, smooth ${alt(r.off)}`);
      } finally { U.uLookK.value = k0; U.uLookW.value = w0; }
    });
    test('moonlight is not stepped: with the point light off, at six moon strengths the grey ground is the same with and without the steps', () => {
      const U = K.uniforms, k0 = U.uLookK.value; let worst = 0, lo = 255;
      try {
        probe(({ sc, cam, pt, dl }) => { pt.intensity = 0;
          for (const s of [0.3, 0.5, 0.7, 0.9, 1.2, 1.5]) { dl.intensity = s; U.uLookK.value = k0; const a = row(grab(cam, sc)); U.uLookK.value = 0; const b = row(grab(cam, sc)); lo = Math.min(lo, ...a); worst = Math.max(worst, ...a.map((v, i) => Math.abs(v - b[i]))); } });
      } finally { U.uLookK.value = k0; }
      ok(worst <= 1 && lo > 10, `largest difference ${worst} (darkest ${lo})`);
    });
    test('terrain cells: tint and glow per type in the cell texture, the changed cell re-sent when the terrain changes; the ground beyond the fence takes the soil tint', () => {
      fresh(); vis(1); const D = K.cellTex.image.data, at = (i) => ((GN - 1 - Math.floor(i / GN)) * GN + (i % GN)) * 4;
      eq(K.cellOfT[TER.SOIL].join(), C.terrain.SOIL.tint.map((x) => Math.round(x * 255)).concat(0).join(), 'soil cell value');
      eq(K.cellOfT[TER.LAVA][3], 255, 'lava glows'); eq(K.cellOfT[TER.FIRE][3], Math.round(0.9 * 255), 'fire glows 0.9'); eq(K.cellOfT[TER.GRASS].join(), '255,255,255,0', 'a type without settings: no tint, no glow');
      const i = cellOf(3.5, 3.5), u0 = K.state.glowUploads; setT(i, TER.LAVA, 30); vis(1);
      eq([...D.slice(at(i), at(i) + 4)].join(), K.cellOfT[TER.LAVA].join(), 'texel of the changed cell'); ok(K.state.glowUploads === u0 + 1, 're-sent once'); ok(K.state.glowCells >= 1, 'glowing cells counted');
      vis(1); eq(K.state.glowUploads, u0 + 1, 'nothing re-sent when nothing changed');
      const s = C.terrain.SOIL.tint; near(ground.material.color.r, s[0], 1e-6, 'outer r'); near(ground.material.color.b, s[2], 1e-6, 'outer b');
    });
    test('glowing lava: with every light off, the brightest pixels of a lava patch are at least 1.5x brighter with the glow than without', () => {
      fresh(); const x0 = 12.5, z0 = 12.5, idx = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const c = cellOf(x0 + dx, z0 + dz); setT(c, TER.LAVA, 30); idx.push(c); }
      vis(1); const cam = new THREE.PerspectiveCamera(42, renderer.domElement.width / renderer.domElement.height, 0.1, 100); cam.position.set(x0, 6, z0 + 0.001); cam.lookAt(x0, 0, z0);
      const keep = scene.children.filter((o) => o.isLight).map((o) => [o, o.intensity]), D = K.cellTex.image.data, at = (i) => ((GN - 1 - Math.floor(i / GN)) * GN + (i % GN)) * 4 + 3;
      const top = () => { const g = grab(cam), v = []; for (let y = g.H * 0.45; y < g.H * 0.55; y += 2) for (let x = g.W * 0.45; x < g.W * 0.55; x += 2) v.push(lum(g.px(x, y))); v.sort((a, b) => b - a); return v.slice(0, v.length >> 2).reduce((a, b) => a + b, 0) / (v.length >> 2); };
      try { for (const [o] of keep) o.intensity = 0; const on = top(); for (const i of idx) D[at(i)] = 0; K.cellTex.needsUpdate = true; const off = top();
        ok(on >= off * 1.5 && on > 20, `bright lava pixels ${on.toFixed(1)} with glow, ${off.toFixed(1)} without`); }
      finally { for (const [o, v] of keep) o.intensity = v; for (const i of idx) D[at(i)] = 255; K.cellTex.needsUpdate = true; }
    });
    test('fill light: every character and prop sprite material takes diffuse x colour, fill x fillColor as emissive, its own picture as the emissive map', () => {
      vis(1); const S = EGSprites, A = Object.values(S.actorCfg).map((c) => c.mat), P = S.propRecs.map((r) => r.cfg.mat).filter((m) => m.isMeshLambertMaterial);
      ok(A.length >= 2 && P.length >= 4, 'materials'); ok(K.state.mats >= 2, 'tuned count ' + K.state.mats);
      const want = (o) => new THREE.Color(o.fillColor).multiplyScalar(o.fill);
      for (const m of A) { near(m.color.r, C.actors.diffuse, 1e-6, 'actor diffuse'); near(m.emissive.r, want(C.actors).r, 1e-6, 'actor fill r'); near(m.emissive.b, want(C.actors).b, 1e-6, 'actor fill b'); eq(m.emissiveMap, m.map, 'actor emissive map'); }
      for (const m of P) { near(m.color.g, C.props.diffuse, 1e-6, 'prop diffuse'); near(m.emissive.g, want(C.props).g, 1e-6, 'prop fill'); eq(m.emissiveMap, m.map, 'prop emissive map'); }
    });
    test('decorations: a pair beside every tower, one beside each tombstone the position hash picks, one alone; drawn standing on the ground, facing the camera', () => {
      fresh(); vis(2); ok(K.state.decorReady, 'pictures loaded'); const [G0, G1, G2] = K.groups;
      eq(G0.items.length, TOWERS.length * 2, 'two per tower');
      G0.items.forEach((I, k) => { const T = TOWERS[k >> 1], o = C.decor[0].at[k & 1]; near(I.x, T.x + o[0], 1e-9, 'x'); near(I.z, T.z + o[1], 1e-9, 'z'); });
      const want = props.filter((p) => p.kind === 'tomb' && h2(Math.round(p.x * 16) + 31, Math.round(p.z * 16) - 17) < C.decor[1].share);
      ok(want.length >= 2, 'fixture picks some tombs'); eq(G1.items.map((I) => props.indexOf(I.owner)).join(), want.map((p) => props.indexOf(p)).join(), 'the hash-picked tombs');
      eq(G2.items.length, 1, 'one alone'); near(G2.items[0].x, C.decor[2].at[0][0], 1e-9, 'absolute x');
      for (const I of K.decor) { ok(I.m && I.m.visible, 'drawn'); near(I.m.position.y, 0, 1e-9, 'on the ground'); ok(I.m.quaternion.angleTo(camera.quaternion) < 1e-6, 'faces the camera'); }
      const w = G1.items[0].m.geometry.parameters.width * (CONTENT.sprites.ppu || 27.5); near(w, 16 / 2, 1e-6, 'shrink 2 halves the 16-pixel cell');
    });
    test('a decoration beside a tombstone goes out when the tomb falls (sprite and halo), and comes back when the props are reset', () => {
      fresh(); vis(2); const I = K.groups[1].items[0];
      breakProp(I.owner, new THREE.Vector3(I.owner.x + 1, 0, I.owner.z)); step(40);
      ok(I.owner.state !== 'up', 'tomb down'); eq(I.m.visible, false, 'sprite hidden'); eq(I.halo.m.visible, false, 'halo hidden');
      resetProps(); vis(2); eq(I.m.visible, true, 'back after reset');
    });
    test('decoration lights: a fixed number added at load, they flicker within ±12 % without random numbers, a third of that with reduced flashing', () => {
      eq(scene.children.filter((o) => o.isPointLight && o.userData.egLook === 'decor').length, TOWERS.length * 2, 'one light per tower decoration'); eq(K.state.lights, TOWERS.length * 2, 'state');
      const I = K.groups[0].items[0], a = flick(120, () => I.light.intensity / I.i0); EG.reduceFlashing(true); const b = flick(120, () => I.light.intensity / I.i0); EG.reduceFlashing(false);
      const span = (v) => Math.max(...v) - Math.min(...v);
      ok(span(a) > 0.02 && Math.max(...a) <= 1.121 && Math.min(...a) >= 0.879, 'span ' + span(a).toFixed(3)); ok(span(b) <= span(a) * 0.35 + 1e-6, 'reduced span ' + span(b).toFixed(3));
      eq(I.light.position.y, C.decor[0].light.y, 'light height');
    });
    test('blocking: the lone decoration with block 0.8 pushes the player out; tomb decorations never block', () => {
      const I = K.groups[2].items[0], o = obstacles.find((b) => b.x === I.x && b.z === I.z); ok(o && o.r === 0.8, 'an obstacle at the decoration');
      const v = new THREE.Vector3(I.x + 0.2, 0, I.z); pushOut(v, 0.4); ok(Math.hypot(v.x - I.x, v.z - I.z) >= 1.2 - 1e-9, 'pushed out to 0.8 + 0.4');
      ok(K.groups[1].items.every((J) => !obstacles.some((b) => b.x === J.x && b.z === J.z)), 'tomb decorations not in the obstacles');
    });
    test('validation names the field: bad colours, tints, steps, flame, decor cells and placement are problems; an unknown key only warns', () => {
      const v = K.validate, has = (p, s) => p.some((x) => x.includes(s));
      eq(v(C).length, 0, 'the fixture is valid'); eq(v({}).length, 0, 'empty is valid');
      ok(has(v({ clear: 'red' }), 'CONTENT.look.clear'), 'colour'); ok(has(v({ terrain: { LAVA: { tint: [2, 0, 0] } } }), 'CONTENT.look.terrain.LAVA.tint'), 'tint');
      ok(has(v({ steps: { dither: 3 } }), 'CONTENT.look.steps.dither'), 'dither'); ok(has(v({ towers: { flame: 'off' } }), 'CONTENT.look.towers.flame'), 'flame');
      ok(has(v({ decor: [{ atlas: 'props', near: 'tomb' }] }), 'CONTENT.look.decor[0].cell'), 'cell'); ok(has(v({ decor: [{ atlas: 'props', cell: 0 }] }), 'CONTENT.look.decor[0].at'), 'absolute without at');
      ok(has(v({ decor: [{ atlas: 'nope', cell: 0, near: 'tower' }] }), 'CONTENT.look.decor[0].atlas'), 'atlas name'); ok(has(v({ decor: [{ atlas: 'props', cell: 0, near: 'well' }] }), 'CONTENT.look.decor[0].near'), 'near');
      ok(has(v({ hemi: { mul: -1 } }), 'CONTENT.look.hemi.mul'), 'negative mul'); ok(has(v([]), 'CONTENT.look'), 'not an object');
      const w0 = (window.__contentWarnings || []).length; eq(v({ glare: 1 }).length, 0, 'unknown key is not a problem'); ok((window.__contentWarnings || []).length > w0, 'but warns');
    });
  }

  for (const [name, fn] of tests) {
    try { await fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, err: String(e && e.stack || e).split('\n').slice(0, 3).join(' | ') }); }
  }
  return results;
};
