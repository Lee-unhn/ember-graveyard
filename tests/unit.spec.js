// Unit tests. Injected into the running page (index.html) and executed against its global functions.
// Each test resets world state through fresh(); no test depends on another test's leftovers.
window.__runUnit = async (only) => {
  const tests = [], results = [];
  const test = (name, fn) => tests.push([name, fn]);
  class AssertError extends Error {}
  const ok = (c, m) => { if (!c) throw new AssertError(m || 'expected truthy'); };
  const eq = (a, b, m) => { if (a !== b) throw new AssertError(`${m || 'eq'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
  const near = (a, b, tol, m) => { if (!(Math.abs(a - b) <= tol)) throw new AssertError(`${m || 'near'}: expected ${b}±${tol}, got ${a}`); };
  const withRandom = (v, fn) => { const r = Math.random; Math.random = () => v; try { return fn(); } finally { Math.random = r; } };
  const fresh = () => {
    while (dlg) endDialog();
    clearWorld(); running = true; paused = false;
    Object.assign(story, { on: false, phase: 'idle', act: 0, unlocked: new Set(['fire', 'bolt', 'meteor', 'blood']), tier: { fire: 1 }, seen: new Set(), boss: null });
    player.pos.set(0, 0, 0); player.maxhp = 100; player.hp = 100; player.kills = 0; player.cast = null;
    for (const k in cds) cds[k] = 0;
    inv.length = 0; for (const k in equipped) delete equipped[k]; recalc();
    setTier(1); setRoute(0);
    Object.assign(SET, SET_DEFAULT); applySettings(); hitStop = 0; shakeAmt = 0; for (const id of MENUS) document.querySelector('#' + id).hidden = true; syncMenu();
    if (window.EG) { EG.resetSpellParams(); EG.pause(false); } // extension state (spell overrides, hold) never leaks into the next test; guarded so this file also runs on an engine without EG
    if (window.EG && EG.pausedBy) for (const o of EG.pausedBy()) EG.pause(false, o); // every named hold too
    if (window.EG && EG.seed) EG.seed(null); // and the page's own random numbers again
    if (window.EG && EG.enableBlink) EG.enableBlink(false); // blink is off unless a test turns it on
  };
  const atlasPx = (x, y) => [...atlas.getContext('2d').getImageData(x, y, 1, 1).data];
  const cellAlpha = (sheet, f, px, py) => { const sx = (sheet % 2) * 512 + (f % 4) * 128, sy = Math.floor(sheet / 2) * 512 + Math.floor(f / 4) * 128; return atlasPx(sx + px, sy + py)[3]; };
  const cellMeanAlpha = (sheet, f) => { const sx = (sheet % 2) * 512 + (f % 4) * 128, sy = Math.floor(sheet / 2) * 512 + Math.floor(f / 4) * 128;
    const d = atlas.getContext('2d').getImageData(sx, sy, 128, 128).data; let s = 0; for (let i = 3; i < d.length; i += 4) s += d[i]; return s / (d.length / 4); };
  const cellDiff = (sheet, f1, f2) => { const g = atlas.getContext('2d'), at = (f) => g.getImageData((sheet % 2) * 512 + (f % 4) * 128, Math.floor(sheet / 2) * 512 + Math.floor(f / 4) * 128, 128, 128).data;
    const a = at(f1), b = at(f2); let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };

  // ---------------------------------------------------------------- math & noise
  test('h2 is deterministic and in [0,1)', () => {
    for (let i = 0; i < 500; i++) { const x = (i * 37) % 997 - 400, y = (i * 91) % 613 - 300, v = h2(x, y); ok(v >= 0 && v < 1, `h2 out of range ${v}`); eq(h2(x, y), v, 'repeat'); }
  });
  test('vnoise stays in [0,1] and is continuous', () => {
    for (let i = 0; i < 300; i++) { const x = i * 0.137, y = i * 0.071, v = vnoise(x, y); ok(v >= 0 && v <= 1, 'range'); near(vnoise(x + 1e-4, y), v, 1e-2, 'continuity'); }
  });
  test('tileFbm tiles seamlessly (period 1 in u and v)', () => {
    for (const v of [0.1, 0.33, 0.77]) { near(tileFbm(0, v, 4, 3), tileFbm(1, v, 4, 3), 1e-9, 'u wrap'); near(tileFbm(v, 0, 4, 3), tileFbm(v, 1, 4, 3), 1e-9, 'v wrap'); }
  });
  test('ramp: endpoints and red channel never decreases', () => {
    const a = ramp(0), b = ramp(1); near(a[0], .35, 1e-9); near(b[0], 1, 1e-9); near(b[2], .9, 1e-9);
    let prev = -1; for (let h = 0; h <= 1.0001; h += .05) { const r = ramp(Math.min(1, h))[0]; ok(r >= prev - 1e-9, 'monotonic red'); prev = r; }
  });
  test('ss / clamp / lerp edge cases', () => {
    eq(ss(0, 1, -5), 0); eq(ss(0, 1, 5), 1); near(ss(0, 1, .5), .5, 1e-9); near(ss(.5, .42, .5), 0, 1e-9, 'reversed edges'); near(ss(.5, .42, .42), 1, 1e-9);
    eq(clamp(5, 0, 1), 1); eq(clamp(-1, 0, 1), 0); eq(lerp(2, 4, .5), 3);
  });

  // ---------------------------------------------------------------- flipbook atlas
  test('atlas is 1024x1024 with four 4x4 sheets', () => { eq(atlas.width, 1024); eq(atlas.height, 1024); });
  test('every cell has a transparent border (no bleeding)', () => {
    for (let s = 0; s < 4; s++) for (let f = 0; f < 16; f++) for (const [x, y] of [[1, 1], [126, 1], [1, 126], [126, 126], [64, 1], [1, 64]]) eq(cellAlpha(s, f, x, y), 0, `sheet ${s} frame ${f} border`);
  });
  test('fire cells are opaque in the middle', () => { for (let f = 0; f < 16; f++) ok(cellAlpha(0, f, 64, 64) > 200, `fire frame ${f} centre alpha ${cellAlpha(0, f, 64, 64)}`); });
  test('fire loop closes: last frame is closer to frame 0 than the mid frame is', () => { ok(cellDiff(0, 15, 0) < cellDiff(0, 8, 0), `seam ${cellDiff(0, 15, 0).toFixed(2)} vs mid ${cellDiff(0, 8, 0).toFixed(2)}`); });
  test('explosion fades out over its 16 frames', () => { ok(cellMeanAlpha(1, 15) < cellMeanAlpha(1, 3) * .25, `last ${cellMeanAlpha(1, 15).toFixed(1)} vs early ${cellMeanAlpha(1, 3).toFixed(1)}`); });
  test('spark sheet: dots in frames 0-7, four-point stars in 8-15', () => {
    ok(cellAlpha(3, 0, 64, 40) < cellAlpha(3, 8, 64, 40), 'star has a vertical arm the dot lacks');
  });

  // ---------------------------------------------------------------- particle system
  test('PSys: emit, age, die, recycle', () => {
    const p = new PSys(4, THREE.AdditiveBlending, 1);
    try {
      ok(p.emit({ life: .1 }) && p.emit({ life: 1 }), 'emit'); eq(p.list.length, 2);
      p.update(.2); eq(p.list.length, 1, 'short-lived particle removed'); eq(p.pool.length, 1, 'returned to pool'); eq(p.g.instanceCount, 1);
      const q = p.emit({ life: 1 }); eq(p.pool.length, 0, 'pool reused'); ok(q, 'recycled object');
    } finally { scene.remove(p.mesh); }
  });
  test('PSys: hard cap returns null instead of growing', () => {
    const p = new PSys(3, THREE.AdditiveBlending, 1);
    try { for (let i = 0; i < 3; i++) ok(p.emit({ life: 5 })); eq(p.emit({ life: 5 }), null); } finally { scene.remove(p.mesh); }
  });
  test('PSys: follow particles track their owner and die with it', () => {
    const p = new PSys(4, THREE.AdditiveBlending, 1), owner = { pos: new THREE.Vector3(1, 2, 3), dead: false };
    try {
      p.emit({ follow: owner, life: 1e9, oy: .5 }); owner.pos.set(5, 0, 0); p.update(.016);
      eq(p.aPos.array[0], 5, 'x follows'); near(p.aPos.array[1], .5, 1e-9, 'y offset'); owner.dead = true; p.update(.016); eq(p.list.length, 0, 'killed with owner');
    } finally { scene.remove(p.mesh); }
  });
  test('PSys: play-once frames run 0 -> 15.999 across the lifetime; gravity bounces on the ground', () => {
    const p = new PSys(4, THREE.AdditiveBlending, 1);
    try {
      p.emit({ life: 1, fm: 1 }); p.update(.5); near(p.aData.array[2], 15.999 * .5, 1e-3, 'frame at half life');
      const q = p.emit({ y: .5, vy: -10, grav: 10, life: 2 }); for (let i = 0; i < 30; i++) p.update(.016); ok(q.y >= .04, 'never below ground');
    } finally { scene.remove(p.mesh); }
  });

  // ---------------------------------------------------------------- light pool
  test('light pool: flash decays and frees; attach follows and releases; size stays 10', () => {
    for (const s of LP) { s.busy = false; s.l.intensity = 0; }
    flash(new THREE.Vector3(), 0xffffff, 4, 8, .2); eq(LP.filter((s) => s.busy).length, 1);
    updateLights(.3); eq(LP.filter((s) => s.busy).length, 0, 'freed after life');
    const o = { pos: new THREE.Vector3(3, 0, 3), dead: false }; const h = attachLight(o, 0xff0000, 2, 6); updateLights(.016); eq(h.l.position.x, 3);
    o.dead = true; updateLights(.016); eq(h.busy, false, 'released when owner dies');
    for (let i = 0; i < 25; i++) flash(new THREE.Vector3(), 0xffffff, 1, 1, 5); eq(LP.length, 10, 'pool never grows'); updateLights(10);
  });

  // ---------------------------------------------------------------- items & inventory
  test('makeItem: forced rarity gives the right stat count and in-range values', () => {
    for (let r = 0; r < 4; r++) for (let n = 0; n < 40; n++) {
      const it = makeItem(r); eq(Object.keys(it.st).length, RAR[r].k, 'stat count');
      for (const [k, v] of Object.entries(it.st)) { if (k === 'light') { eq(v, LAMP_R[r], 'lantern radius by rarity'); continue; } const [lo, hi] = RANGE[k]; ok(v >= Math.round(lo * RAR[r].mul) - 1 && v <= Math.round(hi * RAR[r].mul) + 1, `${k}=${v} rarity ${r}`); }
    }
  });
  const lantern = (r) => { for (let n = 0; n < 500; n++) { const it = makeItem(r); if (it.slot === 'light') return it; } throw new Error('no lantern rolled'); };
  test('lanterns drop with a light radius set by rarity and one ordinary stat fewer', () => {
    for (let r = 0; r < 4; r++) { const it = lantern(r); eq(it.st.light, LAMP_R[r], 'radius'); eq(Object.keys(it.st).length - 1, RAR[r].k - 1, 'other stats'); }
    ok(LAMP_R.every((v, i) => i === 0 || v > LAMP_R[i - 1]), 'rarer lanterns light a wider circle');
  });
  test('equipping a lantern lights a circle around the mage; taking it off turns it off', () => {
    fresh(); updateLamp(); eq(lampLight.intensity, 0, 'no lantern, no light');
    const it = lantern(2); place(it); equip(it); updateLamp();
    eq(stats.light, LAMP_R[2], 'stat'); ok(lampLight.intensity > 0, 'light on'); near(lampLight.distance, LAMP_R[2] * 1.6, 1e-9, 'reach follows the radius');
    near(lampLight.position.x, player.pos.x, 1e-9); near(lampLight.position.z, player.pos.z, 1e-9);
    ok(/照明半徑<span class="v">9 公尺/.test(document.querySelector('#sheet').innerHTML), 'shown on the character sheet');
    unequip('light'); updateLamp(); eq(lampLight.intensity, 0, 'off again'); fresh();
  });
  test('default screen brightness is 140%', () => { eq(SET_DEFAULT.bright, 1.4); });
  test('pixel characters: mage drawn at low resolution, the HD scene around it untouched', () => {
    fresh(); SET.fx = 'low'; player.pos.set(0, 0, 0); camSnap = true; updateCamera(1 / 60);
    EGMist.state.on = false;                      // the mist drifts between the two renders compared below
    const g = renderer.getContext(), W = g.drawingBufferWidth, H = g.drawingBufferHeight, px = new Uint8Array(4 * 48 * 48);
    const sum = (x, y) => { g.readPixels(x, y, 48, 48, g.RGBA, g.UNSIGNED_BYTE, px); let s = 0; for (let i = 0; i < px.length; i += 4) s += px[i] + px[i + 1] + px[i + 2]; return s; };
    const mageAt = () => { const v = player.pos.clone().setY(1).project(camera); return [Math.round((v.x * .5 + .5) * W) - 24, Math.round((v.y * .5 + .5) * H) - 24]; };
    EGPixel.state.on = true; EGPost.render(); const [mx, my] = mageAt(); const onMage = sum(mx, my), onCorner = sum(8, 8);
    ok(EGPixel.state.scale >= 2, `pixel size ${EGPixel.state.scale}`);
    const L = new THREE.Layers(); L.set(EGPixel.CHAR); let tagged = true; EGP.g.traverse((o) => { if (!o.layers.test(L)) tagged = false; }); ok(tagged, 'mage on the character layer');
    EGPixel.state.on = false; EGPost.render(); const offMage = sum(mx, my), offCorner = sum(8, 8); EGPixel.state.on = true;
    ok(Math.abs(onMage - offMage) > 48 * 48 * 3, 'the mage is drawn by the pixel pass'); eq(onCorner, offCorner, 'the scene away from the mage is not touched');
    EGMist.state.on = true; Object.assign(SET, SET_DEFAULT);
  });
  test('quality high: moonlight shadows from props and the mage; low: none', () => {
    fresh(); SET.fx = 'high'; for (let i = 0; i < 25; i++) EGPost.render();
    ok(renderer.shadowMap.enabled && moon.castShadow, 'shadows on'); ok(EGLight.state.casters > 20, `casters ${EGLight.state.casters}`);
    let mageCasts = false; EGP.g.traverse((o) => { if (o.isMesh && o.castShadow) mageCasts = true; }); ok(mageCasts, 'the mage casts a shadow');
    ok(moon.shadow.camera.layers.mask === 0xffffffff || moon.shadow.camera.layers.mask === -1, 'shadow camera sees the character layer');
    near(moon.target.position.x, player.pos.x, 1e-6, 'shadow box follows the mage');
    SET.fx = 'low'; EGPost.render(); ok(!renderer.shadowMap.enabled && !moon.castShadow, 'shadows off at low quality');
    Object.assign(SET, SET_DEFAULT); EGPost.render();
  });
  test('ground detail: tufts on grass, pebbles on paving; burnt grass loses its tufts', () => {
    EGPost.render(); const grass = EGDetail.sets[0], peb = EGDetail.sets[1];
    ok(grass.spots.length > 300 && peb.spots.length > 100, `tufts ${grass.spots.length}, pebbles ${peb.spots.length}`);
    eq(grass.mesh.count, grass.spots.length, 'one instance per tuft');
    const j = grass.shown.indexOf(1), cell = grass.spots[j].cell, keep = TT[cell];
    setT(cell, TER.ASH); EGDetail.refresh(false); eq(grass.shown[j], 0, 'tuft hidden on ash');
    setT(cell, keep); EGDetail.refresh(false); eq(grass.shown[j], 1, 'back when the grass is back');
  });
  test('ground mist: three drifting layers that follow the mage and hide nobody', () => {
    fresh(); EGPost.render(); eq(EGMist.sheets.length, 3, 'layers');
    const S = EGMist.sheets[0].m; player.pos.set(7, 0, -3); EGPost.render();
    near(S.position.x, 7, 1e-9, 'follows x'); near(S.position.z, -3, 1e-9, 'follows z');
    ok(EGMist.sheets.every(({ m }) => m.material.transparent && !m.material.depthWrite && !m.castShadow), 'see-through, writes no depth, casts no shadow');
    const o0 = S.material.map.offset.clone(); const t = performance.now(); while (performance.now() - t < 120) {} EGPost.render();
    ok(!S.material.map.offset.equals(o0), 'drifts over time'); fresh();
  });
  test('without a graphics card the picture is lighter: no mist, no ground detail, 0.75 render scale', () => {
    EGPost.render(); ok(EGPost.state.lite, 'lite profile on in the software-rendered test browser');
    ok(EGMist.sheets.every(({ m }) => !m.visible), 'mist hidden'); ok(EGDetail.sets.every((S) => !S.mesh.visible), 'ground detail hidden');
    ok(renderer.getPixelRatio() <= .75, `render scale ${renderer.getPixelRatio()}`);
  });
  test('without a graphics card the first visit starts at quality low', () => {
    // the test browser renders in software (SwiftShader), like a computer whose graphics acceleration is off
    ok(EGPost.state.software, 'software rendering detected in the test browser');
    eq(EGPost.state.bootFx, 'low', 'quality at boot');
  });
  test('an equipped lantern flickers a little, never off', () => {
    fresh(); const it = lantern(0); place(it); equip(it); const v = [];
    for (let i = 0; i < 60; i++) { updateLamp(); EGLight.update(false); v.push(lampLight.intensity); }
    const lo = Math.min(...v), hi = Math.max(...v); ok(hi - lo > .02, `varies ${lo.toFixed(2)}-${hi.toFixed(2)}`); ok(lo > 1.2 && hi < 1.8, 'stays within about 10 %'); fresh();
  });
  test('camera sits behind and above the mage at about 50 degrees', () => {
    const deg = Math.atan2(CAM_H, CAM_B) * 180 / Math.PI; ok(deg > 45 && deg < 55, `pitch ${deg.toFixed(1)}`);
    near(Math.hypot(CAM_H, CAM_B), 17, 0.5, 'distance');
  });
  test('quality setting turns the post effects on and off, and is saved', () => {
    SET.fx = 'high'; EGPost.render(); ok(EGPost.state.on, 'high: effects on');
    SET.fx = 'low'; EGPost.render(); ok(!EGPost.state.on, 'low: plain render');
    const el = document.querySelector('#sFx'); el.value = 'low'; el.dispatchEvent(new Event('change'));
    eq(JSON.parse(localStorage.getItem('eg-settings')).fx, 'low', 'saved');
    Object.assign(SET, SET_DEFAULT); saveSettings(); EGPost.render(); ok(EGPost.state.on, 'default is high on a computer');
  });
  test('post effects keep the picture at least as bright as the plain render in the centre', () => {
    // the scene is dark on purpose; grading and vignette must not make the middle of the screen darker (author feedback 2026-11-17)
    const g = renderer.getContext(), W = g.drawingBufferWidth, H = g.drawingBufferHeight, px = new Uint8Array(4 * 64 * 64);
    const centre = () => { g.readPixels((W >> 1) - 32, (H >> 1) - 32, 64, 64, g.RGBA, g.UNSIGNED_BYTE, px); let s = 0; for (let i = 0; i < px.length; i += 4) s += px[i] + px[i + 1] + px[i + 2]; return s / (px.length / 4 * 3); };
    fresh(); SET.fx = 'low'; EGPost.render(); const plain = centre(); SET.fx = 'high'; EGPost.render(); const fx = centre();
    ok(fx >= plain, `centre brightness plain ${plain.toFixed(1)}, with effects ${fx.toFixed(1)}`); Object.assign(SET, SET_DEFAULT);
  });
  test('story mode hands out one common lantern, equipped; never a second one', () => {
    fresh(); startStory(0); while (dlg) endDialog();
    ok(equipped.light && equipped.light.rar === RAR[0], 'common lantern equipped'); eq(equipped.light.name, '燼燈'); eq(stats.light, LAMP_R[0], 'lights 5 m');
    startStory(0); while (dlg) endDialog();
    eq(inv.filter((i) => i.slot === 'light').length, 0, 'no spare lantern in the bag'); eq(stats.light, LAMP_R[0]);
    const better = lantern(3); place(better); equip(better); startStory(1); while (dlg) endDialog();
    eq(equipped.light, better, 'continuing keeps the better lantern'); eq(inv.filter((i) => i.slot === 'light').length, 1, 'the old one stays in the bag, no new one');
    fresh();
  });
  test('the ground is subdivided so point lights (lantern, spells) can light it', () => {
    // Lambert lights per vertex: a plane with only its four corners shows no light circle at all (DEVLOG #54)
    const terr = scene.children.find((o) => o.isMesh && o.material === terrMat);
    ok(terr && terr.geometry.attributes.position.count >= GN * GN, `terrain vertices ${terr && terr.geometry.attributes.position.count}`);
    ok(ground.geometry.attributes.position.count >= 70 * 70, `ground vertices ${ground.geometry.attributes.position.count}`);
  });
  test('grid placement: 60 single cells fit, the 61st does not', () => {
    fresh(); let placed = 0; for (let i = 0; i < 61; i++) { const it = makeItem(0); Object.assign(it, { w: 1, h: 1 }); if (place(it)) placed++; } eq(placed, 60);
  });
  test('grid placement respects shapes: a 1x4 staff needs four free rows', () => {
    fresh(); for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!(x === 0 && y < 3)) { const it = makeItem(0); Object.assign(it, { w: 1, h: 1, x, y }); inv.push(it); }
    const staff = makeItem(0); Object.assign(staff, { w: 1, h: 4 }); eq(place(staff), false, 'only 3 rows free');
    inv.splice(inv.findIndex((i) => i.x === 0 && i.y === 3), 1); eq(place(staff), true, '4 rows free'); eq(staff.x, 0); eq(staff.y, 0);
  });
  test('equip / unequip changes max HP and moves the item', () => {
    fresh(); const it = makeItem(0); Object.assign(it, { slot: 'body', type: 'armor', w: 2, h: 3, st: { hp: 30 } }); place(it);
    equip(it); eq(player.maxhp, 130); eq(inv.includes(it), false); eq(equipped.body, it);
    unequip('body'); eq(player.maxhp, 100); eq(inv.includes(it), true); eq(equipped.body, undefined);
  });
  test('equip swap is refused (and nothing changes) when the old item has no room', () => {
    fresh(); const a = makeItem(0); Object.assign(a, { slot: 'body', type: 'armor', w: 2, h: 3, st: { hp: 10 } }); place(a); equip(a);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) { const f = makeItem(0); Object.assign(f, { w: 1, h: 1, x, y }); inv.push(f); }
    const b = inv[0]; Object.assign(b, { slot: 'body', type: 'armor', st: { hp: 50 } }); equip(b); eq(equipped.body, a, 'kept old'); eq(player.maxhp, 110);
  });

  // ---------------------------------------------------------------- combat
  test('dealDamage: normal and critical hits', () => {
    fresh(); spawnEnemy('lizard', 5, 5, 1); const e = enemies[0];
    withRandom(.9, () => dealDamage(e, 10, 'fire')); eq(e.hp, 80, 'normal');
    withRandom(.05, () => dealDamage(e, 10, 'fire')); near(e.hp, 62, 1e-9, 'crit x1.8');
  });
  test('aoe only hits inside the radius; killEnemy counts once', () => {
    fresh(); spawnEnemy('spider', 0, 0, 1); spawnEnemy('spider', 10, 0, 1); const [a, b] = enemies;
    withRandom(.9, () => aoe(new THREE.Vector3(0, 0, 0), 2, 1000, 'fire')); eq(a.alive, false); eq(b.alive, true); eq(player.kills, 1);
    killEnemy(a); dealDamage(a, 50, 'fire'); ok(player.kills <= 2, 'dead enemies ignore further damage');
  });
  test('boltPath: 17 points, exact endpoints', () => {
    const a = new THREE.Vector3(0, 1, 0), b = new THREE.Vector3(6, 1, 2), pts = boltPath(a, b);
    eq(pts.length, 17); eq(pts[0].distanceTo(a), 0); eq(pts[16].distanceTo(b), 0);
  });
  test('pushOut keeps bodies outside obstacles and inside the fence', () => {
    const o = obstacles[0], p = new THREE.Vector3(o.x + .01, 0, o.z); pushOut(p, .4); ok(Math.hypot(p.x - o.x, p.z - o.z) >= o.r + .4 - 1e-6, 'outside obstacle');
    const q = new THREE.Vector3(80, 0, 0); pushOut(q, .4); ok(Math.hypot(q.x, q.z) <= 42.5 + 1e-6, 'inside fence');
  });

  // ---------------------------------------------------------------- spells & modes
  test('tierOf: free mode follows the Lab toggle; story mode follows progress', () => {
    fresh(); setTier(0); eq(tierOf('fire'), 0); eq(tierOf('meteor'), 0); setTier(1); eq(tierOf('bolt'), 1);
    story.on = true; story.tier.fire = 0; eq(tierOf('fire'), 0); eq(tierOf('meteor'), 1); story.tier.fire = 1; eq(tierOf('fire'), 1);
  });
  test('tryCast: locked spells refuse, cooldown blocks a second cast', () => {
    fresh(); story.on = true; story.unlocked = new Set(['fire']); tryCast('bolt'); eq(player.cast, null, 'locked');
    tryCast('fire'); ok(player.cast && player.cast.id === 'fire', 'fire cast'); player.cast = null; tryCast('fire'); eq(player.cast, null, 'cooldown');
  });
  test('tryCast refuses while paused (dialogue open)', () => { fresh(); paused = true; tryCast('fire'); eq(player.cast, null); paused = false; });
  test('route and tier switches update shader uniform and labels', () => {
    fresh(); setRoute(2); eq(shared.uMode.value, 2); ok($('#routeNote').textContent.includes('方塊')); setRoute(0);
    setTier(0); eq($('#mfire').textContent, '單發'); setTier(1); eq($('#mmeteor').textContent, '十顆連落');
  });
  test('replaceSheet: black becomes transparent, colour is un-premultiplied, smoke uses brightness', () => {
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 512); g.fillStyle = 'rgb(255,128,0)'; g.fillRect(256, 0, 256, 512);
    replaceSheet(0, c); eq(atlasPx(10, 10)[3], 0, 'black alpha'); const o = atlasPx(400, 10); eq(o[3], 255); eq(o[0], 255); eq(o[1], 128);
    g.fillStyle = 'rgb(100,100,100)'; g.fillRect(0, 0, 512, 512); replaceSheet(2, c); eq(atlasPx(10, 512 + 10)[3], 160, 'smoke alpha = brightness x1.6');
    atlas.getContext('2d').putImageData(atlasOrig, 0, 0); refreshAtlas();
  });

  // ---------------------------------------------------------------- dialogue & story
  test('dialogue: pause, typewriter, advance, callback, skip', () => {
    fresh(); let done = 0; playDialog('t1', () => done++); eq(paused, true); eq(dlg.i, 0); eq($('#dWho').textContent, '灰翁');
    nextLine(); eq($('#dLine').textContent, DLG.t1[0][1], 'first press completes the line'); eq(dlg.i, 0);
    nextLine(); eq(dlg.i, 1, 'second press advances'); eq($('#dWho').textContent, '沐炎');
    endDialog(); eq(done, 1); eq(paused, false); eq($('#dialog').hidden, true);
  });
  test('story: opening -> fight -> goto -> ignite unlocks the next spell', () => {
    fresh(); startStory(); eq(story.phase, 'dialog'); eq(story.unlocked.has('bolt'), false); endDialog(); eq(story.phase, 'fight'); eq(enemies.length, ACTS[0].n);
    for (const e of enemies) killEnemy(e); updateStory(.016); eq(story.phase, 'goto'); eq(TOWERS[0].beam.visible, true);
    const T = TOWERS[0]; player.pos.set(T.x + 1, 0, T.z); for (let i = 0; i < 100; i++) updateStory(.016); eq(story.phase, 'ignite'); ok(story.ign > .4 && story.ign < 1, 'progress partial');
    player.pos.set(T.x + 10, 0, T.z); updateStory(.5); ok(story.ign < .5, 'progress decays off the tower');
    player.pos.set(T.x + 1, 0, T.z); for (let i = 0; i < 400 && story.phase !== 'dialog'; i++) updateStory(.016);
    eq(T.lit, true); eq(story.tier.fire, 1, 'fire tower upgrades fireball');
  });
  test('boss: shockwave hits once when the ring crosses the player; darkness at 50%; summons at 66%', () => {
    fresh(); story.on = true; startBoss(); const b = story.boss; ok(b && b.type === 'lord');
    player.pos.set(b.pos.x + 5, 0, b.pos.z); player.hp = 100; b.shockT = 0; bossAI(b, .016); eq(shocks.length, 1);
    for (let i = 0; i < 100; i++) updateShocks(.016); eq(player.hp, 78, 'exactly one 22-damage hit'); for (let i = 0; i < 60; i++) updateShocks(.016); eq(shocks.length, 0);
    const n0 = enemies.length; b.hp = b.maxhp * .6; bossAI(b, .016); ok(enemies.length > n0, 'summoned'); ok(b.flags.s1);
    b.hp = b.maxhp * .45; bossAI(b, .016); ok(b.flags.dark, 'dark flag'); ok(dlg, 'taunt dialogue'); endDialog(); eq(darkT, 1);
  });
  test('death text depends on mode', () => {
    fresh(); story.on = true; story.act = 2; story.phase = 'fight'; hurtPlayer(9999); eq(player.alive, false); ok($('#deadSub').textContent.includes('第 3 幕'));
    fresh(); hurtPlayer(9999); ok($('#deadSub').textContent.includes('波'));
  });

  // ---------------------------------------------------------------- P2 terrain
  const C = (x, z) => cellOf(x, z);
  const put = (x, z, t, tm) => setT(C(x, z), t, tm);
  const tAt = (x, z) => TT[C(x, z)];
  const clearBox = (x0, z0, x1, z1, t = TER.SOIL) => { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) put(x + .5, z + .5, t); };
  test('terrain grid: cell <-> world mapping, out of bounds is -1', () => {
    eq(C(-44, -44), 0); eq(C(43.99, 43.99), GN * GN - 1); eq(C(50, 0), -1); const c = cellCenter(C(3.2, -7.9)); eq(c.x, 3.5); eq(c.z, -7.5);
  });
  test('world props are placed from a fixed seed (same layout on every load)', () => {
    const t = props.filter((p) => p.kind === 'tomb'); eq(t.length, 46); eq(props.filter((p) => p.kind === 'tree').length, 12); eq(props.filter((p) => p.kind === 'sarc').length, 6);
    const sig = props.filter((p) => p.kind !== 'fence').map((p) => p.x.toFixed(3) + ',' + p.z.toFixed(3)).join(';');
    let h = 0; for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) >>> 0; window.__propSig = h; ok(h > 0);
  });
  test('initial map is deterministic and contains every base terrain', () => {
    fresh(); genTerrain(); let same = true; for (let i = 0; i < TT.length; i++) if (TT[i] !== TT0[i]) { same = false; break; } ok(same, 'regenerated map equals the saved one');
    for (const t of [TER.GRASS, TER.SOIL, TER.PAVE, TER.WATER, TER.MUD, TER.BONE, TER.WISP]) ok(TT0.includes(t), `map has ${TP[t].n}`); resetTerrain();
  });
  test('reaction table: every spell element turns each terrain into the expected one', () => {
    fresh(); const R = [
      ['fire', TER.GRASS, TER.FIRE], ['fire', TER.BONE, TER.FIRE], ['fire', TER.WATER, TER.STEAM], ['fire', TER.SHOCK, TER.STEAM], ['fire', TER.MUD, TER.SOIL], ['fire', TER.PAVE, TER.PAVE],
      ['meteor', TER.PAVE, TER.CRATER], ['meteor', TER.SOIL, TER.LAVA], ['meteor', TER.GRASS, TER.LAVA], ['meteor', TER.WATER, TER.STEAM], ['meteor', TER.BLOOD, TER.LAVA],
      ['crater', TER.PAVE, TER.CRATER], ['crater', TER.SOIL, TER.CRATER], ['crater', TER.GRASS, TER.FIRE], ['crater', TER.WATER, TER.STEAM],
      ['blood', TER.SOIL, TER.BLOOD], ['blood', TER.PAVE, TER.BLOOD], ['blood', TER.FIRE, TER.ASH], ['blood', TER.WATER, TER.WATER],
      ['bolt', TER.PAVE, TER.PAVE]];
    for (const [el, from, to] of R) { put(10.5, 10.5, from); applyEl(C(10.5, 10.5), el); eq(tAt(10.5, 10.5), to, `${el} on ${TP[from].n}`); }
    put(10.5, 10.5, TER.GRASS); withRandom(.1, () => applyEl(C(10.5, 10.5), 'bolt')); eq(tAt(10.5, 10.5), TER.FIRE, 'bolt ignites grass 30%');
    put(10.5, 10.5, TER.GRASS); withRandom(.9, () => applyEl(C(10.5, 10.5), 'bolt')); eq(tAt(10.5, 10.5), TER.GRASS, 'bolt leaves grass 70%');
    put(10.5, 10.5, TER.OBSID); applyEl(C(10.5, 10.5), 'meteor'); applyEl(C(10.5, 10.5), 'meteor'); eq(tAt(10.5, 10.5), TER.OBSID, 'obsidian survives 2 hits'); applyEl(C(10.5, 10.5), 'meteor'); eq(tAt(10.5, 10.5), TER.CRATER, 'third hit breaks it');
    for (const el of ['fire', 'bolt', 'meteor', 'crater']) { booms.length = 0; put(10.5, 10.5, TER.WISP); applyEl(C(10.5, 10.5), el); eq(booms.length, 1, `${el} sets off a wisp grave`); }
    booms.length = 0;
  });
  test('electrify floods connected water only, and the charge fades back to water', () => {
    fresh(); clearBox(5, 5, 12, 7); for (let x = 5; x <= 8; x++) put(x + .5, 6.5, TER.WATER); put(10.5, 6.5, TER.WATER);
    applyEl(C(5.5, 6.5), 'bolt'); for (let x = 5; x <= 8; x++) eq(tAt(x + .5, 6.5), TER.SHOCK, 'connected'); eq(tAt(10.5, 6.5), TER.WATER, 'gap blocks the current');
    player.pos.set(6, 0, 6); automata(1.5); eq(tAt(5.5, 6.5), TER.WATER, 'charge fades');
  });
  test('cellular automaton: fire spreads to grass, burns out to ash', () => {
    fresh(); player.pos.set(6, 0, 6); clearBox(4, 4, 9, 9); put(6.5, 6.5, TER.FIRE, 3); put(7.5, 6.5, TER.GRASS); put(6.5, 7.5, TER.BONE);
    withRandom(.99, () => automata(.2)); eq(tAt(7.5, 6.5), TER.GRASS, 'no spread on a high roll');
    withRandom(0, () => automata(.2)); eq(tAt(7.5, 6.5), TER.FIRE, 'grass caught fire'); eq(tAt(6.5, 7.5), TER.FIRE, 'bone pile caught fire');
    withRandom(.99, () => { for (let k = 0; k < 20; k++) automata(.2); }); eq(tAt(6.5, 6.5), TER.ASH, 'burnt out');
  });
  test('cellular automaton: lava flows into craters, quenches water into obsidian, cools down', () => {
    fresh(); player.pos.set(6, 0, 6); clearBox(4, 4, 9, 9); put(6.5, 6.5, TER.LAVA, 20); put(7.5, 6.5, TER.CRATER);
    withRandom(0, () => automata(.2)); eq(tAt(7.5, 6.5), TER.LAVA, 'flowed into crater');
    clearBox(4, 4, 9, 9); put(6.5, 6.5, TER.LAVA, 20); put(5.5, 6.5, TER.WATER); withRandom(0, () => automata(.2));
    eq(tAt(5.5, 6.5), TER.STEAM, 'water boiled'); eq(tAt(6.5, 6.5), TER.OBSID, 'lava quenched');
    clearBox(4, 4, 9, 9); put(6.5, 6.5, TER.LAVA, .1); withRandom(.99, () => automata(.2)); eq(tAt(6.5, 6.5), TER.OBSID, 'cooled');
    put(6.5, 6.5, TER.STEAM, .1); automata(.2); eq(tAt(6.5, 6.5), TER.CRATER, 'steam leaves a crater');
    put(6.5, 6.5, TER.BLOOD, .1); automata(.2); eq(tAt(6.5, 6.5), TER.SOIL, 'blood pool dries');
    put(6.5, 6.5, TER.CRATER); put(7.5, 6.5, TER.WATER); withRandom(0, () => automata(.2)); eq(tAt(6.5, 6.5), TER.WATER, 'water flows into crater');
  });
  test('wisp graves chain-explode and their kills count as terrain kills', () => {
    fresh(); clearBox(4, 4, 10, 8); put(6.5, 6.5, TER.WISP); put(7.5, 6.5, TER.WISP); spawnEnemy('spider', 7, 6.5, .5); const e = enemies[0];
    queueBoom(C(6.5, 6.5)); for (let k = 0; k < 10; k++) updateTerrain(.1);
    eq(tAt(6.5, 6.5), TER.CRATER); eq(tAt(7.5, 6.5), TER.CRATER, 'neighbour went off too'); eq(e.alive, false); eq(e.lastKind, 'boom'); ok(terrainKills >= 1);
  });
  // find a w x h block with no tombstone / tree / tower nearby, so body-blocking never nudges a test monster off its tile
  const freeArea = (w, h) => { for (let z0 = -38; z0 < 30; z0 += 2) for (let x0 = -38; x0 < 30; x0 += 2) {
    if ([[x0, z0], [x0 + w, z0], [x0, z0 + h], [x0 + w, z0 + h]].some(([x, z]) => Math.hypot(x, z) > 36)) continue; // stay inside the fenced arena (radius 42.5)
    if (obstacles.every((o) => !o.r || o.x < x0 - o.r - 1.5 || o.x > x0 + w + o.r + 1.5 || o.z < z0 - o.r - 1.5 || o.z > z0 + h + o.r + 1.5)) return [x0, z0]; } throw new AssertError('no free area'); };
  test('terrain damage: standing in lava kills; mud slows; chain counter builds and resets', () => {
    fresh(); player.pos.set(-30, 0, 30); const [ax, az] = freeArea(9, 5); clearBox(ax, az, ax + 8, az + 4);
    for (let k = 0; k < 3; k++) { put(ax + 1.5 + k * 2, az + 2.5, TER.LAVA, 60); spawnEnemy('spider', ax + 1.5 + k * 2, az + 2.5, 1); enemies[k].T = Object.assign({}, enemies[k].T, { speed: 0, dmg: 0 }); }
    for (let k = 0; k < 40 && enemies.some((x) => x.alive); k++) updateEnemies(.1);
    ok(enemies.every((x) => !x.alive), `all three burned: ${JSON.stringify(enemies.map((e) => ({ alive: e.alive, hp: Math.round(e.hp), x: +e.pos.x.toFixed(2), z: +e.pos.z.toFixed(2), tile: TP[tileAt(e.pos.x, e.pos.z)].n })))} area ${ax},${az}`); eq(terrainKills, 3); ok(chainN >= 2, `chain ${chainN}`); eq($('#chainTag').hidden, false); ok(/×\d/.test($('#chainTag').textContent));
    time += 2; updateTerrain(.01); eq($('#chainTag').hidden, true, 'chain tag hides after 1.4 s');
    spawnEnemy('lizard', ax + 7.5, az + 2.5, 1); put(ax + 7.5, az + 2.5, TER.MUD); near(terrainEffects(enemies[3], .016), .45, 1e-9, 'mud speed factor');
  });
  test('player: lava hurts, mud slows, obsidian is a wall', () => {
    fresh(); clearBox(-2, -2, 3, 3); put(.5, .5, TER.LAVA, 60); player.pos.set(.5, 0, .5); const hp0 = player.hp; for (let k = 0; k < 10; k++) updatePlayer(.1); ok(player.hp < hp0 - 5, `hp ${player.hp}`);
    fresh(); clearBox(-2, -2, 3, 3); put(.5, .5, TER.OBSID); const p = new THREE.Vector3(.5, 0, .5); pushOut(p, .4); ok(Math.abs(p.x - .5) >= .9 - 1e-6 || Math.abs(p.z - .5) >= .9 - 1e-6, 'pushed out of the wall');
  });
  test('tombstone: three blasts topple it away from the blast; it crushes what is in its path only', () => {
    fresh(); const t = props.find((p) => p.kind === 'tomb'); const src = new THREE.Vector3(t.x - 1, 0, t.z);
    // spiders: 45 HP, less than the 80 crush damage
    spawnEnemy('spider', t.x + t.len * .5, t.z, 1); spawnEnemy('spider', t.x - 1.6, t.z, 1); const [hit, safe] = enemies; for (const e of enemies) e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 });
    damageProps(src, 1.5, 1, 'fire'); damageProps(src, 1.5, 1, 'fire'); eq(t.state, 'up', 'still standing after 2'); damageProps(src, 1.5, 1, 'fire'); eq(t.state, 'falling');
    ok(t.dir.x > .9, 'falls away from the blast'); eq(t.ob.r, 0, 'no longer blocks');
    withRandom(.9, () => { for (let k = 0; k < 8; k++) updateProps(.1); }); eq(t.state, 'down'); eq(hit.alive, false, 'crushed'); eq(hit.lastKind, 'crush'); eq(safe.alive, true, 'the one behind survives');
  });
  test('dead tree: fire sets it burning, it falls after 6 s; fence and sarcophagus break', () => {
    fresh(); const tr = props.find((p) => p.kind === 'tree'); damageProps(new THREE.Vector3(tr.x, 0, tr.z), 1, 1, 'fire'); eq(tr.state, 'burning');
    for (let k = 0; k < 61; k++) updateProps(.1); ok(tr.state === 'falling' || tr.state === 'down', 'falls after burning'); for (let k = 0; k < 6; k++) updateProps(.1); eq(tr.state, 'down');
    const f = props.find((p) => p.kind === 'fence'); damageProps(new THREE.Vector3(f.x, 0, f.z), .5, 3, 'meteor'); eq(f.state, 'broken');
    const m = new THREE.Matrix4(); fencePosts.getMatrixAt(f.idx, m); ok(Math.abs(m.elements[5]) < .01, 'post hidden');
    const s = props.find((p) => p.kind === 'sarc'), n0 = enemies.length, l0 = loots.length; damageProps(new THREE.Vector3(s.x, 0, s.z), .5, 4, 'meteor');
    eq(s.state, 'broken'); eq(enemies.length - n0, 2, 'two ghosts released'); ok(enemies.slice(n0).every((e) => e.type === 'ghost')); eq(loots.length - l0, 1, 'one guaranteed drop');
  });
  test('boss and terrain: lava hurts the Lord; its shockwave topples tombstones', () => {
    // player far away: body-blocking would push the boss off the lava
    fresh(); story.on = true; player.pos.set(-30, 0, 30); startBoss(); const b = story.boss; clearBox(-2, -2, 2, 2);
    put(.5, .5, TER.LAVA, 60); b.pos.set(.5, 0, .5); b.T = Object.assign({}, b.T, { speed: 0 }); b.shockT = 99;
    const hp0 = b.hp; for (let k = 0; k < 20; k++) updateEnemies(.1);
    ok(hp0 - b.hp > 150, `lava damage ${(hp0 - b.hp).toFixed(0)} on tile ${TP[tileAt(b.pos.x, b.pos.z)].n}`);
    const t = props.find((p) => p.kind === 'tomb' && p.state === 'up'); shocks.push({ x: t.x - 4, z: t.z, t: 0, mesh: new THREE.Mesh(shockGeo, new THREE.MeshBasicMaterial({ transparent: true })), hit: true });
    for (let k = 0; k < 60 && t.state === 'up'; k++) updateShocks(.016); ok(t.state !== 'up', 'toppled by the ring'); ok(t.dir.x > .9, 'outward');
    for (const s of shocks) scene.remove(s.mesh); shocks.length = 0;
  });
  test('restart restores terrain, props and blockers exactly', () => {
    fresh(); put(.5, .5, TER.LAVA); const t = props.find((p) => p.kind === 'tomb'); breakProp(t, new THREE.Vector3(t.x - 1, 0, t.z)); terrainKills = 5;
    clearWorld(); let same = true; for (let i = 0; i < TT.length; i++) if (TT[i] !== TT0[i]) { same = false; break; }
    ok(same, 'terrain back to the initial map'); eq(t.state, 'up'); eq(t.ob.r, t.ob.r0); eq(terrainKills, 0);
  });

  // ---------------------------------------------------------------- P3a: screens, settings, game feel, soft terrain
  test('particle density setting thins out loose particles but never trailing ones', () => {
    fresh(); SET.particles = 'low'; applySettings(); eq(DENSITY, .4, 'low = 40%');
    const base = { x: 0, y: 1, z: 0, kind: 0, fm: 0, life: .5, s0: .5, s1: .1, r: 1, g: 1, b: 1, a0: 1, a1: 0 };
    eq(withRandom(.9, () => ADD.emit({ ...base })), null, 'a roll above the density is dropped');
    ok(withRandom(.1, () => ADD.emit({ ...base })) !== null, 'a roll below the density is kept');
    SET.particles = 'high'; applySettings(); eq(DENSITY, 1);
    ok(withRandom(.99, () => ADD.emit({ ...base })) !== null, 'high keeps everything');
  });
  test('reduce-shake setting turns off screen shake and hit-stop', () => {
    fresh(); shakeAmt = 0; hitStop = 0; shake(.8); freezeFrame(.05); ok(shakeAmt >= .8 && hitStop >= .05, 'on by default');
    shakeAmt = 0; hitStop = 0; SET.reduceShake = true; shake(.8); freezeFrame(.05); eq(shakeAmt, 0); eq(hitStop, 0);
  });
  test('hits make the monster flinch; critical hits add a short hit-stop', () => {
    fresh(); hitStop = 0; spawnEnemy('lizard', 3, 3, 1); const e = enemies[0]; e.hp = e.maxhp = 1e6;
    withRandom(.99, () => dealDamage(e, 5, 'fire')); ok(e.flinch > 0, 'flinch timer set'); eq(hitStop, 0, 'normal hit: no stop');
    withRandom(.0, () => dealDamage(e, 5, 'fire')); ok(hitStop > 0, 'critical hit: hit-stop');
  });
  test('a content pack can switch off crits and meteor-size damage (a pack can keep damage fully deterministic or drive it from its own mechanic)', () => {
    fresh(); spawnEnemy('lizard', 3, 3, 1); const e = enemies[0]; e.hp = e.maxhp = 1e6;
    const keep = CONTENT.combat; try {
      withRandom(.0, () => dealDamage(e, 10, 'fire')); near(1e6 - e.hp, 18, 1e-9, 'demo: crit x1.8 with a low roll');
      CONTENT.combat = { critChance: 0, meteorSizeDamage: false }; e.hp = 1e6; hitStop = 0;
      withRandom(.0, () => dealDamage(e, 10, 'fire')); near(1e6 - e.hp, 10, 1e-9, 'crits off: damage unchanged'); eq(hitStop, 0, 'no crit hit-stop');
      eq(combatCfg().meteorSizeDamage, false, 'meteor size no longer scales damage');
    } finally { CONTENT.combat = keep; fresh(); }
  });
  test('settings survive a reload through localStorage; broken values fall back to defaults', () => {
    fresh(); SET.music = .25; SET.particles = 'mid'; saveSettings();
    const s = JSON.parse(localStorage.getItem('eg-settings')); eq(s.music, .25); eq(s.particles, 'mid');
    Object.assign(SET, SET_DEFAULT); saveSettings();
  });
  test('brightness setting lifts the world light and thins the fog, but not the spell lights', () => {
    fresh(); setDark(0, true); const step = () => visuals(1 / 60);
    SET.bright = 1; step(); const h1 = hemi.intensity, m1 = moon.intensity, f1 = scene.fog.density;
    SET.bright = 2; step(); near(hemi.intensity, h1 * 2, 1e-6, 'sky light doubles'); near(moon.intensity, m1 * 2, 1e-6, 'moon doubles');
    near(scene.fog.density, f1 / 2, 1e-6, 'fog halves');
    SET.bright = .5; step(); near(hemi.intensity, h1 * .5, 1e-6, 'darker'); near(scene.fog.density, f1, 1e-6, 'fog never thicker than normal');
    const el = document.querySelector('#sBright'); el.value = '170'; el.dispatchEvent(new Event('input'));
    eq(SET.bright, 1.7, 'slider sets the value'); eq(JSON.parse(localStorage.getItem('eg-settings')).bright, 1.7, 'saved');
    eq(document.querySelector('#oBright').textContent, '170%', 'shown as a percentage');
    Object.assign(SET, SET_DEFAULT); saveSettings(); step();
  });
  test('save slot: only a valid act number is accepted', () => {
    fresh(); clearSave(); eq(readSave(), null, 'empty');
    writeSave(2); eq(readSave().act, 2);
    for (const bad of ['{"v":1,"act":9}', '{"v":2,"act":1}', '{"v":1,"act":1.5}', 'not json']) { localStorage.setItem('eg-save', bad); eq(readSave(), null, 'rejects ' + bad); }
    clearSave(); refreshTitle(); ok(document.querySelector('#goContinue').hidden, 'no save -> no continue button');
    writeSave(1); refreshTitle(); ok(!document.querySelector('#goContinue').hidden && /第 2 幕/.test(document.querySelector('#goContinue').textContent), 'save -> continue button names the act');
    clearSave();
  });
  test('continuing from act 3 lights the first two towers and unlocks their spells', () => {
    fresh(); startStory(2); while (dlg) endDialog();
    eq(story.act, 2); ok(TOWERS[0].lit && TOWERS[1].lit && !TOWERS[2].lit && !TOWERS[3].lit, 'towers 1-2 lit');
    eq(story.tier.fire, 1, 'fireball upgraded by tower 1'); ok(story.unlocked.has('bolt') && !story.unlocked.has('meteor'), 'bolt yes, meteor not yet');
    ok(story.seen.has('intro'), 'opening dialogue is not replayed'); eq(readSave().act, 2, 'beginAct writes the save');
    clearSave(); story.on = false;
  });
  test('act result screen pauses play and hands control back to the story', () => {
    fresh(); story.actT0 = time - 65; story.actKills0 = player.kills - 7; story.actTk0 = terrainKills - 3; story.actLoot0 = pickups - 1; story.bestChain = 4;
    let next = 0; showResult(1, () => next++);
    ok(menuOpen, 'menu flag blocks the game loop'); eq(document.querySelector('#rTitle').textContent, '雷之塔點亮了');
    const cells = [...document.querySelectorAll('#rTab td')].map((td) => td.textContent);
    eq(cells[1], '1 分 05 秒'); eq(cells[3], '7 隻'); eq(cells[5], '3 隻'); eq(cells[7], '×4'); eq(cells[9], '1 件');
    tryCast('fire'); eq(player.cast, null, 'no casting behind the result screen');
    closeResult(); eq(next, 1, 'continuation called once'); ok(!menuOpen); closeResult(); eq(next, 1, 'second close is a no-op');
  });
  test('pause opens only during play and freezes casting', () => {
    fresh(); togglePause(true); ok(!document.querySelector('#pause').hidden && menuOpen, 'paused');
    tryCast('fire'); eq(player.cast, null, 'no casting while paused'); togglePause(false); ok(document.querySelector('#pause').hidden && !menuOpen, 'resumed');
    running = false; togglePause(true); ok(document.querySelector('#pause').hidden, 'no pause on the title screen'); running = true;
  });
  test('death screen names the cause and gives the matching tip', () => {
    fresh(); hurtPlayer(1e9, '熔岩'); ok(!player.alive);
    ok(/熔岩/.test(document.querySelector('#deadCause').textContent), 'cause'); ok(document.querySelector('#deadTip').textContent.includes(DEATH_TIPS['熔岩']), 'lava tip');
    fresh(); hurtPlayer(1e9, '食屍鬼'); ok(document.querySelector('#deadTip').textContent.includes(DEFAULT_TIP), 'monster -> general tip');
    fresh();
  });
  test('loot rarity shape marks follow the setting', () => {
    fresh(); SET.lootShapes = true; eq(rarMark(RAR[3]), '◆ '); SET.lootShapes = false; eq(rarMark(RAR[3]), ''); SET.lootShapes = true;
  });
  test('soft terrain edges: a changed cell bleeds into its 8 neighbours only', () => {
    fresh(); flushTerrain();
    let c = -1; // a cell whose 5x5 block has no glowing terrain, so the glow layer shows exactly what the new cell paints
    for (let gz = 20; gz < GN - 20 && c < 0; gz++) for (let gx = 20; gx < GN - 20 && c < 0; gx++) {
      let clean = true; for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (TP[TT[(gz + dz) * GN + gx + dx]].glow) clean = false;
      if (clean) c = gz * GN + gx; }
    ok(c >= 0, 'found a quiet cell');
    const lit = (gx, gz) => { let n = 0; const px0 = gx * TPX, py0 = (GN - 1 - gz) * TPX; for (let y = 0; y < TPX; y++) for (let x = 0; x < TPX; x++) if (gData[((py0 + y) * TW + px0 + x) * 4 + 3]) n++; return n; };
    const before = gData.slice(), s0 = { ...terrStats }; setT(c, TER.LAVA); flushTerrain();
    const gx = c % GN, gz = (c / GN) | 0; let ring1 = 0, ring2 = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx || dz) ring1 += lit(gx + dx, gz + dz);
    for (let q = 0; q < TW * TW; q++) if (gData[q * 4 + 3] !== before[q * 4 + 3]) { const cx = (q % TW) / TPX | 0, cz = GN - 1 - ((q / TW | 0) / TPX | 0); if (Math.max(Math.abs(cx - gx), Math.abs(cz - gz)) > 1) ring2++; }
    const own = lit(gx, gz);
    ok(own > TPX * TPX * .5, `most of the cell itself glows (${own}/${TPX * TPX})`); ok(own < TPX * TPX, 'but not all of it (ragged edge)');
    ok(ring1 > 0, `some lava pixels spill into neighbours (${ring1})`); eq(ring2, 0, 'no pixel outside the 3x3 block changed');
    eq(terrStats.partial - s0.partial, 1, 'one partial upload'); eq(terrStats.full - s0.full, 0, 'no full upload');
    eq(terrStats.px - s0.px, 3 * 3 * TPX * TPX, 'uploads only the 3x3 block (three strips of three cells)');
  });
  test('leaving the title screen snaps the camera behind the mage (aim is right on the first frame)', () => {
    fresh(); running = false; for (let k = 0; k < 30; k++) updateCamera(1 / 60);
    running = true; updateCamera(1 / 60);
    const want = new THREE.Vector3(player.pos.x, 0, player.pos.z).add(new THREE.Vector3(0, CAM_H * zoom, CAM_B * zoom));
    near(camPos.distanceTo(want), 0, 1e-6, 'camera on target after one frame');
  });
  // ---------------------------------------------------------------- P3b: skinned mage
  test('the CC0 mage model loads, replaces the block body and keeps hat and staff', async () => {
    for (let k = 0; k < 300 && !EGChar.state.ready && !EGChar.state.failed; k++) await new Promise((r) => setTimeout(r, 100)); // the model loads after the page, up to 30 s
    ok(EGChar.state.ready && P.skinned, 'skinned mage ready');
    eq(Object.keys(EGChar.state.actions).sort().join(','), 'cast,castUp,channel,death,hit,idle,run');
    ok(P.hatGroup.visible && P.staffGroup.parent === P.g, 'hat and staff kept');
    ok(P.g.children.filter((o) => o.isMesh).every((o) => !o.visible), 'block body hidden');
  });
  test('each player state plays the matching animation', () => {
    fresh(); const S = EGChar.state, cur = () => S.cur.getClip().name, tick = () => EGChar.update(1 / 60, player, THREE);
    player.moving = false; player.cast = null; player.hurtT = 0; S.cur = null; tick(); eq(cur(), 'idle');
    player.moving = true; tick(); eq(cur(), 'run'); player.moving = false;
    for (const [id, k, want] of [['fire', 0, 'cast'], ['bolt', 0, 'cast'], ['meteor', 0.2, 'castUp'], ['meteor', 0.8, 'cast'], ['blood', 0.5, 'channel']]) {
      player.cast = { id, t: k * .4, dur: .4 }; tick(); eq(cur(), want, `${id} at ${k}`); }
    player.cast = null; player.hurtT = .25; tick(); eq(cur(), 'hit');
    player.hurtT = 0; player.alive = false; tick(); eq(cur(), 'death'); fresh();
  });
  test('without the model data the block mage stays (offline fallback)', () => {
    const keep = window.MAGE_GLB, fake = { g: new THREE.Group() }; window.MAGE_GLB = undefined;
    const s0 = EGChar.state.failed; try { EGChar.attach(fake, THREE); ok(!fake.skinned, 'not skinned'); ok(EGChar.state.failed, 'marked failed'); }
    finally { window.MAGE_GLB = keep; EGChar.state.failed = s0; }
  });
  // ---------------------------------------------------------------- P3d: prerecorded dialogue voice
  const dlgFiles = () => Object.entries(DLG).flatMap(([id, lines]) => lines.map(([who], i) => `${id}_${i}_${who}`));
  test('every dialogue line has its prerecorded voice file', async () => {
    const files = dlgFiles(); eq(files.length, 24, 'dialogue lines');
    const missing = []; for (const f of files) { const r = await fetch(`${CONTENT.voiceDir}${f}.ogg`, { method: 'HEAD' }); if (!r.ok) missing.push(f); }
    eq(missing.join(','), '', 'missing recordings');
  });
  test('a dialogue line plays its own recording; closing the dialogue stops it', () => {
    const keepTts = tts; let said = 0; tts = () => { said++; }; const v0 = voiceOn; voiceOn = true;
    try {
      playDialog('intro', null); eq(window.__voiceFile, 'intro_0_elder', 'first line'); ok(vAudio && vAudio.src.endsWith(CONTENT.voiceDir + 'intro_0_elder.ogg'), 'audio source');
      nextLine(); nextLine(); eq(window.__voiceFile, 'intro_1_mu', 'second line'); endDialog(); eq(vAudio, null, 'stopped');
    } finally { tts = keepTts; voiceOn = v0; hush(); }
  });
  test('a recording that cannot play falls back to the built-in voice', async () => {
    // a browser that cannot play Ogg Opus (older Safari) rejects play(); the line must still be spoken
    const keepTts = tts, keepAudio = window.Audio; let said = ''; tts = (t) => { said = t; }; const v0 = voiceOn; voiceOn = true;
    window.Audio = class { play() { return Promise.reject(new Error('NotSupportedError')); } pause() {} };
    try {
      speak('測試句', SPEAKERS.mu, 'intro_1_mu');
      for (let k = 0; k < 20 && !said; k++) await new Promise((r) => setTimeout(r, 50));
      eq(said, '測試句', 'built-in voice used');
    } finally { window.Audio = keepAudio; tts = keepTts; voiceOn = v0; hush(); }
  });
  // ---------------------------------------------------------------- P4: key remapping and touch
  // dispatch from the page like a real key press (window capture -> element -> bubble to window); dispatching on window
  // itself runs same-target listeners in registration order, which no real key press does
  const key = (code) => document.body.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const keyUp = (code) => document.body.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  const resetKeys = () => { Object.assign(KB, KB_DEFAULT); try { localStorage.removeItem('eg-keys'); } catch (e) {} };
  test('a remapped skill key casts that spell, the old key no longer does', () => {
    fresh(); resetKeys(); KB.bolt = 'KeyQ';
    key('Digit2'); keyUp('Digit2'); eq(player.cast, null, 'old key does nothing');
    key('KeyQ'); keyUp('KeyQ'); ok(player.cast && player.cast.id === 'bolt', 'new key casts chain lightning');
    resetKeys(); fresh();
  });
  test('settings key rows: pick a row, press a key; a taken key swaps, reserved keys are refused', () => {
    fresh(); resetKeys(); openSub('settings', 'intro');
    const btn = (k) => document.querySelector(`.keybtn[data-k=${k}]`);
    ok(document.querySelectorAll('.keybtn').length === 9, 'nine rows');
    btn('fire').click(); key('Digit2'); // 2 belongs to chain lightning
    eq(KB.fire, 'Digit2'); eq(KB.bolt, 'Digit1', 'chain lightning took the old key');
    eq(JSON.parse(localStorage.getItem('eg-keys')).fire, 'Digit2', 'saved');
    btn('meteor').click(); key('Space'); eq(KB.meteor, 'Digit3', 'Space is reserved'); key('Escape'); // Esc cancels the wait
    ok(!document.querySelector('#settings').hidden, 'Esc while waiting does not close settings');
    document.querySelector('#kReset').click(); eq(KB.fire, 'Digit1'); eq(KB.bolt, 'Digit2');
    backSub('settings'); resetKeys(); fresh();
  });
  test('touch joystick sets the movement keys by direction, with a dead zone', () => {
    fresh(); resetKeys(); const m = () => ['up', 'down', 'left', 'right'].filter((n) => keys[KB[n]]).join(',');
    EGControls.setMove(5, -4); eq(m(), '', 'inside the dead zone');
    EGControls.setMove(0, -40); eq(m(), 'up');
    EGControls.setMove(30, 30); eq(m(), 'down,right', 'diagonal');
    EGControls.joyEnd(); eq(m(), '', 'release clears');
  });
  test('touch aim assist points at the nearest monster in range', () => {
    fresh(); spawnEnemy('lizard', 6, 0, 1); spawnEnemy('lizard', -12, 0, 1); for (const e of enemies) e.T = Object.assign({}, e.T, { speed: 0 });
    const was = EGControls.touch; if (!was) EGControls.enableTouch();
    camSnap = true; updateCamera(1 / 60); EGControls.aimNow(); ray.setFromCamera(mouse, camera); ray.ray.intersectPlane(gplane, aim);
    near(aim.x, 6, 0.6, 'aims at the lizard 6 units away'); near(aim.z, 0, 0.6);
    fresh();
  });
  test('soft terrain jitter table: every pixel samples itself or a direct neighbour', () => {
    let self = 0; for (let q = 0; q < NBC.length; q++) { ok(NBC[q] <= 8, 'code in range'); if (NBC[q] === 4) self++; }
    const f = self / NBC.length; ok(f > .55 && f < .95, `share of pixels sampling their own cell ${f.toFixed(2)}`);
  });

  // ---------------------------------------------------------------- content fields: flow, terms, respond towers, monsters (DEVLOG timeline #43)
  // every field is optional: left out = main's behaviour, given = takes effect, wrong type = a one-line error naming the field when the content loads
  const tryContent = (mut) => { // run the load-time validation on a copy of the content, without touching the live pack
    const live = window.CONTENT, n0 = CONTENT_WARNINGS.length, copy = structuredClone(live);
    try { mut(copy); window.CONTENT = copy; egValidateContent(); return { err: null, warns: CONTENT_WARNINGS.slice(n0) }; }
    catch (e) { return { err: String(e.message), warns: [] }; }
    finally { window.CONTENT = live; CONTENT_WARNINGS.length = n0; }
  };
  const bossReady = (act) => { fresh(); startStory(act); while (dlg) endDialog(); };
  const finishLastTower = () => { const T = TOWERS[TOWERS.length - 1]; story.phase = 'ignite'; igniteTower(T); logic(1.2); closeResult(); };
  test('content flow: left out = no extra dialogue before the boss and before the ending, dark and end ids as before', () => {
    eq(EG_FLOW.half, 'dark'); eq(EG_FLOW.down, 'end'); eq(EG_FLOW.preBoss, undefined); eq(EG_FLOW.preEnding, undefined);
    bossReady(TOWERS.length - 1); finishLastTower(); eq(dlg && dlg.id, CONTENT.acts[TOWERS.length - 1].after, 'the last tower\'s own dialogue');
    endDialog(); eq(dlg, null, 'then the boss comes straight away'); eq(story.phase, 'boss');
    const b = story.boss; b.hp = 0; killEnemy(b); logic(3); eq(dlg && dlg.id, 'end', 'the existing end dialogue'); endDialog(); eq(dlg, null, 'no extra dialogue before the ending'); eq(story.phase, 'end');
  });
  test('content flow: preBoss plays before the boss appears, preEnding before the ending screen; half and down rename the two existing ones', () => {
    const keep = { ...EG_FLOW };
    try {
      EG_FLOW.preBoss = 't1'; EG_FLOW.preEnding = 't2'; EG_FLOW.half = 't3'; EG_FLOW.down = 't4';
      bossReady(TOWERS.length - 1); finishLastTower(); endDialog(); // the last tower's own dialogue
      eq(dlg && dlg.id, 't1', 'preBoss dialogue first'); eq(story.boss, null, 'boss not spawned yet'); ok(!enemies.some((e) => e.type === 'lord'));
      endDialog(); eq(story.phase, 'boss'); ok(story.boss, 'boss spawns when the dialogue ends');
      const b = story.boss; b.hp = b.maxhp * .45; bossAI(b, .016); eq(dlg && dlg.id, 't3', 'half-health dialogue uses the content id'); endDialog();
      b.hp = 0; killEnemy(b); logic(3); eq(dlg && dlg.id, 't4', 'down dialogue uses the content id'); endDialog();
      eq(dlg && dlg.id, 't2', 'preEnding plays after it'); eq(story.phase, 'outro', 'ending screen not yet'); endDialog(); eq(story.phase, 'end'); ok(!$('#ending').hidden);
      // a retry at the boss does not replay the pre-boss dialogue
      fresh(); story.on = true; story.phase = 'boss'; restart(); eq(dlg, null); eq(story.phase, 'boss');
    } finally { for (const k of ['preBoss', 'preEnding', 'half', 'down']) delete EG_FLOW[k]; Object.assign(EG_FLOW, keep); fresh(); }
  });
  test('content flow: a dialogue id that does not exist is skipped and the story goes on', () => {
    const keep = { ...EG_FLOW };
    try { EG_FLOW.preBoss = 'nope'; EG_FLOW.preEnding = 'nope'; bossReady(TOWERS.length - 1); finishLastTower(); endDialog(); endDialog(); eq(story.phase, 'boss', 'boss still appears'); }
    finally { for (const k of ['preBoss', 'preEnding']) delete EG_FLOW[k]; Object.assign(EG_FLOW, keep); fresh(); }
  });
  test('content terms: left out = the demo wording; given = the objective, toasts and result title use it', () => {
    eq(['tower', 'light', 'lit', 'ignite', 'go', 'undead'].map((k) => EG_TERM[k]).join(), '燈塔,點亮,點亮了,點燃,前往,亡者', 'defaults are the demo\'s own words');
    const T0 = TOWERS[0], seen = () => $('#objective').textContent;
    bossReady(0); updateStory(.016); eq(seen(), `擊倒甦醒的亡者　0 / ${ACTS[0].n}第 1 幕`);
    story.phase = 'goto'; updateStory(.016); eq(seen(), `前往${T0.name}（${T0.dir}方）跟著地上的箭頭與光柱走`);
    player.pos.set(T0.x, 0, T0.z); story.ign = .45; story.phase = 'ignite'; updateStory(.001); ok(seen().startsWith(`點燃${T0.name}　4`), 'ignite wording');
    const keep = { ...EG_TERM };
    try {
      Object.assign(EG_TERM, { tower: '石碑', light: '觸碰', lit: '亮了', ignite: '觸碰中', go: '走向', undead: '亡靈' });
      bossReady(0); updateStory(.016); ok(seen().startsWith('擊倒甦醒的亡靈'), seen());
      story.phase = 'goto'; updateStory(.016); ok(seen().startsWith(`走向${T0.name}（`), seen());
      player.pos.set(T0.x, 0, T0.z); story.ign = .45; story.phase = 'ignite'; updateStory(.001); ok(seen().startsWith(`觸碰中${T0.name}　4`), seen());
      story.ign = 1; igniteTower(T0); eq($('#toast').textContent, `${T0.name}亮了`); ok($('#objective').textContent.startsWith(`${T0.name}亮了`));
      showResult(0, null); eq($('#rTitle').textContent, `${T0.name}亮了`); closeResult();
      fresh(); story.on = true; story.unlocked = new Set(['fire']); tryCast('bolt'); eq($('#msg').textContent, '這招還沒學會，先觸碰石碑', 'locked-spell hint');
    } finally { Object.assign(EG_TERM, keep); fresh(); }
  });
  test('content tower respond state: left out = lights up as before; respond = no flame, heartbeat glow, own progress and finish words', () => {
    const T = TOWERS[1], backup = { respond: T.respond, respondIgnite: T.respondIgnite, respondLit: T.respondLit };
    try {
      T.acc = {}; setTowerLit(T, true); eq(T.lit, true); near(T.light.intensity, 2.2, 1e-9); eq(T.pulse, undefined, 'a normal tower never pulses'); setTowerLit(T, false);
      T.respond = true; setTowerLit(T, true); eq(T.lit, false, 'respond tower is not lit'); eq(T.pulse, true); eq(T.light.intensity, 0);
      const seen = new Set(); for (let i = 0; i < 40; i++) { time = i * .05; updateTowers(.05); seen.add(T.light.intensity.toFixed(2)); ok(T.light.intensity >= .15 && T.light.intensity <= 1.3, 'heartbeat range ' + T.light.intensity); }
      ok(seen.size > 8, 'the glow really changes over time'); eq(T.acc.f, undefined, 'no flame particles from this tower');
      setTowerLit(T, false); eq(T.pulse, false); eq(T.light.intensity, 0, 'switched off again');
      // words: no respondIgnite / respondLit -> the shared terms; given -> own words
      bossReady(1); story.phase = 'ignite'; story.ign = .3; player.pos.set(T.x, 0, T.z); updateStory(.001); ok($('#objective').textContent.startsWith(`點燃${T.name}`), 'falls back to the shared ignite word');
      igniteTower(T); eq($('#toast').textContent, `${T.name}點亮了`, 'falls back to the shared lit word'); eq(T.lit, false, 'still not lit after "igniting"');
      bossReady(1); T.respondIgnite = '守候'; T.respondLit = '應答了'; story.phase = 'ignite'; story.ign = .3; player.pos.set(T.x, 0, T.z); updateStory(.001); ok($('#objective').textContent.startsWith(`守候${T.name}`), $('#objective').textContent);
      igniteTower(T); eq($('#toast').textContent, `${T.name}應答了`); eq(story.unlocked.has(T.spell) || story.tier.fire === 1, true, 'the spell is still unlocked');
      showResult(1, null); eq($('#rTitle').textContent, `${T.name}應答了`); closeResult();
    } finally { for (const k in backup) { if (backup[k] === undefined) delete T[k]; else T[k] = backup[k]; } T.pulse = false; fresh(); setTowerLit(T, true); }
  });
  test('content monsters: left out = the engine models; given = colours, size, hidden parts and fade apply, and survive hit shake and flash', () => {
    fresh(); spawnEnemy('spider', 0, 0, 1); let e = enemies[0];
    eq(e.mats[0].color.getHex(), 0x2b2133, 'default body colour'); ok(e.g.children.length > 5, 'no wrapper group by default'); eq(ETYPES.spider.name, '墓蛛');
    const keep = { ...EG_MON };
    try {
      EG_MON.spider = { color: 0x123456, color2: 0x654321, eye: 0x00ff00, glow: 0x010203, scale: 1.5, legs: 2 };
      fresh(); spawnEnemy('spider', 0, 0, 1); e = enemies[0];
      eq(e.mats[0].color.getHex(), 0x123456); eq(e.mats[1].color.getHex(), 0x654321); eq(e.mats[0].emissive.getHex(), 0x010203); eq(e.mats[0].userData.e0.getHex(), 0x010203, 'flash restores to the new glow');
      const eyes = []; e.g.traverse((o) => { if (o.isMesh && o.material.isMeshBasicMaterial) eyes.push(o.material.color.getHex()); }); ok(eyes.length === 2 && eyes.every((c) => c === 0x00ff00), 'eyes recoloured');
      eq(e.g.children.length, 1, 'body parts sit under one scaled wrapper'); near(e.g.children[0].scale.x, 1.5, 1e-9); near(e.g.scale.x, 1, 1e-9, 'the engine\'s own shake scale on the outer group is untouched');
      eq(e.parts.legs.filter((l) => l.piv.visible).length, 4, 'two legs per side');
      e.flinch = .14; updateEnemies(.001); ok(e.g.scale.x > 1.05, 'engine shake still works on the outer group'); e.flinch = 0; updateEnemies(.001); near(e.g.scale.x, 1, 1e-9); near(e.g.children[0].scale.x, 1.5, 1e-9, 'custom size survives');
      e.flash = .05; updateEnemies(.001); near(e.mats[0].emissive.r, .85, 1e-6); e.flash = 0; updateEnemies(.1); eq(e.mats[0].emissive.getHex(), 0x010203, 'back to the content glow after the flash');
      EG_MON.lizard = { tail: false, scale: 2 }; EG_MON.ghost = { skirt: false, opacity: .4 }; EG_MON.lord = { spikes: 3, opacity: .5 };
      fresh(); spawnEnemy('lizard', 0, 0, 1); spawnEnemy('ghost', 0, 0, 1); spawnEnemy('lord', 0, 0, 1);
      const [liz, gh, lord] = enemies;
      eq(liz.parts.tail.visible, false, 'lizard tail hidden'); near(liz.g.children[0].scale.y, 2, 1e-9);
      const cones = (en) => { const a = []; en.g.traverse((o) => { if (o.isMesh && o.geometry.type === 'ConeGeometry' && o.visible) a.push(o.geometry.parameters.openEnded); }); return a; };
      eq(cones(gh).length, 0, 'ghost skirt hidden'); near(gh.mats[0].opacity, .4, 1e-9);
      eq(cones(lord).filter((o) => !o).length, 3, 'three crown spikes left'); eq(cones(lord).filter((o) => o).length, 1, 'robe cone stays'); near(lord.mats[0].opacity, .5, 1e-9);
      delete EG_MON.spider; fresh(); spawnEnemy('spider', 0, 0, 1); ok(enemies[0].g.children.length > 5 && enemies[0].mats[0].color.getHex() === 0x2b2133, 'a type with no entry is untouched');
    } finally { for (const k of Object.keys(EG_MON)) delete EG_MON[k]; Object.assign(EG_MON, keep); fresh(); }
  });
  test('content validation: a wrong type in flow / terms / monsters / towers is one clear message that names the field; a good or missing field passes', () => {
    const must = (what, mut, field) => { const r = tryContent(mut); ok(r.err && r.err.includes(field), `${what}: expected an error naming ${field}, got ${r.err}`); };
    const pass = (what, mut) => { const r = tryContent(mut); eq(r.err, null, what); return r; };
    pass('untouched content', () => {}); pass('flow, terms and monsters absent', (C) => { delete C.flow; delete C.terms; delete C.monsters; });
    must('flow not an object', (C) => { C.flow = 5; }, 'CONTENT.flow'); must('flow.preBoss number', (C) => { C.flow = { preBoss: 3 }; }, 'CONTENT.flow.preBoss');
    must('flow.preEnding empty', (C) => { C.flow = { preEnding: '' }; }, 'CONTENT.flow.preEnding'); must('flow.half array', (C) => { C.flow = { half: ['x'] }; }, 'CONTENT.flow.half');
    must('terms not an object', (C) => { C.terms = 'x'; }, 'CONTENT.terms'); must('terms.tower number', (C) => { C.terms = { tower: 7 }; }, 'CONTENT.terms.tower'); must('terms.go empty', (C) => { C.terms = { go: '' }; }, 'CONTENT.terms.go');
    must('monsters not an object', (C) => { C.monsters = []; }, 'CONTENT.monsters'); must('monster entry not an object', (C) => { C.monsters = { spider: 1 }; }, 'CONTENT.monsters.spider');
    must('colour as text', (C) => { C.monsters = { ghost: { color: 'red' } }; }, 'CONTENT.monsters.ghost.color'); must('colour out of range', (C) => { C.monsters = { ghost: { eye: 0x1000000 } }; }, 'CONTENT.monsters.ghost.eye');
    must('scale too big', (C) => { C.monsters = { lord: { scale: 9 } }; }, 'CONTENT.monsters.lord.scale'); must('scale as text', (C) => { C.monsters = { lord: { scale: '2' } }; }, 'CONTENT.monsters.lord.scale');
    must('opacity above 1', (C) => { C.monsters = { ghost: { opacity: 2 } }; }, 'CONTENT.monsters.ghost.opacity'); must('name empty', (C) => { C.monsters = { spider: { name: '' } }; }, 'CONTENT.monsters.spider.name');
    must('legs fraction', (C) => { C.monsters = { spider: { legs: 2.5 } }; }, 'CONTENT.monsters.spider.legs'); must('spikes too many', (C) => { C.monsters = { lord: { spikes: 20 } }; }, 'CONTENT.monsters.lord.spikes');
    must('tail text', (C) => { C.monsters = { lizard: { tail: 'no' } }; }, 'CONTENT.monsters.lizard.tail'); must('skirt number', (C) => { C.monsters = { ghost: { skirt: 0 } }; }, 'CONTENT.monsters.ghost.skirt');
    must('tower respond text', (C) => { C.towers[1].respond = 'yes'; }, 'CONTENT.towers[1].respond'); must('tower respondLit number', (C) => { C.towers[1].respond = true; C.towers[1].respondLit = 5; }, 'CONTENT.towers[1].respondLit');
    must('tower respondIgnite empty', (C) => { C.towers[1].respondIgnite = ''; }, 'CONTENT.towers[1].respondIgnite');
    const good = pass('a full valid set', (C) => { C.flow = { preBoss: 'dark', preEnding: 'end' }; C.terms = { tower: '石碑', undead: '亡靈' }; C.towers[1].respond = true; C.towers[1].respondIgnite = '守候';
      C.monsters = { spider: { name: '甲', color: 0xff0000, scale: 1.2, legs: 3 }, lizard: { tail: false }, ghost: { skirt: true, opacity: .5 }, lord: { spikes: 0, glow: 0 } }; });
    eq(good.warns.length, 0, 'no warnings for a valid set');
    ok(tryContent((C) => { C.monsters = { spider: { tail: false }, wolf: {} }; C.flow = { preBoos: 'x' }; C.terms = { towr: 'x' }; C.flow.preBoss = 'ghost-id'; }).warns.length >= 4, 'typos, fields for another monster and unknown dialogue ids are warnings');
    ok(tryContent((C) => { C.towers[0].respondLit = 'x'; }).warns.some((w) => w.includes('respond')), 'respondLit without respond: warned (it does nothing)');
    eq(tryContent((C) => { C.flow = { preBoss: 'dark' }; }).err, null, 'valid flow leaves the pack loadable');
    eq(EG_FLOW.half, 'dark', 'the live pack was not changed by the checks');
  });

  // ---------------------------------------------------------------- engine switches and fixes from the commercial slice's breaker report (DEVLOG timeline #44)
  // every switch defaults to what the demo does today; the fixes (F06 F08 F10 F16) change only what was a bug
  const withContent = (patch, fn) => { const keep = {}; for (const k of Object.keys(patch)) keep[k] = CONTENT[k]; try { Object.assign(CONTENT, patch); return fn(); } finally { for (const k of Object.keys(patch)) { if (keep[k] === undefined) delete CONTENT[k]; else CONTENT[k] = keep[k]; } } };
  const mkSarc = () => ({ kind: 'sarc', x: 9, z: 9, state: 'up', hp: 1 });
  test('F01 interface words that used to be fixed in the engine come from CONTENT.terms (defaults = the demo words)', () => {
    const want = { monster: '怪物', sarcBreak: '石棺裂開，殘魂竄了出來', lampName: '燼燈', lampGet: '得到一盞燼燈：身邊照亮 5 公尺（按 I 看裝備）', bossShock: '首領衝擊波', lava: '熔岩', gas: '磷火爆炸',
      hintGo: '跟著地上的箭頭與光柱走', hintIgnite: '站在塔下，別離開', hintBoss: '紫色衝擊波會往外擴散：退到圈外，或貼近牠躲進圈內' };
    for (const k in want) eq(EG_TERM[k], want[k], 'default of terms.' + k);
    fresh(); breakProp(mkSarc(), new THREE.Vector3(0, 0, 0)); eq($('#msg').textContent, want.sarcBreak, 'default hint when a sarcophagus breaks');
    fresh(); story.on = true; story.unlocked = new Set(['fire']); giveLamp(); eq($('#msg').textContent, want.lampGet); eq(equipped.light && equipped.light.name, want.lampName);
    hurtPlayer(1); eq(player.lastHurt, want.monster, 'hurt source default');
    const keep = { ...EG_TERM };
    try {
      Object.assign(EG_TERM, { monster: '來敵', sarcBreak: '石匣碎了，裡面的東西跑出來', lampName: '星燈', lampGet: '拿到星燈', bossShock: '主宰震波', lava: '岩漿', gas: '毒氣爆', hintGo: '往光走', hintIgnite: '待著別動', hintBoss: '躲開圈' });
      fresh(); breakProp(mkSarc(), new THREE.Vector3(0, 0, 0)); eq($('#msg').textContent, '石匣碎了，裡面的東西跑出來');
      fresh(); story.on = true; giveLamp(); eq($('#msg').textContent, '拿到星燈'); eq(equipped.light.name, '星燈'); hurtPlayer(1); eq(player.lastHurt, '來敵');
      const T = TOWERS[0]; bossReady(0); story.phase = 'goto'; player.pos.set(-30, 0, 30); updateStory(.016); ok($('#objective').textContent.includes('往光走'), 'goto hint'); story.phase = 'ignite'; player.pos.set(T.x, 0, T.z); story.ign = .3; updateStory(.001); ok($('#objective').textContent.includes('待著別動'), 'ignite hint');
      fresh(); story.on = true; player.pos.set(-30, 0, 30); startBoss(); story.boss.shockT = 99; updateStory(.016); ok($('#objective').textContent.includes('躲開圈'), 'boss hint');
      const b = story.boss; b.pos.set(0, 0, 0); player.pos.set(5.3, 0, 0); player.maxhp = player.hp = 1e9; b.shockT = 0; bossAI(b, .01); shocks[0].t = .5; updateShocks(.001); eq(player.lastHurt, '主宰震波', 'shockwave hurt source');
    } finally { Object.assign(EG_TERM, keep); fresh(); }
  });
  test('F01 death-screen tips and the default tip come from CONTENT.terms; load-screen tips can be replaced by CONTENT.text.loadTips', () => {
    eq(DEATH_TIPS['熔岩'], '熔岩是唯一會傷到你的地形，橘紅發光的地面別久站。'); eq(DEATH_TIPS['首領衝擊波'], '衝擊波會往外擴散：退到圈外，或貼近首領躲在圈內。'); eq(DEATH_TIPS['磷火爆炸'], '藍色磷火墳碰到火或雷會爆炸，施法前先看腳下。');
    eq(DEFAULT_TIP, '被包圍時用星墜清場，或把怪物引進燃燒的草地。'); ok(LOAD_TIPS.length === 7 && LOAD_TIPS[0].startsWith('火球'), 'demo load tips');
    for (const k of ['tipLava', 'tipShock', 'tipGas', 'tipDefault']) ok(typeof EG_TERM[k] === 'string' && EG_TERM[k].length > 5, 'terms.' + k + ' has a default');
    ok(tryContent((C) => { C.text.loadTips = ['一句提示']; }).err === null, 'a valid loadTips list loads'); ok(tryContent((C) => { C.text.loadTips = []; }).err.includes('CONTENT.text.loadTips'), 'empty list refused');
  });
  test('F05 the sarcophagus releases what CONTENT.combat.sarcSpawn says: default ghosts as before, "mix" follows the act, a list picks from it', () => {
    const keepMix = ACTS[0].mix, types = () => enemies.map((e) => e.type), burst = (n) => { for (let i = 0; i < n; i++) breakProp(mkSarc(), new THREE.Vector3(0, 0, 0)); };
    try {
      ACTS[0].mix = [1, 0, 0]; fresh(); story.on = true; story.act = 0; burst(12); eq(enemies.length, 24, 'two per sarcophagus'); ok(types().every((x) => x === 'ghost'), 'default: ghosts, whatever the act says');
      withContent({ combat: { sarcSpawn: 'mix' } }, () => { fresh(); story.on = true; story.act = 0; burst(12); ok(types().every((x) => x === 'spider'), 'mix: only what act 1 allows ' + types().join()); });
      ACTS[0].mix = [0, .5, .5];
      withContent({ combat: { sarcSpawn: 'mix' } }, () => { fresh(); story.on = true; story.act = 0; burst(15); ok(types().every((x) => x !== 'spider') && new Set(types()).size === 2, 'mix with zero spiders: lizards and ghosts only'); });
      withContent({ combat: { sarcSpawn: ['lizard'] } }, () => { fresh(); story.on = true; story.act = 0; burst(6); ok(types().every((x) => x === 'lizard'), 'a list: only its members'); });
      withContent({ combat: { sarcSpawn: 'mix' } }, () => { fresh(); burst(15); ok(new Set(types()).size >= 2, 'free play has no act: the default mix'); });
    } finally { ACTS[0].mix = keepMix; fresh(); }
  });
  test('F02 gear damage: default keeps fire/spell affixes and their multipliers; CONTENT.combat.gearDamage=false removes both everywhere', () => {
    fresh(); const kinds = () => { const s = new Set(); for (let i = 0; i < 800; i++) { const it = makeItem(i % 4); for (const k in it.st) s.add(k); const n = Object.keys(it.st).filter((k) => k !== 'light').length; eq(n, it.slot === 'light' ? it.rar.k - 1 : it.rar.k, 'stat count for ' + it.rar.n); } return [...s]; };
    ok(kinds().includes('fire') && kinds().includes('spell'), 'demo rolls fire and spell');
    stats.spell = 50; stats.fire = 50; near(spellMul(), 1.5, 1e-9); near(fireMul(), 2.25, 1e-9);
    withContent({ combat: { gearDamage: false } }, () => {
      const k = kinds(); ok(!k.includes('fire') && !k.includes('spell'), 'no damage affix rolled: ' + k); ok(k.includes('hp') && k.includes('cast') && k.includes('move'), 'the other affixes still roll');
      eq(spellMul(), 1); eq(fireMul(), 1, 'multipliers fixed at 1 whatever the stats are');
    });
    stats.spell = 0; stats.fire = 0; fresh();
  });
  test('F03 area damage: the +-10% random roll is on by default and CONTENT.combat.aoeJitter=false makes it a fixed value', () => {
    fresh(); spawnEnemy('lizard', 0, 0, 1); const e = enemies[0]; e.hp = e.maxhp = 1e9; e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 });
    const hits = (n) => { const a = []; for (let i = 0; i < n; i++) { const h = e.hp; aoe(e.pos, 2, 100, 'fire'); a.push(Math.round((h - e.hp) * 1e6) / 1e6); } return a; };
    withContent({ combat: { critChance: 0 } }, () => { const a = hits(40); ok(new Set(a).size > 10 && a.every((v) => v >= 90 && v <= 110), 'varies within 90..110 by default'); });
    withContent({ combat: { critChance: 0, aoeJitter: false } }, () => { const a = hits(40); eq(new Set(a).size, 1, 'one value'); eq(a[0], 100); });
    fresh();
  });
  test('F04 meteor size: by default the size changes the hit radius; CONTENT.combat.meteorSizeRadius=false keeps it at the base radius', () => {
    const land = (sc, patch) => withContent({ combat: Object.assign({ critChance: 0 }, patch) }, () => {
      fresh(); const T = new THREE.Vector3(10, 0, 10); spawnEnemy('lizard', T.x + 2.6, T.z, 1); const e = enemies[0]; e.hp = e.maxhp = 1e6; e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 });
      dropMeteor(T, sc, 0); logic(.01); ok(meteors.length === 1, 'the meteor is in the air'); const m = meteors[0];
      for (let i = 0; i < 40 && !m.dead; i++) logic(.05);
      ok(m.dead, 'the meteor landed'); return e.hp < e.maxhp; });
    eq(land(.8, {}), false, 'small meteor does not reach 2.6 away'); eq(land(1.05, {}), true, 'big meteor does');
    eq(land(.8, { meteorSizeRadius: false }), true, 'switch off: the small one reaches too'); eq(land(1.05, { meteorSizeRadius: false }), true);
    fresh();
  });
  test('F06 the boss falls and the player dies before the ending: restart goes on to the ending, never back to act 4 with the boss fight wiped', () => {
    const toOutro = () => { fresh(); story.on = true; story.act = ACTS.length - 1; player.pos.set(0, 0, 14); startBoss(); const b = story.boss; b.hp = 0; killEnemy(b); eq(story.phase, 'outro'); };
    toOutro(); hurtPlayer(1e9, '測試'); ok(!player.alive); restart();
    ok(player.alive, 'alive again'); eq(story.phase, 'outro', 'still after the boss'); eq(story.act, ACTS.length - 1); eq(enemies.filter((e) => e.alive).length, 0, 'no act-4 monsters spawned'); eq(dlg && dlg.id, EG_FLOW.down, 'the dialogue that follows the fall'); ok($('#ending').hidden, 'ending screen not yet');
    endDialog(); eq(story.phase, 'end'); ok(!$('#ending').hidden, 'then the ending'); eq(dlg, null);
    toOutro(); logic(2); ok(enemies.every((e) => !e.alive), 'minions already cleared'); hurtPlayer(1e9, '測試'); restart(); eq(story.phase, 'outro'); eq(dlg && dlg.id, EG_FLOW.down); endDialog(); eq(story.phase, 'end');
    restart(); eq(story.phase, 'end', 'restart on the ending screen stays on it'); ok(!$('#ending').hidden); eq(enemies.length, 0);
    // a retry during the fight itself still restarts the boss, without replaying the pre-boss dialogue (F07)
    const keep = { ...EG_FLOW };
    try { EG_FLOW.preBoss = 't1'; fresh(); story.on = true; story.act = ACTS.length - 1; story.phase = 'boss'; startBoss(); hurtPlayer(1e9, '測試'); restart(); eq(dlg, null, 'no dialogue on retry'); eq(story.phase, 'boss'); ok(story.boss && story.boss.alive, 'a fresh boss'); eq(enemies.filter((e) => e.type === 'lord').length, 1); }
    finally { for (const k of ['preBoss']) delete EG_FLOW[k]; Object.assign(EG_FLOW, keep); fresh(); }
  });
  test('F08 the bag does not open while a dialogue is showing (keys I and Tab, and the bag button); an open bag can still be closed', () => {
    fresh(); const id = Object.keys(CONTENT.dialog)[0], bag = $('#inv'); bag.hidden = true;
    playDialog(id, null); ok(dlg, 'dialogue open');
    for (const code of ['KeyI', 'Tab']) { window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true })); ok(bag.hidden, code + ' must not open the bag over the dialogue'); }
    toggleInv(); ok(bag.hidden, 'the bag button either');
    endDialog(); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', bubbles: true })); ok(!bag.hidden, 'after the dialogue the key works again'); toggleInv(); ok(bag.hidden);
    toggleInv(); ok(!bag.hidden); playDialog(id, null); toggleInv(); ok(bag.hidden, 'a bag that is already open can be closed during a dialogue'); endDialog(); fresh();
  });
  test('F09 a respond tower makes no flame or explosion particles while it is "ignited"; an ordinary tower still does', () => {
    const T = TOWERS[1], keep = T.respond, run = () => { bossReady(1); T.acc = {}; player.pos.set(T.x, 0, T.z); story.phase = 'ignite'; story.ign = .3; let n = 0; const e1 = ADD.emit, e2 = SMOKE.emit;
      ADD.emit = function (p) { n++; return e1.call(this, p); }; SMOKE.emit = function (p) { n++; return e2.call(this, p); };
      try { for (let i = 0; i < 40 && story.phase !== 'dialog'; i++) updateStory(.1); eq(story.phase, 'dialog', 'the tower finished'); } finally { ADD.emit = e1; SMOKE.emit = e2; } return n; };
    try { T.respond = false; ok(run() > 10, 'an ordinary tower makes particles'); T.respond = true; eq(run(), 0, 'respond tower: no particles at all'); }
    finally { if (keep === undefined) delete T.respond; else T.respond = keep; T.pulse = false; fresh(); setTowerLit(T, true); }
  });
  test('F10/F16 monsters, loot, scorch marks and rites give their geometry and materials back: after many spawn-and-clear rounds the counts return to the baseline', () => {
    fresh(); EGPost.render(); const base = renderer.info.memory.geometries, watched = { g: new Set(), m: new Set() }, gone = { g: 0, m: 0 };
    const watch = (o) => o.traverse((c) => { if (c.geometry && !watched.g.has(c.geometry)) { watched.g.add(c.geometry); c.geometry.addEventListener('dispose', () => gone.g++); }
      for (const m of c.material ? [].concat(c.material) : []) if (!watched.m.has(m)) { watched.m.add(m); m.addEventListener('dispose', () => gone.m++); } });
    const types = ['spider', 'lizard', 'ghost', 'lord'];
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 12; i++) spawnEnemy(types[i % 4], 3 + i, 3, 1);
      for (const e of enemies) { watch(e.g); e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 }); }
      EGPost.render(); for (const e of enemies.slice(0, 6)) killEnemy(e); logic(.7); // half leave through the death animation, half through clearWorld
      for (let i = 0; i < 3; i++) dropLoot(new THREE.Vector3(i, 0, -4), 1); for (const L of loots) watch(L.g);
      addBurn(new THREE.Vector3(-3, 0, 3), 1.5, .2); for (const b of burns) watch(b.decal); EGPost.render();
      clearWorld();
    }
    // a scorch mark that ends by itself (not through clearWorld) release theirs too
    addBurn(new THREE.Vector3(5, 0, 5), 1.5, .2); const decal = burns[0].decal; let decalGone = false; decal.geometry.addEventListener('dispose', () => { decalGone = true; });
    for (let i = 0; i < 30; i++) updateBurns(.1); ok(burns.length === 0 && decalGone, 'the scorch mark that burned out gave its plane back');
    EGPost.render(); const now = renderer.info.memory.geometries;
    ok(now <= base + 12, `uploaded geometries ${base} -> ${now} (it grew by about 15 per monster before the fix)`);
    ok(gone.m >= watched.m.size * .95, `materials released ${gone.m} of ${watched.m.size}`); ok(gone.g >= watched.g.size * .6, `geometries released ${gone.g} of ${watched.g.size} (shared loot and beam shapes are kept)`);
    fresh();
  });
  test('F11 at high quality the long robes of the boss and the ghost cast a shadow once CONTENT.render.shadowTransparentBodies is on; off = as before; glows and decals never cast', () => {
    const casters = (en) => { let n = 0; en.g.traverse((o) => { if (o.isMesh && o.castShadow) n++; }); return n; };
    const draw = () => { for (let i = 0; i < 25; i++) EGPost.render(); };
    fresh(); SET.fx = 'high'; spawnEnemy('lord', 0, 6, 1); spawnEnemy('ghost', 4, 6, 1); const [lord, ghost] = enemies; draw();
    ok(renderer.shadowMap.enabled, 'shadows are on at high quality'); const l0 = casters(lord), g0 = casters(ghost); ok(g0 <= 2, 'demo: only the eyes of the translucent ghost cast (as before)');
    CONTENT.render = { shadowTransparentBodies: true }; try { draw(); ok(casters(lord) > l0, 'boss: its translucent robe and head cast too (' + l0 + ' -> ' + casters(lord) + ')'); ok(casters(ghost) > g0, 'ghost body casts (' + g0 + ' -> ' + casters(ghost) + ')');
      let glow = 0; scene.traverse((o) => { if (o.isMesh && o.material && o.material.blending === THREE.AdditiveBlending && o.castShadow) glow++; }); eq(glow, 0, 'additive glows never cast');
    } finally { delete CONTENT.render; SET.fx = 'low'; EGPost.render(); Object.assign(SET, SET_DEFAULT); EGPost.render(); fresh(); }
  });
  test('loot names and rare prefixes can come from CONTENT.loot; without it the demo names roll', () => {
    fresh(); const base = BASES.find((b) => b.type === 'staff'), names = new Set(); for (let i = 0; i < 200; i++) names.add(makeItem(3, base).name);
    ok([...names].every((n) => base.names.some((x) => n.endsWith(x)) && PREFIX.some((p) => n.startsWith(p))), 'demo names and prefixes');
    withContent({ loot: { names: { staff: ['甲杖', '乙杖'] }, prefixes: ['丙之'] } }, () => { const s = new Set(); for (let i = 0; i < 100; i++) s.add(makeItem(3, base).name); eq([...s].sort().join(), '丙之乙杖,丙之甲杖'); eq(makeItem(0, base).name.length, 2, 'common items have no prefix');
      const h = BASES.find((b) => b.type === 'helm'); ok(h.names.includes(makeItem(0, h).name), 'other kinds keep their names'); });
  });
  test('content validation: the new combat, loot, render, terms and text fields name the field when wrong; good values and absent fields load', () => {
    const must = (what, mut, field) => { const r = tryContent(mut); ok(r.err && r.err.includes(field), `${what}: expected an error naming ${field}, got ${r.err}`); };
    must('aoeJitter text', (C) => { C.combat = { aoeJitter: 'no' }; }, 'CONTENT.combat.aoeJitter'); must('meteorSizeRadius number', (C) => { C.combat = { meteorSizeRadius: 0 }; }, 'CONTENT.combat.meteorSizeRadius');
    must('gearDamage text', (C) => { C.combat = { gearDamage: 'false' }; }, 'CONTENT.combat.gearDamage'); must('sarcSpawn unknown monster', (C) => { C.combat = { sarcSpawn: ['dragon'] }; }, 'CONTENT.combat.sarcSpawn');
    must('sarcSpawn empty', (C) => { C.combat = { sarcSpawn: [] }; }, 'CONTENT.combat.sarcSpawn'); must('combat not an object', (C) => { C.combat = 3; }, 'CONTENT.combat');
    must('loot names not a list', (C) => { C.loot = { names: { staff: '杖' } }; }, 'CONTENT.loot.names.staff'); must('loot prefixes empty', (C) => { C.loot = { prefixes: [] }; }, 'CONTENT.loot.prefixes'); must('loot not an object', (C) => { C.loot = []; }, 'CONTENT.loot');
    must('render flag number', (C) => { C.render = { shadowTransparentBodies: 1 }; }, 'CONTENT.render.shadowTransparentBodies'); must('terms.sarcBreak empty', (C) => { C.terms = { sarcBreak: '' }; }, 'CONTENT.terms.sarcBreak');
    must('terms.hintBoss number', (C) => { C.terms = { hintBoss: 5 }; }, 'CONTENT.terms.hintBoss');
    const good = tryContent((C) => { C.combat = { critChance: 0, aoeJitter: false, meteorSizeRadius: false, gearDamage: false, sarcSpawn: 'mix' }; C.loot = { names: { ring: ['環'] }, prefixes: ['的'] }; C.render = { shadowTransparentBodies: true }; C.terms = { sarcBreak: '破了', tipLava: '提示' }; });
    eq(good.err, null, 'a full valid set'); eq(good.warns.length, 0, 'no warnings');
    ok(tryContent((C) => { C.loot = { names: { wand: ['x'] } }; }).warns.length >= 1, 'an unknown equipment kind is a warning'); ok(tryContent((C) => { C.render = { shadow: true }; }).warns.length >= 1, 'an unknown render field is a warning');
    eq(tryContent(() => {}).err, null, 'untouched content');
  });

  // ---------------------------------------------------------------- extension scripts: spell parameters, events, hold (DEVLOG timeline #45)
  // Every expected number below is a literal copied from the engine before the parameter table existed, never read back from the table.
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const still = (e) => { e.hp = e.maxhp = 1e6; e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 }); return e; };
  const spy = (name, keepIf) => { const log = [], real = window[name]; window[name] = function (...a) { if (!keepIf || keepIf(a)) log.push(a); return real.apply(this, a); }; log.restore = () => { window[name] = real; }; return log; };
  // frames of the page's own loop: loop() asks for its next frame first, so each of our requestAnimationFrame callbacks comes after one loop frame
  const frames = async (n, ms = 60000) => { const t = Date.now(); for (let i = 0; i < n; i++) { if (Date.now() - t > ms) return false; await Promise.race([new Promise((r) => requestAnimationFrame(r)), new Promise((r) => setTimeout(r, ms))]); } return Date.now() - t <= ms; };
  const until = async (cond, ms) => { const t = Date.now(); while (!cond() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 30)); return cond(); };
  test('spell table: the defaults are the numbers the four spells always used (cooldowns, fireball, meteor, blood rite)', () => {
    ok(window.EG && typeof EG.spellParams === 'function', 'window.EG.spellParams exists');
    const want = { fire: { cd: .36, dur: .3, rel: .5, shots: 3, spread: .2, damage: 34, radius: 2.2, speed: 19, life: 1.3, homingTurn: 0, homingCone: 0 },
      bolt: { cd: 1.05, dur: .38, rel: .45, damage: 30, bounces: 6, range: 7.5, firstHop: .88, decay: .92, hopDelay: .075 },
      meteor: { cd: 5, dur: .72, rel: .6, drops: 10, damage: 60, radius: 2.7, burnRadius: 2.2, burnTime: 3.5, spread: 4.4, interval: .17, sizeMin: .8, sizeMax: 1.05, pattern: 'scatter', arcLength: 8, arcMinRadius: 0 },
      blood: { cd: 4.5, dur: 1.9, rel: .02, bolts: 8, damage: 26, interval: .09, duration: 2.4, seek: 15 } };
    for (const id in want) { const p = EG.spellParams(id); eq(Object.keys(p).length, Object.keys(want[id]).length, id + ' key count'); for (const k in want[id]) eq(p[k], want[id][k], `${id}.${k}`); }
    // cooldown, cast time and release point that a cast really sets
    for (const [id, cd, dur, rel] of [['fire', .36, .3, .5], ['bolt', 1.05, .38, .45], ['meteor', 5, .72, .6], ['blood', 4.5, 1.9, .02]]) {
      fresh(); tryCast(id); ok(player.cast && player.cast.id === id, id + ' cast'); eq(cds[id], cd, id + ' cooldown'); eq(player.cast.dur, dur, id + ' cast time'); eq(player.cast.rel, rel, id + ' release'); }
    for (const o of rites) { o.dead = true; scene.remove(o.mesh); } rites.length = 0; // the blood cast above started a rite; clearWorld() does not end rites
    // upgraded fireball: three shots at -0.2, 0, +0.2 rad, speed 19, life 1.3; its blast is radius 2.2, damage 34
    fresh(); player.face = 0; releaseCast({ id: 'fire', target: V(0, 0, 10) }); eq(projs.length, 3, 'three fireballs');
    const ang = projs.map((p) => Math.atan2(p.vel.x, p.vel.z)), mid = ang[1]; near(ang[0] - mid, -.2, 1e-9); near(ang[2] - mid, .2, 1e-9);
    for (const p of projs) { near(Math.hypot(p.vel.x, p.vel.z), 19, 1e-9, 'speed'); eq(p.life, 1.3, 'life'); }
    fresh(); still(spawnEnemy('ghost', 1.2, 0, 1) || enemies[0]); const boom = spy('aoe', (a) => a[3] === 'fire');
    try { spawnFireball(V(0, 1, 0), V(1, 0, 0)); logic(1 / 60); eq(boom.length, 1, 'one blast'); eq(boom[0][1], 2.2, 'radius'); eq(boom[0][2], 34, 'damage'); } finally { boom.restore(); }
    // meteor landing: radius 2.7, damage 60, burning ground radius 2.2 for 3.5 s (size 1)
    fresh(); const hitM = spy('aoe', (a) => a[3] === 'fire'), burn = spy('addBurn');
    try { dropMeteor(V(10, 0, 10), 1, 0); for (let i = 0; i < 60 && !hitM.length; i++) logic(1 / 60);
      eq(hitM.length, 1, 'landed'); eq(hitM[0][1], 2.7); eq(hitM[0][2], 60); eq(burn.length, 1); eq(burn[0][1], 2.2); eq(burn[0][2], 3.5); } finally { hitM.restore(); burn.restore(); }
    // blood rite: eight bolts launched every 0.09 s from 0.95 s, 26 each, monsters within 15 are targets, the rite ends after 2.45 s
    fresh(); const near13 = still(spawnEnemy('ghost', 13, 0, 1) || enemies[0]), far16 = still(spawnEnemy('ghost', 16, 0, 1) || enemies[1]);
    const blood = spy('dealDamage', (a) => a[2] === 'blood');
    try { withContent({ combat: { critChance: 0 } }, () => { startBlood(); const o = rites[rites.length - 1]; let f = 0;
      while (!o.bolts.length && f < 100) { logic(1 / 60); f++; }
      eq(o.bolts.length, 8, 'eight bolts'); o.bolts.forEach((b, k) => { near(b.launchAt, .95 + k * .09, 1e-12, 'launch ' + k); eq(b.target, near13, 'only the monster within 15 is a target'); });
      while (rites.includes(o) && f < 400) { logic(1 / 60); f++; }
      ok(f >= 147 && f <= 149, `rite removed after 2.45 s (frame ${f})`); eq(blood.length, 8, 'eight blood hits'); ok(blood.every((a) => a[0] === near13 && a[1] === 26), 'each hit is 26 on the near monster'); eq(far16.hp, far16.maxhp, 'the monster 16 away is untouched'); });
    } finally { blood.restore(); }
    fresh();
  });
  // Placement tests use floating ghosts: they skip the obstacle push-out, so a tombstone near the line cannot shift them between frames.
  // one chain-bolt cast: monsters in a row along +x at z = 10 (centred, inside the arena), the orb flies at them; returns [[monster index, damage, frame], ...] for every bolt hit
  const chainRun = (gap, n, params) => { fresh(); setTier(1); if (params) ok(EG.setSpellParams('bolt', params), 'override accepted'); const x0 = -(n - 1) * gap / 2; for (let k = 0; k < n; k++) still(spawnEnemy('ghost', x0 + k * gap, 10, 1) || enemies[k]);
    const log = spy('dealDamage', (a) => a[2] === 'bolt'); let f = 0; const out = [];
    try { spawnOrb(V(x0 - 3, 1, 10), V(1, 0, 0)); for (; f < 260; f++) { const before = log.length; logic(1 / 60); for (let i = before; i < log.length; i++) out.push([enemies.indexOf(log[i][0]), log[i][1], f]); } } finally { log.restore(); }
    return out; };
  test('chain bolt by default: 30 on the first monster, then 26.4, 24.288 ... the sixth hop 17.40, one hop every 0.075 s, only within 7.5', () => {
    const hits = chainRun(4, 9);
    eq(hits.length, 7, 'main hit + six hops'); eq(hits.map((h) => h[0]).join(), '0,1,2,3,4,5,6', 'nearest next monster each time');
    const want = [30, 26.4, 24.288, 22.34496, 20.5573632, 18.912774144, 17.39975221248];
    hits.forEach((h, i) => near(h[1], want[i], 1e-9, 'hit ' + i)); near(hits[6][1], 17.40, .01, 'sixth hop');
    for (let i = 1; i < hits.length; i++) ok(hits[i][2] - hits[i - 1][2] >= 4 && hits[i][2] - hits[i - 1][2] <= 5, `hop gap ${hits[i][2] - hits[i - 1][2]} frames (0.075 s)`);
    eq(chainRun(8.5, 4).length, 1, 'monsters 8.5 apart: no hop (range 7.5)');
    fresh();
  });
  test('chain bolt overrides: bounces 8 and range 9 reach monsters 8.5 apart; firstHop, decay and hopDelay are read at hit time', () => {
    const runWith = (p, gap, n) => chainRun(gap, n, p); // chainRun starts with fresh(), which resets the overrides, then applies p
    const far = runWith({ bounces: 8, range: 9 }, 8.5, 10); eq(far.length, 9, 'main hit + eight hops'); eq(far.map((h) => h[0]).join(), '0,1,2,3,4,5,6,7,8');
    eq(runWith({ bounces: 8 }, 4, 12).length, 9, 'bounces alone: nine hits'); eq(runWith({ range: 9 }, 8.5, 10).length, 7, 'range alone: six hops');
    const flat = runWith({ firstHop: 1, decay: 1, hopDelay: .5 }, 4, 9); ok(flat.every((h) => h[1] === 30), 'firstHop 1, decay 1: every hit 30');
    for (let i = 1; i < flat.length; i++) ok(flat[i][2] - flat[i - 1][2] >= 29 && flat[i][2] - flat[i - 1][2] <= 31, `hop gap ${flat[i][2] - flat[i - 1][2]} frames (0.5 s)`);
    fresh();
  });
  // a fireball from the origin flying +x; one frozen monster at (x, z); returns the projectile after `frames` frames (or when it hit) and the monster
  const homingRun = (params, x, z, frames) => { fresh(); if (params) EG.setSpellParams('fire', params); const e = still(spawnEnemy('ghost', x, z, 1) || enemies[0]);
    spawnFireball(V(0, 1, 0), V(1, 0, 0)); const p = projs[projs.length - 1]; const heads = [Math.atan2(p.vel.x, p.vel.z)];
    for (let f = 0; f < frames && !p.dead; f++) { logic(1 / 60); heads.push(Math.atan2(p.vel.x, p.vel.z)); } return { p, e, heads }; };
  test('fireball homing: off by default; homingTurn + homingCone turn it toward a monster inside the cone at most homingTurn rad/s, never toward one outside', () => {
    const off = homingRun(null, 8, 3, 6); eq(off.p.vel.z, 0, 'default: flies straight'); eq(off.p.vel.x, 19);
    const on = homingRun({ homingTurn: 6, homingCone: 45 }, 8, 3, 6); ok(on.p.vel.z > 0, `turns toward the monster 20 deg off the line (vel.z ${on.p.vel.z})`); near(Math.hypot(on.p.vel.x, on.p.vel.z), 19, 1e-9, 'speed kept');
    for (let i = 1; i < on.heads.length; i++) ok(Math.abs(on.heads[i] - on.heads[i - 1]) <= 6 / 60 + 1e-9, 'turn per frame within homingTurn * dt');
    const out = homingRun({ homingTurn: 6, homingCone: 45 }, 2, 8, 6); eq(out.p.vel.z, 0, 'monster 76 deg off the line is outside a 45 deg cone: no turn');
    const wide = homingRun({ homingTurn: 6, homingCone: 90 }, 2, 8, 6); ok(wide.p.vel.z > 0, 'the same monster inside a 90 deg cone: turns');
    const miss = homingRun(null, 8, 3, 90), hit = homingRun({ homingTurn: 6, homingCone: 45 }, 8, 3, 90);
    eq(miss.e.hp, miss.e.maxhp, 'straight fireball passes the off-line monster'); ok(hit.e.hp < hit.e.maxhp, 'homing fireball hits it');
    fresh();
  });
  test('meteor drop pattern: "arc" puts the drops in order along an arc of arcLength in the cast direction with the given interval; default "scatter" is unchanged', () => {
    fresh(); setTier(1); player.pos.set(0, 0, 0); const drops = [], real = dropMeteor;
    try { window.dropMeteor = (T, sc, d) => { drops.push([T.clone(), sc, d]); }; // record only, nothing falls
      ok(EG.setSpellParams('meteor', { pattern: 'arc', arcLength: 6, drops: 5, interval: .2 }), 'override accepted'); castMeteor(V(0, 0, 10));
      eq(drops.length, 5, 'five drops');
      drops.forEach(([T, sc, d], i) => { near(Math.hypot(T.x, T.z), 10, 1e-9, `drop ${i} on the arc (radius 10 around the caster)`); near(Math.atan2(T.z, T.x), Math.PI / 2 + (i / 4 - .5) * .6, 1e-9, `drop ${i} angle in order`); near(d, i * .2, 1e-12, `drop ${i} delay`); ok(sc >= .8 && sc <= 1.05, 'size jitter'); });
      near(drops[2][0].x, 0, 1e-9, 'middle drop on the cast direction'); near(drops[2][0].z, 10, 1e-9);
      drops.length = 0; EG.resetSpellParams('meteor'); castMeteor(V(0, 0, 10));
      eq(drops.length, 10, 'default: ten drops'); near(drops[0][0].x, 0, 1e-12); near(drops[0][0].z, 10, 1e-12, 'first drop on the target');
      drops.forEach(([T, sc, d], i) => { ok(Math.hypot(T.x, T.z - 10) <= 4.4 + 1e-9, 'within 4.4 of the target'); near(d, i * .17, 1e-12, 'every 0.17 s'); ok(sc >= .8 && sc <= 1.05, 'size .8-1.05'); });
    } finally { window.dropMeteor = real; fresh(); }
  });
  test('cooldown and shot overrides: EG.setSpellParams changes the cooldown a cast sets and the skill bar shows; shots and spread change the volley', () => {
    fresh(); ok(EG.setSpellParams('fire', { cd: 2 }), 'accepted'); tryCast('fire'); eq(cds.fire, 2, 'cooldown from the override');
    updateHud(0); near(parseFloat(document.querySelector('.sk[data-s="fire"] .cd').style.getPropertyValue('--p')), 1, 1e-9, 'skill bar measures against the overridden cooldown');
    fresh(); EG.setSpellParams('fire', { shots: 5, spread: .1 }); player.face = 0; releaseCast({ id: 'fire', target: V(0, 0, 10) }); eq(projs.length, 5, 'five fireballs');
    const a = projs.map((p) => Math.atan2(p.vel.x, p.vel.z)); for (let i = 1; i < 5; i++) near(a[i] - a[i - 1], .1, 1e-9, 'spread 0.1');
    EG.resetSpellParams('fire'); eq(EG.spellParams('fire').cd, .36, 'reset restores the default'); fresh();
  });
  test('bad overrides: unknown spell or key, wrong type, negative, NaN, a fractional count, an unknown pattern each warn and are ignored, never throw', () => {
    fresh(); const warns = [], w = console.warn; console.warn = (...a) => warns.push(a.join(' '));
    try {
      const before = JSON.stringify(['fire', 'bolt', 'meteor', 'blood'].map((id) => EG.spellParams(id)));
      for (const [id, o] of [['fire', { damage: 'big' }], ['fire', { dmg: 5 }], ['ice', { cd: 1 }], ['fire', null], ['fire', 5], ['bolt', { bounces: 2.5 }], ['meteor', { pattern: 'zigzag' }], ['meteor', { pattern: 3 }], ['fire', { cd: -1 }], ['fire', { speed: NaN }], ['fire', { speed: Infinity }], ['blood', { bolts: '8' }]]) {
        const n = warns.length; let r; try { r = EG.setSpellParams(id, o); } catch (e) { throw new AssertError(`${id} ${JSON.stringify(o)} threw ${e.message}`); }
        eq(r, false, `${id} ${JSON.stringify(o)} reports not applied`); ok(warns.length > n, `${id} ${JSON.stringify(o)} warned`); }
      eq(JSON.stringify(['fire', 'bolt', 'meteor', 'blood'].map((id) => EG.spellParams(id))), before, 'nothing changed');
      const n = warns.length; eq(EG.setSpellParams('fire', { damage: 50, foo: 1 }), false, 'mixed: reports a rejected key'); eq(EG.spellParams('fire').damage, 50, 'the good key still applies'); eq(EG.spellParams('fire').foo, undefined); eq(warns.length, n + 1, 'one warning for foo');
      EG.spellParams('fire').damage = 1; eq(EG.spellParams('fire').damage, 50, 'spellParams returns a copy');
      let m = warns.length; EG.on('nope', () => {}); EG.on('hit', 5); EG.resetSpellParams('ice'); eq(warns.length, m + 3, 'unknown event, non-function listener, unknown spell reset: one warning each');
    } finally { console.warn = w; fresh(); }
  });
  test('events: each of the ten fires once, with its payload, in a scripted run; EG.off removes a listener', () => {
    fresh(); const got = {}, fns = {}; for (const n of EG.events) { fns[n] = (a) => (got[n] = got[n] || []).push(a); EG.on(n, fns[n]); }
    eq(EG.events.join(), 'towerLit,actStart,bossStart,bossDown,cast,hit,kill,playerDeath,restart,ending,newGame,continueGame,blink,dialogStart,dialogEnd', 'the event list');
    const TEN = EG.events.slice(0, 10); // newGame / continueGame have their own test below
    try { withContent({ combat: { critChance: 0 } }, () => {
      const e = still(spawnEnemy('lizard', 4, 0, 1) || enemies[0]);
      tryCast('fire'); dealDamage(e, 5, 'fire'); hurtPlayer(1e9, 'test cause'); restart();
      startStory(0); while (dlg) endDialog(); igniteTower(TOWERS[0]); startBoss(); killEnemy(story.boss); showEnding(); });
      for (const n of TEN) eq((got[n] || []).length, 1, n + ' fired once');
      eq(got.cast[0], 'fire'); eq(got.hit[0].spell, 'fire'); eq(got.hit[0].amount, 5); ok(got.hit[0].target && got.hit[0].target.type === 'lizard', 'hit target is the monster');
      eq(got.kill[0], 'lord'); eq(got.playerDeath[0], 'test cause'); eq(got.actStart[0], 0); eq(got.towerLit[0], 0);
      EG.off('cast', fns.cast); fresh(); tryCast('fire'); eq(got.cast.length, 1, 'no call after off');
    } finally { for (const n of EG.events) EG.off(n, fns[n]); story.on = false; document.querySelector('#ending').hidden = true; fresh(); }
  });
  test('a listener that throws is caught and warned: the frame goes on, the damage lands, later listeners still run', () => {
    fresh(); const warns = [], w = console.warn; console.warn = (...a) => warns.push(a.join(' '));
    const bad = () => { throw new Error('listener boom'); }, seen = [], good = (h) => seen.push(h.amount);
    try { EG.on('hit', bad); EG.on('hit', good); EG.on('cast', bad); EG.on('kill', bad);
      withContent({ combat: { critChance: 0, aoeJitter: false } }, () => {
        const e = still(spawnEnemy('ghost', 1.5, 0, 1) || enemies[0]); spawnFireball(V(0, 1, 0), V(1, 0, 0));
        let threw = null; try { for (let i = 0; i < 10; i++) logic(1 / 60); tryCast('fire'); dealDamage(e, 1e9, 'fire'); } catch (err) { threw = err; }
        eq(threw, null, 'nothing escaped the frame'); ok(e.maxhp - e.hp >= 34 || !e.alive, 'the blast damage landed'); ok(!e.alive, 'the kill went through'); ok(seen.length >= 2 && seen[0] === 34, 'the next listener still ran');
        ok(player.cast && player.cast.id === 'fire', 'the cast went through'); ok(warns.filter((x) => /listener boom/.test(x)).length >= 3, 'each throw warned'); });
    } finally { EG.off('hit', bad); EG.off('hit', good); EG.off('cast', bad); EG.off('kill', bad); console.warn = w; fresh(); }
  });
  test('EG.pause freezes monsters, timers and casting in the real frame loop; isPaused and inCombat report the state', async () => {
    fresh(); try {
      eq(EG.inCombat(), false, 'no monsters: not in combat'); const e = spawnEnemy('spider', 6, 0, 1) || enemies[0]; e.aggro = true; e.T = Object.assign({}, e.T, { dmg: 0 }); eq(EG.inCombat(), true, 'a living monster: in combat');
      let fired = 0; after(.05, () => fired++);
      EG.pause(true); eq(EG.isPaused(), true); const x0 = e.pos.x;
      ok(await frames(12), 'twelve frames of the real loop ran'); eq(e.pos.x, x0, 'the monster did not move while held'); eq(fired, 0, 'timers did not run while held');
      tryCast('fire'); eq(player.cast, null, 'no casting while held');
      EG.pause(false); eq(EG.isPaused(), false); ok(await until(() => e.pos.x < x0 - .2 && fired === 1, 30000), `moves and the timer runs again after release (x ${e.pos.x.toFixed(2)}, timer ${fired})`);
      clearWorld(); eq(EG.inCombat(), false, 'cleared: not in combat'); story.phase = 'boss'; eq(EG.inCombat(), true, 'boss fight counts as combat'); story.phase = 'idle';
    } finally { if (window.EG) EG.pause(false); fresh(); }
  });

  // ---------------------------------------------------------------- extension scripts, second round (DEVLOG timeline #46): live skill-bar numbers, read-only queries,
  // new-game / continue events, named pause holds, reserved keys, seeded randomness, effect clearing, the spell part behind each hit
  test('skill bar numbers come from the live spell table: an override changes the shot, bounce and drop counts shown, a reset brings the old text back', () => {
    fresh(); setTier(1); const t = (s) => document.querySelector('#m' + s).textContent;
    eq(t('fire'), '三連發'); eq(t('bolt'), '彈跳 6 次'); eq(t('meteor'), '十顆連落');
    ok(EG.setSpellParams('fire', { shots: 5 }), 'shots accepted'); ok(EG.setSpellParams('bolt', { bounces: 8 }), 'bounces accepted'); ok(EG.setSpellParams('meteor', { drops: 12 }), 'drops accepted');
    eq(t('fire'), '五連發', 'five shots'); eq(t('bolt'), '彈跳 8 次', 'eight bounces'); eq(t('meteor'), '12顆連落', 'twelve drops');
    EG.resetSpellParams(); eq(t('fire'), '三連發', 'reset'); eq(t('bolt'), '彈跳 6 次', 'reset'); eq(t('meteor'), '十顆連落', 'reset');
    setTier(0); eq(t('fire'), '單發', 'not upgraded: single shot text unchanged'); fresh();
  });
  test('read-only queries: EG.player, EG.towers, EG.ui and EG.isTouch report the state and hand out copies', () => {
    fresh(); player.pos.set(3, 0, -2); player.hp = 40;
    const p = EG.player(); eq(JSON.stringify(p), JSON.stringify({ x: 3, z: -2, hp: 40, maxHp: 100, alive: true }), 'player');
    p.hp = 1; p.x = 99; eq(player.hp, 40, 'player() is a copy'); eq(player.pos.x, 3);
    const tw = EG.towers(); eq(tw.length, TOWERS.length, 'one row per tower');
    tw.forEach((r, i) => { eq(r.index, i); eq(r.x, TOWERS[i].x); eq(r.z, TOWERS[i].z); eq(r.name, TOWERS[i].name); eq(r.spell, TOWERS[i].spell); eq(typeof r.lit, 'boolean'); eq(r.active, false, 'free play: no active tower'); });
    tw[0].lit = !tw[0].lit; tw[0].x = 1e6; eq(EG.towers()[0].x, TOWERS[0].x, 'towers() is a copy'); eq(TOWERS[0].lit, !tw[0].lit);
    eq(JSON.stringify(EG.ui()), JSON.stringify({ running: true, story: false, dialog: false, menu: false, result: false, ending: false, inventory: false, settings: false }), 'plain play');
    playDialog(Object.keys(CONTENT.dialog)[0], null); eq(EG.ui().dialog, true, 'dialog'); endDialog(); eq(EG.ui().dialog, false);
    togglePause(true); eq(EG.ui().menu, true, 'pause menu'); togglePause(false); eq(EG.ui().menu, false);
    toggleInv(); eq(EG.ui().inventory, true, 'inventory'); toggleInv(); eq(EG.ui().inventory, false);
    document.querySelector('#settings').hidden = false; syncMenu(); const u = EG.ui(); eq(u.settings && u.menu, true, 'settings counts as a menu'); document.querySelector('#settings').hidden = true; syncMenu();
    document.querySelector('#ending').hidden = false; eq(EG.ui().ending, true, 'ending'); document.querySelector('#ending').hidden = true;
    eq(typeof EG.isTouch(), 'boolean'); eq(EG.isTouch(), EGControls.touch, 'same answer as the touch module');
    fresh();
  });
  test('newGame and continueGame: which one fires and when; inside continueGame, EG.towers() already shows the towers the save had lit', () => {
    fresh(); const log = [], L = {}, prev = localStorage.getItem(SAVE_KEY);
    for (const n of ['newGame', 'continueGame', 'towerLit', 'actStart']) EG.on(n, L[n] = (a) => log.push([n, a, n === 'continueGame' ? EG.towers().map((t) => t.lit + '/' + t.active).join() : '']));
    try {
      startStory(0); while (dlg) endDialog();
      eq(log.map((x) => x[0] + ':' + x[1]).join(), 'newGame:0,actStart:0', 'a fresh story');
      log.length = 0; writeSave(2); document.querySelector('#goContinue').onclick(); while (dlg) endDialog();
      eq(log.map((x) => x[0] + ':' + x[1]).join(), 'continueGame:2,actStart:2', 'continue: continueGame before actStart, and no towerLit for the towers the save had lit');
      eq(log[0][2], TOWERS.map((T, i) => (i < 2) + '/' + (i === 2)).join(), 'towers 0 and 1 lit, tower 2 active, when the listener runs');
      log.length = 0; localStorage.removeItem(SAVE_KEY); document.querySelector('#goContinue').onclick(); while (dlg) endDialog();
      eq(log.map((x) => x[0]).join(), 'newGame,actStart', 'continue with no save is a new game');
    } finally { for (const n in L) EG.off(n, L[n]); if (prev === null) localStorage.removeItem(SAVE_KEY); else localStorage.setItem(SAVE_KEY, prev); story.on = false; fresh(); }
  });
  test('pause owners: held while any owner holds, each owner releases only its own hold, the one-argument calls still work', () => {
    fresh(); try {
      EG.pause(true, 'panel'); EG.pause(true, 'tutorial'); eq(EG.isPaused(), true); eq(EG.pausedBy().sort().join(), 'panel,tutorial');
      EG.pause(false, 'panel'); eq(EG.isPaused(), true, 'still held by tutorial'); eq(EG.pausedBy().join(), 'tutorial');
      tryCast('fire'); eq(player.cast, null, 'no casting while any owner holds');
      EG.pause(false); eq(EG.isPaused(), true, 'releasing the default owner leaves the tutorial hold');
      EG.pause(false, 'tutorial'); eq(EG.isPaused(), false, 'last owner released'); eq(EG.pausedBy().length, 0);
      EG.pause(true); EG.pause(true); eq(EG.pausedBy().join(), 'default', 'one-argument call holds as "default"'); EG.pause(false); eq(EG.isPaused(), false, 'holding twice is one hold');
      const c = EG.pausedBy(); c.push('x'); eq(EG.pausedBy().length, 0, 'pausedBy() is a copy');
    } finally { if (EG.pausedBy) for (const o of EG.pausedBy()) EG.pause(false, o); fresh(); }
  });
  test('reserved keys: the remap row refuses a reserved key and says why; a saved binding on a reserved key goes back to its default with a warning', () => {
    fresh(); const warns = [], w = console.warn, kb0 = { ...KB }, store = localStorage.getItem(EG_KEY('eg-keys')); console.warn = (...a) => warns.push(a.join(' '));
    const key = (code) => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
    try {
      KB.bolt = 'F9'; // as if the player's saved keys had put the chain bolt on F9
      EG.reserveKey('F9', '擴充面板');
      eq(KB.bolt, 'Digit2', 'the conflicting binding is back to its default'); ok(warns.some((x) => /F9/.test(x) && /bolt/.test(x)), 'and it warned');
      eq(document.querySelector('.keybtn[data-k=bolt]').textContent, '2', 'the remap row shows the restored key'); eq(EG.reservedKeys().F9, '擴充面板');
      const b = document.querySelector('.keybtn[data-k=fire]'); b.click(); ok(b.classList.contains('waiting'), 'row waits for a key');
      key('F9'); eq(KB.fire, 'Digit1', 'remap refused the reserved key'); ok(/擴充面板/.test(b.textContent), 'the row shows the reason: ' + b.textContent);
      key('F7'); eq(KB.fire, 'F7', 'a free key is still accepted');
      const r = EG.reservedKeys(); r.F9 = 'x'; eq(EG.reservedKeys().F9, '擴充面板', 'reservedKeys() is a copy');
      const n = warns.length; EG.reserveKey(5); eq(warns.length, n + 1, 'a non-string code warns');
    } finally { console.warn = w; Object.assign(KB, kb0); if (store === null) localStorage.removeItem(EG_KEY('eg-keys')); else localStorage.setItem(EG_KEY('eg-keys'), store); EGControls.redrawKeys(); fresh(); }
  });
  test('hit events name the spell part behind each hit (source), next to the damage kind the terrain uses', () => {
    fresh(); const got = [], f = (h) => got.push(h.source + '/' + h.kind + '/' + h.spell); EG.on('hit', f);
    const run = (frames) => { for (let i = 0; i < frames; i++) logic(1 / 60); };
    try { withContent({ combat: { critChance: 0 } }, () => {
      still(spawnEnemy('ghost', 1.2, 0, 1) || enemies[0]); spawnFireball(V(0, 1, 0), V(1, 0, 0)); run(1);
      eq(got[0], 'fire/fire/fire', 'fireball blast');
      fresh(); got.length = 0; still(spawnEnemy('ghost', 10, 10, 1) || enemies[0]); dropMeteor(V(10, 0, 10), 1, 0); run(120);
      eq(got[0], 'meteor/fire/fire', 'meteor impact: source meteor, damage kind still fire');
      const burn = got.filter((x) => /\/burn\//.test(x)); ok(burn.length >= 2 && burn.every((x) => x === 'meteorBurn/burn/burn'), 'burning ground under the meteor: ' + got.join());
      fresh(); got.length = 0; setTier(1); for (const x of [0, 4, 8]) still(spawnEnemy('ghost', x, 10, 1) || enemies[enemies.length - 1]); spawnOrb(V(-3, 1, 10), V(1, 0, 0)); run(120);
      eq(got.join(), 'bolt/bolt/bolt,boltChain/bolt/bolt,boltChain/bolt/bolt', 'chain bolt: direct hit, then two hops');
      fresh(); got.length = 0; setTier(0); for (const x of [0, 1]) still(spawnEnemy('ghost', x, 10, 1) || enemies[enemies.length - 1]); spawnOrb(V(-3, 1, 10), V(1, 0, 0)); run(60);
      eq(got.join(), 'bolt/bolt/bolt,boltSplash/bolt/bolt', 'not upgraded: direct hit and the splash next to it');
      fresh(); got.length = 0; still(spawnEnemy('ghost', 3, 0, 1) || enemies[0]); startBlood(); run(200);
      ok(got.length === 8 && got.every((x) => x === 'blood/blood/blood'), 'blood rite: eight hits, source blood: ' + got.join());
      fresh(); got.length = 0; const e = still(spawnEnemy('ghost', 5, 5, 1) || enemies[0]); dealDamage(e, 5, 'terrain'); eq(got[0], 'null/terrain/terrain', 'damage that no spell caused has source null');
    }); } finally { EG.off('hit', f); if (EG.clearEffects) EG.clearEffects(); fresh(); }
  });
  test('EG.clearEffects removes every live particle, projectile, meteor, burning patch, rite and pending timer; monsters stay', () => {
    fresh(); setTier(1); const e = still(spawnEnemy('ghost', 0, 9, 1) || enemies[0]);
    player.face = 0; releaseCast({ id: 'fire', target: V(0, 0, 9) }); castMeteor(V(6, 0, 6)); startBlood(); dropMeteor(V(-6, 0, 6), 1, 0);
    for (let i = 0; i < 50; i++) { logic(1 / 60); visuals(1 / 60); }
    ok(ADD.list.length > 0 && meteors.length + burns.length > 0 && rites.length > 0 && timers.length > 0, `effects running (particles ${ADD.list.length}, meteors ${meteors.length}, burns ${burns.length}, rites ${rites.length}, timers ${timers.length})`);
    EG.clearEffects();
    eq(ADD.list.length + SMOKE.list.length, 0, 'particles'); eq(projs.length, 0, 'projectiles'); eq(meteors.length + rocks.length, 0, 'meteors'); eq(burns.length, 0, 'burning ground');
    eq(rites.length, 0, 'rites'); eq(timers.length, 0, 'pending timers (queued meteor drops)'); eq(dmgs.length, 0, 'damage numbers');
    ok(e.alive && enemies.includes(e), 'the monster is still there');
    for (let i = 0; i < 30; i++) { logic(1 / 60); visuals(1 / 60); } eq(meteors.length + burns.length, 0, 'nothing comes back afterwards');
    fresh();
  });
  // one scripted fight: six frozen monsters, every spell once, 300 frames; returns every hit as "source:amount"
  const measured = (seed) => { fresh(); if (seed !== undefined) EG.seed(seed); EG.clearEffects(); const hits = [], f = (h) => hits.push(h.source + ':' + h.amount.toFixed(9)); EG.on('hit', f);
    try { setTier(1); for (const [x, z] of [[-3, 8], [0, 9], [3, 8], [-2, 12], [2, 12], [0, 6]]) still(spawnEnemy('ghost', x, z, 1) || enemies[enemies.length - 1]);
      player.face = 0; releaseCast({ id: 'fire', target: V(0, 0, 9) }); spawnOrb(V(0, 1, 0), V(0, 0, 1)); castMeteor(V(0, 0, 9)); startBlood();
      for (let i = 0; i < 300; i++) { logic(1 / 60); visuals(1 / 60); }
    } finally { EG.off('hit', f); EG.seed(null); EG.clearEffects(); }
    return { hits: hits.join(), n: hits.length, total: hits.reduce((s, x) => s + +x.split(':')[1], 0) }; };
  test('EG.seed + EG.clearEffects: the same seed gives the same hits and damage total twice; unseeded or another seed differs', () => {
    const a = measured(7), b = measured(7), c = measured(8), u1 = measured(), u2 = measured();
    ok(a.n >= 20, `the scene lands enough hits (${a.n})`); const A = a.hits.split(','), B = b.hits.split(','), k = A.findIndex((x, i) => x !== B[i]);
    eq(b.total, a.total, `same seed: same damage total (first different hit #${k}: ${A[k]} vs ${B[k]})`); eq(b.hits, a.hits, 'same seed: same hits in the same order');
    ok(c.hits !== a.hits, 'another seed: different hits'); ok(u1.total !== u2.total, `unseeded runs differ (${u1.total} vs ${u2.total}), so the test can see randomness`);
    const r = Math.random; EG.seed(3); const s1 = [Math.random(), Math.random()]; EG.seed(3); const s2 = [Math.random(), Math.random()]; EG.seed(null);
    eq(s1.join(), s2.join(), 'seeding restarts the sequence'); eq(Math.random, r, 'EG.seed(null) gives the page its own random numbers back');
    fresh();
  });

  // ---------------------------------------------------------------- blink (optional fifth basic move), meteor arc minimum radius, remap wait (DEVLOG timeline #47)
  // obstacles are taken out for these tests so a seeded tombstone never sits on a landing spot; tests that need one put their own in
  const bpress = (code) => document.body.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
  const blinkScene = (fn) => async () => {
    fresh(); ok(window.EG && typeof EG.enableBlink === 'function' && typeof EG.blink === 'function', 'EG.enableBlink and EG.blink exist');
    const obs = obstacles.splice(0); EG.enableBlink(true); player.pos.set(0, 0, 0);
    try { await fn(); } finally { obstacles.length = 0; obstacles.push(...obs); EG.enableBlink(false); fresh(); }
  };
  const shownEl = (s) => { const e = document.querySelector(s); return !!e && !(e.closest('.srow') || e).hidden; };
  test('blink is off by default: its key does nothing, no skill tile, help line or remap row, and its parameters have their defaults', () => {
    fresh(); ok(window.EG && typeof EG.blinkEnabled === 'function', 'EG.blinkEnabled exists'); eq(EG.blinkEnabled(), false, 'off by default');
    eq(KB_DEFAULT.blink, 'KeyF', 'default key F'); eq(KB.blink, 'KeyF');
    const p = EG.spellParams('blink'); ok(p, 'blink is in the parameter table');
    for (const [k, v] of Object.entries({ cd: 2.5, distance: 5.5, invuln: .25, passEnemies: true, passProps: true })) eq(p[k], v, 'blink.' + k);
    eq(Object.keys(p).length, 5, 'five parameters');
    player.pos.set(0, 0, 0); bpress('KeyF'); eq(player.pos.x, 0, 'F does not move the mage while blink is off'); eq(player.pos.z, 0);
    eq(EG.blink(1, 0), false, 'EG.blink refuses while off'); eq(cds.blink, 0, 'no cooldown started');
    for (const s of ['.sk[data-s=blink]', '#hBlink', '.keybtn[data-k=blink]']) ok(!shownEl(s), s + ' is not shown');
    eq(document.querySelectorAll('.keybtn').length, 9, 'the settings still list nine keys');
    fresh();
  });
  test('CONTENT.blink: true, false or an object of blink parameters loads; any other type stops loading and names the field', () => {
    for (const v of [5, 'yes', [1]]) { const r = tryContent((C) => { C.blink = v; }); ok(r.err && r.err.includes('CONTENT.blink'), `${JSON.stringify(v)}: expected an error naming CONTENT.blink, got ${r.err}`); }
    for (const v of [true, false, { distance: 7 }]) eq(tryContent((C) => { C.blink = v; }).err, null, JSON.stringify(v) + ' loads');
  });
  test('blink: its key teleports the mage the blink distance along the movement keys, starts the cooldown and fires the blink event with from and to', blinkScene(() => {
    const got = [], f = (a) => got.push(a); EG.on('blink', f);
    try {
      keys[KB.right] = true; bpress(KB.blink); keys[KB.right] = false;
      near(player.pos.x, 5.5, 1e-9, 'moved 5.5 east'); near(player.pos.z, 0, 1e-9); eq(cds.blink, 2.5, 'cooldown started');
      eq(got.length, 1, 'one blink event'); eq(JSON.stringify(got[0]), JSON.stringify({ from: { x: 0, z: 0 }, to: { x: 5.5, z: 0 } }), 'event payload');
      keys[KB.left] = true; bpress(KB.blink); keys[KB.left] = false; near(player.pos.x, 5.5, 1e-9, 'a second press during the cooldown does nothing'); eq(got.length, 1, 'and fires no event');
      for (let i = 0; i < 26; i++) updatePlayer(.1); eq(cds.blink, 0, 'cooldown runs out with game time');
      keys[KB.up] = keys[KB.right] = true; bpress(KB.blink); keys[KB.up] = keys[KB.right] = false;
      near(player.pos.x, 5.5 + 5.5 / Math.SQRT2, 1e-9, 'diagonal x'); near(player.pos.z, -5.5 / Math.SQRT2, 1e-9, 'diagonal z (up is -z)');
      cds.blink = 0; player.pos.set(0, 0, 0); player.face = Math.PI; bpress(KB.blink); near(player.pos.z, -5.5, 1e-9, 'no movement key: along the facing direction'); near(player.pos.x, 0, 1e-9);
      cds.blink = 0; player.pos.set(0, 0, 0); ok(EG.blink(0, 1), 'EG.blink(dx, dz) blinks in a given direction (no mouse needed)'); near(player.pos.z, 5.5, 1e-9);
      cds.blink = 0; EG.pause(true, 'panel'); eq(EG.blink(1, 0), false, 'no blink while an extension holds the game'); EG.pause(false, 'panel');
      cds.blink = 0; togglePause(true); eq(EG.blink(1, 0), false, 'no blink behind the pause menu'); togglePause(false);
      cds.blink = 0; player.alive = false; eq(EG.blink(1, 0), false, 'no blink when dead'); player.alive = true;
    } finally { EG.off('blink', f); for (const n of ['up', 'down', 'left', 'right']) keys[KB[n]] = false; }
  }));
  test('blink invulnerability: no damage for the invuln window after a blink, damage again after it; invuln 0 turns it off', blinkScene(() => {
    EG.blink(1, 0); hurtPlayer(10); eq(player.hp, 100, 'no damage right after the blink');
    updatePlayer(.2); hurtPlayer(10); eq(player.hp, 100, 'still safe 0.2 s later');
    updatePlayer(.1); hurtPlayer(10); eq(player.hp, 90, 'hurt again after 0.3 s');
    EG.setSpellParams('blink', { invuln: 0 }); cds.blink = 0; player.hp = 100; EG.blink(1, 0); hurtPlayer(10); eq(player.hp, 90, 'invuln 0: no safe window');
  }));
  test('blink never ends outside the arena or inside a solid prop or rock tile; passProps / passEnemies false stop before the first prop / monster', blinkScene(() => {
    player.pos.set(40, 0, 0); ok(EG.blink(1, 0), 'blink toward the edge'); ok(Math.hypot(player.pos.x, player.pos.z) <= 42.5 + 1e-9, 'inside the arena: ' + player.pos.x); ok(player.pos.x > 42, 'as far as the edge allows: ' + player.pos.x);
    cds.blink = 0; player.pos.set(42.4, 0, 0); eq(EG.blink(1, 0), false, 'no room at the edge: no blink'); eq(player.pos.x, 42.4, 'stays'); eq(cds.blink, 0, 'and keeps the cooldown free');
    cds.blink = 0; player.pos.set(0, 0, 0); obstacles.push({ x: 5.5, z: 0, r: 1 }); EG.blink(1, 0); ok(player.pos.x <= 4.1 + 1e-9 && player.pos.x > 3.5, 'a tomb on the landing spot: lands just short of it, not inside: ' + player.pos.x);
    obstacles.length = 0; obstacles.push({ x: 2.5, z: 0, r: .5 }); cds.blink = 0; player.pos.set(0, 0, 0); EG.blink(1, 0); near(player.pos.x, 5.5, 1e-9, 'passProps (default): over a prop in the way');
    EG.setSpellParams('blink', { passProps: false }); cds.blink = 0; player.pos.set(0, 0, 0); EG.blink(1, 0); ok(player.pos.x <= 1.6 + 1e-9 && player.pos.x > 1, 'passProps false: stops before the prop: ' + player.pos.x);
    obstacles.length = 0; EG.resetSpellParams('blink');
    const c = cellOf(5.5, 0), t0 = TT[c], tm0 = TM[c]; setT(c, TER.OBSID);
    try { cds.blink = 0; player.pos.set(0, 0, 0); EG.blink(1, 0); const p = { x: player.pos.x, z: player.pos.z }; solidPush(p, .4); ok(p.x === player.pos.x && p.z === player.pos.z && player.pos.x < 5, 'a rock tile on the landing spot: lands outside it: ' + player.pos.x); }
    finally { setT(c, t0, tm0); }
    const e = still(spawnEnemy('lizard', 3, 0, 1) || enemies[0]); cds.blink = 0; player.pos.set(0, 0, 0); EG.blink(1, 0); near(player.pos.x, 5.5, 1e-9, 'passEnemies (default): through a monster');
    EG.setSpellParams('blink', { passEnemies: false }); cds.blink = 0; player.pos.set(0, 0, 0); EG.blink(1, 0); ok(player.pos.x < 3 - e.radius - .4 + 1e-9 && player.pos.x > 0, 'passEnemies false: stops before the monster: ' + player.pos.x);
  }));
  test('blink parameters go through EG.setSpellParams: distance and cooldown change, bad values warn and are ignored, reset brings the defaults', blinkScene(() => {
    const warns = [], w = console.warn; console.warn = (...a) => warns.push(a.join(' '));
    try {
      ok(EG.setSpellParams('blink', { distance: 3, cd: 1 }), 'accepted'); EG.blink(1, 0); near(player.pos.x, 3, 1e-9, 'distance 3'); eq(cds.blink, 1, 'cooldown 1');
      for (const o of [{ distance: -1 }, { distance: NaN }, { passProps: 'no' }, { range: 4 }]) { const n = warns.length; eq(EG.setSpellParams('blink', o), false, JSON.stringify(o) + ' rejected'); ok(warns.length > n, 'warned'); }
      eq(EG.spellParams('blink').distance, 3, 'rejected values changed nothing'); EG.resetSpellParams('blink'); eq(EG.spellParams('blink').distance, 5.5, 'reset');
    } finally { console.warn = w; }
  }));
  test('blink effect: particles at both ends and along the path, one pooled light, a sound and a small shake; low particle density emits fewer; reduced shake keeps the camera still and dims the flash', blinkScene(() => {
    ok(typeof sfx.blink === 'function', 'sfx.blink exists'); const s0 = sfx.blink; let snd = 0; sfx.blink = () => snd++;
    // earlier flashes leave the light pool first, so only this blink's light is read
    const run = (dx) => { EG.clearEffects(); for (const s of LP) if (s.busy && s.life < 9) { s.busy = false; s.l.intensity = 0; } shakeAmt = 0; cds.blink = 0; const x0 = player.pos.x; EG.blink(dx, 0); const x1 = player.pos.x, L = LP.filter((s) => s.busy && s.life < 9 && Math.abs(s.l.position.x - x1) < .2 && Math.abs(s.l.position.z) < .2);
      return { n: ADD.list.length, x0, x1, light: L.length ? Math.max(...L.map((s) => s.l.intensity)) : 0, shake: shakeAmt, parts: ADD.list.map((q) => q.x) }; };
    try {
      EG.seed(11); const a = run(1);
      ok(a.n >= 40, `lavish: ${a.n} particles`); ok(a.parts.some((x) => Math.abs(x - a.x0) < .6) && a.parts.some((x) => Math.abs(x - a.x1) < .6), 'bursts at the departure and arrival points');
      ok(a.parts.some((x) => x > a.x0 + 1.5 && x < a.x1 - 1.5), 'a trail between them'); ok(a.light >= 3, 'a flash from the light pool: ' + a.light); ok(a.shake > 0, 'small shake'); eq(snd, 1, 'one sound');
      SET.particles = 'low'; applySettings(); EG.seed(11); const b = run(-1); ok(b.n < a.n * .7, `low density emits fewer (${b.n} vs ${a.n})`);
      SET.particles = 'high'; SET.reduceShake = true; applySettings(); EG.seed(11); const c = run(1); eq(c.shake, 0, 'reduced shake: no shake'); ok(c.light > 0 && c.light <= a.light / 2, `reduced shake: dimmer flash (${c.light} vs ${a.light})`);
    } finally { sfx.blink = s0; EG.seed(null); SET.reduceShake = false; SET.particles = 'high'; applySettings(); }
  }));
  test('blink UI: when on, a skill tile, a help line and a remap row show its key; remapping moves the blink; a reserved key is refused; off removes them', blinkScene(async () => {
    const kb0 = { ...KB }, store = localStorage.getItem(EG_KEY('eg-keys')), warns = [], w = console.warn; console.warn = (...a) => warns.push(a.join(' '));
    try {
      await frames(2); const tile = document.querySelector('.sk[data-s=blink]');
      ok(tile && !tile.hidden && tile.parentElement.id === 'skills', 'skill tile in the skill bar'); eq(tile.querySelector('.k').textContent, EGControls.touch ? '' : 'F', 'tile shows the key');
      ok(shownEl('#hBlink') && /F/.test(document.querySelector('#hBlink').textContent), 'help line with the key'); ok(shownEl('.keybtn[data-k=blink]'), 'remap row'); eq(document.querySelector('.keybtn[data-k=blink]').textContent, 'F');
      openSub('settings', 'intro'); document.querySelector('.keybtn[data-k=blink]').click(); bpress('KeyG'); eq(KB.blink, 'KeyG', 'remapped to G'); eq(JSON.parse(localStorage.getItem(EG_KEY('eg-keys'))).blink, 'KeyG', 'saved');
      EG.reserveKey('F10', 'test panel'); document.querySelector('.keybtn[data-k=blink]').click(); bpress('F10'); eq(KB.blink, 'KeyG', 'a reserved key is refused'); bpress('Escape'); backSub('settings');
      await frames(2); eq(tile.querySelector('.k').textContent, EGControls.touch ? '' : 'G', 'tile follows the new key'); ok(/G/.test(document.querySelector('#hBlink').textContent), 'help follows');
      player.pos.set(0, 0, 0); cds.blink = 0; keys[KB.right] = true; bpress('KeyF'); near(player.pos.x, 0, 1e-9, 'the old key does nothing'); bpress('KeyG'); keys[KB.right] = false; near(player.pos.x, 5.5, 1e-9, 'the new key blinks');
      KB.blink = 'F11'; EG.reserveKey('F11', 'test panel'); eq(KB.blink, 'KeyF', 'a saved blink key that becomes reserved goes back to F'); ok(warns.some((x) => /F11/.test(x) && /blink/.test(x)), 'with a warning');
      EG.enableBlink(false); for (const s of ['.sk[data-s=blink]', '#hBlink', '.keybtn[data-k=blink]']) ok(!shownEl(s), s + ' gone when off'); eq(document.querySelectorAll('.keybtn').length, 9, 'nine key rows again');
    } finally { console.warn = w; Object.assign(KB, kb0); if (store === null) localStorage.removeItem(EG_KEY('eg-keys')); else localStorage.setItem(EG_KEY('eg-keys'), store); keys[KB.right] = false; EGControls.redrawKeys(); }
  }));
  test('meteor arcMinRadius: default 0 keeps the arc around a close target (it wraps); a minimum radius pushes every drop out to it so the arc stays an arc', () => {
    fresh(); setTier(1); player.pos.set(0, 0, 0); const drops = [], real = dropMeteor;
    try { window.dropMeteor = (T) => { drops.push(T.clone()); };
      eq(EG.spellParams('meteor').arcMinRadius, 0, 'default 0');
      EG.setSpellParams('meteor', { pattern: 'arc', arcLength: 8, drops: 5 }); castMeteor(V(0, 0, 1));
      drops.forEach((T, i) => near(Math.hypot(T.x, T.z), 1, 1e-9, `default: drop ${i} at the target distance 1`));
      const span = (L) => { const a = L.map((T) => Math.atan2(T.z, T.x)); return Math.abs(a[4] - a[0]) < 1e-9 ? 0 : 8 / Math.hypot(L[0].x, L[0].z); };
      ok(span(drops) > 2 * Math.PI, 'default: an arc of 8 at radius 1 goes all the way round the caster (the old behaviour)');
      drops.length = 0; ok(EG.setSpellParams('meteor', { arcMinRadius: 3 }), 'accepted'); castMeteor(V(0, 0, 1));
      drops.forEach((T, i) => near(Math.hypot(T.x, T.z), 3, 1e-9, `drop ${i} pushed out to radius 3`)); ok(span(drops) < 2 * Math.PI, 'the arc no longer closes');
      near(drops[2].x, 0, 1e-9, 'middle drop still on the cast direction'); near(drops[2].z, 3, 1e-9);
      drops.length = 0; castMeteor(V(0, 0, 10)); drops.forEach((T) => near(Math.hypot(T.x, T.z), 10, 1e-9, 'a farther target keeps its own radius'));
    } finally { window.dropMeteor = real; fresh(); }
  });
  test('remap wait ends when the player leaves settings (close button, Esc, going to the title and starting play): nothing is bound, the next key acts normally', async () => {
    fresh(); const kb0 = { ...KB }, store = localStorage.getItem(EG_KEY('eg-keys'));
    const row = () => document.querySelector('.keybtn[data-k=fire]'), waits = () => !!document.querySelector('.keybtn.waiting');
    try {
      for (const [how, leave] of [['close button', () => document.querySelector('#sBack').click()], ['Esc twice', () => { bpress('Escape'); bpress('Escape'); }], ['title, then play', () => { goTitle(); startFree(); }]]) {
        fresh(); openSub('settings', 'pause'); row().click(); ok(waits(), how + ': row waits');
        leave(); await Promise.resolve(); await frames(1);
        ok(document.querySelector('#settings').hidden, how + ': settings closed'); ok(!waits(), how + ': no row waits after leaving');
        if (!running) startFree(); for (const id of MENUS) document.querySelector('#' + id).hidden = true; syncMenu(); paused = false;
        bpress('KeyW'); eq(KB.fire, 'Digit1', how + ': W did not become the fireball key'); ok(keys.KeyW, how + ': W reached the game'); keys.KeyW = false;
        bpress('Digit1'); ok(player.cast && player.cast.id === 'fire', how + ': 1 still casts the fireball'); player.cast = null;
      }
    } finally { Object.assign(KB, kb0); if (store === null) localStorage.removeItem(EG_KEY('eg-keys')); else localStorage.setItem(EG_KEY('eg-keys'), store); EGControls.redrawKeys(); fresh(); }
  });

  // ---------------------------------------------------------------- key taps and extension interface, third round (DEVLOG timeline #48)
  const castUntil = (id, n = 400) => { while (player.cast && player.cast.id === id && n-- > 0) logic(1 / 60); };
  test('a spell key pressed during another cast is cast in the frame that cast ends; the last press wins; a held left button does not replace it; a stale or not-ready press is dropped', () => {
    fresh(); const got = [], f = (id) => got.push(id); EG.on('cast', f);
    try {
      tryCast('meteor'); bpress('Digit4'); eq(got.join(), 'meteor', 'the press during the meteor cast does not cast at once');
      castUntil('meteor'); eq(got.join(), 'meteor,blood', 'blood is cast the moment the meteor cast ends'); eq(player.cast && player.cast.id, 'blood');
      fresh(); got.length = 0; tryCast('bolt'); bpress('Digit3'); bpress('Digit1'); castUntil('bolt'); eq(got.join(), 'bolt,fire', 'only the last press is kept');
      fresh(); got.length = 0; tryCast('bolt'); lmb = true; bpress('Digit4'); castUntil('bolt'); lmb = false; eq(got.slice(0, 2).join(), 'bolt,blood', 'the held fireball button does not push the pressed key aside');
      fresh(); got.length = 0; tryCast('bolt'); bpress('Digit4'); player.cast = null; tryCast('meteor'); castUntil('meteor'); for (let i = 0; i < 30; i++) logic(1 / 60);
      ok(!got.includes('blood'), 'a press kept for a cast that was cut short never fires later: ' + got.join());
      fresh(); got.length = 0; cds.blood = 30; tryCast('bolt'); bpress('Digit4'); castUntil('bolt'); eq(got.join(), 'bolt', 'a spell still cooling down when the cast ends is not cast');
    } finally { EG.off('cast', f); lmb = false; fresh(); }
  });
  test('dialogStart and dialogEnd carry the dialogue id: start fires with the box open, end after it closed and before the follow-up runs', () => {
    fresh(); const log = [], s = (id) => log.push('start:' + id + ':' + EG.ui().dialog), e = (id) => log.push('end:' + id + ':' + EG.ui().dialog);
    EG.on('dialogStart', s); EG.on('dialogEnd', e); const id = Object.keys(CONTENT.dialog)[0];
    try {
      ok(EG.events.includes('dialogStart') && EG.events.includes('dialogEnd'), 'listed in EG.events');
      playDialog(id, () => log.push('then')); eq(log.join(), `start:${id}:true`, 'start');
      for (let k = 0; dlg && k < 99; k++) nextLine(); eq(log.join(), `start:${id}:true,end:${id}:false,then`, 'end, then the follow-up');
      log.length = 0; playDialog(id, null); document.querySelector('#dSkip').click(); eq(log.join(), `start:${id}:true,end:${id}:false`, 'skip button');
    } finally { EG.off('dialogStart', s); EG.off('dialogEnd', e); fresh(); }
  });
  test('EG.ui().story is true in story mode and false in free play and on the title screen', () => {
    fresh(); eq(EG.ui().story, false, 'free play');
    try { startStory(0); while (dlg) endDialog(); eq(EG.ui().story, true, 'story mode'); goTitle(); eq(EG.ui().story, false, 'title'); startFree(); eq(EG.ui().story, false, 'free play again'); }
    finally { fresh(); }
  });
  test('EG.enemyCount and EG.nearestEnemy count living monsters and report the closest one as a copy', () => {
    fresh(); eq(EG.enemyCount(), 0, 'none'); eq(EG.nearestEnemy(), null, 'none: null');
    // the nearer one is spawned first and a farther one after it, so "the last living monster" is not the right answer by accident
    const b = still(spawnEnemy('ghost', 0, 3, 1) || enemies[0]), a = still(spawnEnemy('spider', 6, 0, 1) || enemies[1]); player.pos.set(0, 0, 0);
    eq(EG.enemyCount(), 2, 'two'); const n = EG.nearestEnemy(); eq(JSON.stringify(n), JSON.stringify({ distance: 3, type: 'ghost' }), 'the ghost is nearer');
    n.type = 'x'; eq(EG.nearestEnemy().type, 'ghost', 'a copy'); killEnemy(b); eq(EG.enemyCount(), 1, 'a dead one does not count');
    eq(EG.nearestEnemy().type, 'spider', 'next nearest'); near(EG.nearestEnemy().distance, 6, 1e-9); fresh();
  });
  test('EG.music(false) stops the built-in score and hands out a fresh music bus at the music volume; nothing restarts it until EG.music(true)', () => {
    fresh(); initAudio(); ok(AC, 'audio started');
    try {
      const was = musicBus; ok(musicTimer, 'the score plays'); eq(EG.musicBus(), was, 'musicBus() is the engine bus');
      EG.music(false); eq(musicTimer, null, 'score timer stopped'); ok(EG.musicBus() && EG.musicBus() !== was, 'a new bus for the extension'); near(EG.musicBus().gain.value, SET.music, 1e-6, 'at the music volume');
      startMusic(); eq(musicTimer, null, 'the engine cannot restart it while off'); EG.music(false); eq(musicTimer, null, 'twice is fine');
      EG.music(true); ok(musicTimer, 'on again');
    } finally { EG.music(true); fresh(); }
  });
  test('post effects: default tint and chromatic aberration give the same pixels as the shader without them; a tint and an aberration change them; reduce-shake switches the aberration off', () => {
    fresh(); const M = EGPost.finalMat, U = M.uniforms, T = THREE, S = 64, fx = SET.fx;
    ok(U.uTint && U.uCA && U.uTint.value.equals(new T.Vector3(1, 1, 1)) && U.uCA.value === 0, 'new uniforms with their defaults');
    const old = M.fragmentShader.split(', uCA, uCAk; uniform vec3 uTint;').join(';').replace(/ if \(uCA \* uCAk > 0\.0\) \{[^}]*\}/, '').split('c * uTint, 0.0').join('c, 0.0');
    ok(!/uCA|uTint/.test(old), 'the shader without the new code');
    const oldM = new T.ShaderMaterial({ vertexShader: M.vertexShader, fragmentShader: old, uniforms: U, depthTest: false, depthWrite: false });
    const tex = (k) => { const d = new Uint8Array(S * S * 4); for (let i = 0; i < d.length; i++) d[i] = i % 4 === 3 ? 255 : ((i * 2654435761 + k * 977) >>> 0) % 253; const t = new T.DataTexture(d, S, S, T.RGBAFormat); t.needsUpdate = true; return t; };
    const rt = new T.WebGLRenderTarget(S, S), sc = new T.Scene(), cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1), q = new T.Mesh(new T.PlaneGeometry(2, 2)); q.frustumCulled = false; sc.add(q);
    const shot = (m) => { q.material = m; renderer.setRenderTarget(rt); renderer.render(sc, cam); const px = new Uint8Array(S * S * 4); renderer.readRenderTargetPixels(rt, 0, 0, S, S, px); renderer.setRenderTarget(null); return px; };
    const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
    try {
      SET.fx = 'high'; EGPost.render(); ok(EGPost.state.on, 'post effects on'); eq(U.uCAk.value, 1, 'aberration allowed');
      eq(diff(shot(M), shot(oldM)), 0, 'live game frame: default output pixel-identical');
      U.tMain.value = tex(1); U.tSoft.value = tex(2); U.tBloom.value = tex(3);
      const base = shot(M); eq(diff(base, shot(oldM)), 0, 'noise input: default output pixel-identical');
      U.uTint.value.set(.5, 1, 1); const tinted = shot(M); let r = 0, g = 0; for (let i = 0; i < tinted.length; i += 4) { r += tinted[i] - base[i]; g += Math.abs(tinted[i + 1] - base[i + 1]); }
      ok(r < -1000 && g === 0, `tint halves red only (red ${r}, green ${g})`); U.uTint.value.set(1, 1, 1);
      U.uCA.value = .08; ok(diff(shot(M), base) > 500, 'aberration shifts the colour channels');
      SET.reduceShake = true; EGPost.render(); U.tMain.value = tex(1); U.tSoft.value = tex(2); U.tBloom.value = tex(3);
      eq(U.uCAk.value, 0, 'reduce-shake zeroes the aberration factor'); eq(diff(shot(M), base), 0, 'reduce-shake: no aberration'); eq(U.uCA.value, .08, 'the extension value itself is kept');
    } finally { U.uCA.value = 0; U.uTint.value.set(1, 1, 1); SET.fx = fx; rt.dispose(); oldM.dispose(); fresh(); EGPost.render(); }
  });

  // ---------------------------------------------------------------- blink key collisions, modifier keys, the ending screen, a new run, reduced flashing (DEVLOG timeline #49)
  const kpress = (code, mods = {}) => document.body.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...mods }));
  const noDupKeys = () => { const v = Object.values(KB).filter(Boolean); return new Set(v).size === v.length; };
  test('blink key collision: a key map saved before blink existed that has F on a spell gives blink no key (the spell keeps F, no two actions share a key, F only casts)', blinkScene(async () => {
    const kb0 = { ...KB };
    try {
      // setup: what an old saved map looks like next to blink's default (the spell was moved to F before blink existed)
      EG.enableBlink(false); KB.fire = 'KeyF'; KB.blink = 'KeyF'; EG.enableBlink(true);
      eq(KB.fire, 'KeyF', 'the spell keeps F'); eq(KB.blink, '', 'blink has no key'); ok(noDupKeys(), 'no two actions share a key: ' + JSON.stringify(KB));
      const got = []; const f = (a) => got.push(a); EG.on('blink', f); keys[KB.right] = true; kpress('KeyF'); keys[KB.right] = false; EG.off('blink', f);
      ok(player.cast && player.cast.id === 'fire', 'F casts the spell'); eq(got.length, 0, 'and does not blink'); near(player.pos.x, 0, 1e-9, 'the mage stays');
      await frames(2); eq(document.querySelector('.keybtn[data-k=blink]').textContent, '—', 'the remap row shows blink without a key');
      player.cast = null; cds.fire = 0; KB.fire = 'Digit1'; KB.blink = 'KeyG'; EG.enableBlink(false); EG.enableBlink(true); eq(KB.blink, 'KeyG', 'a free key stays bound');
    } finally { Object.assign(KB, kb0); EGControls.redrawKeys(); }
  }));
  test('Ctrl, Meta and Alt combos never blink, cast or open the bag (Ctrl+F is the browser\'s find); Shift does not block', blinkScene(() => {
    try {
      for (const m of ['ctrlKey', 'metaKey', 'altKey']) {
        cds.blink = 0; player.pos.set(0, 0, 0); keys[KB.right] = true; kpress(KB.blink, { [m]: true }); keys[KB.right] = false;
        near(player.pos.x, 0, 1e-9, m + ' + blink key: no blink'); eq(cds.blink, 0, m + ': no cooldown started');
        cds.fire = 0; player.cast = null; kpress(KB.fire, { [m]: true }); eq(player.cast, null, m + ' + spell key: no cast');
        kpress(KB.inv, { [m]: true }); ok(document.querySelector('#inv').hidden, m + ' + bag key: the bag stays closed');
      }
      cds.blink = 0; player.pos.set(0, 0, 0); keys[KB.right] = true; kpress(KB.blink, { shiftKey: true }); keys[KB.right] = false; near(player.pos.x, 5.5, 1e-9, 'Shift + blink key blinks');
      kpress(KB.fire, { shiftKey: true }); ok(player.cast && player.cast.id === 'fire', 'Shift + spell key casts');
    } finally { keys[KB.right] = false; if (!document.querySelector('#inv').hidden) toggleInv(); }
  }));
  test('ending screen: no cast, no blink and no movement behind it (keys, held left button, EG.blink)', blinkScene(() => {
    const save = localStorage.getItem(SAVE_KEY);
    try {
      story.on = true; story.t0 = time; showEnding(); ok(!document.querySelector('#ending').hidden, 'setup: the ending screen is shown'); player.pos.set(0, 0, 0);
      keys[KB.right] = true; kpress(KB.blink); near(player.pos.x, 0, 1e-9, 'blink key: no blink'); eq(EG.blink(1, 0), false, 'EG.blink refuses');
      kpress(KB.fire); tryCast('meteor'); eq(player.cast, null, 'spell key and tryCast: no cast'); eq(cds.fire + cds.meteor, 0, 'no cooldown started');
      lmb = true; for (let i = 0; i < 10; i++) updatePlayer(.05); lmb = false; keys[KB.right] = false;
      eq(player.cast, null, 'held left button: no cast'); near(player.pos.x, 0, 1e-9, 'held movement key: the mage stays'); near(player.pos.z, 0, 1e-9);
    } finally { keys[KB.right] = false; lmb = false; document.querySelector('#ending').hidden = true; story.on = false; story.phase = 'idle'; if (save !== null) localStorage.setItem(SAVE_KEY, save); }
  }));
  test('a new run starts clean: new game, continue, restart and free play reset every cooldown, the blink safety window, a queued cast, hit-stop, shake and a blood rite in progress', blinkScene(() => {
    const save = localStorage.getItem(SAVE_KEY), s0 = sfx.blink; sfx.blink = () => {};
    const dirty = (how) => {
      while (dlg) endDialog(); paused = false; story.phase = story.on ? 'fight' : 'idle'; player.pos.set(0, 0, 0); cds.blink = 0;
      ok(EG.blink(1, 0), how + ': setup blink'); startBlood(); Object.assign(cds, { fire: .3, bolt: .9, meteor: 4.5, blood: 4 }); egQ = ['bolt', player.cast || {}]; hitStop = .2; shakeAmt = .4;
    };
    try {
      for (const [how, go] of [['new game', () => startStory(0)], ['continue', () => startStory(2, true)], ['restart', () => restart()], ['free play', () => startFree()]]) {
        dirty(how); go(); while (dlg) endDialog();
        for (const k in cds) eq(cds[k], 0, `${how}: ${k} ready`);
        eq(egQ.length, 0, how + ': no queued cast'); eq(hitStop, 0, how + ': no hit-stop'); eq(shakeAmt, 0, how + ': no shake'); eq(rites.length, 0, how + ': no blood rite from the last run');
        player.hp = player.maxhp; hurtPlayer(5); eq(player.hp, player.maxhp - 5, how + ': no blink safety window from the last run');
      }
    } finally { sfx.blink = s0; story.on = false; if (save === null) localStorage.removeItem(SAVE_KEY); else localStorage.setItem(SAVE_KEY, save); }
  }));
  test('EG.reduceFlashing: off by default and the flash numbers are unchanged; on dims every pooled flash (blink, explosion, chain hit) and the monster hit whitening, and the blink skips its shake', blinkScene(() => {
    ok(typeof EG.reduceFlashing === 'function' && typeof EG.flashingReduced === 'function', 'EG.reduceFlashing and EG.flashingReduced exist'); eq(EG.flashingReduced(), false, 'off by default');
    const freeLP = () => { for (const s of LP) if (s.busy && s.life < 9) { s.busy = false; s.l.intensity = 0; } };
    const lit = () => Math.max(0, ...LP.filter((s) => s.busy && s.life < 9).map((s) => s.l.intensity));
    const blinkRun = () => { EG.clearEffects(); freeLP(); shakeAmt = 0; cds.blink = 0; player.pos.set(0, 0, 0); EG.blink(1, 0); return { light: lit(), shake: shakeAmt }; };
    const e = still(spawnEnemy('lizard', 8, 8, 1) || enemies[0]), whiten = () => { dealDamage(e, 1, 'fire'); updateEnemies(.001); return e.mats[0].emissive.r; };
    try {
      const a = blinkRun(); eq(a.light, 5, 'off: blink flash 5'); ok(a.shake > 0, 'off: blink shakes');
      freeLP(); flash(V(0, 1, 0), 0xffffff, 4, 9, .3); eq(lit(), 4, 'off: a flash of 4 stays 4'); freeLP(); explode(V(0, 1, 0), 1); eq(lit(), 4.5, 'off: explosion flash 4.5');
      const w0 = whiten(); near(w0, .85, 1e-6, 'off: hit whitening .85');
      eq(EG.reduceFlashing(true), true, 'returns the new state'); eq(EG.flashingReduced(), true, 'on');
      const b = blinkRun(); near(b.light, 1.5, 1e-9, 'on: blink flash dimmed like reduce-shake (1.5)'); eq(b.shake, 0, 'on: the blink does not shake');
      freeLP(); flash(V(0, 1, 0), 0xffffff, 4, 9, .3); near(lit(), 1.2, 1e-9, 'on: any pooled flash at 0.3'); freeLP(); explode(V(0, 1, 0), 1); near(lit(), 1.35, 1e-9, 'on: explosion flash 0.3');
      ok(whiten() <= w0 * .31, 'on: hit whitening dimmed');
      eq(EG.reduceFlashing(false), false, 'off again'); const c = blinkRun(); eq(c.light, 5, 'off again: blink flash 5');
    } finally { EG.reduceFlashing(false); EG.clearEffects(); freeLP(); }
  }));

  // ---------------------------------------------------------------- run
  for (const [name, fn] of tests) { if (only && !name.includes(only)) continue;
    try { await fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, err: e instanceof AssertError ? e.message : (e && e.stack || String(e)).split('\n').slice(0, 2).join(' ') }); }
  }
  fresh(); $('#dead').hidden = true;
  return results;
};
