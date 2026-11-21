#!/usr/bin/env node
// One command for every gate:  node tests/run-all.mjs [--url=https://...] [--skip-mutation]
//   smoke     static gates + gameplay/story integration probe   (scripts/smoke.mjs)
//   unit      37+ in-page unit tests                             (tests/unit.mjs)
//   e2e       real keyboard/mouse flows                          (tests/e2e.mjs)
//   checks    performance, leaks, phone width, a11y, docs, diagrams (tests/checks.mjs)
//   screens   every menu/result screen at desktop + phone size: screenshot + layout rules (tests/screens.mjs)
//   breaker   adversarial checks for the engine/content split: odd content packs, load failures, gate bypasses (tests/breaker.mjs)
//   mutation  copy the project, plant defects, require the suites to turn red
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('--url='));
const run = (file, extra = [], env = {}) => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(ROOT, file), ...extra], { stdio: 'inherit', env: { ...process.env, ...env }, timeout: 600000 });
  return { code: r.status ?? 1, secs: ((Date.now() - t0) / 1000).toFixed(1) };
};
const rows = [];
rows.push(['smoke', run('scripts/smoke.mjs', url ? [url] : ['--browser'])]);
rows.push(['smoke selftest', run('scripts/smoke.mjs', ['--selftest'])]);
rows.push(['unit', run('tests/unit.mjs', url ? [url] : [])]);
rows.push(['e2e', run('tests/e2e.mjs', url ? [url] : [])]);
rows.push(['checks', run('tests/checks.mjs', url ? [url] : [])]);
rows.push(['screens', run('tests/screens.mjs', url ? [url.slice(6)] : [])]);
if (!url) rows.push(['breaker', run('tests/breaker.mjs')]); // builds its own temporary sites, so it has no --url mode

if (!args.includes('--skip-mutation') && !url) {
  // plant fourteen defects in a scratch copy; the suites must notice
  const dir = mkdtempSync(join(tmpdir(), 'eg-mut-'));
  try {
    cpSync(ROOT, dir, { recursive: true, filter: (s) => !/[\\/]\.git([\\/]|$)/.test(s) });
    // the game code now lives in kit/*.js (engine) next to index.html; each defect is planted in whichever file holds its line (DEVLOG §4 #40)
    const codeFiles = ['index.html', ...readdirSync(join(dir, 'kit')).filter((x) => x.endsWith('.js')).map((x) => 'kit/' + x)];
    const src = Object.fromEntries(codeFiles.map((x) => [x, readFileSync(join(dir, x), 'utf8')]));
    const plant = (needle, replacement) => {
      const hit = codeFiles.find((x) => src[x].includes(needle));
      if (!hit) throw new Error('mutation did not apply: ' + needle);
      src[hit] = src[hit].replace(needle, () => replacement);
    };
    plant('<!doctype html>\n', '');                                                                   // 1. drop doctype (the quirks-mode bug from P0)
    plant("if(!story.unlocked.has(id)){if(story.on)note(`這招還沒學會，先${EG_TERM.light}${EG_TERM.tower}`);return}", '');   // 2. lose the spell lock
    plant('A*=ss(.47,.4,', 'A*=ss(.5,.42,');                                                           // 3. reintroduce atlas edge bleed
    plant('if(Math.random()<spreadP(nt))ch.push(', 'if(false)ch.push(');                              // 4. fire stops spreading (P2 terrain)
    plant('Math.random=mulberry32(20261115);', '');                                                    // 5. world props no longer seeded
    plant('if(!running||paused||menuOpen||!player.alive)return;', 'if(!running||paused||!player.alive)return;'); // 6. spells cast behind the pause menu (P3a)
    plant('function tnoise(x,y){', 'function vnoise(x,y){');                                           // 7. terrain noise shadows the atlas noise (P3a bug)
    plant('EG_FLOW.preBoss?playDialog(EG_FLOW.preBoss,startBoss):startBoss()', 'startBoss()');                // 10. the content field flow.preBoss is ignored (DEVLOG timeline #43)
    plant('scene.remove(e.g);egFree(e.g);list.splice(i,1)', 'scene.remove(e.g);list.splice(i,1)');          // 11. monsters stop giving their geometry back (DEVLOG timeline #44, F10)
    plant('else if(egBossDownRestart()){}else{', 'else{');                                                    // 12. dying right after the boss falls sends the player back to act 4 (F06)
    plant('>=c&&d<bd', '>=-2&&d<bd');                                                                          // 13. fireball homing ignores the cone and chases a monster behind it (DEVLOG timeline #45)
    plant('const s=spellP(id),cs=castMul();', 'const s=SPELL_DEF[id],cs=castMul();');                         // 14. a cooldown override is not read by the cast (DEVLOG timeline #45)
    src[codeFiles.find((x) => src[x].includes('function vnoise(x,y){'))] = src[codeFiles.find((x) => src[x].includes('function vnoise(x,y){'))].replace(/tnoise\(/g, 'vnoise(');
    for (const x of codeFiles) writeFileSync(join(dir, x), src[x]);
    const g = join(dir, 'godot', 'main.gd'), gd = readFileSync(g, 'utf8');                // 8. Godot particles lose their scale (P5 bug)
    if (!gd.includes('m.billboard_keep_scale = true')) throw new Error('mutation did not apply: billboard_keep_scale');
    writeFileSync(g, gd.replace('m.billboard_keep_scale = true', 'pass'));
    const px = join(dir, 'kit', 'pixel.js'), pj = readFileSync(px, 'utf8'), keepClear = 'renderer.autoClear = false; renderer.render(quadScene, quadCam);'; // 9. pixel overlay wipes the scene (P6 bug)
    if (!pj.includes(keepClear)) throw new Error('mutation did not apply: pixel overlay autoClear');
    writeFileSync(px, pj.replace(keepClear, 'renderer.render(quadScene, quadCam);'));
    const env = { EG_ROOT: dir };
    const u = run('tests/unit.mjs', [], env), c = run('tests/checks.mjs', [], env);
    rows.push(['mutation (must be red)', { code: u.code !== 0 && c.code !== 0 ? 0 : 1, secs: (+u.secs + +c.secs).toFixed(1) }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// every suite must close its headless Chrome completely: leftovers slowed local runs from about 2 to 8 minutes (DEVLOG #32, #34)
if (process.platform === 'win32') {
  // taskkill returns before every child has exited, so give the tree up to 15 s to disappear before judging (5 s was too short on a loaded machine, DEVLOG #48)
  const count = () => parseInt(spawnSync('powershell', ['-NoProfile', '-Command', "@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -match 'remote-debugging-port=0' -and $_.CommandLine -match 'headless' }).Count"], { encoding: 'utf8' }).stdout, 10);
  let left = count();
  for (let k = 0; k < 30 && left; k++) { spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},500)']); left = count(); }
  rows.push(['no leftover headless Chrome', { code: left === 0 ? 0 : 1, secs: '0.0' }]);
  if (left) console.log(`  ${left} headless Chrome processes are still running after the suites`);
}

console.log('\n=== summary ===');
for (const [name, r] of rows) console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${name.padEnd(24)} ${r.secs}s`);
const failed = rows.filter(([, r]) => r.code !== 0).length;
console.log(failed ? `\nRED: ${failed} suite(s) failed` : '\nGREEN: every suite passed');
process.exit(failed ? 1 : 0);
