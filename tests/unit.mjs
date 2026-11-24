#!/usr/bin/env node
// Unit tests: load the game headlessly, inject tests/unit.spec.js, run each test against the page's own functions.
// Then the optional pixel-sprite module (kit/sprites.js): inert on the demo page, and tests/sprites.spec.js on two pages that
// received the test atlases (tests/lib/sprite-fixture.js), one of them with the whole screen in low resolution.
// Then the optional night-look module (kit/look.js): inert on the demo page, and tests/look.spec.js on a page with the test
// CONTENT.look and atlases (tests/lib/look-fixture.js) and on one with only a moved tower flame.
// Then the optional terrain actions and spell extensions (kit/spellkit.js): inert on the demo page, the same fight with and without
// the module when no new parameter is set, and tests/spellkit.spec.js on a page with the test CONTENT.spellkit.
//   node tests/unit.mjs [--url=https://...] [--sprites-only] [--look-only] [--spellkit-only]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, serve, openPage, reporter, spriteInit, lookInit, spellkitInit } from './lib/browser.mjs';

const live = (process.argv.find((a) => a.startsWith('--url=')) || '').slice(6);
const spritesOnly = process.argv.includes('--sprites-only'), lookOnly = process.argv.includes('--look-only'), kitOnly = process.argv.includes('--spellkit-only');
const rep = reporter('unit');
const srv = live ? null : await serve();
const url = live || `http://127.0.0.1:${srv.address().port}/index.html`;
// what the demo page shows, as a hash of one fixed frame (no post effects, mist off, a fixed camera)
const FRAME = `(() => { EGMist.state.on = false; running = false; time = 12.5; camera.position.set(9, 14, 13); camera.lookAt(0, 0, 0); renderer.setRenderTarget(null); renderer.render(scene, camera);
  const c = document.createElement('canvas'); c.width = 320; c.height = 200; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(renderer.domElement, 0, 0, 320, 200);
  const d = g.getImageData(0, 0, 320, 200).data; let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) >>> 0; return h; })()`;

if (!spritesOnly && !lookOnly && !kitOnly) {
  const page = await openPage(url);
  try {
    rep.ok(await page.waitFor(`typeof atlas !== 'undefined' && !!atlas && !document.querySelector('#go').disabled`), 'page booted and atlas built');
    await page.evaluate(readFileSync(join(ROOT, 'tests', 'unit.spec.js'), 'utf8'));
    const results = await page.evaluate('window.__runUnit()');
    for (const r of results) rep.ok(r.ok, r.name, r.err);
    rep.ok(results.length >= 30, `suite size ${results.length} >= 30`);
    rep.ok(page.errors.length === 0, 'no uncaught page errors during unit run', page.errors.slice(0, 3));
    // determinism across loads: a second page must place every tombstone, tree and sarcophagus at the same spot.
    // Pages are opened one after another: two headless Chromes at once left the second stuck loading three.js.
    const sigExpr = `props.filter(p => p.kind !== 'fence').map(p => p.x.toFixed(3) + ',' + p.z.toFixed(3)).join(';')`;
    const a = await page.evaluate(sigExpr);
    await page.close();
    const page2 = await openPage(url);
    try { const ready = await page2.waitFor(`typeof props !== 'undefined' && props.length > 0`);
      rep.ok(ready && a === await page2.evaluate(sigExpr), 'a second page load places every prop at the same spot (fixed seed)'); }
    finally { await page2.close(); }
  } catch (e) { rep.ok(false, 'unit runner crashed', e.message); await page.close(); }
}

