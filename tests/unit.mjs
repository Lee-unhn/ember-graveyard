#!/usr/bin/env node
// Unit tests: load the game headlessly, inject tests/unit.spec.js, run each test against the page's own functions.
// Then the optional pixel-sprite module (kit/sprites.js): inert on the demo page, and tests/sprites.spec.js on two pages that
// received the test atlases (tests/lib/sprite-fixture.js), one of them with the whole screen in low resolution.
//   node tests/unit.mjs [--url=https://...] [--sprites-only]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, serve, openPage, reporter, spriteInit } from './lib/browser.mjs';

const live = (process.argv.find((a) => a.startsWith('--url=')) || '').slice(6);
const spritesOnly = process.argv.includes('--sprites-only');
const rep = reporter('unit');
const srv = live ? null : await serve();
const url = live || `http://127.0.0.1:${srv.address().port}/index.html`;
// what the demo page shows, as a hash of one fixed frame (no post effects, mist off, a fixed camera)
const FRAME = `(() => { EGMist.state.on = false; running = false; time = 12.5; camera.position.set(9, 14, 13); camera.lookAt(0, 0, 0); renderer.setRenderTarget(null); renderer.render(scene, camera);
  const c = document.createElement('canvas'); c.width = 320; c.height = 200; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(renderer.domElement, 0, 0, 320, 200);
  const d = g.getImageData(0, 0, 320, 200).data; let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) >>> 0; return h; })()`;

if (!spritesOnly) {
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
if (!live) {
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
srv?.close();
process.exit(rep.done() ? 1 : 0);
