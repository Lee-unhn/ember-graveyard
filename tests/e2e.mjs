#!/usr/bin/env node
// End-to-end: drive the game only through real keyboard / mouse events (Chrome DevTools Input domain),
// then read the resulting page state. Setup shortcuts are marked "setup:" and never replace the action under test.
//   node tests/e2e.mjs [--url=https://...]
import { serve, openPage, reporter, sleep } from './lib/browser.mjs';

const live = (process.argv.find((a) => a.startsWith('--url=')) || '').slice(6);
const rep = reporter('e2e');
const srv = live ? null : await serve();
const url = live || `http://127.0.0.1:${srv.address().port}/index.html`;
const W = 1280, H = 800;

async function storyFlow() {
  const p = await openPage(url, { width: W, height: H });
  try {
    rep.ok(await p.waitFor(`!document.querySelector('#goStory').disabled`), 'story button becomes enabled after the atlas is drawn');
    await p.clickSel('#goStory');
    rep.ok(await p.evaluate(`document.querySelector('#intro').hidden && !document.querySelector('#dialog').hidden`), 'click "story mode" -> intro closes, dialogue opens');
    rep.ok((await p.evaluate(`document.querySelector('#dWho').textContent`)) === '灰翁', 'first speaker is the elder');
    let presses = 0;
    while (await p.evaluate(`!document.querySelector('#dialog').hidden`) && presses < 20) { await p.key('Space', ' ', ' '); presses++; await sleep(60); }
    rep.ok(presses >= 5 && presses <= 10, `Space advances the opening dialogue (${presses} presses for 5 lines)`);
    rep.ok(await p.evaluate(`story.phase === 'fight' && /擊倒/.test(document.querySelector('#objective').textContent)`), 'after dialogue: fight phase with a kill objective');
    rep.ok(await p.evaluate(`document.querySelector('.sk[data-s=bolt]').classList.contains('locked')`), 'locked spells are greyed out in the skill bar');

    // movement: hold W
    await p.evaluate(`(() => { for (const e of enemies) { e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 }); } })()`); // setup: freeze monsters so the test is deterministic
    const z0 = await p.evaluate('player.pos.z');
    await p.keyDown('KeyW'); await sleep(700); await p.keyUp('KeyW');
    const z1 = await p.evaluate('player.pos.z');
    rep.ok(z0 - z1 > 1.5, `holding W moves the mage north (${(z0 - z1).toFixed(2)} units)`);

    // aim + left click casts the fireball
    await p.mouse('mouseMoved', W / 2 + 120, H / 2 - 160);
    await p.mouse('mousePressed', W / 2 + 120, H / 2 - 160);
    const sawProjectile = await p.waitFor(`projs.some(q => q.kind === 'fire')`, 3000);
    await p.mouse('mouseReleased', W / 2 + 120, H / 2 - 160);
    rep.ok(sawProjectile, 'left click casts a fireball toward the cursor');
    rep.ok(await p.evaluate(`(() => { const q = projs.find(q => q.kind === 'fire'); if (!q) return true; return q.vel.x > 0 && q.vel.z < 0; })()`), 'fireball flies toward the cursor (up-right)');

    // locked spell feedback
    await p.mouse('mousePressed', W / 2 + 120, H / 2 - 160); // start another fireball so the press lands mid-cast
    await p.mouse('mouseReleased', W / 2 + 120, H / 2 - 160);
    await p.key('Digit2', '2', '2'); await sleep(80);
    // read the target opacity the game sets, not the computed one: the 0.3 s fade-in makes computed values timing-dependent on slow CI machines
    rep.ok(await p.waitFor(`document.querySelector('#msg').textContent.includes('還沒學會') && document.querySelector('#msg').style.opacity === '1' && player.cast?.id !== 'bolt'`, 2000),
      'pressing 2 before the thunder lighthouse shows "not learned yet", even mid-cast');

    // inventory: open with I, click an item, it gets equipped
    await p.evaluate(`(() => { const it = makeItem(2); Object.assign(it, { slot: 'head', type: 'helm', w: 2, h: 2, st: { hp: 25 } }); place(it); })()`); // setup: give one helmet
    await p.key('KeyI', 'i', 'i'); await sleep(100);
    rep.ok(await p.evaluate(`!document.querySelector('#inv').hidden && document.querySelectorAll('#grid .it').length === 1`), 'I opens the inventory showing the helmet');
    await p.clickSel('#grid .it'); await sleep(100);
    rep.ok(await p.evaluate(`equipped.head && player.maxhp === 125 && /125/.test(document.querySelector('#sheet').textContent)`), 'clicking the helmet equips it and the stat sheet shows 125 HP');
    await p.key('KeyI', 'i', 'i'); await sleep(80);
    rep.ok(await p.evaluate(`document.querySelector('#inv').hidden`), 'I closes the inventory');

    // death and retry
    await p.evaluate(`hurtPlayer(99999)`); // setup: lethal hit
    rep.ok(await p.waitFor(`!document.querySelector('#dead').hidden`, 3000), 'death screen appears');
    await p.key('KeyR', 'r', 'r'); await sleep(150);
    rep.ok(await p.evaluate(`document.querySelector('#dead').hidden && player.alive && story.phase === 'fight' && story.act === 0`), 'R restarts the current act');

    // skip whole dialogue with the button
    await p.evaluate(`playDialog('t2', null)`); // setup: open a dialogue
    await p.clickSel('#dSkip'); await sleep(60);
    rep.ok(await p.evaluate(`document.querySelector('#dialog').hidden && !paused`), '"skip dialogue" closes it and resumes the game');
    rep.ok(p.errors.length === 0, 'story flow: no console errors', p.errors.slice(0, 3));
  } finally { await p.close(); }
}

