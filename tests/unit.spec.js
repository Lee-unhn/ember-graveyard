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
    const want = new THREE.Vector3(player.pos.x, 0, player.pos.z).add(new THREE.Vector3(0, 18.5 * zoom, 11 * zoom));
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
    const missing = []; for (const f of files) { const r = await fetch(`assets/voice/${f}.ogg`, { method: 'HEAD' }); if (!r.ok) missing.push(f); }
    eq(missing.join(','), '', 'missing recordings');
  });
  test('a dialogue line plays its own recording; closing the dialogue stops it', () => {
    const keepTts = tts; let said = 0; tts = () => { said++; }; const v0 = voiceOn; voiceOn = true;
    try {
      playDialog('intro', null); eq(window.__voiceFile, 'intro_0_elder', 'first line'); ok(vAudio && /assets\/voice\/intro_0_elder\.ogg$/.test(vAudio.src), 'audio source');
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

  // ---------------------------------------------------------------- run
  for (const [name, fn] of tests) { if (only && !name.includes(only)) continue;
    try { await fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, err: e instanceof AssertError ? e.message : (e && e.stack || String(e)).split('\n').slice(0, 2).join(' ') }); }
  }
  fresh(); $('#dead').hidden = true;
  return results;
};
