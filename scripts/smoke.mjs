#!/usr/bin/env node
// Ember Graveyard smoke harness.
//   node scripts/smoke.mjs            static gates (size, hosts, syntax, privacy)
//   node scripts/smoke.mjs --browser  static gates + headless Chrome gameplay probe
//   node scripts/smoke.mjs --selftest prove the gates turn red on bad input
//   node scripts/smoke.mjs --url=https://lee-unhn.github.io/ember-graveyard/   probe the deployed site
// Exit code 0 = all green. Any failed gate exits 1 (fail-loud, no silent skip).
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import vm from 'node:vm';
import { pageSources } from '../tests/lib/pagesrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 150 * 1024;
// raised from 200 KB to 208 KB for the extension interface (spell parameter table, window.EG events and pause, DEVLOG #45); the selftest proves it still fails one byte over
// raised from 208 KB to 214 KB for the optional blink move (kit/blink.js, about 5.6 KB: movement, landing rules, effect, sound, touch tile, remap row; DEVLOG #47)
// raised by 384 B for the blink and new-run fixes (key collision, modifier keys, ending screen, new-run reset, reduced flashing; DEVLOG #49): 960 B of code and comments, 740 B were left,
// and the selftest below needs room for its own extra script tag (about 45 B) to reach the limit exactly
// raised by another 384 B for the two-line loader in kit/character.js that fetches kit/sprites.js only when a content pack sets CONTENT.sprites (289 B; DEVLOG #50);
// the sprite module itself is not loaded by index.html and has its own cap below
// raised by another 384 B for the second loader line in kit/character.js (kit/look.js only when a content pack sets CONTENT.look; 194 B; DEVLOG #52):
// 259 B were left and the selftest needs about 45 B for its own script tag
const MAX_CODE_BYTES = 214 * 1024 + 768 + 384;
// engine modules that index.html does not load (kit/*.js fetched on demand by another kit file: kit/sprites.js, kit/look.js): each compiles, together at most 72 KB
// (40 KB until DEVLOG #52 added kit/look.js, about 26 KB; a page that sets neither CONTENT.sprites nor CONTENT.look downloads none of it)
const MAX_ONDEMAND_BYTES = 72 * 1024;
const ALLOWED_HOSTS = new Set(['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com', 'www.w3.org']);
const TEXT_EXT = new Set(['.html', '.md', '.mjs', '.js', '.mmd', '.json', '.txt', '.css', '.yml', '.yaml']);
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const SKIP_FILES = new Set(['scripts/private-terms.txt']);

let failures = 0;
const ok = (m) => console.log('  PASS ' + m);
const bad = (m) => { failures++; console.log('  FAIL ' + m); };

// files git ignores are never published (local design drafts in incoming/, test screenshots, the private main file),
// so the publish gates skip them; outside a git checkout (the selftest's poisoned copy) everything is scanned (DEVLOG #83)
function ignoredSet(root) {
  const r = spawnSync('git', ['-C', root, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return new Set(r.stdout.split('\n').filter(Boolean).map((s) => s.replace(/\/$/, '')));
}
function walk(dir, out = [], root = dir, ign = ignoredSet(root)) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (ign && ign.has(relative(root, p).replace(/\\/g, '/'))) continue;
    if (statSync(p).isDirectory()) walk(p, out, root, ign); else out.push(p);
  }
  return out;
}

