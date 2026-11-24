#!/usr/bin/env node
// Plant each per-cast, terrain-action, spell-extension and pose defect (tests/lib/spellkit-mutations.mjs) ALONE in a scratch copy and
// require the unit pages named in the list (--spellkit-only or --sprites-only) to turn red. tests/run-all.mjs plants every defect at
// once, which only proves that the suites as a whole notice; this proves each defect is caught.
//   node tests/spellkit-mutations.mjs [--only=<index>[,<index>...]] [--from=<index>] [--to=<index>]   (about 1 to 2 minutes per defect)
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { SPELLKIT_MUTATIONS } from './lib/spellkit-mutations.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
const only = arg('only') ? arg('only').split(',').map(Number) : null, from = +(arg('from') || 0), to = arg('to') === '' ? Infinity : +arg('to');
const rows = [];
for (const [i, [needle, repl, suite]] of SPELLKIT_MUTATIONS.entries()) {
  if (only ? !only.includes(i) : i < from || i > to) continue;
  const dir = mkdtempSync(join(tmpdir(), 'eg-kmut-'));
  try {
    cpSync(ROOT, dir, { recursive: true, filter: (s) => !/(^|[\\/])(\.git|incoming|godot|\.screens|\.claude)([\\/]|$)/.test(relative(ROOT, s)) });   // relative: this checkout may itself sit under a .claude folder
    const files = ['index.html', ...readdirSync(join(dir, 'kit')).filter((x) => x.endsWith('.js')).map((x) => 'kit/' + x)].map((x) => join(dir, x));
    const hit = files.filter((f) => readFileSync(f, 'utf8').includes(needle));
    if (hit.length !== 1) { rows.push([i, needle, `needle found in ${hit.length} files`]); console.log(`${i}. ${rows.at(-1)[2]}`); continue; }
    writeFileSync(hit[0], readFileSync(hit[0], 'utf8').replace(needle, () => repl));
    const r = spawnSync(process.execPath, [join(ROOT, 'tests', 'unit.mjs'), '--' + suite + '-only'], { env: { ...process.env, EG_ROOT: dir }, encoding: 'utf8', timeout: 900000 });
    const fails = (r.stdout || '').split('\n').filter((l) => /^\s+FAIL /.test(l)).map((l) => l.trim().slice(5, 110));
    rows.push([i, needle, r.status !== 0 ? `RED (${fails.length}): ${fails[0] || '(runner)'}` : 'GREEN - not caught']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  console.log(`${rows.at(-1)[0]}. ${rows.at(-1)[2]}\n     ${rows.at(-1)[1].slice(0, 110)}`);
}
const missed = rows.filter((r) => !r[2].startsWith('RED'));
console.log(missed.length ? `\n${missed.length} defect(s) NOT caught: ${missed.map((r) => r[0]).join(', ')}` : `\nall ${rows.length} defects caught one at a time`);
process.exit(missed.length ? 1 : 0);
