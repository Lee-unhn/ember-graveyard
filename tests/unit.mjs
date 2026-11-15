#!/usr/bin/env node
// Unit tests: load the game headlessly, inject tests/unit.spec.js, run each test against the page's own functions.
//   node tests/unit.mjs [--url=https://...]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, serve, openPage, reporter } from './lib/browser.mjs';

const live = (process.argv.find((a) => a.startsWith('--url=')) || '').slice(6);
const rep = reporter('unit');
const srv = live ? null : await serve();
const page = await openPage(live || `http://127.0.0.1:${srv.address().port}/index.html`);
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
  const page2 = await openPage(live || `http://127.0.0.1:${srv.address().port}/index.html`);
  try { const ready = await page2.waitFor(`typeof props !== 'undefined' && props.length > 0`);
    rep.ok(ready && a === await page2.evaluate(sigExpr), 'a second page load places every prop at the same spot (fixed seed)'); }
  finally { await page2.close(); }
} catch (e) { rep.ok(false, 'unit runner crashed', e.message); await page.close(); }
finally { srv?.close(); }
process.exit(rep.done() ? 1 : 0);
