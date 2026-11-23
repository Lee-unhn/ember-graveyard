// Pixel-sprite pipeline tests (kit/sprites.js). Injected into a page that received the test atlases (tests/lib/sprite-fixture.js)
// as CONTENT.sprites. Game time is advanced by calling the engine's own logic()/visuals(); nothing waits on wall-clock time.
//   __runSprites('normal')   characters, props, ground tiles, effects, occlusion, validation
//   __runSprites('lowres')   the same atlases with CONTENT.sprites.pixelScreen: buffer size, whole-number scale, pixel lattice, no tilt-shift
window.__runSprites = async (mode) => {
  const tests = [], results = [];
  const test = (name, fn) => tests.push([name, fn]);
  class AssertError extends Error {}
  const ok = (c, m) => { if (!c) throw new AssertError(m || 'expected truthy'); };
  const eq = (a, b, m) => { if (a !== b) throw new AssertError(`${m || 'eq'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
  const near = (a, b, tol, m) => { if (!(Math.abs(a - b) <= tol)) throw new AssertError(`${m || 'near'}: expected ${b}±${tol}, got ${a}`); };
  const S = EGSprites, D = (x) => S.debug(x), HERO = S.actorCfg.player.at.meta;
  const step = (n, dt = 1 / 60) => { for (let k = 0; k < n; k++) { time += dt; shared.uTime.value = time; logic(dt); visuals(dt); } };
  const vis = (n, dt = 1 / 60) => { for (let k = 0; k < n; k++) { time += dt; visuals(dt); } };
  const until = (cond, maxSteps = 2000, dt = 1 / 60) => { for (let k = 0; k < maxSteps; k++) { if (cond()) return true; step(1, dt); } return cond(); }; // waits in game time, never in real time
  const mon = (...a) => { spawnEnemy(...a); return enemies[enemies.length - 1]; };
  const freeze = () => { for (const e of enemies) e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 }); };
  const fresh = () => {
    while (dlg) endDialog();
    for (const k in keys) keys[k] = false; lmb = false;
    clearWorld(); resetTerrain(); running = true; paused = false;
    Object.assign(story, { on: false, phase: 'idle', act: 0, unlocked: new Set(['fire', 'bolt', 'meteor', 'blood']), tier: { fire: 1 }, seen: new Set(), boss: null });
    player.pos.set(0, 0, 0); player.maxhp = player.hp = 1e6; player.alive = true; player.cast = null; player.hurtT = 0; player.moving = false; player.float = 0;
    for (const k in cds) cds[k] = 0; for (const id of MENUS) document.querySelector('#' + id).hidden = true; syncMenu();
    if (window.EG) { EG.resetSpellParams(); EG.seed(null); }
    camSnap = true; step(2);
  };
  const walk = (code, n = 20) => { keys[code] = true; try { step(n); } finally { keys[code] = false; } };
  const row = (name) => HERO.rowNames.indexOf(name);
  // render the scene once (no post effects) and read pixels at screen points; returns [[r, g, b], ...]
  const shoot = (pts) => { renderer.setRenderTarget(null); renderer.render(scene, camera); const c = document.createElement('canvas'), W = renderer.domElement.width, H = renderer.domElement.height;
    c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(renderer.domElement, 0, 0);
    return pts.map(([x, y]) => [...g.getImageData(Math.round(x * W), Math.round(y * H), 1, 1).data].slice(0, 3)); };
  const proj = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(camera); return [(v.x + 1) / 2, (1 - v.y) / 2]; };

  // ---------------------------------------------------------------- shared by both pages
  test('module active, every atlas loaded, nothing failed', () => {
    ok(S.state.active && S.state.ready, 'active and ready'); eq(S.state.atlases, 5, 'five atlases'); eq(S.state.failed.length, 0, 'no failed atlas');
    ok(S.state.props > 46, `prop sprites built (${S.state.props})`); ok(S.state.tiles, 'ground tiles on');
  });
  test('the player is drawn as a sprite: the 3D model and its round shadow are hidden', () => {
    fresh(); ok(!EGP.g.visible, 'model hidden'); ok(D(player) && D(player).visible, 'sprite shown'); ok(!EGP.shadow.visible, 'model shadow hidden (pixel shadow instead)');
  });

  if (mode === 'normal') {
    test('walking direction picks the row: down, up, right (side row), left (side row mirrored)', () => {
      fresh(); mouse.set(0, 0);
      walk(KB.down); let d = D(player); eq(d.anim, 'walk', 'walking'); eq(d.dir, 'down'); eq(d.row, row('down'), 'row down'); eq(d.flip, false, 'down not mirrored');
      walk(KB.up); d = D(player); eq(d.dir, 'up'); eq(d.row, row('up'), 'row up');
      walk(KB.right); d = D(player); eq(d.dir, 'right'); ok(d.row === row('side') || d.row === row('side2'), 'side rows'); eq(d.flip, false, 'right not mirrored');
      walk(KB.left); d = D(player); eq(d.dir, 'left'); ok(d.row === row('side') || d.row === row('side2'), 'side rows'); eq(d.flip, true, 'left is the side row mirrored');
    });
    test('mirroring swaps the texture coordinates and the anchor side', () => {
      fresh(); player.face = Math.PI / 2; S.update(0); const P = D(player).mesh.geometry.attributes, uR = P.uv.getX(0), xR = P.position.getX(0);
      player.face = -Math.PI / 2; S.update(0); eq(D(player).flip, true, 'facing left mirrors'); near(P.uv.getX(1), uR, 1e-9, 'left edge texture of right-facing = right edge of left-facing'); near(P.position.getX(0), xR, 1e-9, 'symmetric anchor keeps the quad in place');
    });
    test('standing still faces the aim: +z is down on screen, -z up, +x right, -x left', () => {
      fresh();
      for (const [f, dir, r, flip] of [[0, 'down', 'down', false], [Math.PI, 'up', 'up', false], [Math.PI / 2, 'right', 'side', false], [-Math.PI / 2, 'left', 'side', true]]) {
        player.face = f; S.update(0); const d = D(player); eq(d.anim, 'idle', 'idle'); eq(d.dir, dir, 'dir for face ' + f.toFixed(2)); eq(d.row, row(r), 'row'); eq(d.col, 0, 'idle cell'); eq(d.flip, flip, 'mirror');
      }
    });
    test('one walk cycle crosses two rows in order (side: 4 cells on one row, 2 on the next); empty cells are skipped', () => {
      fresh(); keys[KB.right] = true; const seen = [];
      try { step(3); for (let k = 0; k < 48; k++) { step(1, 1 / 64); const d = D(player); const id = d.row + ':' + d.col; if (seen[seen.length - 1] !== id) seen.push(id); } } finally { keys[KB.right] = false; }
      const cyc = [`${row('side')}:0`, `${row('side')}:1`, `${row('side')}:2`, `${row('side')}:3`, `${row('side2')}:0`, `${row('side2')}:1`];
      const at = seen.indexOf(cyc[0]); ok(at >= 0, 'cycle start seen ' + seen.join(' ')); eq(seen.slice(at, at + 6).join(' '), cyc.join(' '), 'cell order');
      ok(!seen.includes(`${row('side2')}:2`) && !seen.includes(`${row('side2')}:3`), 'cells marked empty in the meta never show');
    });
    test('casting shows the cast cells spread over the cast time', () => {
      fresh(); mouse.set(0, .3); tryCast('meteor'); const c = player.cast; ok(c, 'casting'); const got = [];
      until(() => { S.update(0); const d = D(player); if (d.anim === 'cast') got.push([c.t / c.dur, d.row, d.col]); return !player.cast; }, 400);
      ok(got.length > 5, 'cast frames seen'); for (const [k, r, col] of got) { eq(r, row('misc'), 'misc row'); eq(col, k < .5 ? 0 : 1, 'cell at progress ' + k.toFixed(2)); }
      step(1); eq(D(player).anim, 'idle', 'idle again after the cast');
    });
    test('a hit plays the hurt cell once, then back to idle; dying holds the last die cell', () => {
      fresh(); hurtPlayer(1); vis(1); eq(D(player).anim, 'hurt', 'hurt'); eq(D(player).col, 2, 'hurt cell');
      vis(30); eq(D(player).anim, 'idle', 'idle after 0.5 s (hurt lasts 1 cell at 4 per second)');
      player.hp = 1; hurtPlayer(5); vis(240); const d = D(player); eq(d.anim, 'die', 'dead'); eq(d.col, 3, 'die cell held'); ok(d.visible, 'still shown');
      fresh(); eq(D(player).anim, 'idle', 'a new run starts idle');
    });
    test('feet stand on the ground: the anchor row boundary is at the sprite origin, the origin at the player', () => {
      fresh(); player.pos.set(3.25, 0, -2.5); player.face = 0; S.update(0); const d = D(player), P = d.mesh.geometry.attributes.position;
      near(d.x, 3.25, 1e-9, 'x'); near(d.z, -2.5, 1e-9, 'z'); near(d.y, 0, 1e-9, 'on the ground');
      const top = P.getY(0), bottom = P.getY(2), perPx = (top - bottom) / HERO.frameH;
      near(top - 23 * perPx, 0, 1e-6, 'the line under the feet row (23 px from the top) is at height 0'); near(bottom, -perPx, 1e-6, 'only the empty last row is below the ground');
      near(top - bottom, HERO.frameH / 27.5, 1e-6, 'height = cell pixels / ppu'); near(P.getX(1) - P.getX(0), HERO.frameW / 27.5, 1e-6, 'width = cell pixels / ppu');
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(d.mesh.quaternion), f = new THREE.Vector3(); camera.getWorldDirection(f); near(n.dot(f), -1, 1e-6, 'the quad is parallel to the screen (square pixels, upright edges, no lean near the screen edges)');
    });
    test('feet on screen: the magenta feet row is drawn just above the projected ground point', () => {
      fresh(); for (const p of S.propRecs) p.m.visible = false; player.face = 0; S.update(0);
      const [fx, fy] = proj(0, 0, 0), H = renderer.domElement.height, W = renderer.domElement.width; const pts = [];
      for (let dy = -6; dy <= 3; dy++) pts.push([fx, fy + dy / H]);
      const col = shoot(pts), mag = col.map(([r, g, b]) => r > 1.6 * g && b > 1.6 * g && r > 40), first = mag.indexOf(true), last = mag.lastIndexOf(true);
      ok(first >= 0, 'feet row visible ' + JSON.stringify(col)); ok(last <= 6, `no feet pixels below the ground point (last at ${last - 6} px)`); ok(last >= 5, `the feet row ends within 1 px of the ground point (at ${last - 6} px)`);
      S.update(0);
    });
    test('occlusion: a tombstone in front hides the player, the player in front hides the tombstone', () => {
      fresh(); const R = S.propRecs.find((r) => r.kind === 'tomb' && Math.abs(r.p.x) < 30 && r.p.z < 25 && r.p.z > -25), p = R.p;
      for (const o of S.propRecs) if (o !== R) o.m.visible = false; for (const e of enemies) e.g.visible = false;
      const green = ([r, g, b]) => g > r * 1.4 && g > b * 1.4, bluish = ([r, g, b]) => b > g && b > r * 1.2;
      // behind: player 1.2 m further from the camera than the tomb, probe the tomb's middle
      player.pos.set(p.x, 0, p.z - 1.2); camSnap = true; updateCamera(0); S.update(0); for (const o of S.propRecs) if (o !== R) o.m.visible = false;
      let c = shoot([proj(p.x, .5, p.z)])[0]; ok(green(c), 'tomb in front covers the player ' + c);
      player.pos.set(p.x, 0, p.z + 1.2); camSnap = true; updateCamera(0); S.update(0); for (const o of S.propRecs) if (o !== R) o.m.visible = false;
      c = shoot([proj(p.x, .5, p.z + 1.2)])[0]; ok(bluish(c), 'player in front covers the tomb ' + c);
      S.update(0);
    });
    test('monsters with sprites: model hidden, walk faces the movement, hurt then die, then the quad goes back to the pool', () => {
      fresh(); const e = mon('spider', 5, 0, 1); freeze(); vis(1); ok(!e.g.visible, 'model hidden'); const d0 = D(e); ok(d0 && d0.visible, 'sprite shown');
      e.T = Object.assign({}, e.T, { speed: 3 }); e.aggro = true; player.pos.set(-5, 0, 0); step(20); let d = D(e); eq(d.anim, 'walk', 'walking toward the player'); eq(d.dir, 'left', 'moving -x faces left'); eq(d.flip, true, 'mirrored');
      freeze(); step(2); dealDamage(e, 1, 'fire'); vis(1); eq(D(e).anim, 'hurt', 'hurt on a hit'); eq(D(e).row, 1, 'hurt row'); eq(D(e).col, 0);
      const pool0 = S.pool.length, kids0 = scene.children.length - loots.length; dealDamage(e, 1e6, 'fire'); vis(1); eq(D(e).anim, 'die', 'dying'); eq(D(e).col, 1, 'first die cell');
      ok(until(() => !enemies.includes(e)), 'monster left the list'); ok(D(e), 'die animation still playing after the monster left the list');
      ok(until(() => !D(e), 120), 'sprite released after the die cells'); ok(S.pool.length >= pool0 + 1, 'quad back in the pool'); ok(scene.children.length - loots.length <= kids0, 'scene did not grow (dropped loot not counted)');
    });
    test('monsters without a sprite keep their 3D model', () => {
      fresh(); const e = mon('lizard', 4, 4, 1); vis(1); ok(e.g.visible !== false, 'lizard model visible'); eq(D(e), null, 'no sprite');
    });
    test('props: 3D hidden; tombstones keep one variant each and fall; trees burn and end burnt; sarcophagi break; towers light up', () => {
      fresh(); const tombs = S.propRecs.filter((r) => r.kind === 'tomb');
      ok(tombs.every((r) => !r.g.visible), 'tomb models hidden'); const v1 = tombs.map((r) => r.cell); vis(90); eq(tombs.map((r) => r.cell).join(), v1.join(), 'variants do not change over time');
      ok(new Set(v1).size === 2, 'both variants used'); const P = S.propRecs[0].cfg.at.meta.cols; ok(v1.every((c) => c === 0 || c === 1), 'variants are cells 0 and 1');
      const t = tombs[0]; breakProp(t.p, new THREE.Vector3(t.p.x + 1, 0, t.p.z)); step(40); eq(D(t.p).anim, 'fallen'); eq(D(t.p).cell, 2, 'fallen cell');
      const tr = S.propRecs.find((r) => r.kind === 'tree'); igniteTree(tr.p); const burn = new Set(); for (let k = 0; k < 40; k++) { step(1); burn.add(D(tr.p).cell); }
      eq([...burn].sort().join(), '4,5', 'burning cycles cells 4 and 5'); ok(until(() => tr.p.state === 'down', 800), 'tree fell'); vis(1); eq(D(tr.p).anim, 'burnt'); eq(D(tr.p).cell, P + 0, 'burnt cell');
      const sc = S.propRecs.find((r) => r.kind === 'sarc'); breakProp(sc.p, new THREE.Vector3(sc.p.x + 1, 0, sc.p.z)); vis(1); eq(D(sc.p).cell, P + 2, 'broken sarcophagus');
      const tw = S.propRecs.find((r) => r.kind === 'tower'); setTowerLit(tw.p.tower, false); vis(1); eq(D(tw.p.tower).cell, P + 3, 'unlit tower');
      ok(tw.g.children.filter((o) => o !== tw.p.tower.beam).every((o) => !o.visible), 'tower model hidden, guide beam kept');
      setTowerLit(tw.p.tower, true); const lit = new Set(); for (let k = 0; k < 30; k++) { vis(1); lit.add(D(tw.p.tower).cell); } eq([...lit].sort().join(), [P + 4, P + 5].join(), 'lit tower cycles two cells');
      resetProps(); vis(1); eq(D(t.p).anim, 'up', 'reset tomb stands again');
    });
    test('ground tiles follow the terrain: lava, fire (animated), water (animated), fallback for terrain without tiles', () => {
      fresh(); const i = cellOf(2.5, 3.5), G = S.ground, at = G.at, data = G.data;
      const tilePx = (cell) => { const M = at.meta, x = (cell % M.cols) * 16 + 5, y = Math.floor(cell / M.cols) * 16 + 5, k = (y * at.W + x) * 4; return [...at.px.slice(k, k + 3)]; };
      const shownPx = (cell) => { const gx = cell % GN, gz = Math.floor(cell / GN), x = gx * 16 + 5, y = (GN - 1 - gz) * 16 + (15 - 5), k = (y * G.TS + x) * 4; return [...data.slice(k, k + 3)]; };
      setT(i, TER.LAVA, 30); vis(1); eq(S.shown(i), 9, 'lava tile'); eq(shownPx(i).join(), tilePx(9).join(), 'texture holds the lava tile pixels');
      setT(i, TER.FIRE, 30); const f = new Set(); for (let k = 0; k < 20; k++) { vis(1, 1 / 32); f.add(S.shown(i)); } eq([...f].sort().join(), '6,7', 'fire animates between tiles 6 and 7');
      setT(i, TER.WATER); vis(1); ok([4, 5].includes(S.shown(i)), 'water tile'); setT(i, TER.WISP); vis(1); eq(S.shown(i), 13, 'terrain without tiles uses default');
      setT(i, TER.STEAM, 2); vis(1); eq(S.shown(i), 13, 'steam -> default too');
    });
    test('ground tile variants are fixed per cell: no flicker over time, both variants used across grass cells', () => {
      fresh(); const grass = []; for (let i = 0; i < TT.length && grass.length < 400; i++) if (TT[i] === TER.GRASS) grass.push(i);
      ok(grass.length > 50, 'grass cells exist'); vis(1); const a = grass.map((i) => S.shown(i)); for (let k = 0; k < 30; k++) vis(1, .1); const b = grass.map((i) => S.shown(i));
      eq(b.join(), a.join(), 'same tiles 3 s later'); ok(new Set(a).size === 2, 'both grass variants appear'); ok(a.every((t) => t === 0 || t === 1), 'grass tiles are 0 and 1');
      ok(grass.every((i) => S.tileFor(i) === S.shown(i)), 'texture matches the rule');
    });
    test('effects: fireballs fly as flipbooks without their particle core, explode as flipbooks, and every effect is released', () => {
      fresh(); mouse.set(0, .35); spawnEnemy('lizard', 0, -6, 50); freeze(); EG.clearEffects(); tryCast('fire');
      ok(until(() => S.fxList.some((f) => f.key === 'fireball'), 60), 'fireball flipbook appears'); const p = projs[0]; ok(p, 'projectile flying');
      eq(ADD.list.filter((q) => q.follow === p).length, 0, 'no particle core follows the projectile');
      const fb = S.fxList.find((f) => f.key === 'fireball'); near(fb.m.position.distanceTo(fb.follow.pos), 0, 1e-9, 'flipbook rides on the projectile');
      ok(until(() => S.fxList.some((f) => f.key === 'explosion'), 200), 'explosion flipbook on impact');
      ok(until(() => !projs.length && S.fxList.length === 0, 600), 'every flipbook released once the projectiles are gone and the explosion played');
    });
    test('effects: every engine function the module replaces keeps the original\'s own properties (a content pack may tag them)', () => {
      ok(window.__EG_FX_TAGGED === true, 'the fixture tagged the engine functions before the sprite module loaded');
      ok(/fn\(o, arguments\)/.test(String(dealDamage)), 'dealDamage is replaced by the hit flipbook wrapper');
      eq(window.__EG_FX_HOOKED.filter((n) => window[n].egTag !== n).join(), '', 'functions that lost their tag');
    });
    test('effects: chain lightning is a beam from monster to monster; a hit spawns a hit flipbook', () => {
      fresh(); const a = mon('lizard', 0, -6, 50), b = mon('lizard', 2.5, -7, 50); freeze(); EG.clearEffects(); mouse.set(0, .3);
      const n0 = S.fxList.filter((f) => f.key === 'hit').length; dealDamage(a, 1, 'fire'); eq(S.fxList.filter((f) => f.key === 'hit').length, n0 + 1, 'one hit flipbook per hit');
      tryCast('bolt'); ok(until(() => S.fxList.some((f) => f.key === 'chain'), 300), 'chain beam appears'); const c = S.fxList.find((f) => f.key === 'chain');
      const P = c.m.geometry.attributes.position, mid = (i, j) => new THREE.Vector3((P.getX(i) + P.getX(j)) / 2, (P.getY(i) + P.getY(j)) / 2, (P.getZ(i) + P.getZ(j)) / 2);
      const ends = [mid(0, 2), mid(1, 3)], at = (e) => new THREE.Vector3(e.pos.x, 1, e.pos.z);
      ok(ends.some((v) => v.distanceTo(at(a)) < .05) && ends.some((v) => v.distanceTo(at(b)) < .05), 'beam ends on the two monsters');
      ok(until(() => S.fxList.length === 0, 600), 'all released');
    });
    test('effects: meteor rock and impact, blood ring on the ground, orb; the 3D rock and rune ring are hidden', () => {
      fresh(); EG.clearEffects(); mouse.set(0, .3); tryCast('meteor'); ok(until(() => meteors.length > 0, 200), 'meteor falling');
      ok(until(() => S.fxList.some((f) => f.key === 'meteor'), 5), 'meteor flipbook'); ok(meteors.every((m) => !m.mesh.visible), '3D rock hidden');
      ok(until(() => S.fxList.some((f) => f.key === 'impact'), 400), 'impact flipbook'); ok(rocks.every((r) => !r.mesh.visible), 'landed rocks hidden');
      ok(until(() => !player.cast && !meteors.length, 600), 'meteors done'); cds.blood = 0; tryCast('blood'); const r = rites[rites.length - 1]; ok(r && !r.mesh.visible, 'rune ring hidden');
      const ring = S.fxList.find((f) => f.key === 'ring'); ok(ring, 'ring flipbook'); near(ring.m.rotation.x, -Math.PI / 2, 1e-9, 'lies on the ground');
      ok(until(() => !rites.length, 600) && until(() => !S.fxList.some((f) => f.key === 'ring'), 5), 'ring released with the rite');
      cds.bolt = 0; tryCast('bolt'); ok(until(() => S.fxList.some((f) => f.key === 'orb'), 120), 'orb flipbook');
      ok(until(() => S.fxList.length === 0, 900), 'all effects released');
    });
    test('restart and clearEffects drop every flipbook and every monster sprite at once', () => {
      fresh(); for (let k = 0; k < 6; k++) spawnEnemy('spider', k * 2 - 5, -5, 1); freeze(); mouse.set(0, .3); tryCast('meteor'); step(40);
      ok(S.state.actors > 6 && S.fxList.length > 0, 'busy scene'); restart(); vis(1); eq(S.fxList.length, 0, 'no flipbook left');
      eq(S.state.actors, 1 + enemies.filter((e) => S.actorCfg[e.type]).length, 'sprites only for the player and the new wave');
    });
    test('quads are pooled: 5 rounds of 20 monsters and spells leave the scene, the pool and the GPU geometry count flat', () => {
      fresh(); const own = () => loots.length + enemies.reduce((n, e) => n + 1 + (S.actorCfg[e.type] ? 2 : 0), 0); // loot and live monsters (free mode sends new waves) are not leaks
      const snap = () => [scene.children.length - own(), renderer.info.memory.geometries, S.pool.length + S.fxList.length + S.state.actors]; const rounds = [];
      for (let r = 0; r < 5; r++) { restart(); const guard = mon('spider', 40, 0, 1e9); for (let k = 0; k < 20; k++) spawnEnemy('spider', (k % 5) * 3 - 6, -4 - Math.floor(k / 5) * 2, 1); freeze(); mouse.set(0, .3);
        for (const id of ['fire', 'bolt', 'meteor', 'blood']) { player.cast = null; cds[id] = 0; tryCast(id); step(60); } for (const e of [...enemies]) if (e !== guard) killEnemy(e); step(240); /* the guard stays alive so free mode sends no new wave */ renderer.render(scene, camera); rounds.push(snap()); }
      const flat = (k) => Math.max(...rounds.map((x) => x[k])) - Math.min(...rounds.slice(1).map((x) => x[k]));
      ok(flat(0) <= 2, 'scene children flat ' + rounds.map((x) => x[0])); ok(flat(1) <= 4, 'geometries flat ' + rounds.map((x) => x[1])); ok(flat(2) <= 10, 'quads flat ' + rounds.map((x) => x[2]));
    });
    test('without pixelScreen the canvas is not touched: full resolution, no inline size, tilt-shift unchanged', () => {
      eq(S.state.lowRes, false, 'not in low resolution'); eq(canvas.style.width, '', 'canvas keeps its page size'); ok(renderer.getPixelRatio() >= .75, 'pixel ratio as before');
    });
    test('validate() rejects broken values and names the field; the test pack is valid', () => {
      eq(S.validate(CONTENT.sprites).length, 0, 'fixture valid');
      const has = (v, w) => { const p = S.validate(v); ok(p.some((m) => m.includes(w)), `expected a message naming ${w}: ${JSON.stringify(p)}`); };
      has(5, 'CONTENT.sprites'); has({ atlases: { a: { image: 3, meta: {} } } }, 'CONTENT.sprites.atlases.a');
      const base = () => ({ atlases: { a: { image: 'x.png', meta: {} } } });
      has(Object.assign(base(), { actors: { player: { atlas: 'a' } } }), 'CONTENT.sprites.actors.player.idle');
      has(Object.assign(base(), { actors: { player: { atlas: 'b', idle: [0] } } }), 'CONTENT.sprites.actors.player.atlas');
      has(Object.assign(base(), { actors: { player: { atlas: 'a', idle: [0], walk: { down: 'x' } } } }), 'CONTENT.sprites.actors.player.walk');
      has(Object.assign(base(), { props: { tomb: { atlas: 'a', fallen: [0] } } }), 'CONTENT.sprites.props.tomb.up');
      has(Object.assign(base(), { ground: { atlas: 'a', tiles: { LAVA: [-1] } } }), 'CONTENT.sprites.ground.tiles.LAVA');
      has(Object.assign(base(), { fx: { hit: { atlas: 'a', frames: [0], blend: 'screen' } } }), 'CONTENT.sprites.fx.hit.blend');
      has(Object.assign(base(), { pixelScreen: { rows: 50 } }), 'CONTENT.sprites.pixelScreen');
      eq(S.validate(Object.assign(base(), { actors: { player: { atlas: 'a', idle: [0] } }, pixelScreen: true })).length, 0, 'a minimal pack is valid');
    });
  }

  if (mode === 'lowres') {
    test('low resolution: about 360 rows, scaled up by a whole number, nearest-neighbour', () => {
      fresh(); EGPost.render(); const st = S.state, b = renderer.getDrawingBufferSize(new THREE.Vector2()), dpr = devicePixelRatio || 1;
      ok(st.lowRes, 'on'); ok(Number.isInteger(st.scale) && st.scale >= 1, 'whole-number scale ' + st.scale); eq(st.scale, Math.max(1, Math.round(innerHeight * dpr / 360)), 'scale = window rows / 360, rounded');
      eq(b.y, Math.floor(innerHeight * dpr / st.scale), 'buffer rows'); ok(b.y >= 300 && b.y <= 480, 'about 360 rows (' + b.y + ')');
      eq(canvas.style.width, b.x * st.scale / dpr + 'px', 'shown width = buffer width x scale'); eq(canvas.style.height, b.y * st.scale / dpr + 'px', 'shown height = buffer height x scale');
      eq(canvas.style.imageRendering, 'pixelated', 'hard pixel edges');
    });
    test('low resolution: the camera and the sprites sit on the pixel lattice while drawing, and the camera is restored after', () => {
      fresh(); player.pos.set(1.2345, 0, -.777); camSnap = true; updateCamera(0); const before = camera.position.clone(); let seen = null;
      const r0 = renderer.render; renderer.render = function (s, c) { if (s === scene && !seen) seen = camera.position.clone(); return r0.apply(this, arguments); };
      try { EGPost.render(); } finally { renderer.render = r0; }
      ok(seen, 'scene drawn'); const [sx, sz] = S.state.step, d = new THREE.Vector3(); camera.getWorldDirection(d); const gl = Math.hypot(d.x, d.z), gx = d.x / gl, gz = d.z / gl;
      const a = (seen.x * -gz + seen.z * gx) / sx, b = (seen.x * gx + seen.z * gz) / sz; near(a, Math.round(a), 1e-6, 'camera on the column lattice'); near(b, Math.round(b), 1e-6, 'camera on the row lattice');
      ok(seen.distanceTo(before) > 0 && seen.distanceTo(before) < Math.hypot(sx, sz), 'snapped by less than one pixel'); near(camera.position.distanceTo(before), 0, 1e-12, 'camera restored after drawing');
      vis(1); const p = D(player); const pa = (p.x * -gz + p.z * gx) / sx, pb = (p.x * gx + p.z * gz) / sz; near(pa, Math.round(pa), 1e-6, 'player sprite on the lattice'); near(pb, Math.round(pb), 1e-6, 'player sprite on the lattice (rows)');
    });
    test('low resolution: moving less than one pixel leaves the picture unchanged (no shimmer); a whole pixel moves it', () => {
      // quality low: moon shadows follow the mage without snapping (a known limit, see CONTENT-API.md); mist drifts on purpose
      fresh(); const fx0 = SET.fx; SET.fx = 'low'; EGMist.state.on = false; EG.clearEffects(); for (const e of enemies) e.g.visible = false;
      const grab = () => { EGPost.render(); const c = document.createElement('canvas'), W = renderer.domElement.width, H = renderer.domElement.height; c.width = W; c.height = H;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(renderer.domElement, 0, 0); return g.getImageData(0, 0, W, H).data; };
      const at = (x) => { player.pos.set(x, 0, 2); camSnap = true; updateCamera(0); S.update(0); return grab(); };
      EGPost.render(); const sx = S.state.step[0], x0 = Math.round(3 / sx) * sx, A = at(x0), B = at(x0 + sx * .3), C = at(x0 + sx);
      let diffB = 0, diffC = 0; for (let i = 0; i < A.length; i += 4) { if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2]) diffB++; if (A[i] !== C[i] || A[i + 1] !== C[i + 1]) diffC++; }
      eq(diffB, 0, 'a 0.3-pixel move changes no pixel'); ok(diffC > 500, 'a 1-pixel move does change the picture (' + diffC + ' pixels)');
      EGMist.state.on = true; SET.fx = fx0;
    });
    test('low resolution: tilt-shift is off while drawing and the extension value is kept', () => {
      fresh(); EGPost.uniforms.uTilt.value = .7; let during = null; const r0 = renderer.render, fx0 = SET.fx;
      renderer.render = function (s, c) { if (s !== scene && during === null) during = EGPost.uniforms.uTilt.value; return r0.apply(this, arguments); };
      try { SET.fx = 'high'; EGPost.render(); } finally { renderer.render = r0; SET.fx = fx0; }
      ok(EGPost.state.on, 'post effects ran'); eq(during, 0, 'no tilt-shift in the final pass'); eq(EGPost.uniforms.uTilt.value, .7, 'value restored'); EGPost.uniforms.uTilt.value = 1;
    });
  }

  for (const [name, fn] of tests) {
    try { await fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, err: e instanceof AssertError ? e.message : (e && e.stack || String(e)).split('\n').slice(0, 2).join(' ') }); }
  }
  try { fresh(); } catch (e) {}
  return results;
};