// ---------------------------------------------------------------- pixel sprites
if (!live && !lookOnly && !kitOnly) {
  // 1. the demo page: kit/sprites.js is never requested, and loading it by hand without CONTENT.sprites changes nothing
  const p = await openPage(url);
  try {
    await p.waitFor(`!document.querySelector('#go').disabled && window.EGChar && (EGChar.state.ready || EGChar.state.failed)`, 60000); // the skinned mage arrives later and would change the frame
    rep.ok(await p.evaluate(`!window.EGSprites && ![...document.scripts].some(s => /sprites\\.js/.test(s.src)) && !performance.getEntriesByType('resource').some(r => /sprites\\.js/.test(r.name))`), 'sprites: the demo page (no CONTENT.sprites) never loads kit/sprites.js');
    await p.evaluate(`requestAnimationFrame = () => 0; new Promise((ok) => setTimeout(ok, 300))`); // stop the page's own loop: only the probe draws from now on
    const before = await p.evaluate(`(() => { window.__fn = [visuals, EGPost.render, explode, dealDamage, clearWorld, EG.clearEffects, ADD.emit]; return ${FRAME}; })()`);
    await p.evaluate(`new Promise((ok) => { const s = document.createElement('script'); s.src = 'kit/sprites.js'; s.onload = ok; document.head.appendChild(s); })`);
    const inert = await p.evaluate(`({ active: EGSprites.state.active, same: [visuals, EGPost.render, explode, dealDamage, clearWorld, EG.clearEffects, ADD.emit].every((f, i) => f === __fn[i]), pr: renderer.getPixelRatio(), css: canvas.style.width, warn: (window.__contentWarnings || []).length })`);
    rep.ok(!inert.active && inert.same && inert.css === '' && inert.warn === 0, 'sprites: loaded without CONTENT.sprites the module stays inert (no engine function replaced, canvas untouched, no warning)', inert);
    const after = await p.evaluate(FRAME), moved = await p.evaluate(`(() => { const g = props.filter((q) => q.g).sort((x, y) => Math.hypot(x.x, x.z) - Math.hypot(y.x, y.z))[0].g; g.position.x += 2; const h = ${FRAME}; g.position.x -= 2; return h; })()`);
    rep.ok(moved !== before, 'sprites: control: the frame hash does change when one tombstone moves 2 m');
    rep.ok(before === after, 'sprites: the demo frame is pixel-identical before and after the module is present');
    rep.ok(p.errors.length === 0, 'sprites: no page errors on the demo page', p.errors.slice(0, 3));
  } catch (e) { rep.ok(false, 'sprites inert check crashed', e.message); } finally { await p.close(); }
  // 2. the test atlases, normal resolution and whole-screen low resolution
  for (const [mode, opts] of [['normal', {}], ['lowres', { pixelScreen: { rows: 360 } }]]) {
    const q = await openPage(url, { init: spriteInit(opts) });
    try {
      rep.ok(await q.waitFor(`!document.querySelector('#go').disabled && window.EGSprites && EGSprites.state.ready`, 30000), `sprites(${mode}): page booted and the test atlases loaded`);
      await q.evaluate(readFileSync(join(ROOT, 'tests', 'sprites.spec.js'), 'utf8'));
      const results = await q.evaluate(`window.__runSprites('${mode}')`);
      for (const r of results) rep.ok(r.ok, `sprites(${mode}): ${r.name}`, r.err);
      rep.ok(results.length >= (mode === 'normal' ? 20 : 6), `sprites(${mode}): suite size ${results.length}`);
      rep.ok(q.errors.length === 0, `sprites(${mode}): no page errors`, q.errors.slice(0, 3));
    } catch (e) { rep.ok(false, `sprites(${mode}) runner crashed`, e.message); } finally { await q.close(); }
  }
}
// ---------------------------------------------------------------- night look and light (kit/look.js)
if (!live && !spritesOnly && !kitOnly) {
  // 1. the demo page: kit/look.js is never requested; loaded by hand with a broken CONTENT.look it stays inert and says why;
  //    loaded with an empty CONTENT.look it is on but the frame is pixel-identical
  const p = await openPage(url);
  try {
    await p.waitFor(`!document.querySelector('#go').disabled && window.EGChar && (EGChar.state.ready || EGChar.state.failed)`, 60000);
    rep.ok(await p.evaluate(`!window.EGLook && ![...document.scripts].some(s => /look\.js/.test(s.src)) && !performance.getEntriesByType('resource').some(r => /look\.js/.test(r.name))`), 'look: the demo page (no CONTENT.look) never loads kit/look.js');
    await p.evaluate(`requestAnimationFrame = () => 0; new Promise((ok) => setTimeout(ok, 300))`);
    const load = `new Promise((ok) => { const s = document.createElement('script'); s.src = 'kit/look.js'; s.onload = ok; document.head.appendChild(s); })`;
    const before = await p.evaluate(`(() => { window.__fn = [visuals, updateTowers, ADD.emit]; window.__clr = renderer.getClearColor(new THREE.Color()).getHex(); return ${FRAME}; })()`);
    await p.evaluate(load);
    rep.ok(await p.evaluate(`!EGLook.state.on && [visuals, updateTowers, ADD.emit].every((f, i) => f === __fn[i])`), 'look: loaded without CONTENT.look the module stays inert (no engine function replaced)');
    await p.evaluate(`CONTENT.look = { clear: 'red', towers: { flame: 'off' } }; window.__w0 = __contentWarnings.length;`); await p.evaluate(load);
    const bad = await p.evaluate(`({ on: EGLook.state.on, problems: EGLook.problems, same: [visuals, updateTowers, ADD.emit].every((f, i) => f === __fn[i]) && renderer.getClearColor(new THREE.Color()).getHex() === __clr, warned: __contentWarnings.slice(__w0) })`);
    rep.ok(!bad.on && bad.same && bad.problems.length === 2 && bad.warned.some((w) => /CONTENT\.look\.clear/.test(w)) && bad.warned.some((w) => /CONTENT\.look\.towers\.flame/.test(w)),
      'look: a broken CONTENT.look switches the whole module off, leaves the page as it is and names each bad field in the content warnings', bad);
    rep.ok(before === await p.evaluate(FRAME), 'look: the demo frame is unchanged after the broken value');
    await p.evaluate(`CONTENT.look = {};`); await p.evaluate(load);
    const empty = await p.evaluate(`({ on: EGLook.state.on, towers: updateTowers === __fn[1], patched: EGLook.state.patched.length, lights: scene.children.filter((o) => o.userData.egLook).length })`);
    rep.ok(empty.on && empty.towers && empty.patched === 0 && empty.lights === 0, 'look: an empty CONTENT.look turns the module on without patching materials, adding objects or touching the tower flame', empty);
    await p.evaluate(`EGLook.frame(1 / 60)`);   // the module's own per-frame work (a whole visuals() would also move the engine's particles)
    const moved = await p.evaluate(`(() => { const g = props.filter((q) => q.g).sort((x, y) => Math.hypot(x.x, x.z) - Math.hypot(y.x, y.z))[0].g; g.position.x += 2; const h = ${FRAME}; g.position.x -= 2; return h; })()`);
    rep.ok(moved !== before, 'look: control: the frame hash does change when one tombstone moves 2 m');
    rep.ok(before === await p.evaluate(FRAME), 'look: with an empty CONTENT.look the demo frame is pixel-identical (after the look frame ran)');
    rep.ok(p.errors.length === 0, 'look: no page errors on the demo page', p.errors.slice(0, 3));
  } catch (e) { rep.ok(false, 'look inert check crashed', e.message); } finally { await p.close(); }
  // 2. the full fixture with the test atlases; 3. only a moved flame, no atlases, no decorations
  for (const [mode, init, ready] of [['full', lookInit({}, { sprites: {} }), `window.EGSprites && EGSprites.state.ready && EGLook.state.decorReady`], ['flameY', lookInit({ towers: { flame: 2.1 } }, { decor: false }), 'true']]) {
    const q = await openPage(url, { init });
    try {
      rep.ok(await q.waitFor(`!document.querySelector('#go').disabled && window.EGLook && EGLook.state.on && ${ready}`, 30000), `look(${mode}): page booted and the look module is on`);
      await q.evaluate(readFileSync(join(ROOT, 'tests', 'look.spec.js'), 'utf8'));
      const results = await q.evaluate(`window.__runLook('${mode}')`);
      for (const r of results) rep.ok(r.ok, `look(${mode}): ${r.name}`, r.err);
      rep.ok(results.length >= (mode === 'full' ? 18 : 5), `look(${mode}): suite size ${results.length}`);
      rep.ok(q.errors.length === 0, `look(${mode}): no page errors`, q.errors.slice(0, 3));
    } catch (e) { rep.ok(false, `look(${mode}) runner crashed`, e.message); } finally { await q.close(); }
  }
}
// ---------------------------------------------------------------- terrain actions and spell extensions (kit/spellkit.js)
// one fixed fight (seeded): six monsters, the four spells cast by the engine's own release functions, 400 frames of logic; every hit
// (kind, source, amount, which monster, cast record), the terrain grid and the next random number. The same on every page that runs
// the same engine code with no new spell parameter set.
const FIGHT = `(() => { requestAnimationFrame = () => 0; clearWorld(); resetTerrain(); EG.resetSpellParams(); running = true; paused = false; time = 100;
  Object.assign(story, { on: false, unlocked: new Set(['fire', 'bolt', 'meteor', 'blood']) }); setTier(1); player.pos.set(0, 0, 0); player.maxhp = player.hp = 1e6; player.alive = true; player.cast = null;
  player.face = 0; player.float = 0; player.kills = 0; hitStop = shakeAmt = 0;
  camera.position.set(0, 14, 13); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(); mouse.set(0, 0);   // the mage faces the mouse through the camera
  EG.seed(4242); EG.clearEffects(); const log = [], seen = new Map(), idx = (e) => { if (!seen.has(e)) seen.set(e, seen.size); return seen.get(e); };
  const L = (h) => log.push([h.kind, h.source, Math.round(h.amount * 1e6), idx(h.target), h.cast ? h.cast.id + h.cast.mul : '-'].join(':')); EG.on('hit', L);
  [[0, 9], [2, 10], [-2, 11], [9, 3], [10, 5], [-9, -4]].forEach(([x, z], i) => spawnEnemy(i % 2 ? 'lizard' : 'spider', x, z, 2));
  const V = (x, z) => new THREE.Vector3(x, 0, z), rec = (id) => ({ id, n: 0, mul: 1 });
  for (let f = 0; f < 400; f++) {
    if (f === 5) releaseCast({ id: 'fire', target: V(0, 9), k: rec('fire') });
    if (f === 60) releaseCast({ id: 'bolt', target: V(9, 3), k: rec('bolt') });
    if (f === 120) releaseCast({ id: 'meteor', target: V(0, 10), k: rec('meteor') });
    if (f === 200) { player.cast = { id: 'blood', target: V(-9, -4), k: rec('blood') }; egCur = player.cast.k; startBlood(); egCur = null; player.cast = null; }
    logic(1 / 60); }
  EG.off('hit', L); let h = 0; for (let i = 0; i < TT.length; i++) h = (h * 31 + TT[i]) >>> 0;
  return { log, terrain: h, next: Math.random(), kills: player.kills, tk: terrainKills }; })()`;
