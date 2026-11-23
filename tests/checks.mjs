#!/usr/bin/env node
// Non-functional checks: performance budget, leaks over restarts, phone width, accessibility basics,
// rendered output, documentation links, diagram source sync.
//   node tests/checks.mjs [--url=https://...]
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { ROOT, serve, openPage, reporter, spriteInit, lookInit } from './lib/browser.mjs';
import { pageSources, splitViolations, contentScripts, sharedScopeDuplicates } from './lib/pagesrc.mjs';

const live = (process.argv.find((a) => a.startsWith('--url=')) || '').slice(6);
const rep = reporter('checks');
const srv = live ? null : await serve();
const url = live || `http://127.0.0.1:${srv.address().port}/index.html`;
const STEP = `window.__step = (n, dt = 1/60) => { for (let k = 0; k < n; k++) { time += dt; shared.uTime.value = time; if (!paused) logic(dt); visuals(dt); } };`;

// ---------------------------------------------------------------- static: docs and diagrams
function staticChecks() {
  const { html, scripts: pageScripts, localFiles } = pageSources(ROOT);
  rep.ok(/^<!doctype html>/i.test(html), 'index.html starts with <!doctype html> (standards mode)');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]); const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  rep.ok(dup.length === 0, `no duplicate ids among ${ids.length}`, dup);
  const lower = ids.map((s) => s.toLowerCase()); const ci = lower.filter((v, i) => lower.indexOf(v) !== i);
  rep.ok(ci.length === 0, 'no ids that collide case-insensitively', ci);
  // a second `function name(){}` silently replaces the first one everywhere (hoisting): P3a's terrain noise broke the atlas tiling this way
  // (since the engine/content split the game is several classic scripts that share one global scope, so the whole page's code is checked together)
  // the former inline game script = every blocking script (content + kit core files + start-up line) shares one scope and is checked as one; each deferred module is wrapped in its own IIFE and is checked on its own
  const dups = (code) => { const f = [...code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]); return [f.length, [...new Set(f.filter((v, i) => f.indexOf(v) !== i))]]; };
  const [nShared, dupShared] = dups(pageScripts.filter((s) => s.text && !s.defer).map((s) => s.text).join('\n'));
  const dupModules = pageScripts.filter((s) => s.text && s.defer).flatMap((s) => dups(s.text)[1].map((n) => `${s.src}:${n}`));
  rep.ok(dupShared.length === 0 && dupModules.length === 0, `no function declared twice among ${nShared} (shared scope) and within each deferred module`, [...dupShared, ...dupModules]);
  // a plain <script src> blocks parsing until it has downloaded: a 1.2 MB model loaded that way kept the live page in "loading" for 15 s+ (DEVLOG #40)
  const blocking = pageScripts.filter((s) => s.local && !s.defer && !s.async).map((s) => s.src).filter((s) => statSync(join(ROOT, s)).size > 100 * 1024);
  rep.ok(blocking.length === 0, 'no local script over 100 KB loads in a way that blocks the page', blocking);
  // phone controls must not wait for a third-party download: deferred scripts run in document order (DEVLOG #52)
  const srcs = pageScripts.filter((s) => s.defer).map((s) => s.src);
  rep.ok(srcs.indexOf('kit/controls.js') >= 0 && srcs.slice(0, srcs.indexOf('kit/controls.js')).every((s) => !/^https?:/.test(s)), 'touch controls load before any deferred third-party script', srcs);
  // engine/content split (DEVLOG §4 #40): kit/ must run with any content pack, a content pack must be plain data
  const rd = (dir) => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.js')).map((f) => ({ name: `${dir}/${f}`, text: readFileSync(join(ROOT, dir, f), 'utf8') }));
  const kitFiles = rd('kit'), contentFiles = contentScripts(ROOT); // every content/<pack>/*.js on disk plus whatever index.html loads from content/ (breaker finding 5)
  const viol = splitViolations(kitFiles, contentFiles);
  rep.ok(viol.length === 0, `kit/ holds no demo content and content/ holds no engine logic (${kitFiles.length} kit files, ${contentFiles.length} content files)`, viol);
  // the detector must prove it read the pack: strings from the REAL content files, not a fixed word list (breaker finding 3)
  const realProbe = splitViolations([{ name: 'kit/x.js', text: "const a = '燈火守著亡者的夢。火一滅，他們就醒了，而且很餓。'; const b = '星之塔';" }], contentFiles);
  rep.ok(realProbe.length >= 2, `split check reads the real content files: a dialogue line and a tower name copied into kit/ are both caught (${realProbe.length} findings)`, realProbe);
  const dupDecl = sharedScopeDuplicates(pageScripts.filter((s) => s.text && !s.defer).map((s) => ({ name: s.src || 'inline', text: s.text })));
  rep.ok(dupDecl.length === 0, 'no top-level const / let / class declared twice across the shared-scope scripts (a SyntaxError in the browser)', dupDecl);
  // the detector itself must be able to turn red (proved by hand in DEVLOG §4 #40; kept here so it cannot rot into a no-op)
  const probe = splitViolations([{ name: 'kit/x.js', text: "const s = '灰翁';" }], [{ name: 'content/y.js', text: 'window.CONTENT = { f: function () { return new THREE.Mesh(); } };' }]);
  rep.ok(probe.length >= 3, `split check flags a planted name and planted engine code (${probe.length} findings)`, probe);
  // load order: content pack first, then kit/ (the kit reads window.CONTENT while loading), and only then the deferred scripts
  const order = pageScripts.filter((s) => s.local).map((s) => s.src);
  const lastContent = Math.max(...order.map((s, i) => (s.startsWith('content/') ? i : -1))), firstKit = order.findIndex((s) => s.startsWith('kit/'));
  rep.ok(lastContent >= 0 && lastContent < firstKit, 'content scripts load before the first kit script', order);
  rep.ok(!pageScripts.some((s) => s.local && /^content\//.test(s.src) && (s.defer || s.async)), 'content scripts are plain blocking scripts (no defer, no async: either one lets kit/ read window.CONTENT before it exists)', pageScripts.filter((s) => /^content\//.test(s.src || '') && (s.defer || s.async)).map((s) => s.src));
  // kit/ files depend on each other by name; this is the documented order (kit/CONTENT-API.md). Files not listed here may sit anywhere after core.js.
  const KIT_ORDER = ['kit/core.js', 'kit/world.js', 'kit/combat.js', 'kit/systems.js', 'kit/story.js', 'kit/ui.js', 'kit/boot.js'];
  const kitBlock = pageScripts.filter((s) => s.local && /^kit\//.test(s.src) && !s.defer).map((s) => s.src), known = kitBlock.filter((s) => KIT_ORDER.includes(s));
  rep.ok(kitBlock[0] === 'kit/core.js' && JSON.stringify(known) === JSON.stringify(KIT_ORDER.filter((s) => known.includes(s))), 'kit/ blocking scripts load in the documented order (core first, then world, combat, systems, story, ui, boot)', kitBlock);
  rep.ok(!pageScripts.some((s) => s.local && /^kit\//.test(s.src) && !s.defer && pageScripts.indexOf(s) > pageScripts.findIndex((x) => x.defer)), 'blocking kit scripts all come before the first deferred script');
  // Godot port: billboarded particles drop their own scale unless the material keeps it; every quad then drew at 1 unit (DEVLOG #45)
  const gd = readFileSync(join(ROOT, 'godot', 'main.gd'), 'utf8');
  rep.ok(!/BILLBOARD_PARTICLES/.test(gd) || /billboard_keep_scale\s*=\s*true/.test(gd), 'Godot particle materials keep each particle\'s own scale');
  // every third-party asset shipped in content/ is credited in NOTICE.md and the in-game credits
  const notice = readFileSync(join(ROOT, 'NOTICE.md'), 'utf8');
  rep.ok(existsSync(join(ROOT, 'content', 'demo', 'models', 'mage-model.js')) && /Universal Animation Library/.test(notice) && /CC0/.test(notice) && /Universal Animation Library/.test(html), 'shipped mage model is credited (NOTICE + in-game credits, CC0)');
  // relative links in markdown
  const mds = ['README.md', 'NOTICE.md', 'docs/METHOD.md', 'docs/SCREENS.md', 'docs/DEVLOG.md', 'docs/VOICE.md', 'docs/GODOT.md', 'docs/ROUTES.md'];
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
  // development log: the change / fix record kept for the course
  const log = existsSync(join(ROOT, 'docs', 'DEVLOG.md')) ? readFileSync(join(ROOT, 'docs', 'DEVLOG.md'), 'utf8') : '';
  const sec = (h) => { const a = log.indexOf(h); if (a < 0) return ''; const b = log.indexOf('\n## ', a + 1); return log.slice(a, b < 0 ? undefined : b); };
  const rows = (s) => s.split('\n').filter((l) => /^\| \d+ \|/.test(l)).length;
  rep.ok(rows(sec('## 4.')) >= 13, `DEVLOG timeline has an entry per change (${rows(sec('## 4.'))} rows)`);
  rep.ok(rows(sec('## 5.')) >= 13 && sec('## 5.').split('\n').filter((l) => /^\| \d+ \|/.test(l)).every((l) => l.split('|').length >= 8), `DEVLOG fix table: every bug has symptom, discovery, root cause, fix and guard (${rows(sec('## 5.'))} rows)`);
  rep.ok(readFileSync(join(ROOT, 'README.md'), 'utf8').includes('docs/DEVLOG.md'), 'README links the development log');
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

    // terrain under load: a 40x40 burning field plus lava, the automaton and texture uploads every frame
    const tperf = await p.evaluate(`(() => { player.pos.set(0, 0, 0);
      for (let z = -20; z < 20; z++) for (let x = -20; x < 20; x++) setT(cellOf(x + .5, z + .5), (x + z) % 7 === 0 ? TER.LAVA : TER.GRASS, 30);
      for (let k = 0; k < 40; k++) applyEl(cellOf(Math.random() * 40 - 20, Math.random() * 40 - 20), 'fire');
      let t = 0, worst = 0, burning = 0; for (let f = 0; f < 300; f++) { const a = performance.now(); time += 1/60; logic(1/60); visuals(1/60); const d = performance.now() - a; t += d; worst = Math.max(worst, d); }
      for (let i = 0; i < TT.length; i++) if (TT[i] === TER.FIRE || TT[i] === TER.ASH) burning++;
      return { avg: t / 300, worst, burning }; })()`);
    rep.ok(tperf.burning > 200, `terrain load test actually burned (${tperf.burning} cells on fire or ash)`);
    rep.ok(tperf.avg < 8, `terrain automaton + texture upload averages ${tperf.avg.toFixed(2)} ms/frame (budget 8 ms, worst ${tperf.worst.toFixed(1)} ms)`);

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
    rep.ok(/手機操作/.test(r.note), 'touch-only devices get the touch controls explained on the title screen (P4)');
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
    // 3.3 MB from the CDN: took 34 s when other jobs saturated the network (DEVLOG #39), so allow 90 s
    if (!(await p.waitFor('typeof mermaid !== "undefined"', 90000))) { rep.ok(false, 'mermaid parser loaded (needs network)'); return; }
    const control = await p.evaluate(`(async () => { try { await mermaid.parse('flowchart LR\\n  A[open --> '); return 'ok'; } catch (e) { return 'rejected'; } })()`);
    rep.ok(control === 'rejected', 'negative control: the parser rejects broken mermaid');
    for (const [name, src] of blocks) {
      const r = await p.evaluate(`(async () => { try { await mermaid.parse(${JSON.stringify(src)}); return 'ok'; } catch (e) { return String(e.message || e).split('\\n').slice(0, 3).join(' '); } })()`);
      rep.ok(r === 'ok', `mermaid syntax valid: ${name}`, r);
    }
  } finally { await p.close(); }
}

// ---------------------------------------------------------------- pixel sprites (kit/sprites.js, loaded only for a content pack with CONTENT.sprites)
function spriteStatic() {
  const { scripts } = pageSources(ROOT), ch = readFileSync(join(ROOT, 'kit', 'character.js'), 'utf8');
  rep.ok(!scripts.some((s) => /sprites\.js/.test(s.src || '')), 'sprites: index.html does not load kit/sprites.js (the demo page carries no sprite code)');
  rep.ok(/if \(window\.CONTENT && CONTENT\.sprites\) \{[^}]*sprites\.js/.test(ch), 'sprites: kit/character.js loads kit/sprites.js only when the content pack has CONTENT.sprites');
}
async function spriteChecks() {
  const p = await openPage(url, { width: 1280, height: 800, init: spriteInit() });
  try {
    if (!(await p.waitFor(`!document.querySelector('#go').disabled && window.EGSprites && EGSprites.state.ready`, 30000))) { rep.ok(false, 'sprites: page with the test atlases boots'); return; }
    await p.clickSel('#go'); await p.evaluate(STEP + `requestAnimationFrame = () => 0; for (const e of enemies) e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 }); __step(10);`);
    // cost of the sprite update itself under load: 50 monsters walking, spells, a burning field (the engine's own update has its own budget above)
    const perf = await p.evaluate(`(() => { for (const e of enemies) e.T = Object.assign({}, e.T, { speed: 2, dmg: 0 }); player.maxhp = player.hp = 1e9; mouse.set(.05, .3);
      for (let z = -12; z < 12; z++) for (let x = -12; x < 12; x++) setT(cellOf(x + .5, z + .5), (x + z) % 5 ? TER.GRASS : TER.FIRE, 20);
      let t = 0, n = 0, peak = 0; for (let f = 0; f < 300; f++) { if (f % 60 === 0) { player.cast = null; cds.meteor = 0; tryCast('meteor'); } if (f % 20 === 10) { player.cast = null; cds.fire = 0; tryCast('fire'); }
        time += 1/60; logic(1/60); const a = performance.now(); EGSprites.update(1/60); t += performance.now() - a; n++; peak = Math.max(peak, EGSprites.fxList.length); }
      return { avg: t / n, peak, actors: EGSprites.state.actors }; })()`);
    rep.ok(perf.avg < 3, `sprites: update of ${perf.actors} character sprites, props, effects and tiles averages ${perf.avg.toFixed(2)} ms/frame (budget 3 ms; peak ${perf.peak} effect flipbooks)`);
    // memory: five restarts with every spell keep the scene, GPU geometries and textures, and the quad pool flat
    const leak = await p.evaluate(`(() => { const rounds = [];
      for (let r = 0; r < 5; r++) { restart(); spawnEnemy('spider', 40, 0, 1e9); const guard = enemies[enemies.length - 1]; for (const e of enemies) e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 }); mouse.set(.05, .3);
        for (const id of ['meteor', 'fire', 'bolt', 'blood']) { player.cast = null; cds[id] = 0; tryCast(id); __step(90); } for (const e of [...enemies]) if (e !== guard) killEnemy(e); __step(400); renderer.render(scene, camera);
        rounds.push({ scene: scene.children.length - loots.length - enemies.reduce((n, e) => n + 1 + (EGSprites.actorCfg[e.type] ? 2 : 0), 0), geo: renderer.info.memory.geometries, tex: renderer.info.memory.textures, quads: EGSprites.pool.length + EGSprites.fxList.length + EGSprites.state.actors, fx: EGSprites.fxList.length }); }
      return rounds; })()`);
    const span = (k) => Math.max(...leak.slice(1).map((r) => r[k])) - Math.min(...leak.slice(1).map((r) => r[k]));
    rep.ok(span('scene') <= 3 && span('geo') <= 6 && span('tex') <= 1, `sprites: scene objects, GPU geometries and textures stay flat over 5 restarts (scene ${leak.map((r) => r.scene).join(' ')}, geometries ${leak.map((r) => r.geo).join(' ')}, textures ${leak.map((r) => r.tex).join(' ')})`);
    rep.ok(span('quads') <= 12 && leak.every((r) => r.fx === 0), `sprites: the quad pool stays bounded and no effect flipbook outlives its effect (${leak.map((r) => r.quads).join(' ')})`);
    rep.ok(p.errors.length === 0, 'sprites: no console errors (checks)', p.errors.slice(0, 3));
  } finally { await p.close(); }
  // whole screen in low resolution: about 360 rows at a whole-number scale on three window sizes (desktop, odd size, phone)
  for (const [w, h, mobile] of [[1280, 800], [1366, 767], [375, 812, true]]) {
    const q = await openPage(url, { width: w, height: h, mobile, init: spriteInit({ pixelScreen: { rows: 360 } }) });
    try {
      await q.waitFor(`!document.querySelector('#go').disabled && window.EGSprites && EGSprites.state.lowRes && EGSprites.state.h > 0`, 30000);
      const r = await q.evaluate(`({ k: EGSprites.state.scale, bw: EGSprites.state.w, bh: EGSprites.state.h, cw: parseFloat(canvas.style.width), chh: parseFloat(canvas.style.height), ir: canvas.style.imageRendering, dpr: devicePixelRatio, vw: innerWidth, vh: innerHeight })`);
      const kWant = Math.max(1, Math.round(r.vh * r.dpr / 360));
      rep.ok(Number.isInteger(r.k) && r.k === kWant && r.cw * r.dpr === r.bw * r.k && r.chh * r.dpr === r.bh * r.k && r.ir === 'pixelated' && r.bh >= 270 && r.bh <= 540 && r.vw - r.cw < r.k && r.vh - r.chh < r.k,
        `sprites: low resolution at ${w}x${h}: ${r.bw}x${r.bh} buffer shown at exactly x${r.k} (${r.cw}x${r.chh} px)`, r);
      rep.ok(q.errors.length === 0, `sprites: no console errors at ${w}x${h} in low resolution`, q.errors.slice(0, 3));
    } finally { await q.close(); }
  }
}

// ---------------------------------------------------------------- night look (kit/look.js, loaded only for a content pack with CONTENT.look)
function lookStatic() {
  const { scripts } = pageSources(ROOT), ch = readFileSync(join(ROOT, 'kit', 'character.js'), 'utf8'), lk = readFileSync(join(ROOT, 'kit', 'look.js'), 'utf8');
  rep.ok(!scripts.some((s) => /look\.js/.test(s.src || '')), 'look: index.html does not load kit/look.js (the demo page carries no look code)');
  rep.ok(/if \(window\.CONTENT && CONTENT\.look\) \{[^}]*look\.js/.test(ch), 'look: kit/character.js loads kit/look.js only when the content pack has CONTENT.look');
  rep.ok(!/Math\.random/.test(lk), 'look: kit/look.js never calls Math.random (seeded scenes draw the same sequence with or without it)');
}
async function lookChecks() {
  const p = await openPage(url, { width: 1280, height: 800, init: lookInit({}, { sprites: {} }) });
  try {
    if (!(await p.waitFor(`!document.querySelector('#go').disabled && window.EGSprites && EGSprites.state.ready && window.EGLook && EGLook.state.decorReady`, 30000))) { rep.ok(false, 'look: page with the test look boots'); return; }
    await p.clickSel('#go'); await p.evaluate(STEP + `requestAnimationFrame = () => 0; for (const e of enemies) e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 }); __step(10);`);
    // cost of the look frame itself under load: 50 monsters, spells, a burning and melting field (cells re-sent), three lit towers
    const perf = await p.evaluate(`(() => { for (let k = 0; k < 50; k++) spawnEnemy('spider', -15 + (k % 10) * 3, -10 + Math.floor(k / 10) * 3, 1e9); player.maxhp = player.hp = 1e9; mouse.set(.05, .3);
      for (const i of [0, 1, 2]) TOWERS[i].lit = true;
      for (let z = -12; z < 12; z++) for (let x = -12; x < 12; x++) setT(cellOf(x + .5, z + .5), (x + z) % 5 ? TER.GRASS : TER.FIRE, 20);
      let t = 0, n = 0; for (let f = 0; f < 300; f++) { if (f % 60 === 0) { player.cast = null; cds.meteor = 0; tryCast('meteor'); } if (f % 20 === 10) { player.cast = null; cds.fire = 0; tryCast('fire'); }
        time += 1/60; logic(1/60); visuals(1/60); const a = performance.now(); EGLook.frame(1/60); t += performance.now() - a; n++; }
      return { avg: t / n, uploads: EGLook.state.glowUploads, decor: EGLook.decor.length }; })()`);
    rep.ok(perf.avg < 1, `look: the look frame (strengths, cells, ${perf.decor} decorations, halos) averages ${perf.avg.toFixed(3)} ms/frame under load (budget 1 ms; ${perf.uploads} cell uploads)`);
    // five restarts with every spell: nothing the look module owns is added again (decorations, lights and halos are built once)
    const leak = await p.evaluate(`(() => { const rounds = [];
      for (let r = 0; r < 5; r++) { restart(); for (const id of ['meteor', 'fire', 'bolt', 'blood']) { player.cast = null; cds[id] = 0; tryCast(id); __step(90); } __step(200);
        rounds.push({ mine: scene.children.filter((o) => o.userData.egLook).length, lights: scene.children.filter((o) => o.isPointLight).length, halos: EGLook.halos.length, decor: EGLook.decor.length }); }
      return rounds; })()`);
    rep.ok(leak.every((r) => JSON.stringify(r) === JSON.stringify(leak[0])), `look: objects, lights, halos and decorations stay the same over 5 restarts (${JSON.stringify(leak[0])})`, leak);
    rep.ok(p.errors.length === 0, 'look: no console errors (checks)', p.errors.slice(0, 3));
  } finally { await p.close(); }
}

try { staticChecks(); spriteStatic(); lookStatic(); await mermaidChecks(); await desktopChecks(); await phoneChecks(); if (!live) { await spriteChecks(); await lookChecks(); } }
catch (e) { rep.ok(false, 'checks crashed', e.message); }
finally { srv?.close(); }
process.exit(rep.done() ? 1 : 0);
