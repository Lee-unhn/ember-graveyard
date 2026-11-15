#!/usr/bin/env node
// One command for every gate:  node tests/run-all.mjs [--url=https://...] [--skip-mutation]
//   smoke     static gates + gameplay/story integration probe   (scripts/smoke.mjs)
//   unit      37+ in-page unit tests                             (tests/unit.mjs)
//   e2e       real keyboard/mouse flows                          (tests/e2e.mjs)
//   checks    performance, leaks, phone width, a11y, docs, diagrams (tests/checks.mjs)
//   mutation  copy the project, plant defects, require the suites to turn red
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
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

if (!args.includes('--skip-mutation') && !url) {
  // plant four defects in a scratch copy; the suites must notice
  const dir = mkdtempSync(join(tmpdir(), 'eg-mut-'));
  try {
    cpSync(ROOT, dir, { recursive: true, filter: (s) => !/[\\/]\.git([\\/]|$)/.test(s) });
    const f = join(dir, 'index.html');
    let h = readFileSync(f, 'utf8');
    h = h.replace(/^<!doctype html>\n/i, '')                                         // 1. drop doctype (the quirks-mode bug from P0)
      .replace("if(!story.unlocked.has(id)){if(story.on)note('這招還沒學會，先點亮燈塔');return}", '') // 2. lose the spell lock
      .replace('A*=ss(.47,.4,', 'A*=ss(.5,.42,')                                     // 3. reintroduce atlas edge bleed
      .replace('if(Math.random()<spreadP(nt))ch.push(', 'if(false)ch.push(');            // 4. fire stops spreading (P2 terrain)
    for (const needle of ['<!doctype html>', "if(!story.unlocked.has(id))", 'A*=ss(.47,.4,', 'if(Math.random()<spreadP(nt))ch.push('])
      if (readFileSync(f, 'utf8').includes(needle) && h.includes(needle)) throw new Error('mutation did not apply: ' + needle);
    writeFileSync(f, h);
    const env = { EG_ROOT: dir };
    const u = run('tests/unit.mjs', [], env), c = run('tests/checks.mjs', [], env);
    rows.push(['mutation (must be red)', { code: u.code !== 0 && c.code !== 0 ? 0 : 1, secs: (+u.secs + +c.secs).toFixed(1) }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log('\n=== summary ===');
for (const [name, r] of rows) console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${name.padEnd(24)} ${r.secs}s`);
const failed = rows.filter(([, r]) => r.code !== 0).length;
console.log(failed ? `\nRED: ${failed} suite(s) failed` : '\nGREEN: every suite passed');
process.exit(failed ? 1 : 0);