if (!live && !spritesOnly && !lookOnly) {
  let demo = null;
  // 1. the demo page: kit/spellkit.js is never requested; the engine's default chain tone; loaded by hand without or with a broken
  //    CONTENT.spellkit the module stays inert; loaded with an empty one it is on and the frame is pixel-identical
  const p = await openPage(url);
  try {
    await p.waitFor(`!document.querySelector('#go').disabled && window.EGChar && (EGChar.state.ready || EGChar.state.failed)`, 60000);
    rep.ok(await p.evaluate(`!window.EGSpellkit && ![...document.scripts].some(s => /spellkit\\.js/.test(s.src)) && !performance.getEntriesByType('resource').some(r => /spellkit\\.js/.test(r.name))`), 'spellkit: the demo page (no CONTENT.spellkit) never loads kit/spellkit.js');
    const tone0 = await p.evaluate(`(() => { const t0 = tone, out = []; tone = (...a) => out.push(a); try { egChainTone(2); egChainTone(30); } finally { tone = t0; } return out; })()`);
    rep.ok(tone0.length === 2 && Math.abs(tone0[0][0] - 440 * 1.06 ** 2) < 1e-9 && Math.abs(tone0[1][0] - 440 * 1.06 ** 20) < 1e-9 && tone0[0][3] === 'triangle' && Math.abs(tone0[0][1] / tone0[0][0] - 1.5) < 1e-12,
      'spellkit: without the module the chain tone is the engine\'s own rising tone (x1.06 per step, capped at 20)', tone0);
    await p.evaluate(`requestAnimationFrame = () => 0; new Promise((ok) => setTimeout(ok, 300))`); // stop the page's own loop: only the probes run from now on
    demo = await p.evaluate(FIGHT);
    rep.ok(demo.log.length > 20 && demo.kills > 0, `spellkit: the fixed fight on the demo page: ${demo.log.length} hits, ${demo.kills} kills`);
    const load = `new Promise((ok) => { const s = document.createElement('script'); s.src = 'kit/spellkit.js'; s.onload = ok; document.head.appendChild(s); })`;
    const before = await p.evaluate(`(() => { window.__fn = [dealDamage, applyEl, setT, updateProjs, chain, updateTerrain, EG.clearEffects]; return ${FRAME}; })()`);
    await p.evaluate(load);
    rep.ok(await p.evaluate(`!EGSpellkit.state.on && [dealDamage, applyEl, setT, updateProjs, chain, updateTerrain, EG.clearEffects].every((f, i) => f === __fn[i]) && !EG.terrain`), 'spellkit: loaded without CONTENT.spellkit the module stays inert (no engine function replaced, no EG.terrain)');
    await p.evaluate(`CONTENT.spellkit = { ember: -1, chainTone: { wave: 'saw' } }; window.__w0 = __contentWarnings.length;`); await p.evaluate(load);
    const bad = await p.evaluate(`({ on: EGSpellkit.state.on, n: EGSpellkit.state.problems.length, same: [dealDamage, applyEl, setT].every((f, i) => f === __fn[i]), w: __contentWarnings.slice(__w0) })`);
    rep.ok(!bad.on && bad.n === 2 && bad.same && bad.w.some((w) => /CONTENT\.spellkit\.ember/.test(w)) && bad.w.some((w) => /chainTone\.wave/.test(w)), 'spellkit: a broken CONTENT.spellkit switches the whole module off and names each bad field', bad);
    await p.evaluate(`CONTENT.spellkit = {};`); await p.evaluate(load);
    const on = await p.evaluate(`({ on: EGSpellkit.state.on, meshes: scene.children.filter((o) => o.userData.egSpellkit).length, name: document.querySelector('.sk[data-s="fire"] .n').textContent, icons: document.querySelectorAll('img.egIcon').length })`);
    rep.ok(on.on && on.meshes === 0 && on.icons === 0 && on.name === '焰核彈', 'spellkit: an empty CONTENT.spellkit turns the module on without adding objects or touching the skill bar', on);
    rep.ok(before === await p.evaluate(FRAME), 'spellkit: with an empty CONTENT.spellkit the demo frame is pixel-identical');
    const again = await p.evaluate(FIGHT);
    rep.ok(JSON.stringify(again) === JSON.stringify(demo), 'spellkit: the fixed fight is the same hit for hit after the module was switched on in the same page (no new parameter set)',
      { first: demo.log.length, after: again.log.length, diff: demo.log.findIndex((x, i) => x !== again.log[i]) });
    rep.ok(p.errors.length === 0, 'spellkit: no page errors on the demo page', p.errors.slice(0, 3));
  } catch (e) { rep.ok(false, 'spellkit inert check crashed', e.message); } finally { await p.close(); }
  // 2. a page that starts with an empty CONTENT.spellkit: the same fixed fight as the demo page
  const q = await openPage(url, { init: spellkitInit({}) });
  try {
    rep.ok(await q.waitFor(`!document.querySelector('#go').disabled && window.EGSpellkit && EGSpellkit.state.on`, 30000), 'spellkit(empty): page booted and the module is on');
    const f = await q.evaluate(FIGHT);
    rep.ok(demo && JSON.stringify(f) === JSON.stringify(demo), 'spellkit(empty): the fixed fight is the same as on the demo page: every hit, the terrain and the next random number',
      demo && { demo: demo.log.length, here: f.log.length, diff: demo.log.findIndex((x, i) => x !== f.log[i]), terrain: [demo.terrain, f.terrain], next: [demo.next, f.next] });
    rep.ok(q.errors.length === 0, 'spellkit(empty): no page errors', q.errors.slice(0, 3));
  } catch (e) { rep.ok(false, 'spellkit(empty) runner crashed', e.message); } finally { await q.close(); }
  // 3. the full test fixture
  const r = await openPage(url, { init: spellkitInit() });
  try {
    rep.ok(await r.waitFor(`!document.querySelector('#go').disabled && window.EGSpellkit && EGSpellkit.state.on`, 30000), 'spellkit(full): page booted and the module is on');
    await r.evaluate(readFileSync(join(ROOT, 'tests', 'spellkit.spec.js'), 'utf8'));
    const results = await r.evaluate(`window.__runSpellkit('full')`);
    for (const x of results) rep.ok(x.ok, `spellkit: ${x.name}`, x.err);
    rep.ok(results.length >= 40, `spellkit: suite size ${results.length}`);
    rep.ok(r.errors.length === 0, 'spellkit(full): no page errors', r.errors.slice(0, 3));
  } catch (e) { rep.ok(false, 'spellkit(full) runner crashed', e.message); } finally { await r.close(); }
}
srv?.close();
process.exit(rep.done() ? 1 : 0);
