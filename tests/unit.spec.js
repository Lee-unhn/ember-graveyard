// Unit tests. Injected into the running page (index.html) and executed against its global functions.
// Each test resets world state through fresh(); no test depends on another test's leftovers.
window.__runUnit = async () => {
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
      for (const [k, v] of Object.entries(it.st)) { const [lo, hi] = RANGE[k]; ok(v >= Math.round(lo * RAR[r].mul) - 1 && v <= Math.round(hi * RAR[r].mul) + 1, `${k}=${v} rarity ${r}`); }
    }
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

  // ---------------------------------------------------------------- run
  for (const [name, fn] of tests) {
    try { await fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, err: e instanceof AssertError ? e.message : (e && e.stack || String(e)).split('\n').slice(0, 2).join(' ') }); }
  }
  fresh(); $('#dead').hidden = true;
  return results;
};