async function freeFlow() {
  const p = await openPage(url, { width: W, height: H });
  try {
    await p.waitFor(`!document.querySelector('#go').disabled`);
    await p.clickSel('#go'); await sleep(200);
    rep.ok(await p.evaluate(`!story.on && enemies.filter(e => e.alive).length === 50`), 'click "free play" -> 50 monsters, story off');
    rep.ok(await p.evaluate(`[...document.querySelectorAll('.sk')].every(s => !s.classList.contains('locked'))`), 'all four spells available in free play');
    await p.clickSel('#segRoute button[data-v="1"]'); rep.ok(await p.evaluate('shared.uMode.value === 1'), 'Lab: "procedural" switches the shader');
    await p.clickSel('#segRoute button[data-v="2"]'); rep.ok(await p.evaluate('shared.uMode.value === 2'), 'Lab: "quads only" switches the shader');
    await p.clickSel('#segRoute button[data-v="0"]');
    await p.clickSel('#segTier button[data-v="0"]'); rep.ok(await p.evaluate(`document.querySelector('#mfire').textContent === '單發'`), 'Lab: "basic" relabels the fireball');
    await p.clickSel('#segTier button[data-v="1"]');
    // right click = chain lightning
    // setup: freeze monsters and park nine of them where the cursor aims, so "spells kill" does not depend on random spawn spots
    await p.evaluate(`(() => { const al = enemies.filter(e => e.alive); al.forEach((e, i) => { e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 });
      if (i < 9) e.pos.set(player.pos.x - 2.4 + (i % 3) * 1.6, 0, player.pos.z - 5 - Math.floor(i / 3) * 1.4); }); })()`);
    await p.mouse('mouseMoved', W / 2, H / 2 - 150); await p.mouse('mousePressed', W / 2, H / 2 - 150, 'right'); await p.mouse('mouseReleased', W / 2, H / 2 - 150, 'right');
    rep.ok(await p.waitFor(`projs.some(q => q.kind === 'bolt') || cds.bolt > 0`, 3000), 'right click casts chain lightning');
    // keys 3 and 4
    await p.waitFor('!player.cast', 2000); await p.key('Digit3', '3', '3');
    rep.ok(await p.waitFor('cds.meteor > 0', 2000), 'key 3 casts meteor rain');
    await p.waitFor('!player.cast', 3000); await p.key('Digit4', '4', '4');
    rep.ok(await p.waitFor('cds.blood > 0 && rites.length > 0', 2000), 'key 4 casts the blood rune');
    rep.ok(await p.waitFor('player.kills > 0', 8000), 'spells kill monsters in real time');
    // atlas viewer and sound toggles
    await p.clickSel('#btnAtlas'); rep.ok(await p.evaluate(`!document.querySelector('#atlasPop').hidden`), '"view flipbook" shows the atlas');
    await p.clickSel('#btnSound'); rep.ok(await p.evaluate(`!soundOn && /關/.test(document.querySelector('#btnSound').textContent)`), 'sound toggle switches off');
    await p.clickSel('#btnVoice'); rep.ok(await p.evaluate(`!voiceOn`), 'voice toggle switches off');
    rep.ok(p.errors.length === 0, 'free flow: no console errors', p.errors.slice(0, 3));
  } finally { await p.close(); }
}

