#!/usr/bin/env node
// Export the page's procedurally drawn flipbook atlas as four 512x512 PNG sheets (4x4 frames of 128 px each):
// flame, explosion, smoke, glow. Used by the Godot port (godot/textures/) so both engines draw from the same frames.
//   node scripts/export_atlas.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, serve, openPage } from '../tests/lib/browser.mjs';

const srv = await serve();
const p = await openPage(`http://127.0.0.1:${srv.address().port}/index.html`, { width: 800, height: 600 });
try {
  if (!(await p.waitFor(`!document.querySelector('#go').disabled`, 60000))) throw new Error('page did not boot');
  const sheets = await p.evaluate(`['flame', 'explosion', 'smoke', 'glow'].map((name, s) => {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    c.getContext('2d').drawImage(atlas, (s % 2) * 512, Math.floor(s / 2) * 512, 512, 512, 0, 0, 512, 512);
    return [name, c.toDataURL('image/png').split(',')[1]]; })`);
  const dir = join(ROOT, 'godot', 'textures'); mkdirSync(dir, { recursive: true });
  for (const [name, b64] of sheets) { writeFileSync(join(dir, name + '.png'), Buffer.from(b64, 'base64')); console.log('wrote godot/textures/' + name + '.png'); }
} finally { await p.close(); srv.close(); }