export function staticGates(root) {
  const page = join(root, 'index.html');
  const { html, scripts: pageScripts, localFiles } = pageSources(root);
  const localText = pageScripts.filter((s) => s.local && s.text).map((s) => s.text).join('\n');
  console.log('[static] ' + relative(process.cwd(), page) || page);

  // 1. size
  const bytes = Buffer.byteLength(html);
  bytes <= MAX_BYTES ? ok(`size ${bytes} B <= ${MAX_BYTES}`) : bad(`size ${bytes} B > ${MAX_BYTES}`);
  // the game code used to sit inside index.html; after the engine/content split the same budget idea covers page + every local script the page loads (kit/, content/, anything else added later; the model and voice files are data loaded at run time, not counted)
  const codeBytes = bytes + pageScripts.filter((s) => s.local && s.text).reduce((n, s) => n + Buffer.byteLength(s.text), 0);
  codeBytes <= MAX_CODE_BYTES ? ok(`page code (index + every local script) ${codeBytes} B <= ${MAX_CODE_BYTES}`) : bad(`page code ${codeBytes} B > ${MAX_CODE_BYTES}`);
  const kitDir = join(root, 'kit'), onDemand = existsSync(kitDir) ? readdirSync(kitDir).filter((f) => f.endsWith('.js') && !localFiles.includes('kit/' + f)) : [];
  const odBytes = onDemand.reduce((n, f) => n + statSync(join(kitDir, f)).size, 0);
  odBytes <= MAX_ONDEMAND_BYTES ? ok(`on-demand engine modules (${onDemand.join(', ') || 'none'}) ${odBytes} B <= ${MAX_ONDEMAND_BYTES}`) : bad(`on-demand engine modules ${odBytes} B > ${MAX_ONDEMAND_BYTES}`);
  for (const f of onDemand) { try { new vm.Script(readFileSync(join(kitDir, f), 'utf8'), { filename: 'kit/' + f }); ok(`kit/${f} (on demand) compiles`); } catch (e) { bad(`kit/${f}: ${e.message}`); } }
  const missing = pageScripts.filter((s) => s.local && s.text === null).map((s) => s.src);
  missing.length === 0 ? ok(`all ${localFiles.length} local scripts exist`) : bad(`missing script files: ${missing.join(', ')}`);

  // 2. external hosts
  const hosts = [...(html + '\n' + localText).matchAll(/https?:\/\/([^/"'\s)`]+)/g)].map((m) => m[1]);
  const unknown = [...new Set(hosts.filter((h) => !ALLOWED_HOSTS.has(h)))];
  unknown.length === 0 ? ok(`external hosts all allow-listed (${[...new Set(hosts)].join(', ')})`) : bad(`unexpected hosts: ${unknown.join(', ')}`);

  // 3. inline script compiles
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (scripts.length === 0) bad('no inline start-up script found');
  scripts.forEach((s, i) => {
    try { new vm.Script(s, { filename: `inline-${i}.js` }); ok(`inline script #${i} compiles (${s.length} chars)`); }
    catch (e) { bad(`inline script #${i}: ${e.message}`); }
  });
  for (const s of pageScripts.filter((x) => x.local && x.text)) {
    try { new vm.Script(s.text, { filename: s.src }); ok(`${s.src} compiles (${s.text.length} chars)`); }
    catch (e) { bad(`${s.src}: ${e.message}`); }
  }

  // 4. required anchors (things the README and probe rely on)
  for (const id of ['id="c"', 'id="go"', 'id="segRoute"', 'id="sheetFile"', 'id="inv"', 'id="grid"']) {
    html.includes(id) ? ok(`anchor ${id}`) : bad(`missing anchor ${id}`);
  }

  // 5. privacy: local paths, e-mail addresses, private terms
  const termsFile = join(root, 'scripts', 'private-terms.txt');
  const terms = existsSync(termsFile) ? readFileSync(termsFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')) : null;
  const files = walk(root).filter((f) => TEXT_EXT.has(extname(f).toLowerCase()) && !SKIP_FILES.has(relative(root, f).replace(/\\/g, '/')));
  const pathRe = /[A-Za-z]:\\\\?Users\\|[A-Za-z]:\/Users\/|\/Users\/[A-Za-z]|\/home\/[a-z]/;
  const mailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  let leaks = 0;
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    const rel = relative(root, f);
    if (pathRe.test(t)) { leaks++; bad(`local user path in ${rel}`); }
    const mail = t.match(mailRe);
    if (mail && !/noreply|example\.com/.test(mail[0])) { leaks++; bad(`e-mail address in ${rel}`); }
    if (terms) for (const w of terms) if (t.includes(w)) { leaks++; bad(`private term #${terms.indexOf(w) + 1} in ${rel}`); }
  }
  if (!leaks) ok(`privacy scan clean over ${files.length} text files`);
  if (!terms) console.log('  NOTE private-terms.txt absent: workplace-name scan skipped (kept out of the public repo on purpose)');
}

// ---------------------------------------------------------------- browser probe
function findChrome() {
  const c = [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1208/chrome-win64/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  return c.find((p) => p && existsSync(p));
}
function serve(root) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
  const srv = http.createServer((req, res) => {
    const p = join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!p.startsWith(root) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function browserProbe(root, liveUrl) {
  console.log('[browser] headless gameplay probe');
  const chrome = findChrome();
  if (!chrome) { bad('no Chrome/Chromium found (set CHROME_PATH)'); return; }
  const srv = await serve(root);
  const url = liveUrl || `http://127.0.0.1:${srv.address().port}/index.html`;
  console.log('  probing ' + url);
  const prof = mkdtempSync(join(tmpdir(), 'eg-probe-'));
  const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${prof}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,800', '--no-first-run', '--no-default-browser-check', ...(process.env.EG_AUDIBLE ? [] : ['--mute-audio', '--disable-audio-output']), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    const wsUrl = await new Promise((res, rej) => {
      let buf = ''; const t = setTimeout(() => rej(new Error('Chrome did not start')), 20000);
      proc.stderr.on('data', (d) => { buf += d; const m = buf.match(/ws:\/\/[^\s]+/); if (m) { clearTimeout(t); res(m[0]); } });
    });
    const ver = await (await fetch(wsUrl.replace('ws://', 'http://').replace(/\/devtools\/.*/, '/json/list'))).json();
    const page = ver.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let id = 0; const pending = new Map(); const errors = [], fontMiss = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        // the web font is decoration: when Google Fonts drops the connection the page falls back to system fonts and still
        // works, so report it instead of failing (a CI runner lost the connection once, DEVLOG #53); every other load error still fails
        const u = m.params.entry.url || '';
        if (FONT_URL.test(u)) fontMiss.push(u); else errors.push(m.params.entry.text + ' ' + u);
      }
    });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
      return r.result.result.value;
    };
    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
    // The game reads lines aloud with the OS speech engine when a line has no recorded voice; that sound bypasses the browser's audio
    // output, so --disable-audio-output cannot silence it. Tests replace speak() with a silent stand-in that still fires start and end
    // (EG_AUDIBLE=1 keeps the real voice). window.__egSpoken counts the lines that would have been read.
    if (!process.env.EG_AUDIBLE) await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try { const S = window.speechSynthesis; if (!S) return; window.__egSpoken = 0;
      S.speak = function (u) { window.__egSpoken++; setTimeout(() => { try { u.dispatchEvent(new Event('start')); u.dispatchEvent(new Event('end')); } catch (e) {} }, 0); }; } catch (e) {} })();` });
    await send('Page.navigate', { url });
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) { await sleep(500); ready = await evaluate(`!!document.querySelector('#go') && !document.querySelector('#go').disabled`).catch(() => false); }
    ready ? ok('page loaded, atlas built, start button enabled') : bad('start button never enabled (atlas build or script failure)');
    if (!ready) return;

    const result = await evaluate(`(async () => {
      const step = window.__step = (n, dt = 1/60) => { for (let k = 0; k < n; k++) { time += dt; shared.uTime.value = time; logic(dt); visuals(dt); } renderer.render(scene, camera); };
      document.querySelector('#go').click();   // whole probe runs synchronously, so the page's own frame loop cannot interleave
      const out = { spells: {}, peakParticles: 0, glErrors: [] };
      // freeze every monster so the probe measures spells, not a lost fight; park all but nine far away
      const line = () => { const al = enemies.filter(e => e.alive); al.forEach((e, i) => { e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 });
        if (i < 9) e.pos.set(-5 + i * 1.3, 0, -6 - (i % 3) * 1.5); else { const a = i / al.length * 6.283; e.pos.set(Math.cos(a) * 36, 0, Math.sin(a) * 36); } });
        player.hp = player.maxhp; step(1); return al; };
      const aimAt = (e) => { const v = e.pos.clone().project(camera); mouse.set(v.x, v.y); };
      for (const id of ['fire', 'bolt', 'meteor', 'blood']) {
        const al = line(); aimAt(al.slice(0, 9).sort((a, b) => a.pos.distanceTo(player.pos) - b.pos.distanceTo(player.pos))[0]);
        const k0 = player.kills, hp0 = enemies.reduce((s, e) => s + (e.alive ? e.hp : 0), 0);
        player.cast = null; cds[id] = 0; tryCast(id);
        for (let f = 0; f < 240; f++) { step(1); out.peakParticles = Math.max(out.peakParticles, ADD.list.length + SMOKE.list.length); }
        const hp1 = enemies.reduce((s, e) => s + (e.alive ? e.hp : 0), 0);
        out.spells[id] = { damage: Math.round(hp0 - hp1), kills: player.kills - k0 };
        step(200);
      }
      const gl = renderer.getContext();
      for (const m of [0, 1, 2]) { setRoute(m); step(3); const e = gl.getError(); if (e) out.glErrors.push(m + ':' + e); }
      setRoute(0);
      const before = player.maxhp; const it = makeItem(); it.base = BASES[2]; it.type = 'armor'; it.slot = 'body'; it.w = 2; it.h = 3; it.st = { hp: 30 };
      place(it); equip(it); out.equipDelta = player.maxhp - before;
      out.killsTotal = player.kills; out.lootOnGround = loots.length;
      return out; })()`);
    for (const [id, r] of Object.entries(result.spells)) r.damage > 0 ? ok(`spell ${id} dealt ${r.damage} damage, ${r.kills} kills`) : bad(`spell ${id} dealt no damage`);
    result.peakParticles > 200 ? ok(`peak particles on screen ${result.peakParticles}`) : bad(`peak particles only ${result.peakParticles}`);
    result.glErrors.length === 0 ? ok('all three texture routes render without GL errors') : bad('GL errors ' + result.glErrors.join(','));
    result.equipDelta === 30 ? ok('equipping +30 HP armour raises max HP by 30') : bad(`equip delta ${result.equipDelta}`);
    result.killsTotal > 0 ? ok(`total kills ${result.killsTotal}, loot on ground ${result.lootOnGround}`) : bad('no kills');
    // ---- story mode: opening -> four towers -> boss -> ending
    const st = await evaluate(`(() => {
      const step = window.__step, skip = () => { for (let k = 0; k < 50 && (dlg || !document.querySelector('#result').hidden); k++) { if (dlg) endDialog(); else closeResult(); } };
      startStory(); player.maxhp = player.hp = 1e9;
      const out = { acts: [], lockedAtStart: [...['bolt','meteor','blood']].filter(id => !story.unlocked.has(id)).length, fireTierAtStart: tierOf('fire') };
      skip();
      for (let a = 0; a < 4; a++) {
        if (story.phase !== 'fight') { out.acts.push('act ' + a + ' not in fight: ' + story.phase); break; }
        for (const e of enemies) if (e.alive) killEnemy(e);
        step(2);
        const T = TOWERS[a]; player.pos.set(T.x + 1, 0, T.z + 1); player.hp = player.maxhp;
        step(230); skip(); step(70); skip();
        out.acts.push(T.name + ':' + (T.lit ? 'lit' : 'dark'));
      }
      out.unlocked = [...story.unlocked].sort().join(','); out.fireTier = tierOf('fire');
      out.bossSpawned = !!(story.boss && story.boss.alive); out.phaseAtBoss = story.phase;
      if (story.boss) { player.pos.set(0, 0, 10); step(400); out.shocksSeen = shocks.length > 0 || story.boss.shockT < 5.2;
        story.boss.hp = story.boss.maxhp * 0.45; step(5); skip(); out.darkTriggered = !!story.boss.flags.dark; // set HP directly: dealDamage can crit and kill outright
        dealDamage(story.boss, story.boss.hp + 1, 'fire'); step(240); skip(); step(5); }
      out.ending = !document.querySelector('#ending').hidden; out.phaseEnd = story.phase;
      return out; })()`);
    st.lockedAtStart === 3 && st.fireTierAtStart === 0 ? ok('story starts with basic fireball only') : bad(`story start state wrong: ${JSON.stringify(st)}`);
    st.acts.length === 4 && st.acts.every((s) => s.endsWith(':lit')) ? ok('all four towers lit: ' + st.acts.join(' ')) : bad('towers: ' + st.acts.join(' | '));
    st.unlocked === 'blood,bolt,fire,meteor' && st.fireTier === 1 ? ok('all four spells unlocked, fireball upgraded') : bad(`unlocks ${st.unlocked} tier ${st.fireTier}`);
    st.bossSpawned ? ok('boss spawned after the fourth tower') : bad('boss missing, phase ' + st.phaseAtBoss);
    st.shocksSeen && st.darkTriggered ? ok('boss shockwave and darkness phase triggered') : bad(`boss mechanics shock=${st.shocksSeen} dark=${st.darkTriggered}`);
    st.ending ? ok('ending screen shown') : bad('ending not shown, phase ' + st.phaseEnd);
    errors.length === 0 ? ok('console errors 0') : bad('console errors: ' + errors.slice(0, 5).join(' | '));
    if (fontMiss.length) console.log(`  NOTE web font did not load (${fontMiss.length}), the page used system fonts: ${fontMiss[0]}`);
    ws.close();
  } catch (e) { bad('probe crashed: ' + e.message); }
  // Windows: proc.kill() leaves Chrome's child processes running and they slow every later suite (DEVLOG #32, #34)
  finally { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); else proc.kill(); srv.close(); await sleep(300); try { rmSync(prof, { recursive: true, force: true }); } catch {} }
}

// ---------------------------------------------------------------- self-test
// load failures from these hosts are reported as a note, not an error (the page falls back to system fonts)
const FONT_URL = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
function selftest() {
  // only the web font may fail quietly: the 3D library, the model loader and look-alike hosts must still count as errors
  const quiet = ['https://fonts.googleapis.com/css2?family=Noto+Sans+TC', 'https://fonts.gstatic.com/s/notosanstc/v1/a.woff2'];
  const loud = ['https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js',
    'https://fonts.googleapis.com.evil.example/x.css', 'http://fonts.googleapis.com/css2'];
  quiet.every((u) => FONT_URL.test(u)) && loud.every((u) => !FONT_URL.test(u)) ? ok('only Google Fonts load failures are treated as a note') : bad('font-failure filter lets other hosts through or misses fonts');
  console.log('[selftest] gates must turn red on a poisoned copy');
  const dir = mkdtempSync(join(tmpdir(), 'eg-self-'));
  const poisoned = readFileSync(join(ROOT, 'index.html'), 'utf8')
    .replace('</title>', '</title><script src="https://evil.example.net/x.js"></script>')
    .replace('<script>', '<script>const p = "' + ['C:', 'Users', 'someone', 'secret'].join('/') + '"; (');
  writeFileSync(join(dir, 'index.html'), poisoned);
  const before = failures; staticGates(dir); const caught = failures - before;
  failures = before; rmSync(dir, { recursive: true, force: true });
  caught >= 3 ? ok(`poisoned copy tripped ${caught} gates (host, syntax, path)`) : bad(`poisoned copy tripped only ${caught} gates`);
  // the code budget bites at the byte: a copy padded with an extra local script to exactly the limit passes every gate, one byte more fails exactly one (DEVLOG #45)
  const budgetTrips = (extra) => {
    const d = mkdtempSync(join(tmpdir(), 'eg-budget-'));
    try {
      for (const sub of ['kit', 'content']) cpSync(join(ROOT, sub), join(d, sub), { recursive: true, filter: (s) => statSync(s).isDirectory() || s.endsWith('.js') });
      writeFileSync(join(d, 'index.html'), readFileSync(join(ROOT, 'index.html'), 'utf8').replace('<script src="kit/character.js" defer></script>', '$&\n<script src="pad.js" defer></script>'));
      writeFileSync(join(d, 'pad.js'), '');
      const { html, scripts } = pageSources(d), used = Buffer.byteLength(html) + scripts.filter((s) => s.local && s.text).reduce((n, s) => n + Buffer.byteLength(s.text), 0);
      writeFileSync(join(d, 'pad.js'), '/*' + 'x'.repeat(MAX_CODE_BYTES - used - 4 + extra) + '*/');
      const b0 = failures; staticGates(d); const n = failures - b0; failures = b0; return n;
    } finally { rmSync(d, { recursive: true, force: true }); }
  };
  const atLimit = budgetTrips(0), overLimit = budgetTrips(1);
  atLimit === 0 && overLimit === 1 ? ok(`code budget: exactly ${MAX_CODE_BYTES} B passes, one byte more fails`) : bad(`code budget gate: at the limit ${atLimit} failures, one byte over ${overLimit} failures (want 0 and 1)`);
}

const args = process.argv.slice(2);
if (args.includes('--selftest')) selftest();
else {
  const live = (args.find((a) => a.startsWith('--url=')) || '').slice(6);
  staticGates(ROOT);
  if (args.includes('--browser') || live) await browserProbe(ROOT, live || null);
}
console.log(failures ? `\nRED: ${failures} gate(s) failed` : '\nGREEN: all gates passed');
process.exit(failures ? 1 : 0);