async function terrainFlow() {
  const p = await openPage(url, { width: W, height: H });
  try {
    await p.waitFor(`!document.querySelector('#go').disabled`);
    await p.clickSel('#go'); await sleep(150);
    // setup: a dry-grass field north of the mage, one spider at the aim point, four lizards further out on the grass
    await p.evaluate(`(() => { for (const e of enemies) e.pos.set(30, 0, 30 - Math.random() * 5), e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 });
      player.pos.set(0, 0, 0); for (let z = -11; z <= -3; z++) for (let x = -4; x <= 4; x++) setT(cellOf(x + .5, z + .5), TER.GRASS);
      // three spiders 3 cells from the impact: outside the blast radius, so only the spreading fire can kill them
      spawnEnemy('spider', .5, -5.5, 1); for (const [x, z] of [[-2.5, -5.5], [3.5, -5.5], [.5, -8.5]]) spawnEnemy('spider', x, z, .6);
      for (const e of enemies) e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 }); window.__tk0 = terrainKills; })()`);
    const aim = await p.evaluate(`(() => { const v = new THREE.Vector3(.5, 1, -5.5).project(camera); return [(v.x * .5 + .5) * innerWidth, (-v.y * .5 + .5) * innerHeight]; })()`);
    // hold the button until the game has actually cast: on a slow software-GPU CI box a short click can fall between two frames
    await p.mouse('mouseMoved', aim[0], aim[1]); await p.mouse('mousePressed', aim[0], aim[1]);
    const cast = await p.waitFor(`projs.some(q => q.kind === 'fire') || cds.fire > 0`, 10000); await p.mouse('mouseReleased', aim[0], aim[1]);
    const diag = () => p.evaluate(`(() => { let fire = 0, ash = 0; for (let i = 0; i < TT.length; i++) { if (TT[i] === TER.FIRE) fire++; if (TT[i] === TER.ASH) ash++; }
      return { fireballs: projs.filter(q => q.kind === 'fire').length, cdFire: +cds.fire.toFixed(2), fireCells: fire, ashCells: ash, terrainKills, kills: player.kills, fps: document.querySelector('#sFps').textContent, gameTime: +time.toFixed(1) }; })()`);
    rep.ok(cast, 'holding the left button casts a fireball at the grass', cast ? undefined : await diag());
    const lit = await p.waitFor(`(() => { let n = 0; for (let i = 0; i < TT.length; i++) if (TT[i] === TER.FIRE) n++; return n >= 3; })()`, 30000);
    rep.ok(lit, 'the fireball sets the dry grass on fire', lit ? undefined : await diag());
    const spread = await p.waitFor(`(() => { let n = 0; for (let z = -11; z <= -3; z++) for (let x = -4; x <= 4; x++) { const t = TT[cellOf(x + .5, z + .5)]; if (t === TER.FIRE || t === TER.ASH) n++; } return n >= 20; })()`, 60000);
    rep.ok(spread, 'the fire spreads across the field on its own', spread ? undefined : await diag());
    const tk = await p.waitFor(`terrainKills > window.__tk0`, 60000);
    rep.ok(tk, 'monsters standing in the fire die as terrain kills', tk ? undefined : await diag());
    const ash = await p.waitFor(`(() => { let n = 0; for (let z = -11; z <= -3; z++) for (let x = -4; x <= 4; x++) if (TT[cellOf(x + .5, z + .5)] === TER.ASH) n++; return n >= 5; })()`, 60000);
    rep.ok(ash, 'burnt grass turns to ash and stays on the map', ash ? undefined : await diag());
    rep.ok(p.errors.length === 0, 'terrain flow: no console errors', p.errors.slice(0, 3));
  } finally { await p.close(); }
}

try { await storyFlow(); await freeFlow(); await terrainFlow(); }
catch (e) { rep.ok(false, 'e2e crashed', e.message); }
finally { srv?.close(); }
process.exit(rep.done() ? 1 : 0);
