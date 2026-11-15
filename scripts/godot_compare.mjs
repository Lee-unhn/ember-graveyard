#!/usr/bin/env node
// P5 side-by-side: the same fireball at the same moments, web (Three.js) vs Godot 4 (GPUParticles3D).
//   GODOT=<path to Godot 4.7 console exe> node scripts/godot_compare.mjs
// 1. Godot renders 60 frames at a fixed 30 fps with Movie Maker into godot/out/ (gitignored).
// 2. The web page is driven frame by frame (its own animation loop frozen) through the same timeline:
//    fireball from x=-6.65 at speed 19, scripted hit after 0.7 s.
// 3. scripts/compose_compare.py puts matching frames next to each other into docs/media/godot-vs-web.jpg.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, serve, openPage } from '../tests/lib/browser.mjs';

const MOMENTS = [0.33, 0.8, 1.1]; // in flight, just after the hit, smoke and sparks
const FPS = 30;
const godot = process.env.GODOT;
if (!godot || !existsSync(godot)) { console.error('set GODOT to the Godot 4.7 console executable'); process.exit(2); }

const out = join(ROOT, 'godot', 'out'); mkdirSync(out, { recursive: true });
const r = spawnSync(godot, ['--path', join(ROOT, 'godot'), '--write-movie', join(out, 'frame.png'), '--fixed-fps', String(FPS),
  '--quit-after', '60', '--resolution', '960x540'], { stdio: 'inherit', timeout: 300000 });
if (r.status !== 0) { console.error('Godot render failed', r.status); process.exit(1); }

const srv = await serve();
const p = await openPage(`http://127.0.0.1:${srv.address().port}/index.html`, { width: 960, height: 540 });
try {
  if (!(await p.waitFor(`!document.querySelector('#go').disabled`, 60000))) throw new Error('page did not boot');
  await p.evaluate(`(() => {
    startFree(); spawnWave = () => {}; for (const e of enemies) killEnemy(e); enemies.length = 0;
    player.pos.set(0, 0, 0); zoom = 1; titleMode(true); document.querySelector('#lab').style.display = 'none';
    P.g.visible = false; P.shadow.visible = false;          // effect only, like the Godot scene
    requestAnimationFrame = () => 0;                       // freeze the page's own loop; we step it
    window.__t = 0; window.__hit = false;
    spawnFireball(new THREE.Vector3(-6.65, 1.15, 0), new THREE.Vector3(1, 0, 0));
    window.__step = (to) => { const dt = 1 / ${FPS};
      while (window.__t + 1e-6 < to) { window.__t += dt; time += dt; shared.uTime.value = time; logic(dt); visuals(dt);
        if (!window.__hit && window.__t >= 0.7) { window.__hit = true; const f = projs.find((q) => q.kind === 'fire');
          if (f) { explode(f.pos.clone(), 1, [1, 1, 1], false); f.dead = true; } } }
      renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png').split(',')[1]; };
  })()`);
  for (const m of MOMENTS) {
    const b64 = await p.evaluate(`__step(${m})`);
    writeFileSync(join(out, `web_${m.toFixed(2)}.png`), Buffer.from(b64, 'base64'));
    console.log('web frame at', m, 's; godot frame', String(Math.round(m * FPS)).padStart(8, '0'));
  }
  console.log('errors', JSON.stringify(p.errors.slice(0, 3)));
} finally { await p.close(); srv.close(); }
const c = spawnSync('python', ['-I', join(ROOT, 'scripts', 'compose_compare.py'), out, join(ROOT, 'docs', 'media', 'godot-vs-web.jpg'), String(FPS), ...MOMENTS.map(String)], { stdio: 'inherit' });
process.exit(c.status ?? 1);
