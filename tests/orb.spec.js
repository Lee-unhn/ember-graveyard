// The orb flipbook (kit/sprites.js) on a page that also runs the terrain actions and spell extensions (kit/spellkit.js), DEVLOG #150.
// kit/spellkit.js may take the engine's new orb out of projs (bolt.hitElem other than 'bolt') or create none (bolt.fromSky), and the two
// modules are fetched on demand, so either one can sit on top of spawnOrb. tests/unit.mjs runs this file on two pages, one per order.
// Game time is advanced by calling the engine's own logic()/visuals(); nothing waits on wall-clock time.
//   __runOrb('spritesOnTop')    kit/sprites.js loaded after kit/spellkit.js
//   __runOrb('spellkitOnTop')   kit/spellkit.js loaded after kit/sprites.js
window.__runOrb = async () => {
  const tests = [], results = [];
  const test = (name, fn) => tests.push([name, fn]);
  class AssertError extends Error {}
  const ok = (c, m) => { if (!c) throw new AssertError(m || 'expected truthy'); };
  const eq = (a, b, m) => { if (a !== b) throw new AssertError(`${m || 'eq'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
  const near = (a, b, tol, m) => { if (!(Math.abs(a - b) <= tol)) throw new AssertError(`${m || 'near'}: expected ${b}±${tol}, got ${a}`); };
  // the same object (projectiles hold circular links, so eq's JSON message cannot print them): name what was found instead
  const same = (a, b, m) => { if (a !== b) throw new AssertError(`${m}: expected that ${b && b.kind} projectile, got ${a ? 'another ' + a.kind + ' projectile' : String(a)}`); };
  const S = EGSprites, K = EGSpellkit, V = (x, z) => new THREE.Vector3(x, 0, z);
  const step = (n, dt = 1 / 60) => { for (let k = 0; k < n; k++) { time += dt; shared.uTime.value = time; logic(dt); visuals(dt); } };
  const until = (f, max = 600) => { for (let k = 0; k < max; k++) { if (f()) return k; step(1); } return f() ? max : -1; };
  const fresh = () => {
    while (dlg) endDialog();
    for (const k in keys) keys[k] = false; lmb = false;
    clearWorld(); resetTerrain(); running = true; paused = false;
    Object.assign(story, { on: false, phase: 'idle', act: 0, unlocked: new Set(['fire', 'bolt', 'meteor', 'blood']), tier: { fire: 1 }, seen: new Set(), boss: null });
    player.pos.set(0, 0, 0); player.maxhp = player.hp = 1e6; player.alive = true; player.cast = null; player.face = 0; player.float = 0;
    for (const k in cds) cds[k] = 0; for (const id of MENUS) document.querySelector('#' + id).hidden = true; syncMenu();
    EG.resetSpellParams(); EG.seed(null); EG.clearEffects(); camSnap = true; step(2);
  };
  const orbFx = () => S.fxList.filter((f) => f.key === 'orb');
  // a fireball flying away from the bolt (towards -z, no monster there): projs' last entry is then not the orb
  const decoy = () => { spawnFireball(new THREE.Vector3(0, 1, -1), new THREE.Vector3(0, 0, -1)); const f = projs[projs.length - 1]; eq(f.kind, 'fire', 'decoy fireball in projs'); return f; };
  // release a bolt towards (0, 8) through the engine's own release, the way a finished cast does
  const release = () => releaseCast({ id: 'bolt', target: V(0, 8), k: { id: 'bolt', n: 0, mul: 1 } });
  const ownPush = () => Object.prototype.hasOwnProperty.call(projs, 'push');

  test('the module stack: both modules on, spawnOrb replaced by both', () => {
    ok(S.state.ready && K.state.on, 'both on'); ok(S.fxCfg.orb && !S.fxCfg.orb.particles, 'orb flipbook replaces the particle core');
    ok(K.state.wraps.includes('spawnOrb'), 'spellkit wrapped spawnOrb');
  });
  test('hitElem light: the flipbook follows the orb spellkit took over (not projs\' last entry, which is a fireball), rides on it and ends with it', () => {
    fresh(); EG.setSpellParams('bolt', { hitElem: 'light' }); const f = decoy(); release();
    const orbs = K.skProjs.filter((p) => p.kind === 'bolt'); eq(orbs.length, 1, 'one orb taken over by spellkit'); const o = orbs[0];
    ok(!projs.includes(o), 'the orb left projs'); same(projs[projs.length - 1], f, 'projs\' last entry is the fireball');
    const fx = orbFx(); eq(fx.length, 1, 'one orb flipbook'); same(fx[0].follow, o, 'it follows the orb that flies'); ok(!S.fxList.some((x) => x.key === 'orb' && x.follow === f), 'not on the fireball');
    ok(!ownPush(), 'projs.push given back'); step(10); near(fx[0].m.position.distanceTo(o.pos), 0, 1e-9, 'flipbook rides on the orb');
    ok(o.pos.z > 1.5, 'the orb flew forward: z ' + o.pos.z.toFixed(2));
    ok(until(() => o.dead, 200) >= 0, 'the orb lands'); step(1); eq(orbFx().length, 0, 'its flipbook is released');
  });
  test('hitElem light without anything else in projs: no error, the flipbook is on the orb', () => {
    fresh(); EG.setSpellParams('bolt', { hitElem: 'light' }); release(); eq(projs.length, 0, 'projs empty');
    const o = K.skProjs.find((p) => p.kind === 'bolt'); ok(o, 'orb in spellkit'); eq(orbFx().length, 1, 'one orb flipbook'); same(orbFx()[0].follow, o, 'on the orb');
    step(20); ok(until(() => o.dead, 200) >= 0, 'lands'); step(1); eq(orbFx().length, 0, 'released');
  });
  test('fromSky: no orb, so no orb flipbook at all (none on the fireball either); the strike still comes', () => {
    fresh(); EG.setSpellParams('bolt', { fromSky: 0.25 }); const f = decoy(); const ev = [], L = (o) => ev.push(o); EG.on('spell', L); release();
    eq(projs.filter((p) => p.kind === 'bolt').length + K.skProjs.filter((p) => p.kind === 'bolt').length, 0, 'no orb');
    eq(orbFx().length, 0, 'no orb flipbook'); eq(S.fxList.filter((x) => x.follow === f).length, 1, 'the fireball carries only its own flipbook'); ok(!ownPush(), 'projs.push given back');
    try { ok(until(() => ev.some((o) => o.type === 'strike'), 120) >= 0, 'the strike comes'); step(5); eq(orbFx().length, 0, 'still no orb flipbook'); } finally { EG.off('spell', L); }
  });
  test('fromSky with projs empty: no orb flipbook and no error', () => {
    fresh(); EG.setSpellParams('bolt', { fromSky: 0.25 }); release(); eq(orbFx().length, 0, 'none'); step(30); eq(orbFx().length, 0, 'none later');
  });
  test('a plain orb (no new parameter) is unchanged: it stays in projs, flies, carries the flipbook and no particle core, and lands', () => {
    fresh(); const f = decoy(); release(); const o = projs.find((p) => p.kind === 'bolt'); ok(o, 'the orb is in projs'); eq(K.skProjs.length, 0, 'spellkit took nothing');
    const fx = orbFx(); eq(fx.length, 1, 'one orb flipbook'); same(fx[0].follow, o, 'on the orb'); ok(!S.fxList.some((x) => x.key === 'orb' && x.follow === f), 'not on the fireball');
    eq(ADD.list.filter((q) => q.follow === o).length, 0, 'no particle core follows the orb'); ok(o.light, 'the orb still has its light'); ok(!ownPush(), 'projs.push given back');
    near(o.vel.length(), 13, 1e-9, 'engine speed'); step(10); near(fx[0].m.position.distanceTo(o.pos), 0, 1e-9, 'rides on it');
    ok(until(() => o.dead, 200) >= 0, 'lands'); step(1); eq(orbFx().length, 0, 'released');
  });
  test('the bolt keeps working through the real cast (tryCast) with each setting', () => {
    for (const p of [{}, { hitElem: 'light' }, { fromSky: 0.2 }]) {
      fresh(); EG.setSpellParams('bolt', p); const v = V(0, 8).project(camera); mouse.set(v.x, v.y); tryCast('bolt'); ok(player.cast && player.cast.id === 'bolt', 'cast started ' + JSON.stringify(p));
      const c = player.cast; until(() => c.released, 200); eq(orbFx().length, p.fromSky ? 0 : 1, 'orb flipbooks ' + JSON.stringify(p)); step(120); eq(orbFx().length, 0, 'all released ' + JSON.stringify(p));
    }
  });

  for (const [name, fn] of tests) {
    try { await fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, err: String(e && e.stack || e).split('\n').slice(0, 3).join(' | ') }); }
  }
  try { fresh(); } catch (e) {}
  return results;
};
