#!/usr/bin/env node
// Non-functional checks: performance budget, leaks over restarts, phone width, accessibility basics,
// rendered output, documentation links, diagram source sync.
//   node tests/checks.mjs [--url=https://...]
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { ROOT, serve, openPage, reporter } from './lib/browser.mjs';

const live = (process.argv.find((a) => a.startsWith('--url=')) || '').slice(6);
const rep = reporter('checks');
const srv = live ? null : await serve();
const url = live || `http://127.0.0.1:${srv.address().port}/index.html`;
const STEP = `window.__step = (n, dt = 1/60) => { for (let k = 0; k < n; k++) { time += dt; shared.uTime.value = time; if (!paused) logic(dt); visuals(dt); } };`;

// ---------------------------------------------------------------- static: docs and diagrams
function staticChecks() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  rep.ok(/^<!doctype html>/i.test(html), 'index.html starts with <!doctype html> (standards mode)');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]); const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  rep.ok(dup.length === 0, `no duplicate ids among ${ids.length}`, dup);
  const lower = ids.map((s) => s.toLowerCase()); const ci = lower.filter((v, i) => lower.indexOf(v) !== i);
  rep.ok(ci.length === 0, 'no ids that collide case-insensitively', ci);
  // relative links in markdown
  const mds = ['README.md', 'NOTICE.md', 'docs/METHOD.md'];
  let broken = [];
  for (const f of mds) { const t = readFileSync(join(ROOT, f), 'utf8');
    for (const m of t.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) { const l = m[1]; if (/^https?:|^mailto:/.test(l)) continue; const p = resolve(ROOT, dirname(f), decodeURIComponent(l)); if (!existsSync(p)) broken.push(`${f} -> ${l}`); } }
  rep.ok(broken.length === 0, `relative links in ${mds.length} markdown files resolve`, broken);
  // every diagram viewer embeds its .mmd sources verbatim
  const dd = join(ROOT, 'docs', 'diagrams');
  for (const folder of readdirSync(dd)) {
    const dir = join(dd, folder); if (!statSync(dir).isDirectory()) continue;
    const viewer = readFileSync(join(dir, 'architecture.html'), 'utf8');
    for (const mmd of readdirSync(dir).filter((f) => f.endsWith('.mmd'))) rep.ok(viewer.includes(readFileSync(join(dir, mmd), 'utf8')), `${folder}/${mmd} embedded verbatim in its viewer`);
  }
  rep.ok(/```mermaid/.test(readFileSync(join(ROOT, 'README.md'), 'utf8')), 'README has mermaid diagrams GitHub can render');
}

// ---------------------------------------------------------------- browser checks
async function desktopChecks() {
  const p = await openPage(url, { width: 1280, height: 800 });
  try {
    await p.waitFor(`!document.querySelector('#go').disabled`);
    // accessibility basics
    const a11y = await p.evaluate(`(() => {
      const nameless = [...document.querySelectorAll('button, [role=button], select, input:not([type=hidden])')].filter(b => !(b.textContent.trim() || b.getAttribute('aria-label') || (b.labels && b.labels.length) || b.id === 'sheetFile')).map(b => b.id || b.outerHTML.slice(0, 40));
      return { nameless, lang: document.documentElement.lang, title: document.title, canvasLabel: document.querySelector('#c').getAttribute('aria-label'), dialogRole: document.querySelector('#dialog').getAttribute('role') }; })()`);
    rep.ok(a11y.nameless.length === 0, 'every button / control has an accessible name', a11y.nameless);
    rep.ok(a11y.lang === 'zh-Hant' && a11y.title.length > 0, 'document language and title set');
    rep.ok(!!a11y.canvasLabel && a11y.dialogRole === 'dialog', 'canvas has a label; dialogue box has role=dialog');
    rep.ok(await p.evaluate(`matchMedia('(prefers-reduced-motion: reduce)') && [...document.styleSheets].some(s => { try { return [...s.cssRules].some(r => r.conditionText && r.conditionText.includes('prefers-reduced-motion')) } catch (e) { return false } })`), 'styles honour prefers-reduced-motion');

    // rendered output is not blank, and the three routes render differently
    await p.clickSel('#go'); await p.evaluate(STEP + `requestAnimationFrame = () => 0; for (const e of enemies) e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 }); __step(30);`);
    const stats = await p.evaluate(`(() => { const out = {}; const c = document.createElement('canvas'); c.width = 160; c.height = 100; const g = c.getContext('2d', { willReadFrequently: true });
      for (const m of [0, 1, 2]) { setRoute(m); mouse.set(0, .35); player.cast = null; cds.fire = 0; tryCast('fire'); __step(16); renderer.render(scene, camera);
        g.drawImage(renderer.domElement, 0, 0, 160, 100); const d = g.getImageData(0, 0, 160, 100).data; let s = 0, s2 = 0, n = d.length / 4, h = 0;
        for (let i = 0; i < d.length; i += 4) { const l = .3 * d[i] + .59 * d[i + 1] + .11 * d[i + 2]; s += l; s2 += l * l; h = (h * 31 + (l | 0)) >>> 0; }
        out[m] = { mean: s / n, std: Math.sqrt(s2 / n - (s / n) ** 2), hash: h }; __step(120); }
      setRoute(0); return out; })()`);
    rep.ok(stats[0].std > 4, `rendered frame is not blank (luminance std ${stats[0].std.toFixed(1)})`);
    rep.ok(stats[0].hash !== stats[1].hash && stats[1].hash !== stats[2].hash, 'atlas / procedural / quads routes produce different frames');

    // performance budget for game logic + particle/visual update (render excluded: headless uses a software GPU)
    const perf = await p.evaluate(`(() => { setTier(1); for (const e of enemies) e.T = Object.assign({}, e.T, { speed: 2, dmg: 0 });
      let t = 0, frames = 0, peak = 0; mouse.set(.05, .3);
      for (let f = 0; f < 360; f++) { if (f % 60 === 0) { player.cast = null; cds.meteor = 0; tryCast('meteor'); } if (f % 20 === 10) { player.cast = null; cds.fire = 0; tryCast('fire'); }
        const a = performance.now(); time += 1/60; logic(1/60); visuals(1/60); t += performance.now() - a; frames++; peak = Math.max(peak, ADD.list.length + SMOKE.list.length); }
      return { avg: t / frames, peak, enemies: enemies.length }; })()`);
    rep.ok(perf.avg < 8, `logic+visual update averages ${perf.avg.toFixed(2)} ms/frame under load (budget 8 ms; peak ${perf.peak} quads, ${perf.enemies} monsters)`);

    // leaks: five restarts with heavy spells in between keep scene / DOM / pools bounded
    const leak = await p.evaluate(`(() => { const snap = () => ({ scene: scene.children.length, fx: document.querySelector('#fx').children.length, pool: ADD.pool.length + SMOKE.pool.length });
      const rounds = [];
      for (let r = 0; r < 5; r++) { restart(); for (const e of enemies) e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 }); mouse.set(.05, .3);
        for (const id of ['meteor', 'fire', 'bolt', 'blood']) { player.cast = null; cds[id] = 0; tryCast(id); __step(90); }
        __step(400); rounds.push(snap()); }
      return { rounds, lightsBusy: LP.filter(l => l.busy && l.life !== Infinity).length }; })()`);
    const sc = leak.rounds.map((r) => r.scene), fx = leak.rounds.map((r) => r.fx);
    rep.ok(Math.max(...sc) - Math.min(...sc) <= 20, `scene object count stays flat over 5 restarts (${sc.join(' ')})`);
    rep.ok(Math.max(...fx) <= 120, `overlay DOM nodes stay bounded (${fx.join(' ')})`);
    rep.ok(leak.lightsBusy === 0, 'all temporary lights returned to the pool');
    rep.ok(p.errors.length === 0, 'desktop checks: no console errors', p.errors.slice(0, 3));
  } finally { await p.close(); }
}

async function phoneChecks() {
  const p = await openPage(url, { width: 375, height: 812, mobile: true });
  try {
    await p.waitFor(`!document.querySelector('#go').disabled`);
    const r = await p.evaluate(`({ sw: document.documentElement.scrollWidth, note: document.querySelector('#introNote').textContent,
      goVisible: (() => { const b = document.querySelector('#goStory').getBoundingClientRect(); return b.width > 0 && b.right <= innerWidth + 1; })() })`);
    rep.ok(r.sw <= 375, `no horizontal scroll at 375 px (scrollWidth ${r.sw})`);
    rep.ok(r.goVisible, 'start button fits the phone screen');
    rep.ok(/鍵盤與滑鼠/.test(r.note), 'touch-only devices are told keyboard and mouse are needed');
    rep.ok(p.errors.length === 0, 'phone checks: no console errors', p.errors.slice(0, 3));
  } finally { await p.close(); }
}

// every mermaid block (README + .mmd sources) parses with the real Mermaid parser GitHub uses
async function mermaidChecks() {
  const blocks = [];
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  [...readme.matchAll(/```mermaid\n([\s\S]*?)```/g)].forEach((m, i) => blocks.push([`README block ${i + 1}`, m[1]]));
  const dd = join(ROOT, 'docs', 'diagrams');
  for (const folder of readdirSync(dd)) { const dir = join(dd, folder); if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.mmd'))) blocks.push([`${folder}/${f}`, readFileSync(join(dir, f), 'utf8')]); }
  const p = await openPage('data:text/html,<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>');
  try {
    if (!(await p.waitFor('typeof mermaid !== "undefined"', 20000))) { rep.ok(false, 'mermaid parser loaded (needs network)'); return; }
    const control = await p.evaluate(`(async () => { try { await mermaid.parse('flowchart LR\\n  A[open --> '); return 'ok'; } catch (e) { return 'rejected'; } })()`);
    rep.ok(control === 'rejected', 'negative control: the parser rejects broken mermaid');
    for (const [name, src] of blocks) {
      const r = await p.evaluate(`(async () => { try { await mermaid.parse(${JSON.stringify(src)}); return 'ok'; } catch (e) { return String(e.message || e).split('\\n').slice(0, 3).join(' '); } })()`);
      rep.ok(r === 'ok', `mermaid syntax valid: ${name}`, r);
    }
  } finally { await p.close(); }
}

try { staticChecks(); await mermaidChecks(); await desktopChecks(); await phoneChecks(); }
catch (e) { rep.ok(false, 'checks crashed', e.message); }
finally { srv?.close(); }
process.exit(rep.done() ? 1 : 0);
