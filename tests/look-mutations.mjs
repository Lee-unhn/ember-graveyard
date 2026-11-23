#!/usr/bin/env node
// Plant each night-look defect (tests/lib/look-mutations.mjs) ALONE in a scratch copy and require the look unit suites to turn red.
// tests/run-all.mjs plants every defect at once, which only proves that the suites as a whole notice; this proves each defect is caught.
//   node tests/look-mutations.mjs [--only=<index>]      (about 2 minutes per defect: three pages each)
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { LOOK_MUTATIONS } from './lib/look-mutations.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const rows = [];
for (const [i, [needle, repl]] of LOOK_MUTATIONS.entries()) {
  if (only !== '' && +only !== i) continue;
  const dir = mkdtempSync(join(tmpdir(), 'eg-lmut-'));
  try {
    // the big local-only folders (design drafts, editor download) are not needed to run the page
    cpSync(ROOT, dir, { recursive: true, filter: (s) => !/[\\/](\.git|incoming|godot|\.screens)([\\/]|$)/.test(s) });
    const files = readdirSync(join(dir, 'kit')).filter((x) => x.endsWith('.js')).map((x) => join(dir, 'kit', x)), hit = files.filter((f) => readFileSync(f, 'utf8').includes(needle));
    if (hit.length !== 1) { rows.push([i, needle, `needle found in ${hit.length} files`]); continue; }
    writeFileSync(hit[0], readFileSync(hit[0], 'utf8').replace(needle, () => repl));
    const r = spawnSync(process.execPath, [join(ROOT, 'tests', 'unit.mjs'), '--look-only'], { env: { ...process.env, EG_ROOT: dir }, encoding: 'utf8', timeout: 900000 });
    const fails = (r.stdout || '').split('\n').filter((l) => /^\s+FAIL /.test(l)).map((l) => l.trim().slice(5, 110));
    rows.push([i, needle, r.status !== 0 ? `RED (${fails.length}): ${fails[0] || '(runner)'}` : 'GREEN - not caught']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  console.log(`${rows.at(-1)[0]}. ${rows.at(-1)[2]}\n     ${rows.at(-1)[1]}`);
}
const missed = rows.filter((r) => !r[2].startsWith('RED'));
console.log(missed.length ? `\n${missed.length} defect(s) NOT caught` : `\nall ${rows.length} defects caught one at a time`);
process.exit(missed.length ? 1 : 0);
