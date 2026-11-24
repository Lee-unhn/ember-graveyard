// Terrain actions and spell extension tests (kit/spellkit.js) and the engine's per-cast record (kit/core.js, combat.js, world.js,
// systems.js). Injected into a page that received the test CONTENT.spellkit (tests/lib/spellkit-fixture.js). Game time is advanced
// by calling the engine's own logic()/visuals(); nothing waits on wall-clock time.
//   __runSpellkit('full')
window.__runSpellkit = async () => {
  const tests = [], results = [];
  const test = (name, fn) => tests.push([name, fn]);
  class AssertError extends Error {}
  const ok = (c, m) => { if (!c) throw new AssertError(m || 'expected truthy'); };
  const eq = (a, b, m) => { if (a !== b) throw new AssertError(`${m || 'eq'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
  const near = (a, b, tol, m) => { if (!(Math.abs(a - b) <= tol)) throw new AssertError(`${m || 'near'}: expected ${b}±${tol}, got ${a}`); };
  const K = EGSpellkit, C = CONTENT.spellkit, V = (x, z) => new THREE.Vector3(x, 0, z);
  const step = (n, dt = 1 / 60) => { for (let k = 0; k < n; k++) { time += dt; shared.uTime.value = time; logic(dt); visuals(dt); } };
  const until = (f, max = 600) => { for (let k = 0; k < max; k++) { if (f()) return k; step(1); } return -1; };
  const L0 = {}; for (const n of Object.keys(EG_EV)) L0[n] = EG_EV[n].slice();   // listeners present before the tests (the module's own): kept by fresh()
  const fresh = () => {
    while (dlg) endDialog();
    for (const k in keys) keys[k] = false; lmb = false;
    clearWorld(); resetTerrain(); running = true; paused = false;
    Object.assign(story, { on: false, phase: 'idle', act: 0, unlocked: new Set(['fire', 'bolt', 'meteor', 'blood']), tier: { fire: 1 }, seen: new Set(), boss: null });
    player.pos.set(0, 0, 0); player.maxhp = player.hp = 1e6; player.alive = true; player.cast = null; player.face = 0;
    for (const k in cds) cds[k] = 0; for (const id of MENUS) document.querySelector('#' + id).hidden = true; syncMenu();
    EG.resetSpellParams(); EG.seed(null); EG.reduceFlashing(false); setTier(1);
    for (const n of Object.keys(EG_EV)) EG_EV[n] = (L0[n] || []).slice();
    camSnap = true; step(2);
  };
  // a test patch of ground: every cell in the rectangle gets type t; props inside are laid down (they neither block nor break)
  const paint = (x0, z0, x1, z1, t) => { for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { const i = cellOf(x + 0.5, z + 0.5); TT[i] = t; TM[i] = [TER.FIRE, TER.LAVA, TER.SHOCK, TER.STEAM, TER.BLOOD].includes(t) ? 99 : 0; THP[i] = t === TER.OBSID ? 3 : 0; paintCell(i); } };
  const clean = (x, z, r) => { for (const p of props) if (p.kind !== 'fence' && Math.hypot(p.x - x, p.z - z) < r) { p.state = 'down'; if (p.ob) p.ob.r = 0; } };
  const tile = (x, z) => TT[cellOf(x, z)];
  // a monster that stays where it is put (its own copy of the type with speed 0) and does not hurt the player
  const dummy = (type, x, z, hp = 1e5) => { spawnEnemy(type, x, z, 1); const e = enemies[enemies.length - 1]; e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 }); e.hp = e.maxhp = hp; e.pos.set(x, e.pos.y, z); return e; };
  // a real cast: aim the mouse at (x, z) on the ground, press through tryCast, run game time until the spell has left the hand
  const cast = (id, x, z) => { const v = V(x, z).project(camera); mouse.set(v.x, v.y); cds[id] = 0; player.cast = null; tryCast(id); ok(player.cast && player.cast.id === id, 'cast started: ' + id);
    const c = player.cast; until(() => c.released, 200); return c; };
  const hits = []; const onHit = (h) => hits.push({ kind: h.kind, source: h.source, amount: h.amount, cast: h.cast, target: h.target });
  const listen = (n, f) => { EG.on(n, f); return f; };
  const silent = (fn) => { const t0 = window.tone; let n = []; window.tone = (...a) => n.push(a); try { fn(); } finally { window.tone = t0; } return n; };

  // ---------------------------------------------------------------- module state and parameters
  test('module on, no error; it replaced only the functions it lists and every replacement keeps its own properties (tags)', () => {
    ok(K.state.on, 'on'); eq(K.state.err, '', 'no error'); eq(K.state.problems.length, 0, 'no problems');
    for (const n of ['dealDamage', 'applyEl', 'updateProjs', 'chain']) eq(window[n].egTag, n, 'tag on ' + n);
    for (const n of ['setT', 'applyEl', 'updateEnemies', 'terrainEffects', 'crush', 'dealDamage', 'updateProjs', 'chain', 'castMeteor', 'meteorTerrain', 'startBlood', 'updateRites', 'updateTerrain']) ok(K.state.wraps.includes(n), 'wrapped ' + n);
  });
  test('new events are known (spell, status, terrainHit, terrainChange) and new parameters have their defaults', () => {
    for (const n of ['spell', 'status', 'terrainHit', 'terrainChange']) ok(EG.events.includes(n), n);
    const f = EG.spellParams('fire'), b = EG.spellParams('bolt'), m = EG.spellParams('meteor'), r = EG.spellParams('blood');
    eq(f.pierce, false, 'pierce'); eq(f.elem, 'fire', 'fire elem'); eq(f.sweeps, 0, 'sweeps'); eq(f.maxRange, 17, 'maxRange'); eq(b.fromSky, 0, 'fromSky'); eq(b.hopElem, 'bolt', 'hopElem');
    eq(b.arcs, true, 'arcs'); eq(m.elem, 'meteor', 'meteor elem'); eq(m.ringRadius, 3.5, 'ringRadius'); eq(r.focus, false, 'focus'); eq(r.elem, 'blood', 'blood elem'); eq(r.wallElem, 'ember', 'wallElem');
    eq(f.damage, 34, 'old fields untouched'); eq(m.pattern, 'scatter', 'old pattern');
  });
  test('setSpellParams takes the new string values and booleans, rejects unknown words, and reset brings the defaults back', () => {
    fresh(); ok(EG.setSpellParams('meteor', { pattern: 'ring', elem: 'volt', quench: true }), 'ring / volt / quench');
    ok(!EG.setSpellParams('fire', { elem: 'plasma' }), 'unknown element refused'); eq(EG.spellParams('fire').elem, 'fire', 'unchanged');
    ok(!EG.setSpellParams('fire', { trail: 3 }), 'wrong type refused'); ok(EG.setSpellParams('fire', { trail: '' , pierce: true }), 'empty trail is a value');
    EG.resetSpellParams(); eq(EG.spellParams('meteor').pattern, 'scatter', 'reset pattern'); eq(EG.spellParams('fire').pierce, false, 'reset pierce');
  });
  test('with every new parameter at its default, the four spells never use the module\'s own paths (no special projectile, strike or crawl)', () => {
    fresh(); clean(0, 12, 8); dummy('lizard', 0, 10); let special = 0;
    for (const id of ['fire', 'bolt', 'meteor', 'blood']) { cast(id, 0, 10); for (let k = 0; k < 120; k++) { step(1); special = Math.max(special, K.skProjs.length + K.strikes.length + K.sweeps.length + (rites.some((o) => o.sk) ? 1 : 0)); } }
    eq(special, 0, 'special objects');
  });

  // ---------------------------------------------------------------- the engine's per-cast record (core)
  test('each cast gets a record { id, n, mul: 1 }; a cast listener can lock a factor; every hit of that cast is multiplied and carries the record', () => {
    fresh(); clean(0, 8, 6); paint(-4, 4, 4, 12, TER.SOIL); EG.setSpellParams('fire', { shots: 1 }); EG.on('hit', onHit); hits.length = 0;
    const e = dummy('lizard', 0, 8); let rec = null; EG.on('cast', (id) => { rec = EG.castInfo(); if (id === 'fire') rec.mul = 3; });
    const r0 = Math.random; Math.random = () => 0.5;   // no critical hit, no jitter: the two casts differ only by their factor
    try { cast('fire', 0, 8); until(() => hits.length > 0, 200); } finally { Math.random = r0; }
    ok(rec && rec.id === 'fire' && rec.n > 0, 'record'); const h = hits.find((x) => x.source === 'fire'); ok(h, 'fireball hit'); eq(h.cast, rec, 'hit carries the record');
    const n0 = hits.length; EG_EV.cast = (L0.cast || []).slice(); EG.on('cast', (id) => { EG.castInfo().mul = 1; }); // a second cast with factor 1
    Math.random = () => 0.5; try { cds.fire = 0; cast('fire', 0, 8); until(() => hits.length > n0, 200); } finally { Math.random = r0; } const h2 = hits[n0];
    near(h.amount / h2.amount, 3, 1e-9, 'factor 3 against factor 1'); ok(h2.cast !== rec && h2.cast.n > rec.n, 'a new record per cast');
  });
  test('damage outside a cast (terrain under a monster) carries no record and is not multiplied', () => {
    fresh(); clean(10, -20, 5); paint(8, -22, 12, -18, TER.LAVA); EG.on('hit', onHit); hits.length = 0; EG.on('cast', () => { EG.castInfo().mul = 5; });
    const e = dummy('lizard', 10, -20); step(30); const t = hits.filter((x) => x.kind === 'terrain'); ok(t.length > 0, 'terrain hits');
    ok(t.every((x) => x.cast === null && Math.abs(x.amount - 6) < 1.5), 'no record, about 6 per tick: ' + t.map((x) => x.amount.toFixed(2)).join(','));
  });
  test('bursts carry the cast: a wisp grave blown by the fireball hurts with the factor; a wisp blown by spreading fire has no record', () => {
    fresh(); clean(0, 9, 6); paint(-3, 6, 3, 12, TER.SOIL); const w = cellOf(0.5, 9.5); TT[w] = TER.WISP; paintCell(w); EG.on('hit', onHit); hits.length = 0;
    const e = dummy('lizard', 0.5, 10.6); EG.setSpellParams('fire', { shots: 1, radius: 0.1 }); let rec = null; EG.on('cast', () => { rec = EG.castInfo(); rec.mul = 2; });
    cast('fire', 0.5, 9.5); until(() => hits.some((x) => x.kind === 'boom'), 240); const b = hits.find((x) => x.kind === 'boom'); ok(b, 'boom hit'); eq(b.cast, rec, 'boom carries the cast');
    ok([80, 144].some((v) => Math.abs(b.amount - v) < 1e-9), '40 x 2 (x1.8 on a critical hit): ' + b.amount);
    fresh(); clean(-20, 20, 6); paint(-24, 16, -16, 24, TER.SOIL); const w2 = cellOf(-19.5, 20.5); TT[w2] = TER.WISP; paintCell(w2); EG.on('hit', onHit); hits.length = 0;
    dummy('lizard', -19.5, 21.6); const g = cellOf(-20.5, 20.5); TT[g] = TER.FIRE; TM[g] = 9; paintCell(g); player.pos.set(-20, 0, 14);
    until(() => hits.some((x) => x.kind === 'boom'), 1200); const b2 = hits.find((x) => x.kind === 'boom'); ok(b2, 'the fire spread to the wisp'); eq(b2.cast, null, 'no record'); ok([40, 72].some((v) => Math.abs(b2.amount - v) < 1e-9), 'x1 (x1.8 on a critical hit): ' + b2.amount);
  });
  test('felled props carry the cast: a tombstone broken by a cast crushes with the factor; a tree set on fire by a cast falls with it', () => {
    fresh(); EG.on('hit', onHit); hits.length = 0; const t = props.find((p) => p.kind === 'tomb' && Math.hypot(p.x, p.z) > 10 && Math.hypot(p.x, p.z) < 30);
    let rec = null; EG.on('cast', () => { rec = EG.castInfo(); rec.mul = 2; });
    player.pos.set(t.x - 6, 0, t.z); camSnap = true; step(2); egCur = { id: 'test', n: 1, mul: 2 }; damageProps(V(t.x - 0.4, t.z), 1, 9, 'fire'); egCur = null;
    eq(t.state, 'falling', 'tomb falls'); const e = dummy('lizard', t.x + t.dir.x * 0.8, t.z + t.dir.z * 0.8); until(() => t.state === 'down', 120);
    const c = hits.find((x) => x.kind === 'crush'); ok(c, 'crushed'); eq(c.cast && c.cast.id, 'test', 'record from the breaking hit'); ok([160, 288].some((v) => Math.abs(c.amount - v) < 1e-9), '80 x 2 (x1.8 on a critical hit): ' + c.amount);
    fresh(); const tr = props.find((p) => p.kind === 'tree'); egCur = { id: 'tree', n: 2, mul: 1.5 }; igniteTree(tr); egCur = null; eq(tr.c.id, 'tree', 'the tree remembers the cast');
    fresh(); eq(tr.state, 'up', 'reset'); igniteTree(tr); eq(tr.c, null, 'a tree that catches fire outside a cast has no record');
  });
  test('meteors, their burning ground, chain hops and blood bolts all carry their cast', () => {
    fresh(); clean(0, 10, 8); paint(-6, 4, 6, 16, TER.SOIL); EG.on('hit', onHit); hits.length = 0;
    const recs = {}; EG.on('cast', (id) => { recs[id] = EG.castInfo(); recs[id].mul = 1.25; });
    for (let k = 0; k < 4; k++) dummy('lizard', -3 + k * 2, 10);
    cast('meteor', 0, 10); step(150); cast('bolt', 0, 10); step(90); cast('blood', 0, 10); step(200);
    const by = (s) => hits.filter((x) => x.source === s);
    for (const [s, id] of [['meteor', 'meteor'], ['meteorBurn', 'meteor'], ['bolt', 'bolt'], ['boltChain', 'bolt'], ['blood', 'blood']]) { const l = by(s); ok(l.length > 0, 'hits from ' + s); ok(l.every((x) => x.cast === recs[id]), s + ' carries the ' + id + ' cast'); }
  });
  test('the record is gone once the cast is processed: a later terrain tick in the same frame is not multiplied', () => {
    fresh(); clean(0, 10, 6); paint(-4, 6, 4, 14, TER.SOIL); paint(2, 9, 3, 10, TER.FIRE); for (let x = 2; x <= 3; x++) for (let z = 9; z <= 10; z++) TM[cellOf(x + 0.5, z + 0.5)] = 99;
    EG.on('hit', onHit); hits.length = 0; EG.on('cast', () => { EG.castInfo().mul = 4; }); dummy('lizard', 3, 10); dummy('lizard', -2, 10);
    cast('fire', -2, 10); step(120); const t = hits.filter((x) => x.kind === 'terrain');
    ok(t.length > 0 && t.every((x) => x.cast === null && x.amount < 12), 'terrain ticks x1: ' + t.map((x) => x.amount.toFixed(1)).join(','));
    eq(egCur, null, 'no record left');
  });
  test('burnt trees start a new run with clean emission timers (resetProps clears p.acc)', () => {
    fresh(); const tr = props.find((p) => p.kind === 'tree'); igniteTree(tr); for (let k = 0; k < 7; k++) updateProps(1 / 60 * 1.37);
    ok(Object.keys(tr.acc).length > 0 && Object.values(tr.acc).some((v) => v > 0), 'fractions left while burning'); resetProps();
    eq(Object.keys(tr.acc).length, 0, 'acc empty after reset'); eq(tr.state, 'up', 'standing again');
  });

  // ---------------------------------------------------------------- terrain elements
  test('ember: soil and ash burn for the ember time and end as ash; paving and craters come back; blood marsh turns to ash; grass and bone burn as fire', () => {
    fresh(); player.pos.set(20, 0, 20); clean(20, 20, 8); paint(16, 16, 24, 24, TER.SOIL);
    const at = [[17, 17, TER.SOIL], [18, 17, TER.ASH], [19, 17, TER.PAVE], [20, 17, TER.CRATER], [21, 17, TER.BLOOD], [22, 17, TER.GRASS], [23, 17, TER.BONE]];
    for (const [x, z, t] of at) paint(x, z, x, z, t); for (const [x, z] of at) EG.terrain.area(x + 0.5, z + 0.5, 0.2, 'ember');
    eq(tile(17.5, 17.5), TER.FIRE, 'soil burns'); eq(tile(19.5, 17.5), TER.FIRE, 'paving burns'); eq(tile(21.5, 17.5), TER.ASH, 'blood marsh to ash'); eq(tile(22.5, 17.5), TER.FIRE, 'grass');
    near(TM[cellOf(17.5, 17.5)], 2, 1e-9, 'ember time'); eq(EG.terrain.cellAt(19.5, 17.5).returnsTo, 'PAVE', 'remembers paving');
    step(150); eq(tile(17.5, 17.5), TER.ASH, 'soil ends as ash'); eq(tile(18.5, 17.5), TER.ASH, 'ash stays ash'); eq(tile(19.5, 17.5), TER.PAVE, 'paving back'); eq(tile(20.5, 17.5), TER.CRATER, 'crater back');
    eq(EG.terrain.cellAt(19.5, 17.5).returnsTo, null, 'forgotten after coming back');
  });
  test('ember on a fire, lava, steam and obsidian: the fire is kept burning, lava lasts 5 s longer, steam clears 1 s sooner, obsidian loses one hit', () => {
    fresh(); player.pos.set(20, 0, 20); paint(16, 16, 24, 24, TER.SOIL); paint(17, 18, 17, 18, TER.FIRE); TM[cellOf(17.5, 18.5)] = 0.5; paint(18, 18, 18, 18, TER.LAVA); TM[cellOf(18.5, 18.5)] = 10;
    paint(19, 18, 19, 18, TER.STEAM); TM[cellOf(19.5, 18.5)] = 2; paint(20, 18, 20, 18, TER.OBSID);
    for (const x of [17, 18, 19, 20]) EG.terrain.area(x + 0.5, 18.5, 0.2, 'ember');
    near(TM[cellOf(17.5, 18.5)], 2, 1e-9, 'fire timer'); near(TM[cellOf(18.5, 18.5)], 15, 1e-9, 'lava'); near(TM[cellOf(19.5, 18.5)], 1, 1e-9, 'steam'); eq(THP[cellOf(20.5, 18.5)], 2, 'obsidian');
  });
  test('an ember fire hurts a monster standing in it like any fire (a terrain kill)', () => {
    fresh(); player.pos.set(20, 0, 20); clean(20, 24, 4); paint(18, 22, 22, 26, TER.PAVE); const e = dummy('spider', 20.5, 24.5, 30); const k0 = terrainKills;
    EG.terrain.area(20.5, 24.5, 1.2, 'ember', 3); until(() => !e.alive, 300); ok(!e.alive, 'dead'); eq(terrainKills, k0 + 1, 'terrain kill');
  });
  test('light: a wisp grave blows after lightDelay (not before), blood marsh dries to soil, other ground is untouched', () => {
    fresh(); player.pos.set(-20, 0, -20); clean(-20, -20, 6); paint(-24, -24, -16, -16, TER.SOIL); paint(-20, -20, -20, -20, TER.WISP); paint(-18, -20, -18, -20, TER.BLOOD); paint(-17, -20, -17, -20, TER.GRASS);
    EG.terrain.area(-19.5, -19.5, 0.2, 'light'); EG.terrain.area(-17.5, -19.5, 0.2, 'light'); EG.terrain.area(-16.5, -19.5, 0.2, 'light');
    eq(tile(-17.5, -19.5), TER.SOIL, 'dried'); eq(tile(-16.5, -19.5), TER.GRASS, 'grass untouched');
    const t0 = time; until(() => tile(-19.5, -19.5) === TER.CRATER, 60); near(time - t0, 0.3, 0.035, 'blew after 0.3 s');
  });
  test('volt: a pool carries current 1.4 s, recharging a charged pool gives 2.8 s; blood marsh carries it and comes back with its own remaining time', () => {
    fresh(); player.pos.set(-20, 0, 20); clean(-20, 20, 8); paint(-26, 14, -14, 26, TER.SOIL); paint(-24, 16, -22, 18, TER.WATER);
    eq(EG.terrain.area(-23.5, 16.5, 0.2, 'volt'), 1, 'one cell hit'); eq(tile(-22.5, 18.5), TER.SHOCK, 'whole pool'); near(TM[cellOf(-22.5, 18.5)], 1.4, 1e-6, '1.4 s');
    EG.terrain.area(-23.5, 16.5, 0.2, 'volt'); near(TM[cellOf(-22.5, 18.5)], 2.8, 1e-6, 'recharge 2.8 s');
    paint(-19, 16, -17, 18, TER.BLOOD); for (let x = -19; x <= -17; x++) for (let z = 16; z <= 18; z++) TM[cellOf(x + 0.5, z + 0.5)] = 5;
    EG.terrain.area(-18.5, 16.5, 0.2, 'volt'); eq(tile(-17.5, 18.5), TER.SHOCK, 'blood carries'); eq(EG.terrain.cellAt(-17.5, 18.5).returnsTo, 'BLOOD', 'remembers blood');
    step(100); eq(tile(-17.5, 18.5), TER.BLOOD, 'blood back'); near(TM[cellOf(-17.5, 18.5)], 5, 0.25, 'with its own time');
    eq(tile(-22.5, 18.5), TER.SHOCK, 'pool still charged at 1.67 s'); step(80); eq(tile(-22.5, 18.5), TER.WATER, 'pool back to water');
  });
  test('volt: steam carries current 0.7 s then is steam again; mud carries only the cell hit; grass catches about 30 %; a monster on charged blood takes 26 per second', () => {
    fresh(); player.pos.set(-20, 0, 20); clean(-20, 20, 8); paint(-26, 14, -14, 26, TER.SOIL); paint(-24, 22, -23, 22, TER.STEAM); for (const x of [-24, -23]) TM[cellOf(x + 0.5, 22.5)] = 3;
    EG.terrain.area(-23.5, 22.5, 0.2, 'volt'); eq(tile(-22.5, 22.5), TER.SHOCK, 'steam carries'); step(70); eq(tile(-22.5, 22.5), TER.STEAM, 'steam again');
    paint(-20, 22, -18, 22, TER.MUD); EG.terrain.area(-19.5, 22.5, 0.2, 'volt'); eq(tile(-19.5, 22.5), TER.SHOCK, 'mud cell'); eq(tile(-18.5, 22.5), TER.MUD, 'neighbour mud untouched'); step(70); eq(tile(-19.5, 22.5), TER.MUD, 'mud back');
    paint(-26, 14, -15, 14, TER.GRASS); EG.seed(11); let n = 0; for (let x = -26; x <= -15; x++) { EG.terrain.area(x + 0.5, 14.5, 0.2, 'volt'); if (tile(x + 0.5, 14.5) === TER.FIRE) n++; } EG.seed(null); ok(n >= 1 && n <= 8, 'some of 12 grass cells caught fire: ' + n);
    paint(-17, 18, -15, 20, TER.BLOOD); const e = dummy('lizard', -16, 19); EG.on('hit', onHit); hits.length = 0; EG.terrain.area(-15.5, 18.5, 0.2, 'volt'); step(60);
    const d = hits.filter((x) => x.target === e && x.kind === 'terrain').reduce((s, x) => s + x.amount, 0); ok(d >= 26 - 7 && d <= 26 + 1 + 4 * 4.8, 'about 26 in one second on charged blood (ticks of 6, critical hits x1.8): ' + d.toFixed(1));
  });
  test('terrainHit reports every element that touches a cell (even with no change) and terrainChange every change, with the cast', () => {
    fresh(); player.pos.set(20, 0, -20); paint(16, -24, 24, -16, TER.SOIL); paint(20, -20, 20, -20, TER.GRASS); const hs = [], cs = [];
    EG.on('terrainHit', (o) => hs.push(o)); EG.on('terrainChange', (o) => cs.push(o)); egCur = { id: 'x', n: 9, mul: 1 };
    EG.terrain.area(20.5, -19.5, 0.2, 'light'); EG.terrain.area(20.5, -19.5, 0.2, 'ember'); egCur = null;
    eq(hs.length, 2, 'two hits'); eq(hs[0].el, 'light', 'light'); eq(hs[0].from, 'GRASS', 'from'); eq(hs[0].to, 'GRASS', 'light leaves grass'); eq(hs[1].to, 'FIRE', 'ember burns it'); eq(hs[1].cast.id, 'x', 'cast');
    const c = cs.find((o) => o.cell === cellOf(20.5, -19.5)); ok(c && c.from === 'GRASS' && c.to === 'FIRE' && c.cast.id === 'x', 'change'); near(c.x, 20.5, 1e-9, 'x');
    cs.length = 0; step(400); ok(cs.some((o) => o.from === 'FIRE' && o.to === 'ASH' && o.cast === null), 'the fire burning out is a change with no cast');
  });

  // ---------------------------------------------------------------- terrain actions
  test('path and ring change the cells along them (width), area a disc; strike burns soil, lights water and sets a tree on fire', () => {
    fresh(); player.pos.set(0, 0, -30); clean(0, -30, 9); paint(-8, -38, 8, -22, TER.GRASS);
    EG.terrain.path([[-6, -36], [6, -36]], 'ember', 1); eq(tile(0, -35.9), TER.FIRE, 'on the path'); eq(tile(0, -34.2), TER.GRASS, 'beyond the width');
    const n = EG.terrain.ring(0, -28, 3, 'ember', 1); ok(n > 15, 'ring cells ' + n); eq(tile(2.9, -27.9), TER.FIRE, 'on the ring'); eq(tile(0, -28), TER.GRASS, 'centre untouched');
    paint(-8, -24, 8, -22, TER.SOIL); paint(-2, -23, -1, -23, TER.WATER); const tr = props.find((p) => p.kind === 'tree'); const keep = [tr.x, tr.z];
    tr.x = 2; tr.z = -23; EG.terrain.strike(0, -23, 2.5); eq(tile(0.5, -23.5), TER.FIRE, 'soil burns'); eq(tile(-1.5, -22.5), TER.SHOCK, 'water carries'); eq(tr.state, 'burning', 'tree'); [tr.x, tr.z] = keep;
  });
  test('sweep: a moving head changes cells near the start first and the far end only when its time is up; it carries the cast', () => {
    fresh(); player.pos.set(0, 0, -30); clean(0, -30, 9); paint(-8, -38, 8, -22, TER.GRASS); egCur = { id: 'sw', n: 3, mul: 1 }; EG.terrain.sweep(-6, -30, 6, -30, 'ember', 1, 0.9, 'fire'); egCur = null;
    const cs = []; EG.on('terrainChange', (o) => cs.push(o)); step(15); eq(tile(-5.5, -29.5), TER.FIRE, 'start'); eq(tile(5.5, -29.5), TER.GRASS, 'end not yet');
    step(50); eq(tile(5.5, -29.5), TER.FIRE, 'end after 1 s'); eq(K.sweeps.length, 0, 'done'); ok(cs.some((o) => o.cast && o.cast.id === 'sw'), 'cast');
  });
  test('fences: current spreads about fenceRange both ways along standing segments, stops at a broken one, hurts a monster against it and glows', () => {
    fresh(); const f = props.filter((p) => p.kind === 'fence'), p0 = f[10]; player.pos.set(p0.x * 0.8, 0, p0.z * 0.8); breakProp(f[13], V(0, 0)); const s0 = f[13].state;
    const n = EG.terrain.fence(p0.x, p0.z, 0.3); eq(s0, 'broken', 'segment 13 broken'); eq(n, 3 + 1 + 2, 'segments 7..12 (stops before 13)'); ok(K.fenceT[7] > 0 && K.fenceT[12] > 0 && !(K.fenceT[6] > 0) && !(K.fenceT[13] > 0), 'range');
    const e = dummy('lizard', p0.x * 0.985, p0.z * 0.985); EG.on('hit', onHit); hits.length = 0; step(30);
    ok(hits.some((x) => x.target === e && x.kind === 'terrain'), 'hurt by the fence'); const gl = scene.children.find((o) => o.userData.egSpellkit === 'fence'); ok(gl && gl.visible, 'glow visible');
    step(60); ok(!(K.fenceT[10] > 0), 'current gone after 1 s'); ok(!gl.visible, 'glow off');
  });

  // ---------------------------------------------------------------- monster states
  test('root keeps a monster in place (it still takes terrain damage); stun stops its attacks but not its walk; both run out in game time; status event', () => {
    fresh(); player.pos.set(0, 0, 0); clean(0, 4, 4); paint(-2, 2, 2, 6, TER.SOIL); paint(2, 4, 2, 4, TER.LAVA); spawnEnemy('lizard', 2.5, 4.5, 1); const e = enemies[enemies.length - 1]; e.hp = e.maxhp = 1e4;
    const evs = []; EG.on('status', (o) => evs.push(o)); EG.on('hit', onHit); hits.length = 0;
    ok(EG.status(e, 'root', 1), 'root'); const x0 = e.pos.x, z0 = e.pos.z; step(30); near(e.pos.x, x0, 1e-9, 'x held'); near(e.pos.z, z0, 1e-9, 'z held');
    ok(hits.some((h) => h.kind === 'terrain'), 'lava still burns'); eq(evs[0].kind, 'root', 'event'); near(EG.statusOf(e).root, 0.5, 0.02, 'half left'); step(80); ok(Math.hypot(e.pos.x - x0, e.pos.z - z0) > 0.3, 'walks after root');
    e.pos.set(0.9, 0, 0); e.T = Object.assign({}, e.T, { dmg: 10 }); const hp0 = player.hp; EG.status(e, 'stun', 1); step(40); eq(player.hp, hp0, 'no attack while stunned');
    ok(!EG.status(e, 'sleep', 1) && !EG.status(null, 'root', 1), 'bad states refused');
    step(90); ok(player.hp < hp0, 'attacks again after the stun');
  });
  test('ground: a floating monster takes ground terrain damage and is crushed by a falling tomb only while grounded, and stands at height 0', () => {
    fresh(); player.pos.set(0, 0, -10); clean(-12, 12, 5); paint(-15, 9, -9, 15, TER.FIRE); for (let x = -15; x <= -9; x++) for (let z = 9; z <= 15; z++) TM[cellOf(x + 0.5, z + 0.5)] = 99;
    const g = dummy('ghost', -12, 12); EG.on('hit', onHit); hits.length = 0; step(40); eq(hits.filter((h) => h.target === g).length, 0, 'floating: no fire damage');
    EG.status(g, 'ground', 2); step(40); ok(hits.some((h) => h.target === g && h.kind === 'terrain'), 'grounded: fire damage'); eq(g.g.position.y, 0, 'on the ground');
    const t = props.find((p) => p.kind === 'tomb'); t.state = 'up'; t.dir = V(1, 0); t.len = 2; const [tx, tz] = [t.x, t.z]; t.x = -13; t.z = 12; hits.length = 0; crush(t);
    ok(hits.some((h) => h.target === g && h.kind === 'crush'), 'crushed while grounded'); EG.status(g, 'ground', 0); g.sk.ground = 0; hits.length = 0; crush(t); eq(hits.filter((h) => h.kind === 'crush').length, 0, 'not when floating'); t.x = tx; t.z = tz;
  });

  // ---------------------------------------------------------------- fireball parameters
  test('pierce: the fireball passes through monsters (one pass event each) and blows up at the end of its flight', () => {
    fresh(); clean(0, 8, 8); paint(-4, 2, 4, 16, TER.SOIL); EG.setSpellParams('fire', { shots: 1, pierce: true, toAim: true }); const a = dummy('lizard', 0, 4), b = dummy('lizard', 0, 7);
    const ev = []; EG.on('spell', (o) => ev.push(o)); cast('fire', 0, 12); until(() => ev.some((o) => o.type === 'explode'), 200);
    eq(ev.filter((o) => o.type === 'pass').length, 2, 'two passes'); const x = ev.find((o) => o.type === 'explode'); near(x.z, 12, 1.2, 'exploded at the aim, not at the first monster or the end of its flight');
  });
  test('toAim and maxRange: the fireball blows up at the aim point, never farther than maxRange', () => {
    fresh(); clean(0, 8, 9); EG.setSpellParams('fire', { shots: 1, toAim: true, maxRange: 6 }); const ev = []; EG.on('spell', (o) => ev.push(o));
    cast('fire', 0, 12); until(() => ev.some((o) => o.type === 'explode'), 200); const x = ev.find((o) => o.type === 'explode'); near(Math.hypot(x.x - player.pos.x, x.z - player.pos.z), 6.6, 0.6, 'about 6 m from the hand');
  });
  test('reflect: a fireball entering water turns back once (reflect event) and keeps flying', () => {
    fresh(); clean(0, 6, 8); paint(-5, 0, 5, 14, TER.SOIL); paint(-5, 7, 5, 9, TER.WATER); EG.setSpellParams('fire', { shots: 1, reflect: 1, life: 2 }); const ev = []; EG.on('spell', (o) => ev.push(o));
    cast('fire', 0, 12); until(() => ev.some((o) => o.type === 'explode'), 300); const r = ev.filter((o) => o.type === 'reflect'); eq(r.length, 1, 'one reflection');
    const x = ev.find((o) => o.type === 'explode'); ok(x.z < 6.5, 'came back: ' + x.z.toFixed(2)); ok(tile(0.5, 7.5) === TER.WATER, 'the water itself is untouched by the bounce');
  });
  test('seed: the fireball lands at the aim and waits; it blows when a monster walks within seedRadius, or when the wait runs out', () => {
    fresh(); clean(0, 8, 8); paint(-4, 2, 4, 16, TER.SOIL); EG.setSpellParams('fire', { shots: 1, seed: 1.5 }); const ev = []; EG.on('spell', (o) => ev.push(o));
    cast('fire', 0, 9); until(() => ev.some((o) => o.type === 'seed'), 200); ok(K.skProjs[0] && K.skProjs[0].sk.seeded, 'seeded'); step(30); ok(!ev.some((o) => o.type === 'explode'), 'still waiting');
    const e = dummy('spider', 3, 9); step(5); ok(!ev.some((o) => o.type === 'explode'), 'monster too far'); e.pos.set(1, 0, 9.2); step(2); const x = ev.find((o) => o.type === 'explode'); ok(x && x.seed, 'blew when the monster came near');
    ev.length = 0; cds.fire = 0; e.alive = false; cast('fire', 0, 9); until(() => ev.some((o) => o.type === 'seed'), 200); const t0 = time; until(() => ev.some((o) => o.type === 'explode'), 200); near(time - t0, 1.5, 0.05, 'time ran out');
  });
  test('trail light: wisp graves under the flight path blow 0.3 s later and blood marsh dries; elem volt: the blast conducts water instead of steaming it', () => {
    fresh(); clean(0, 8, 8); paint(-4, 2, 4, 16, TER.SOIL); paint(0, 5, 0, 5, TER.WISP); paint(-1, 6, 1, 6, TER.BLOOD); EG.setSpellParams('fire', { shots: 1, trail: 'light', toAim: true });
    cast('fire', 0.5, 12); step(20); eq(tile(0.5, 6.5), TER.SOIL, 'dried'); until(() => tile(0.5, 5.5) === TER.CRATER, 60); eq(tile(0.5, 5.5), TER.CRATER, 'wisp blew');
    fresh(); clean(0, 8, 8); paint(-4, 2, 4, 16, TER.SOIL); paint(-2, 9, 2, 11, TER.WATER); EG.setSpellParams('fire', { shots: 1, elem: 'volt', toAim: true }); cast('fire', 0, 10); step(40);
    eq(tile(0.5, 10.5), TER.SHOCK, 'conducts'); ok(![...Array(5)].some((_, k) => tile(-1.5 + k, 9.5) === TER.STEAM), 'no steam');
  });
  test('sweeps: the blast sends three sweeping fires that turn soil into ember along about sweepLength in sweepTime', () => {
    fresh(); clean(0, 9, 9); paint(-8, 2, 8, 18, TER.SOIL); EG.setSpellParams('fire', { shots: 1, toAim: true, sweeps: 3, sweepLength: 3, sweepTime: 0.6 }); const ev = []; EG.on('spell', (o) => ev.push(o));
    cast('fire', 0, 8); until(() => ev.some((o) => o.type === 'explode'), 200); const x = ev.find((o) => o.type === 'explode'); eq(K.sweeps.length, 3, 'three sweeps');
    step(45); eq(K.sweeps.length, 0, 'done'); const ahead = tile(x.x, x.z + 2.6); ok(ahead === TER.FIRE || ahead === TER.ASH, 'ground ahead burnt: ' + TNAME(ahead));
  });

  // ---------------------------------------------------------------- bolt parameters
  test('fromSky: no orb; a warning ring at the aim; after the delay the nearest monster within pickRadius is struck and the chain goes on', () => {
    fresh(); clean(0, 10, 8); paint(-6, 4, 6, 16, TER.SOIL); EG.setSpellParams('bolt', { fromSky: 0.25 }); const a = dummy('lizard', 1, 10), b = dummy('lizard', 4, 10); EG.on('hit', onHit); hits.length = 0;
    const ev = []; EG.on('spell', (o) => ev.push(o)); cast('bolt', 0, 10); eq(projs.filter((p) => p.kind === 'bolt').length, 0, 'no orb'); ok(scene.children.some((o) => o.userData.egSpellkit === 'warn'), 'warning ring');
    const t0 = time; until(() => ev.some((o) => o.type === 'strike'), 120); near(time - t0, 0.25, 0.04, 'delay'); eq(ev.find((o) => o.type === 'strike').target, a, 'nearest');
    step(20); ok(hits.some((h) => h.target === a && h.source === 'bolt'), 'struck'); ok(hits.some((h) => h.target === b && h.source === 'boltChain'), 'chain went on'); ok(!scene.children.some((o) => o.userData.egSpellkit === 'warn'), 'ring removed');
  });
  test('waterNet: from a monster in water the chain reaches a monster on the same water far beyond range; without it, it does not', () => {
    for (const net of [true, false]) {
      fresh(); clean(0, 20, 14); paint(-14, 14, 14, 26, TER.SOIL); paint(-12, 19, 12, 21, TER.WATER); EG.setSpellParams('bolt', { waterNet: net }); const a = dummy('lizard', -10, 20), b = dummy('lizard', 10, 20);
      EG.on('hit', onHit); hits.length = 0; egCur = { id: 'w', n: 1, mul: 1 }; chain(a, new Set([a]), 3, 10); egCur = null; step(20);
      eq(hits.some((h) => h.target === b), net, 'far monster reached: ' + net); }
  });
  test('hopElem, path and hopDelay 0: hops apply their element, lay a path between monsters and happen at once', () => {
    fresh(); clean(0, 20, 10); paint(-10, 14, 10, 26, TER.GRASS); EG.setSpellParams('bolt', { hopElem: 'light', path: 'ember', hopDelay: 0 }); const a = dummy('lizard', -4, 20), b = dummy('lizard', 2, 20);
    paint(2, 20, 2, 20, TER.BLOOD); EG.on('hit', onHit); hits.length = 0; chain(a, new Set([a]), 3, 10);
    ok(hits.some((h) => h.target === b), 'hop happened without game time'); eq(tile(2.5, 20.5), TER.SOIL, 'light dried the blood under the target'); eq(tile(-1, 20.2), TER.FIRE, 'path between them burns');
  });

  // ---------------------------------------------------------------- meteor parameters
  test('line: drops fall along the aim line from lineStart every lineGap, in order; land events count them and mark the last', () => {
    fresh(); player.pos.set(0, 0, -20); camSnap = true; step(2); clean(0, -10, 10); paint(-6, -18, 6, 0, TER.SOIL); EG.setSpellParams('meteor', { pattern: 'line', drops: 6 });
    const ev = []; EG.on('spell', (o) => o.type === 'land' && ev.push(o)); cast('meteor', 0, -5); until(() => ev.length === 6, 300);
    ev.forEach((o, i) => { near(o.x, 0, 0.05, 'x'); near(o.z, -20 + 3 + i * 1.6, 0.05, 'z of drop ' + i); eq(o.index, i, 'index'); eq(o.count, 6, 'count'); });
    eq(ev[5].last, true, 'last'); eq(ev[4].last, false, 'not last'); near(ev[0].aim.z, -5, 0.6, 'aim reported');
  });
  test('ring: drops fall on a circle of ringRadius around the aim; elem volt: a drop in water conducts the pool instead of steaming it', () => {
    fresh(); clean(0, 10, 10); paint(-8, 2, 8, 18, TER.SOIL); paint(-2, 6, 2, 7, TER.WATER); EG.setSpellParams('meteor', { pattern: 'ring', ringRadius: 3.5, elem: 'volt' });
    const ev = []; EG.on('spell', (o) => o.type === 'land' && ev.push(o)); cast('meteor', 0, 10); until(() => ev.length === 10, 300);
    ok(ev.every((o) => Math.abs(Math.hypot(o.x - 0, o.z - 10) - 3.5) < 0.6), 'on the circle'); ok([...Array(5)].some((_, k) => tile(-1.5 + k, 6.5) === TER.SHOCK || tile(-1.5 + k, 7.5) === TER.SHOCK), 'water conducted');
  });
  test('quench: lava next to water turns into obsidian at once and the water into steam; plow: craters beyond the last drop', () => {
    fresh(); player.pos.set(0, 0, -20); clean(0, -10, 12); paint(-6, -20, 6, 4, TER.SOIL); paint(-3, -13, 3, -12, TER.WATER); EG.setSpellParams('meteor', { pattern: 'line', drops: 4, quench: true, plow: 4 });
    const ev = []; EG.on('spell', (o) => o.type === 'land' && ev.push(o)); cast('meteor', 0, 0); until(() => ev.length === 4, 300);
    let obs = 0, steam = 0; for (let x = -3; x <= 3; x++) for (let z = -15; z <= -10; z++) { if (tile(x + 0.5, z + 0.5) === TER.OBSID) obs++; if (tile(x + 0.5, z + 0.5) === TER.STEAM) steam++; }
    ok(obs >= 1 && steam >= 1, 'obsidian ' + obs + ', steam ' + steam); const last = ev[3]; let cr = 0; for (let d = 2; d <= 4; d++) if (tile(last.x, last.z + d) === TER.CRATER || tile(last.x, last.z + d) === TER.LAVA) cr++; ok(cr >= 2, 'furrow ahead: ' + cr);
  });
  test('arcBolt: an arc on the ground between consecutive drops conducts water lying between them', () => {
    fresh(); player.pos.set(0, 0, -20); clean(0, -14, 8); paint(-4, -20, 4, -6, TER.SOIL); EG.setSpellParams('meteor', { pattern: 'line', drops: 2, lineGap: 6, arcBolt: 0.3 }); paint(-1, -15, 1, -14, TER.WATER);
    const ev = []; EG.on('spell', (o) => ev.push(o)); cast('meteor', 0, 0); until(() => ev.filter((o) => o.type === 'land').length === 2, 300);
    ok(ev.some((o) => o.type === 'arc'), 'arc event'); ok(tile(0.5, -14.5) === TER.SHOCK || tile(0.5, -13.5) === TER.SHOCK, 'water between the drops conducts');
  });

  // ---------------------------------------------------------------- blood rite parameters
  test('focus: all eight bolts go to the monster nearest the aim; when it dies they turn to the nearest one left', () => {
    fresh(); clean(0, 8, 8); paint(-6, 2, 6, 14, TER.SOIL); EG.setSpellParams('blood', { focus: true }); const a = dummy('lizard', 3, 9, 60), b = dummy('lizard', -3, 9), c = dummy('spider', 0, 2.5);
    EG.on('hit', onHit); hits.length = 0; cast('blood', 3, 9); step(240); const bl = hits.filter((h) => h.source === 'blood');
    ok(bl.length >= 7, 'bolts landed: ' + bl.length); eq(bl[0].target, a, 'first on the aimed monster'); ok(!a.alive, 'it died'); ok(bl.every((h) => h.target !== c), 'never the one by the player'); ok(bl.some((h) => h.target === b), 'the rest turned to the next nearest');
  });
  test('crawl and crawlElem: bolts run along the ground at the crawl speed and conduct the water they cross; elem ember: they leave fire where they land', () => {
    fresh(); clean(0, 8, 8); paint(-6, 2, 6, 14, TER.SOIL); paint(-6, 5, 6, 5, TER.WATER); EG.setSpellParams('blood', { crawl: 12, crawlElem: 'volt', elem: 'ember' }); const a = dummy('lizard', 0, 10);
    cast('blood', 0, 10); let low = true, seen = false; for (let k = 0; k < 160; k++) { step(1); for (const o of rites) for (const b of o.bolts) if (b.state === 1 && !b.dead) { seen = true; if (b.pos.y > 0.4) low = false; } }
    ok(seen && low, 'crawling low'); ok([...Array(9)].some((_, k) => tile(-4.5 + k, 5.5) === TER.SHOCK) || EG.terrain.cellAt(0.5, 5.5).type !== 'WATER', 'water crossed was charged');
    ok([...Array(3)].some((_, k) => tile(-1 + k, 10.2) === TER.FIRE), 'ember where they landed');
  });
  test('fireWall: a ring of ember fire around the caster at fireWall radius lasting the rite duration; wall event', () => {
    fresh(); clean(0, 0, 5); paint(-5, -5, 5, 5, TER.SOIL); EG.setSpellParams('blood', { fireWall: 1.7 }); const ev = []; EG.on('spell', (o) => ev.push(o)); cast('blood', 0, 6);
    ok(ev.some((o) => o.type === 'wall' && o.radius === 1.7), 'event'); eq(tile(1.7, 0.1), TER.FIRE, 'on the ring'); eq(tile(0.2, 0.2), TER.SOIL, 'not under the caster'); near(TM[cellOf(1.7, 0.1)], 2.4, 0.05, 'duration');
  });

  // ---------------------------------------------------------------- glow, skill bar, assists, chain tone, validation
  test('glow: a tombstone gets an additive copy that fades over secs and is removed; reduced flashing dims it to 30 %; not a prop -> false', () => {
    fresh(); const t = props.find((p) => p.kind === 'tomb'); ok(EG.glow(t, { color: '#ffffff', strength: 1, secs: 0.5 }), 'glow');
    const g = K.glows.get(t); ok(g && scene.children.includes(g.m), 'copy in the scene'); step(1); const o1 = g.mat.opacity; EG.reduceFlashing(true); step(1); near(g.mat.opacity, o1 * 0.3, 0.05, 'dimmed'); EG.reduceFlashing(false);
    step(40); ok(!K.glows.has(t) && !scene.children.includes(g.m), 'removed'); ok(!EG.glow({}, {}), 'not a prop');
    const f = props.find((p) => p.kind === 'fence'); ok(EG.glow(f, { color: '#ff8040', secs: 0.4 }), 'fence glow'); step(1); ok(scene.children.find((o) => o.userData.egSpellkit === 'fence').visible, 'fence glow on');
  });
  test('skill bar: names, labels and icons from CONTENT.spellkit.skills; setSkill changes them, null restores; the engine relabel keeps the label', () => {
    fresh(); const t = (id, s) => document.querySelector(`.sk[data-s="${id}"] ${s}`);
    eq(t('fire', '.n').textContent, C.skills.fire.name, 'name'); eq(t('fire', '.m').textContent, C.skills.fire.label, 'label'); ok(t('fire', 'img.egIcon'), 'icon'); eq(t('meteor', '.m').textContent, '一排', 'meteor label');
    refreshSkillLabels(); eq(t('fire', '.m').textContent, C.skills.fire.label, 'label kept after refresh');
    ok(EG.setSkill('bolt', { name: '光鏈', icon: C.skills.fire.icon }), 'set'); eq(t('bolt', '.n').textContent, '光鏈', 'bolt name'); ok(t('bolt', 'img.egIcon'), 'bolt icon');
    ok(EG.setSkill('bolt', { name: null, icon: null }), 'restore'); eq(t('bolt', '.n').textContent, '鏈雷', 'engine name back'); ok(!t('bolt', 'img.egIcon'), 'icon gone');
    ok(!EG.setSkill('bolt', { colour: 'red' }), 'unknown key'); ok(!EG.setSkill('nova', {}), 'unknown spell');
  });
  test('terrain assist: a monster hurt by terrain and finished by a spell counts once; terrain kills keep their meaning; the result screen shows the act count', () => {
    fresh(); clean(0, 8, 6); paint(-4, 4, 4, 12, TER.SOIL); const a0 = EG.terrainAssists(), k0 = terrainKills; const e = dummy('spider', 0, 8, 40);
    dealDamage(e, 10, 'terrain'); eq(terrainKills, k0, 'no kill yet'); dealDamage(e, 100, 'fire', 'fire'); eq(EG.terrainAssists(), a0 + 1, 'assist'); eq(terrainKills, k0, 'not a terrain kill');
    const f = dummy('spider', 1, 8, 40); dealDamage(f, 100, 'fire'); eq(EG.terrainAssists(), a0 + 1, 'no terrain before: no assist');
    const g = dummy('spider', 2, 8, 40); dealDamage(g, 10, 'fire'); dealDamage(g, 100, 'terrain'); eq(EG.terrainAssists(), a0 + 1, 'a terrain kill is not an assist'); eq(terrainKills, k0 + 1, 'terrain kill');
    Object.assign(story, { on: true, act: 0, actT0: time, actKills0: player.kills, actTk0: terrainKills, actLoot0: pickups, bestChain: 0 }); K.state.act0 = EG.terrainAssists() - 2;
    showResult(0, null); const rows = [...document.querySelectorAll('#rTab tr')].map((r) => r.textContent); const i = rows.findIndex((r) => r.startsWith('地形助攻'));
    ok(i === 3, 'row right after the terrain kills: ' + rows.join('|')); ok(rows[i].includes('2 隻'), 'act count'); closeResult(); story.on = false;
  });
  test('chain tone from CONTENT.spellkit.chainTone: the same pitch on every step (rise 1) and quieter steps (fade)', () => {
    const calls = silent(() => { for (let n = 2; n <= 5; n++) egChainTone(n); });
    eq(calls.length, 4, 'four tones'); ok(calls.every((c) => c[0] === 330 && c[1] === 330 && c[3] === 'sine'), 'same pitch, sine'); near(calls[0][4], 0.1, 1e-9, 'first volume'); near(calls[3][4], 0.1 * 0.8 ** 3, 1e-9, 'fade');
  });
  test('the engine plays the chain tone through egChainTone: two terrain kills within 1.2 s play the pack tone once', () => {
    fresh(); clean(0, 8, 6); const a = dummy('spider', 0, 8, 5), b = dummy('spider', 1, 8, 5);
    const calls = silent(() => { dealDamage(a, 50, 'terrain'); dealDamage(b, 50, 'terrain'); }); const t = calls.filter((c) => c[0] === 330);
    eq(t.length, 1, 'one chain tone (the second kill makes the chain x2)'); eq(chainN, 2, 'chain 2');
  });
  test('validation names the field: bad numbers, tone, assist and skill values are problems; unknown keys and spells only warn; true is valid', () => {
    const v = K.validate, has = (p, s) => p.some((x) => x.includes(s));
    eq(v(C).length, 0, 'the fixture is valid'); eq(v({}).length, 0, 'empty'); eq(v(true).length, 0, 'true');
    ok(has(v({ ember: 0 }), 'CONTENT.spellkit.ember'), 'ember'); ok(has(v({ volt: { blood: -1 } }), 'CONTENT.spellkit.volt.blood'), 'volt'); ok(has(v({ chainTone: { wave: 'saw' } }), 'CONTENT.spellkit.chainTone.wave'), 'wave');
    ok(has(v({ chainTone: { max: 1.5 } }), 'CONTENT.spellkit.chainTone.max'), 'max'); ok(has(v({ assist: 'yes' }), 'CONTENT.spellkit.assist'), 'assist'); ok(has(v({ skills: { fire: { name: 3 } } }), 'CONTENT.spellkit.skills.fire.name'), 'name');
    ok(has(v(5), 'CONTENT.spellkit'), 'not an object'); eq(v({ chainTone: false }).length, 0, 'tone off');
    const w0 = (window.__contentWarnings || []).length; eq(v({ glare: 1, skills: { nova: {} } }).length, 0, 'unknown key and spell not problems'); ok((window.__contentWarnings || []).length >= w0 + 2, 'but warn');
  });
  test('clearEffects empties the module: special projectiles, sweeps, strikes, glows, fence current and monster states', () => {
    fresh(); EG.setSpellParams('fire', { shots: 1, seed: 3 }); EG.setSpellParams('bolt', { fromSky: 1 }); clean(0, 8, 6); cast('fire', 0, 8); cast('bolt', 0, 8); EG.terrain.sweep(0, 0, 5, 5, 'ember', 3);
    const f = props.find((p) => p.kind === 'fence'); EG.terrain.fence(f.x, f.z, 0.3); EG.glow(props.find((p) => p.kind === 'tomb'), { secs: 3 }); const e = dummy('lizard', 3, 3); EG.status(e, 'root', 5); step(20);
    ok(K.skProjs.length && K.strikes.length && K.sweeps.length && K.glows.size && K.fenceT.some((x) => x > 0), 'all present');
    EG.clearEffects(); ok(!K.skProjs.length && !K.strikes.length && !K.sweeps.length && !K.glows.size && !K.fenceT.some((x) => x > 0), 'all gone'); eq(EG.statusOf(e).root, 0, 'state cleared');
    ok(!scene.children.some((o) => o.userData.egSpellkit === 'warn' || o.userData.egSpellkit === 'glow'), 'meshes removed');
  });
  test('the module per-frame work draws no random numbers while nothing special is happening', () => {
    fresh(); const real = Math.random; let n = 0; Math.random = () => { n++; return real(); };
    try { for (let k = 0; k < 60; k++) K.debug.tick(1 / 60); } finally { Math.random = real; }
    eq(n, 0, 'random calls');
  });

  const TNAME = (t) => Object.keys(TER).find((k) => TER[k] === t);
  for (const [name, fn] of tests) {
    try { await fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, err: String(e && e.stack || e).split('\n').slice(0, 3).join(' | ') }); }
  }
  try { fresh(); } catch (e) {}
  return results;
};
