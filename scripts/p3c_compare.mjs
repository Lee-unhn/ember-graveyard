#!/usr/bin/env node
// P3c side-by-side: the same fireball drawn with three sets of flipbook sheets.
//   node scripts/p3c_compare.mjs
// Sets: the page's own procedural sheets, and every image-model set found in incoming/p3c/
// (<prefix>_flame / _explosion / _smoke, .png or .jpg; incoming/ is gitignored, the drawings stay local).
// Each set is loaded through the page's own upload path (replaceSheet: black turns transparent), the random
// generator is seeded the same way, and the page is stepped frame by frame through one timeline:
// fireball from x = -6.65 at speed 19, scripted hit after 0.7 s. Frames go to incoming/p3c/out/,
// scripts/compose_routes.py builds docs/media/p3c-routes.jpg and docs/media/p3c-sheets.jpg.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, serve, openPage } from '../tests/lib/browser.mjs';

const MOMENTS = [0.33, 0.8, 1.1]; // in flight, just after the hit, the explosion fading
const FPS = 30;
const SHEETS = ['flame', 'explosion', 'smoke'];
const IN = join(ROOT, 'incoming', 'p3c'), out = join(IN, 'out');
mkdirSync(out, { recursive: true });

const find = (prefix, s) => ['png', 'jpg', 'jpeg', 'webp'].map((e) => `${prefix}_${s}.${e}`).find((f) => existsSync(join(IN, f)));
const SETS = [{ key: 'code', label: 'Procedural (code)', files: null }];
for (const [key, label] of [['gemini', 'Gemini'], ['gpt', 'ChatGPT']]) {
  const files = SHEETS.map((s) => find(key, s));
  if (files.every(Boolean)) SETS.push({ key, label, files }); else console.log(`skip ${label}: missing`, SHEETS.filter((s, i) => !files[i]).join(', '));
}

const srv = await serve();
const base = `http://127.0.0.1:${srv.address().port}`;
try {
  for (const set of SETS) {
    const p = await openPage(`${base}/index.html`, { width: 960, height: 540 });
    try {
      if (!(await p.waitFor(`!document.querySelector('#go').disabled`, 60000))) throw new Error('page did not boot');
      if (set.files) {
        const ok = await p.evaluate(`Promise.all(${JSON.stringify(set.files)}.map((f, i) => new Promise((res, rej) => {
          const img = new Image(); img.onload = () => { replaceSheet(i, img); res(true); }; img.onerror = () => rej(f); img.src = '/incoming/p3c/' + f; })))
          .then(() => true, (f) => 'could not load ' + f)`);
        if (ok !== true) throw new Error(ok);
      }
      await p.evaluate(`(() => {
        startFree(); spawnWave = () => {}; for (const e of enemies) killEnemy(e); enemies.length = 0;
        player.pos.set(0, 0, 0); zoom = 1; titleMode(true); document.querySelector('#lab').style.display = 'none';
        P.g.visible = false; P.shadow.visible = false; setRoute(0);
        requestAnimationFrame = () => 0;
        Math.random = mulberry32(31);                       // same particles for every set
        window.__t = 0; window.__hit = false;
        spawnFireball(new THREE.Vector3(-6.65, 1.15, 0), new THREE.Vector3(1, 0, 0));
        window.__step = (to) => { const dt = 1 / ${FPS};
          while (window.__t + 1e-6 < to) { window.__t += dt; time += dt; shared.uTime.value = time; logic(dt); visuals(dt);
            if (!window.__hit && window.__t >= 0.7) { window.__hit = true; const f = projs.find((q) => q.kind === 'fire');
              if (f) { explode(f.pos.clone(), 1, [1, 1, 1], false); f.dead = true; } } }
          renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png').split(',')[1]; };
      })()`);
      for (const m of MOMENTS) writeFileSync(join(out, `${set.key}_${m.toFixed(2)}.png`), Buffer.from(await p.evaluate(`__step(${m})`), 'base64'));
      // the atlas after upload, as the game uses it (transparent background)
      const sheet = await p.evaluate(`(() => { const c = document.createElement('canvas'); c.width = 1536; c.height = 512; const x = c.getContext('2d');
        x.fillStyle = '#000'; x.fillRect(0, 0, 1536, 512);
        [0, 1, 2].forEach((s) => x.drawImage(atlas, (s % 2) * 512, Math.floor(s / 2) * 512, 512, 512, s * 512, 0, 512, 512));
        return c.toDataURL('image/png').split(',')[1]; })()`);
      writeFileSync(join(out, `${set.key}_sheets.png`), Buffer.from(sheet, 'base64'));
      console.log(set.label, 'done; errors', JSON.stringify(p.errors.slice(0, 3)));
    } finally { await p.close(); }
  }
} finally { srv.close(); }

const args = [join(ROOT, 'scripts', 'compose_routes.py'), out, join(ROOT, 'docs', 'media'), MOMENTS.join(','), ...SETS.map((s) => `${s.key}=${s.label}`)];
const c = spawnSync('python', ['-I', ...args], { stdio: 'inherit' });
process.exit(c.status ?? 1);
