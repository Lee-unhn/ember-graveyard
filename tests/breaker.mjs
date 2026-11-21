#!/usr/bin/env node
// Breaker: adversarial checks for the engine/content split (kit/ + content/). Written by someone who did not make the change.
// A check that is RED here is a finding (see incoming/design/breaker_split.md); a GREEN one proves that direction was tried and held.
// It does not edit kit/, content/, index.html or any other test: every variant is built in a temp copy.
//   node tests/breaker.mjs
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { ROOT, serve, openPage, reporter, sleep } from './lib/browser.mjs';
import { pageSources, splitViolations, ownedStrings } from './lib/pagesrc.mjs';

const rep = reporter('breaker');
const BASE = '1e294ad'; // main, before the split
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const work = mkdtempSync(join(tmpdir(), 'eg-breaker-'));
const cleanups = [() => rmSync(work, { recursive: true, force: true })];

// ---------------------------------------------------------------- helpers
const freeGB = () => parseFloat(spawnSync('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB'], { encoding: 'utf8' }).stdout.replace(',', '.')) || 0;
async function waitForMemory() {
  for (let i = 0; i < 60; i++) { const g = freeGB(); if (g >= 3 || process.platform !== 'win32') return g; console.log(`  (free memory ${g.toFixed(1)} GB < 3 GB, waiting 30 s)`); await sleep(30000); }
  return freeGB();
}
function demoContent() {
  const ctx = {}; ctx.window = ctx; vm.createContext(ctx); // the content files assign to a bare global `CONTENT`, so they need a real global object
  for (const f of ['story.js', 'world.js']) vm.runInContext(read('content/demo/' + f), ctx);
  return JSON.parse(JSON.stringify(ctx.CONTENT));
}
function freshCopy(name) { // a copy of the worktree without .git / heavy folders, for planting defects
  const dir = join(work, name);
  cpSync(ROOT, dir, { recursive: true, filter: (s) => !/[\\/](\.git|node_modules)([\\/]|$)/.test(s) });
  return dir;
}
function edit(dir, file, fn) { const p = join(dir, file); const t = readFileSync(p, 'utf8'); const n = fn(t); if (n === t) throw new Error(`edit did not apply: ${file}`); writeFileSync(p, n); }
function killTree(pid) { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }); }
// run the repo's own static gates against a planted copy
function runChecksStatic(dir) { // tests/checks.mjs, stopped as soon as its static section is over (the rest needs a browser)
  return new Promise((res) => {
    const pr = spawn(process.execPath, [join(ROOT, 'tests', 'checks.mjs')], { env: { ...process.env, EG_ROOT: dir }, cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = ''; const done = () => { killTree(pr.pid); res(out); };
    const t = setTimeout(done, 30000);
    pr.stdout.on('data', (d) => { out += d; if (/README links the development log/.test(out)) { clearTimeout(t); setTimeout(done, 100); } });
    pr.on('exit', () => { clearTimeout(t); res(out); });
  });
}
const failLines = (out) => out.split('\n').filter((l) => /^\s+FAIL /.test(l)).map((l) => l.trim());
function runSmokeStatic(dir) { const r = spawnSync(process.execPath, [join(dir, 'scripts', 'smoke.mjs')], { cwd: dir, encoding: 'utf8', timeout: 60000 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; }

// ================================================================ A. behaviour parity with main (static, git)
// The hardening that fixed this report's findings (DEVLOG §5 #68-#80) is the ONLY allowed difference from main, and it is spelled out:
//  - new engine lines carry the marker /*H*/ at the start of the line (only core.js and boot.js may hold them, checked below);
//  - the few main lines that had to change are undone by REVERSE (kit text -> main text), each replacement must really occur in kit/;
//  - HTML_FORWARD turns main's index.html into what the page must look like now (content-specific text moved into the content pack).
// Anything else that differs from main is still a finding.
const MARK = '/*H*/';
const REVERSE = [["EG_KEY('eg-save')", "'eg-save'"], ["EG_KEY('eg-settings')", "'eg-settings'"], ["EG_KEY('eg-keys')", "'eg-keys'"],
  ['for(const a of ACTS.slice(0,fromAct))if(a.dlg)story.seen.add(a.dlg)', "story.seen.add('intro')"]];
const HTML_FORWARD = [['<div class="nm">無燈之主</div>', '<div class="nm"></div>'],
  ['<p class="note" id="introNote">故事模式約 15 分鐘：點亮四座燈塔、學會四招法術，最後對上無燈之主。自由試玩：四招全開，可切換拆解台。需要鍵盤與滑鼠；怪物死後會掉裝備，走過去自動撿起，按 I 穿上。</p>', '<p class="note" id="introNote"></p>'],
  ['color:#d6cdb9">四座燈塔重新亮起。燼語墓園今晚會很安靜。</p>', 'color:#d6cdb9"></p>']];
const unhardened = (t) => t.split('\n').filter((l) => !l.trim().startsWith(MARK)).join('\n');
const reversed = (t) => REVERSE.reduce((s, [now, was]) => s.split(now).join(was), t);
function parity() {
  const git = (a) => spawnSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const old = git(['show', `${BASE}:index.html`]);
  if (old.status !== 0) { rep.ok(false, `parity: cannot read ${BASE}:index.html from git`, old.stderr); return; }
  const mainTags = [...old.stdout.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).sort((a, b) => b.length - a.length);
  const { scripts } = pageSources(ROOT);
  const kitBlockingRaw = scripts.filter((s) => s.local && !s.defer && /^kit\//.test(s.src));
  const kitBlocking = reversed(unhardened(kitBlockingRaw.map((s) => s.text).join('\n')));
  const Hlines = kitBlockingRaw.map((s) => [s.src, s.text.split('\n').filter((l) => l.trim().startsWith(MARK)).length]).filter(([, n]) => n);
  rep.ok(Hlines.every(([f]) => f === 'kit/core.js' || f === 'kit/boot.js'), 'parity: the /*H*/ hardening marker appears only in kit/core.js and kit/boot.js (content validation, load errors, page text from content)', Hlines);
  const allKit = kitBlockingRaw.map((s) => s.text).join('\n');
  const unused = REVERSE.filter(([now]) => !allKit.includes(now)).map(([now]) => now);
  rep.ok(unused.length === 0, 'parity: every recorded replacement of a main line really occurs in kit/ (the list of allowed deviations cannot rot)', unused);
  const norm = (t) => t.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
  const A = norm(mainTags[0]), B = norm(kitBlocking), sa = new Set(A), sb = new Set(B);
  const demo = JSON.stringify(demoContent());
  const contentish = (l) => /assets\/voice/.test(l) || /[一-鿿]/.test(l) &&/沐炎|灰翁|無燈之主|焰之塔|[雷星血]之塔|assets\/voice|[a-z]\d?:\[\[|\['(?:elder|lord|mu)'|^(?:mu|elder|lord):'<rect/.test(l)
    || /^const (TOWER_POS|PORTRAITS|SPEAKERS|DLG|TOWERS|ACTS)=/.test(l) || /^(?:intro|t\d|dark|end):\[\[/.test(l) || /^\{name:'/.test(l) || /^\['(?:elder|lord|mu)'/.test(l)
    || /^(?:mu|elder|lord):['{]/.test(l) || /^loop\(\);$/.test(l) || /^lord:\{hp:4200/.test(l);
  const onlyMain = A.filter((l) => !sb.has(l) && !contentish(l)), onlyKit = B.filter((l) => !sa.has(l) && !/CONTENT/.test(l));
  rep.ok(onlyMain.length === 0 && onlyKit.length === 0, 'parity: kit/ blocking scripts equal main\'s inline game script line by line except content and CONTENT reads', { onlyMain: onlyMain.slice(0, 5), onlyKit: onlyKit.slice(0, 5) });
  const stripScripts = (h) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const forward = HTML_FORWARD.reduce((s, [a, b]) => s.split(a).join(b), old.stdout);
  const ha = stripScripts(forward), hb = stripScripts(read('index.html'));
  rep.ok(JSON.stringify(ha) === JSON.stringify(hb) && HTML_FORWARD.every(([a]) => old.stdout.includes(a)), 'parity: index.html markup (scripts and comments removed) is unchanged except the three texts that moved into the content pack (boss name, intro note, ending note), so every element id, label and default text is the same');
  const moved = []; for (const f of ['controls', 'pixel', 'lighting', 'detail', 'mist', 'postfx']) if (git(['show', `${BASE}:assets/${f}.js`]).stdout !== reversed(read(`kit/${f}.js`))) moved.push(f);
  rep.ok(moved.length === 0, 'parity: the six deferred modules moved to kit/ byte for byte (apart from the storage keys going through EG_KEY)', moved);
  // the keys the player's browser data lives under must be the very same strings as before
  const keys = (t) => [...t.matchAll(/['"](eg-[a-z]+)['"]/g)].map((m) => m[1]).sort().join();
  rep.ok(keys(mainTags[0] + git(['show', `${BASE}:assets/controls.js`]).stdout + git(['show', `${BASE}:assets/postfx.js`]).stdout) === keys(allKit + read('kit/controls.js') + read('kit/postfx.js')), 'parity: storage key names (eg-settings, eg-keys, eg-save) unchanged');
}

// ================================================================ B. isolation: can the split check be fooled, is kit/ really clean
function isolation() {
  const kit = (text) => [{ name: 'kit/x.js', text }];
  const content = (text) => [{ name: 'content/y.js', text }];
  const okContent = 'window.CONTENT={dialog:{a:[["x","一二三四五六七八"]]},speakers:{s:{n:"灰翁"}},towers:[{name:"焰之塔"}],text:{bossName:"無燈之主"}};';
  // control: the detector does fire on the plain form
  rep.ok(splitViolations(kit("const a='灰翁';"), content(okContent)).length > 0, 'isolation(control): a plain planted speaker name in kit/ is flagged');
  // the same with the REAL content files (they write to a bare global `CONTENT`; the detector evaluates them with a `window` argument only)
  const realContent = ['story.js', 'world.js'].map((f) => ({ name: 'content/demo/' + f, text: read('content/demo/' + f) }));
  const realHits = (s) => splitViolations(kit(`const a='${s}';`), realContent).filter((v) => v.startsWith('kit/'));
  rep.ok(realHits('燈火守著亡者的夢。火一滅，他們就醒了，而且很餓。').length > 0 && realHits('星之塔').length > 0, 'isolation: with the real content files, a dialogue sentence or a tower name copied into kit/ is caught (the strings are read from the content pack)',
    { dialogueLine: realHits('燈火守著亡者的夢。火一滅，他們就醒了，而且很餓。').length, towerName: realHits('星之塔').length });
  const seen = ownedStrings(realContent);
  rep.ok(seen.errors.length === 0 && seen.read === realContent.length && seen.owned.size > 20 && seen.owned.has('星之塔') && seen.owned.has('燈火守著亡者的夢。火一滅，他們就醒了，而且很餓。'), 'isolation(self-check): the detector really read the real content files (every file ran, tower names and dialogue lines are in its list)', { files: seen.read, of: realContent.length, strings: seen.owned.size, errors: seen.errors });
  const slipped = (list) => list.filter(([, k, c]) => splitViolations(k, c).length === 0).map(([n]) => n);
  rep.ok(slipped([['unicode-escape', kit("const a='\\u7070\\u7fc1';"), content(okContent)], ['concatenation', kit("const a='灰'+'翁';"), content(okContent)]]).length === 0,
    'isolation: a demo name written as \\u escapes or as two joined strings in kit/ is still caught', slipped([['unicode-escape', kit("const a='\\u7070\\u7fc1';"), content(okContent)], ['concatenation', kit("const a='灰'+'翁';"), content(okContent)]]));
  rep.ok(splitViolations(kit("const a='燈熄了。';"), content('window.CONTENT={dialog:{a:[["x","燈熄了。"]]}};')).length > 0, 'isolation: a short (under 6 characters) dialogue line copied into kit/ is caught');
  rep.ok(splitViolations(kit("toast('Z龍');"), content('window.CONTENT={text:{bossName:"Z龍"}};')).length > 0, 'isolation: a content pack\'s own boss name (CONTENT.text.bossName) copied into kit/ is caught, not just the hard-coded demo names');
  const hide = [['template-literal', "window.CONTENT={a:`${(()=>{document.title='x';})()}`};"], ['apostrophe-in-comment', "window.CONTENT={a:1}; /* ' */ function hid(){ THREE.x=1 } /* ' */"]];
  const hid = hide.filter(([, t]) => splitViolations([], content(t)).length === 0).map(([n]) => n);
  rep.ok(hid.length === 0, 'isolation: engine logic cannot hide inside a template literal or behind an apostrophe in a comment of a content file', hid);
  const eff = [['localStorage', 'window.CONTENT={get a(){localStorage.clear();return 1}};'], ['fetch', 'window.CONTENT={get a(){return fetch("x")}};'], ['eval', 'window.CONTENT={get a(){return eval("1")}};'], ['setTimeout', 'window.CONTENT={get a(){return setTimeout(0)}};']];
  const slip = eff.filter(([, t]) => splitViolations([], content(t)).length === 0).map(([n]) => n);
  rep.ok(slip.length === 0, 'isolation: a content file with side effects (localStorage / fetch / eval / timers / getters) is flagged as engine logic', slip);
  // does the real gate look at the content pack index.html loads, or only at the folder called demo?
  const dir = freshCopy('gate-private');
  mkdirSync(join(dir, 'content', 'private'), { recursive: true });
  const C = demoContent(); C.speakers.mu.n = '乙丙測試名'; writeFileSync(join(dir, 'content', 'private', 'pack.js'), 'window.CONTENT=' + JSON.stringify(C) + ';\n');
  edit(dir, 'index.html', (h) => h.replace(/<script src="content\/demo\/story.js"><\/script>\n<script src="content\/demo\/world.js"><\/script>/, '<script src="content/private/pack.js"></script>'));
  edit(dir, 'kit/ui.js', (t) => t + "\ntoast('乙丙測試名');\n");
  return runChecksStatic(dir).then((out) => {
    const row = out.split('\n').find((l) => /kit\/ holds no demo content/.test(l)) || '';
    rep.ok(/FAIL/.test(row), 'isolation: the split gate follows the content scripts index.html loads (a kit/ file holding a name from content/private/ must turn it red)', row.trim() || out.slice(-300));
  });
}
function kitHoldsNoDemo() {
  const owned = ['沐炎', '灰翁', '無燈之主', '焰之塔', '雷之塔', '星之塔', '血之塔'];
  const hits = [];
  const walk = (d) => { for (const n of readdirSync(join(ROOT, d))) { const p = d + '/' + n; if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (!/\.(ogg|png|jpg)$/.test(n)) { const t = read(p); for (const w of owned) if (t.includes(w)) hits.push(`${p}: ${w}`); } } };
  walk('kit');
  rep.ok(hits.length === 0, 'isolation: nothing under kit/ (docs included) names a demo speaker, tower or boss', hits);
  const html = read('index.html'); const inHtml = owned.filter((w) => html.includes(w));
  rep.ok(inHtml.length === 0, 'isolation: index.html (the page that is meant to be reused with another pack) names no demo speaker, tower or boss', inHtml);
  const stale = ['README.md', 'docs/VOICE.md', 'docs/METHOD.md', 'docs/GODOT.md', 'docs/ROUTES.md', 'docs/SCREENS.md'].filter((f) => /assets\/(mage-model|voice|controls|character|pixel|postfx|lighting|detail|mist)/.test(read(f)));
  rep.ok(stale.length === 0, 'docs: no document still points at the old assets/ locations of the model, voices or scripts (they moved to content/demo/ and kit/)', stale);
  const lit = [...read('kit/story.js').matchAll(/['"](intro|t[1-9]|dark|end)['"]/g)].map((m) => m[1]);
  rep.ok(lit.filter((x) => x !== 'dark' && x !== 'end').length === 0, 'isolation: kit/story.js refers to no dialogue id except the two documented ones (dark, end)', [...new Set(lit)]);
}

// ================================================================ C. gates: do the new static gates miss real problems
async function gates() {
  const smokeOf = (dir) => runSmokeStatic(dir);
  const d0 = freshCopy('gate-base'); const baseChecks = new Set(failLines(await runChecksStatic(d0))), baseSmoke = new Set(failLines(smokeOf(d0).out));
  rep.ok(baseChecks.size === 0 && baseSmoke.size === 0, 'gates(control): an untouched copy passes the own static gates of the repo (so a red below is caused by the planted defect)', [...baseChecks, ...baseSmoke]);
  const added = (out, base) => failLines(out).filter((l) => !base.has(l));
  // 1. a local engine script outside kit/ and content/ is not counted by the 200 KB code budget
  let dir = freshCopy('gate-budget');
  mkdirSync(join(dir, 'vendor'), { recursive: true }); writeFileSync(join(dir, 'vendor', 'big.js'), '/*' + 'x'.repeat(300 * 1024) + '*/\n');
  edit(dir, 'index.html', (h) => h.replace('<script src="kit/controls.js" defer></script>', '<script src="kit/controls.js" defer></script>\n<script src="vendor/big.js" defer></script>'));
  let r = smokeOf(dir);
  rep.ok(added(r.out, baseSmoke).length > 0, 'gates: 300 KB of extra local script outside kit/ and content/ turns the code budget red', r.out.split('\n').filter((l) => /code|FAIL/.test(l)).slice(0, 4));
  // 2. content script with defer / async passes the order gate although it runs after kit/
  for (const attr of ['defer', 'async']) {
    dir = freshCopy('gate-' + attr);
    edit(dir, 'index.html', (h) => h.replace('<script src="content/demo/story.js">', `<script src="content/demo/story.js" ${attr}>`));
    const out = await runChecksStatic(dir);
    rep.ok(added(out, baseChecks).length > 0, `gates: a content script marked ${attr} (so it runs after kit/ has already read window.CONTENT) turns a static gate red`, out.split('\n').filter((l) => /content scripts/.test(l)));
  }
  // 3. kit files in the wrong order
  dir = freshCopy('gate-order');
  edit(dir, 'index.html', (h) => h.replace('<script src="kit/core.js"></script>\n<script src="kit/world.js"></script>', '<script src="kit/world.js"></script>\n<script src="kit/core.js"></script>'));
  let out = await runChecksStatic(dir);
  rep.ok(added(out, baseChecks).length > 0, 'gates: kit/world.js listed before kit/core.js turns a static gate red', out.split('\n').filter((l) => /order|before/.test(l)).slice(0, 3));
  // 4. duplicate function across two kit files (the check the split had to rework): control, must stay green-detecting
  dir = freshCopy('gate-dupfn');
  edit(dir, 'kit/core.js', (t) => t + '\nfunction breakerDup(){return 1}\n'); edit(dir, 'kit/ui.js', (t) => t + '\nfunction breakerDup(){return 2}\n');
  out = await runChecksStatic(dir);
  rep.ok(failLines(out).some((l) => /declared twice/.test(l)), 'gates(control): the same function declared in two kit files is caught');
  // 5. duplicate top-level const across two kit files is a SyntaxError in the browser; before the split one compile of one script saw it
  dir = freshCopy('gate-dupconst');
  edit(dir, 'kit/core.js', (t) => t + '\nconst breakerDupConst=1;\n'); edit(dir, 'kit/ui.js', (t) => t + '\nconst breakerDupConst=2;\n');
  const sm = smokeOf(dir); out = await runChecksStatic(dir);
  rep.ok(added(sm.out, baseSmoke).length > 0 || added(out, baseChecks).length > 0, 'gates: the same top-level const declared in two kit files (a SyntaxError in the browser) turns a static gate red', { smokeExit: sm.code, checksFails: added(out, baseChecks).length });
  // 6. mutation test: every needle must exist exactly once in the code files, otherwise the planted defect lands somewhere else than intended
  const needles = ['<!doctype html>\n', "if(!story.unlocked.has(id)){if(story.on)note('這招還沒學會，先點亮燈塔');return}", 'A*=ss(.47,.4,', 'if(Math.random()<spreadP(nt))ch.push(', 'Math.random=mulberry32(20261115);', 'if(!running||paused||menuOpen||!player.alive)return;', 'function tnoise(x,y){'];
  const files = ['index.html', ...readdirSync(join(ROOT, 'kit')).filter((x) => x.endsWith('.js')).map((x) => 'kit/' + x)];
  const counts = needles.map((n) => files.reduce((c, f) => c + read(f).split(n).length - 1, 0));
  rep.ok(counts.every((c) => c === 1), 'gates(control): each of the seven mutation needles occurs exactly once across index.html + kit/*.js (so the planted defect lands where intended)', counts);
  // mutation 7 renames tnoise( in whichever file first contains 'function vnoise(x,y){': check it is the file that holds the planted copy, so two vnoise stay a duplicate
  const planted = files.filter((f) => read(f).includes('function tnoise(x,y){'))[0];
  const firstVn = files.find((f) => (read(f).replace('function tnoise(x,y){', 'function vnoise(x,y){')).includes('function vnoise(x,y){'));
  rep.ok(planted === firstVn, 'gates(control): mutation 7 renames tnoise( in the file that now holds the shadowing vnoise', { planted, firstVn });
}

// ================================================================ D. runtime: bad / odd content, load order, file://
const STEP = `window.__step = (n, dt = 1/60) => { for (let k = 0; k < n; k++) { time += dt; shared.uTime.value = time; if (!paused) logic(dt); visuals(dt); } };`;
const FLOW = `window.__flow = () => {
  const out = { acts: [], err: null };
  try {
    startStory(0);
    let n = 0;
    while (n++ < 5000) {
      if (dlg) endDialog(); if (!$('#result').hidden) closeResult();
      if (story.phase === 'boss' || story.phase === 'end' || story.phase === 'outro') break;
      if (story.phase === 'fight') player.kills = story.killsAt + story.goal;
      if ((story.phase === 'goto' || story.phase === 'ignite') && TOWERS[story.act]) { const T = TOWERS[story.act]; player.pos.set(T.x, 0, T.z); }
      for (const e of enemies) if (e.T && e.T.dmg) e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 });
      player.hp = player.maxhp; __step(6);
      if (out.acts[out.acts.length - 1] !== story.act) out.acts.push(story.act);
    }
  } catch (e) { out.err = String(e && e.message || e); }
  out.phase = story.phase; out.act = story.act; return out; };
window.__boss = (mode) => {
  const out = { err: null };
  try {
    const b = story.boss; for (const e of enemies) if (e !== b && e.T) e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 });
    if (mode === 'dark') { b.hp = b.maxhp * .4; for (let i = 0; i < 20; i++) { if (dlg) endDialog(); __step(5); } }
    else { b.hp = 0; killEnemy(b); for (let i = 0; i < 400 && story.phase !== 'end'; i++) { if (dlg) endDialog(); __step(5); } }
  } catch (e) { out.err = String(e && e.message || e); }
  out.phase = story.phase; return out; };`;

const exceptions = (p) => p.errors.filter((e) => !/Failed to load resource/.test(e));
async function runtime() {
  const mem = await waitForMemory();
  console.log(`  (free memory ${mem.toFixed(1)} GB, opening one headless Chrome)`);
  const site = join(work, 'site'); mkdirSync(site, { recursive: true });
  for (const d of ['kit', 'content']) cpSync(join(ROOT, d), join(site, d), { recursive: true });
  const html0 = read('index.html');
  const tagPair = '<script src="content/demo/story.js"></script>\n<script src="content/demo/world.js"></script>';
  if (!html0.includes(tagPair)) throw new Error('index.html content script tags changed shape');
  const writeVariant = (name, mutate, { html } = {}) => {
    const C = demoContent(); mutate && mutate(C);
    writeFileSync(join(site, 'content', name + '.js'), 'window.CONTENT = window.CONTENT || {};\nObject.assign(window.CONTENT, ' + JSON.stringify(C) + ');\n');
    writeFileSync(join(site, name + '.html'), (html ? html(html0) : html0).replace(tagPair, `<script src="content/${name}.js"></script>`));
  };
  // ---- variants
  writeVariant('control');
  const fields = ['portraits', 'speakers', 'dialog', 'towers', 'towerPos', 'acts', 'text'];
  for (const f of fields) writeVariant('missing_' + f, (C) => { delete C[f]; });
  writeVariant('towers3', (C) => { C.towers = C.towers.slice(0, 3); C.towerPos = C.towerPos.slice(0, 3); C.acts = C.acts.slice(0, 3); });
  writeVariant('towers5', (C) => { C.towers.push({ name: '風之塔', dir: '北', spell: 'fire', col: 0x88ff88, c: [.5, 1, .5], kind: 0 }); C.towerPos.push([-10, -12]); C.acts.push({ n: 10, mix: [1, 0, 0], after: 't4' }); });
  writeVariant('acts_ne_towers', (C) => { C.acts.push({ n: 10, mix: [1, 0, 0], after: 't4' }); });
  writeVariant('after_missing', (C) => { C.acts[0].after = 'nope'; });
  writeVariant('no_dark', (C) => { delete C.dialog.dark; });
  writeVariant('no_end', (C) => { delete C.dialog.end; });
  writeVariant('unknown_speaker', (C) => { C.dialog.intro[0][0] = 'narrator'; });
  writeVariant('no_portrait_for_one', (C) => { delete C.portraits.elder; });
  writeVariant('empty_intro', (C) => { C.dialog.intro = []; });
  writeVariant('no_voiceDir', (C) => { delete C.voiceDir; });
  writeVariant('voice_missing', (C) => { C.voiceDir = 'content/none/'; });
  writeVariant('no_modelScript', (C) => { delete C.modelScript; });
  writeVariant('model_404', (C) => { C.modelScript = 'content/none/model.js'; });
  writeVariant('renamed_boss', (C) => { C.text.bossName = '白霜巨龍'; });
  writeVariant('other_pack_id', (C) => { C.id = 'frost-dragon'; C.towers.push(C.towers[0]); C.towerPos.push([-10, -12]); C.acts.push({ n: 10, mix: [1, 0, 0], after: 't4' }); });
  writeVariant('other_pack', (C) => { delete C.id; C.towers.push(C.towers[0]); C.towerPos.push([-10, -12]); C.acts.push({ n: 10, mix: [1, 0, 0], after: 't4' }); });
  // load-order / 404 variants
  writeVariant('content_after_kit', null, { html: (h) => h.replace(tagPair, '').replace('<script src="kit/boot.js"></script>', '<script src="kit/boot.js"></script>\n' + tagPair) });
  writeVariant('kit_story_404', null, { html: (h) => h.replace('kit/story.js', 'kit/story_404.js') });
  writeVariant('kit_controls_404', null, { html: (h) => h.replace('kit/controls.js', 'kit/controls_404.js') });
  writeVariant('kit_character_404', null, { html: (h) => h.replace('kit/character.js', 'kit/character_404.js') });

  const srv = await serve(site); cleanups.push(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const p = await openPage(base + 'control.html', { width: 1280, height: 800 });
  cleanups.push(() => p.close());
  const readyExpr = `!!document.querySelector('#go') && !document.querySelector('#go').disabled`;
  async function load(url, { settle = 8000 } = {}) {
    await p.send('Page.navigate', { url: 'about:blank' }); await sleep(150); p.errors.length = 0;
    await p.send('Page.navigate', { url }); const t0 = Date.now(); let ready = false;
    while (Date.now() - t0 < settle) { await sleep(200); ready = await p.evaluate(readyExpr).catch(() => false); if (ready) break; if (p.errors.length && Date.now() - t0 > 3000) break; }
    const info = await p.evaluate(`({ stuck: !!document.querySelector('#loading') && !document.querySelector('#loading').hidden && !!document.querySelector('#go') && document.querySelector('#go').disabled,
      diag: /CONTENT|載入失敗|錯誤|error/i.test((document.querySelector('#loading') || {}).innerText || '') })`).catch(() => ({ stuck: true, diag: false }));
    return { ready, ...info, exc: exceptions(p).slice(0, 3) };
  }
  const prep = async () => { await p.evaluate(STEP + FLOW + 'requestAnimationFrame = () => 0;'); };

  // ---- control
  const c = await load(base + 'control.html');
  if (!rep.ok(c.ready && c.exc.length === 0, 'runtime(control): the demo content, split into a temp copy, loads and the title screen is usable', c)) { console.log('  environment cannot load the demo page (CDN offline?); the other runtime checks are skipped'); return; }
  await prep();
  let f = await p.evaluate('__flow()');
  let b = f.phase === 'boss' ? await p.evaluate(`__boss('dark')`) : null; let e2 = f.phase === 'boss' ? await p.evaluate(`__boss('end')`) : null;
  rep.ok(f.err === null && f.phase === 'boss' && f.acts.join() === '0,1,2,3' && b && !b.err && e2 && !e2.err && e2.phase === 'end', 'runtime(control): story driven programmatically from act 1 through boss, dark dialogue and ending', { f, b, e2 });
  // save format
  const save = await p.evaluate(`(() => { writeSave(2); const s = localStorage.getItem('eg-save'); clearSave(); return s; })()`);
  rep.ok(save === '{"v":1,"act":2}', 'parity: the save written for act 3 is exactly {"v":1,"act":2}', save);

  // ---- 1. each documented field missing: expect no uncaught exception, or a visible explanation
  for (const fld of fields) {
    const r = await load(base + `missing_${fld}.html`); let use = null;
    if (r.ready) { await prep(); use = await p.evaluate(`(() => { try { startFree(); __step(30); startStory(0); __step(30); if (dlg) endDialog(); __step(30); return null; } catch (e) { return String(e.message); } })()`); }
    rep.ok((r.ready && r.exc.length === 0 && use === null) || (!r.ready && r.diag), `content: CONTENT.${fld} missing -> the page still works (free play and story start), or says what is missing on screen`, { ready: r.ready, stuckOnLoadingScreen: r.stuck, shownToPlayer: r.diag, firstException: r.exc[0] || use });
  }
  // ---- 1b. towers / acts of other sizes
  for (const v of ['towers3', 'towers5']) {
    const r = await load(base + v + '.html'); let res = { err: 'not loaded' };
    if (r.ready) { await prep(); res = await p.evaluate('__flow()'); if (res.phase === 'boss') { const e = await p.evaluate(`__boss('end')`); res.phase = e.phase; res.err = res.err || e.err; } }
    const n = v === 'towers3' ? 3 : 5;
    rep.ok(r.ready && res.err === null && res.phase === 'end' && res.acts.length === n, `content: ${n} towers and ${n} acts play from the first act to the ending`, { r: { ready: r.ready, exc: r.exc }, res });
  }
  { const r = await load(base + 'acts_ne_towers.html'); let res = { err: null, phase: '' };
    if (r.ready) { await prep(); res = await p.evaluate('__flow()'); }
    rep.ok(!r.ready ? r.diag : /CONTENT|acts|towers/i.test(String(res.err)), 'content: 5 acts with 4 towers is reported with a message that names the mismatch (not a bare TypeError)', { loaded: r.ready, err: res.err, phase: res.phase }); }
  // ---- 1c. dialogue problems
  { const r = await load(base + 'after_missing.html'); await prep(); const res = await p.evaluate('__flow()');
    rep.ok(res.err === null && res.acts.length >= 2, 'content: an act whose "after" dialogue code does not exist does not freeze the story at the first tower', { err: res.err, acts: res.acts, phase: res.phase, ready: r.ready }); }
  for (const [v, mode, label] of [['no_dark', 'dark', 'dark (half-health) dialogue'], ['no_end', 'end', 'end dialogue']]) {
    await load(base + v + '.html'); await prep(); const res = await p.evaluate('__flow()'); let bo = { err: 'no boss' };
    if (res.phase === 'boss') bo = await p.evaluate(`__boss('${mode}')`);
    rep.ok(res.err === null && !bo.err && (mode === 'dark' || bo.phase === 'end'), `content: a pack without the ${label} still gets through the boss fight`, { flowErr: res.err, boss: bo });
  }
  { await load(base + 'unknown_speaker.html'); await prep(); const res = await p.evaluate(`(() => { try { startStory(0); return { err: null, who: $('#dWho').textContent }; } catch (e) { return { err: String(e.message) }; } })()`);
    rep.ok(res.err === null, 'content: a dialogue line whose speaker is not in CONTENT.speakers shows without an exception', res); }
  { await load(base + 'no_portrait_for_one.html'); await prep(); const res = await p.evaluate(`(() => { try { startStory(0); return { err: null, svg: $('#dPortrait').innerHTML }; } catch (e) { return { err: String(e.message) }; } })()`);
    rep.ok(res.err === null && res.svg !== 'undefined', 'content: a speaker without a portrait gets an empty portrait, not the text "undefined"', res); }
  { await load(base + 'empty_intro.html'); await prep(); const res = await p.evaluate(`(() => { try { startStory(0); __step(30); return { err: null, phase: story.phase, paused }; } catch (e) { return { err: String(e.message) }; } })()`);
    rep.ok(res.err === null && res.phase === 'fight' && res.paused === false, 'content(control): an empty dialogue array is skipped and the fight starts', res); }
  // ---- 1d. voice
  { await load(base + 'no_voiceDir.html'); await prep(); p.errors.length = 0; await p.evaluate('startStory(0)'); await sleep(1200);
    rep.ok(!p.errors.some((e) => /undefined/.test(e)), 'content: a pack without voiceDir (no recordings) does not ask the server for files named "undefined…ogg"', p.errors.filter((e) => /undefined/.test(e)).slice(0, 2)); }
  { await load(base + 'voice_missing.html'); await prep(); p.errors.length = 0; const res = await p.evaluate(`(() => { try { startStory(0); return { err: null, line: $('#dLine').textContent.length >= 0 }; } catch (e) { return { err: String(e.message) }; } })()`); await sleep(1200);
    rep.ok(res.err === null && exceptions(p).length === 0, 'content(control): recordings that do not exist fall back to browser speech with no exception', { res, exc: exceptions(p).slice(0, 2) }); }
  // ---- 1e. model
  for (const v of ['no_modelScript', 'model_404']) {
    const r = await load(base + v + '.html'); await sleep(1500);
    const st = await p.evaluate(`({ ready: EGChar.state.ready, failed: EGChar.state.failed })`).catch(() => ({}));
    rep.ok(r.ready && exceptions(p).length === 0 && st.ready !== true, `content(control): ${v === 'no_modelScript' ? 'no modelScript' : 'a modelScript that 404s'} keeps the block mage and throws nothing`, { r, st, exc: exceptions(p).slice(0, 2) });
  }
  // ---- 1f. the boss name the content gives
  { await load(base + 'renamed_boss.html'); await prep(); const res = await p.evaluate(`(() => { try { startStory(0); startBoss(); return { err: null, bar: (document.querySelector('#bossbar .nm') || {}).textContent, obj: $('#objective').textContent }; } catch (e) { return { err: String(e.message) }; } })()`);
    rep.ok(res.err === null && res.bar === '白霜巨龍', 'content: CONTENT.text.bossName is what the boss health bar shows', res); }
  // ---- 1g. saves from another pack on the same origin
  { await load(base + 'control.html'); await p.evaluate(`localStorage.setItem('eg-save', JSON.stringify({ v: 1, act: 3 }))`);
    await load(base + 'other_pack.html'); const cont = await p.evaluate(`!document.querySelector('#goContinue').hidden`);
    await p.evaluate(`localStorage.removeItem('eg-save')`);
    rep.ok(!cont, 'content: a save written by the demo pack (same origin, same eg-save key) is not offered as "continue" by a different pack', { continueButtonShown: cont }); }
  { await load(base + 'control.html'); await p.evaluate(`localStorage.setItem('eg-save', JSON.stringify({ v: 1, act: 3 }))`);
    await load(base + 'other_pack_id.html'); const cont = await p.evaluate(`!document.querySelector('#goContinue').hidden`);
    const keysUsed = await p.evaluate(`(() => { writeSave(1); const k = Object.keys(localStorage).filter((x) => /^eg-/.test(x)); clearSave(); return k; })()`);
    await p.evaluate(`localStorage.removeItem('eg-save')`);
    rep.ok(!cont && keysUsed.includes('eg-save:frost-dragon'), 'content: a pack with its own CONTENT.id keeps its save under eg-save:<id> and never sees the demo save', { continueButtonShown: cont, keysUsed }); }
  { await load(base + 'control.html'); await p.evaluate(`localStorage.setItem('eg-save', JSON.stringify({ v: 1, act: 3 }))`);
    await load(base + 'control.html'); const cont2 = await p.evaluate(`!document.querySelector('#goContinue').hidden`); await p.evaluate(`localStorage.removeItem('eg-save')`);
    rep.ok(cont2, 'content(control): the demo pack (id "demo") still reads its own old eg-save key, so players keep their saves', { cont2 }); }
  // ---- 1h. optional fields missing: safe defaults and a recorded warning
  { await load(base + 'missing_speakers.html'); await prep(); const res = await p.evaluate(`(() => { try { startStory(0); return { err: null, who: $('#dWho').textContent, warn: window.__contentWarnings.length }; } catch (e) { return { err: String(e.message) }; } })()`);
    rep.ok(res.err === null && res.who === '' && res.warn > 0, 'content: a pack without speakers shows empty names and records warnings in window.__contentWarnings (no exception)', res); }

  // ---- 2. load order and missing kit files
  { const r = await load(base + 'content_after_kit.html', { settle: 5000 });
    rep.ok(r.ready || r.diag, 'load order: content loaded after kit/ -> the player gets a message (not a loading screen that never ends)', { exc: r.exc.slice(0, 1), stuckOnLoadingScreen: r.stuck, shownToPlayer: r.diag });
    rep.ok(r.exc.some((e) => /CONTENT 未載入/.test(e)), 'load order(control): content loaded after kit/ throws the explicit "CONTENT 未載入" error', r.exc.slice(0, 2)); }
  { const r = await load(base + 'kit_story_404.html', { settle: 5000 });
    rep.ok(r.ready || r.diag, 'load order: kit/story.js fails to load (404) -> the player gets a message (not a loading screen that never ends)', { exc: r.exc.slice(0, 1), stuckOnLoadingScreen: r.stuck, shownToPlayer: r.diag }); }
  for (const v of ['kit_controls_404', 'kit_character_404']) { const r = await load(base + v + '.html');
    rep.ok(r.ready && r.exc.length === 0, `load order(control): ${v.replace('_404', '')}.js (a deferred module) failing to load leaves the game playable`, { r }); }

  // ---- 3. file:// (open index.html by double-click)
  { const root = pathToFileURL(join(site, 'control.html')).href; const r = await load(root);
    let res = null; if (r.ready) { await prep(); res = await p.evaluate(`(() => { try { startFree(); __step(30); return { err: null, enemies: enemies.length }; } catch (e) { return { err: String(e.message) }; } })()`); }
    rep.ok(r.ready && r.exc.length === 0 && res && res.err === null, 'load order: opened straight from disk (file://) the page loads and free play starts', { r, res }); }
  await p.close();
}

// ================================================================ run
try {
  parity();
  await isolation();
  kitHoldsNoDemo();
  await gates();
  await runtime();
} catch (e) { rep.ok(false, 'breaker crashed', String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
finally { for (const c of cleanups.reverse()) { try { await c(); } catch {} } }
process.exit(rep.done() ? 1 : 0);
