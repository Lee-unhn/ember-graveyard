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
    rep.ok(await p.waitFor(`window.EGControls && !EGControls.touch`, 5000), 'a desktop browser is not mistaken for a touch device (P4)');
    await p.clickSel('#goStory');
    rep.ok(await p.evaluate(`document.querySelector('#intro').hidden && !document.querySelector('#dialog').hidden`), 'click "story mode" -> intro closes, dialogue opens');
    rep.ok((await p.evaluate(`document.querySelector('#dWho').textContent`)) === '灰翁', 'first speaker is the elder');
    let presses = 0;
    while (await p.evaluate(`!document.querySelector('#dialog').hidden`) && presses < 20) { await p.key('Space', ' ', ' '); presses++; await sleep(60); }
    rep.ok(presses >= 5 && presses <= 10, `Space advances the opening dialogue (${presses} presses for 5 lines)`);
    // objective text and skill-bar classes are refreshed by the next frame, so wait for them (slow CI renders few frames)
    rep.ok(await p.waitFor(`story.phase === 'fight' && /擊倒/.test(document.querySelector('#objective').textContent)`, 5000), 'after dialogue: fight phase with a kill objective');
    rep.ok(await p.waitFor(`document.querySelector('.sk[data-s=bolt]').classList.contains('locked')`, 5000), 'locked spells are greyed out in the skill bar');

    // movement: hold W
    await p.evaluate(`(() => { for (const e of enemies) { e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 }); } })()`); // setup: freeze monsters so the test is deterministic
    const z0 = await p.evaluate('player.pos.z');
    // hold W until the mage has walked 1.5 units (max 5 s): a fixed hold time fails on slow CI and on slowing terrain (mud, water)
    await p.keyDown('KeyW'); await p.waitFor(`player.pos.z < ${z0} - 1.5`, 5000); await p.keyUp('KeyW');
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
      return { fireballs: projs.filter(q => q.kind === 'fire').length, cdFire: +cds.fire.toFixed(2), fireCells: fire, ashCells: ash, terrainKills, kills: player.kills, fps: document.querySelector('#sFps').textContent, gameTime: +time.toFixed(1), touch: !!(window.EGControls && EGControls.touch), aim: [+aim.x.toFixed(1), +aim.z.toFixed(1)] }; })()`);
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

async function menusFlow() {
  const p = await openPage(url, { width: W, height: H });
  const ready = () => p.waitFor(`document.querySelector('#loading').hidden && !document.querySelector('#go').disabled`, 60000);
  const shown = (sel) => `!document.querySelector('${sel}').hidden`;
  try {
    rep.ok(await ready(), 'loading screen goes away once the atlas is drawn');
    rep.ok(await p.evaluate(`getComputedStyle(document.querySelector('#bottom')).display === 'none' && getComputedStyle(document.querySelector('#lab')).display === 'none'`), 'title screen hides the battle HUD');
    // settings: keyboard on the first slider, value is saved
    await p.clickSel('#btnSettings');
    rep.ok(await p.evaluate(`${shown('#settings')} && document.activeElement.id === 'sBright'`), 'settings opens with focus on the first slider (brightness)');
    await p.key('ArrowLeft', 'ArrowLeft');
    rep.ok(await p.waitFor(`Math.abs(SET.bright - .9) < 1e-9 && JSON.parse(localStorage.getItem('eg-settings')).bright === .9`, 3000), 'arrow key lowers screen brightness and the value is saved');
    await p.key('ArrowRight', 'ArrowRight');                // one press back up to 100% so the rest of the run sees the normal picture
    await p.key('Escape', 'Escape');
    rep.ok(await p.evaluate(`document.querySelector('#settings').hidden && ${shown('#intro')}`), 'Esc returns from settings to the title');
    // story start, skip the opening
    await p.clickSel('#goStory');
    for (let k = 0; k < 20 && await p.evaluate(shown('#dialog')); k++) { await p.key('Space', ' ', ' '); await sleep(60); }
    rep.ok(await p.waitFor(`story.phase === 'fight'`, 5000), 'story reaches the first fight');
    await p.evaluate(`for (const e of enemies) e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 })`); // setup: harmless monsters
    // pause really stops the game: holding W while paused does not move the mage
    await p.key('Escape', 'Escape');
    rep.ok(await p.evaluate(`${shown('#pause')} && menuOpen`), 'Esc pauses the game');
    const z0 = await p.evaluate('player.pos.z');
    await p.keyDown('KeyW'); await sleep(700); await p.keyUp('KeyW');
    rep.ok(Math.abs(await p.evaluate('player.pos.z') - z0) < 1e-6, 'holding W while paused does not move the mage');
    await p.key('KeyP', 'p');
    rep.ok(await p.evaluate(`document.querySelector('#pause').hidden && !menuOpen`), 'P resumes');
    await p.keyDown('KeyW'); const moved = await p.waitFor(`player.pos.z < ${z0} - 1`, 5000); await p.keyUp('KeyW');
    rep.ok(moved, 'after resuming, W moves the mage again');
    // back to title through the confirmation
    await p.key('Escape', 'Escape'); await p.clickSel('#pTitle');
    rep.ok(await p.evaluate(shown('#pConfirm')), 'leaving asks for confirmation first');
    await p.clickSel('#pYes');
    rep.ok(await p.evaluate(`${shown('#intro')} && !running && ${shown('#goContinue')} && /第 1 幕/.test(document.querySelector('#goContinue').textContent)`), 'confirm -> title with a "continue act 1" button');
    // continue after a reload, from act 3
    await p.evaluate(`writeSave(2)`); // setup: pretend two towers were already lit
    await p.send('Page.reload'); await sleep(300);
    rep.ok(await ready() && await p.evaluate(`${shown('#goContinue')} && /第 3 幕/.test(document.querySelector('#goContinue').textContent)`), 'after a reload the title offers "continue act 3"');
    await p.clickSel('#goContinue');
    for (let k = 0; k < 20 && await p.evaluate(shown('#dialog')); k++) { await p.key('Space', ' ', ' '); await sleep(60); }
    rep.ok(await p.evaluate(`story.act === 2 && TOWERS[0].lit && TOWERS[1].lit && !TOWERS[2].lit && story.unlocked.has('bolt')`), 'continue resumes act 3 with towers 1-2 lit and their spells learnt');
    // result screen: Space continues
    await p.evaluate(`showResult(2, () => { window.__next = 1 })`); // setup: the tower-lighting sequence itself is covered by the smoke probe
    await p.key('Space', ' ', ' ');
    rep.ok(await p.evaluate(`window.__next === 1 && document.querySelector('#result').hidden`), 'Space closes the act result and continues the story');
    // death by lava: cause + tip, then back to title
    await p.evaluate(`for (const e of enemies) e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 }); player.hp = 1;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) setT(cellOf(player.pos.x + dx, player.pos.z + dz), TER.LAVA, 30)`);
    // setup: a 5x5 lava patch with a lifetime; a single cell cools at once (no lifetime) or hardens on a neighbouring puddle before the damage adds up (DEVLOG #33, #35)
    rep.ok(await p.waitFor(shown('#dead'), 10000), 'standing in lava at 1 HP ends in the death screen');
    rep.ok(await p.evaluate(`/熔岩/.test(document.querySelector('#deadCause').textContent) && /熔岩/.test(document.querySelector('#deadTip').textContent)`), 'death screen names lava and gives the lava tip');
    await p.clickSel('#deadTitle');
    rep.ok(await p.evaluate(`${shown('#intro')} && document.querySelector('#dead').hidden && getComputedStyle(document.querySelector('#bottom')).display === 'none'`), '"back to title" from the death screen');
    rep.ok(p.errors.length === 0, 'menus flow: no console errors', p.errors.slice(0, 3));
  } finally { await p.close(); }
}

async function touchFlow() {
  // a landscape phone with touch emulation; every action under test is a real touch event
  const p = await openPage(url + (url.includes('?') ? '&' : '?') + 'touch=1', { width: 844, height: 390, mobile: true });
  try {
    rep.ok(await p.waitFor(`document.querySelector('#loading').hidden && !document.querySelector('#go').disabled && window.EGControls && EGControls.touch`, 60000), 'touch mode switches on for ?touch=1');
    rep.ok(await p.evaluate(`/手機操作/.test(document.querySelector('#introNote').textContent)`), 'title screen explains the touch controls');
    await p.evaluate(`startFree(); player.maxhp = player.hp = 1e9; for (const e of enemies) { e.pos.set(30, 0, 30); e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 }); }`); // setup
    // joystick: drag up on the left half
    const z0 = await p.evaluate('player.pos.z');
    await p.touch('touchStart', [[150, 250]]); await p.touch('touchMove', [[150, 190]]);
    const moved = await p.waitFor(`player.pos.z < ${z0} - 1.5`, 8000);
    await p.touch('touchEnd');
    rep.ok(moved, 'dragging up on the left half walks the mage north');
    rep.ok(await p.waitFor(`!keys[KB.up] && !keys[KB.down] && !keys[KB.left] && !keys[KB.right]`, 2000), 'lifting the finger stops the mage');
    // tap a skill: auto-aim at the nearest monster
    await p.evaluate(`spawnEnemy('lizard', player.pos.x + 6, player.pos.z, 1); enemies[enemies.length - 1].T = Object.assign({}, enemies[enemies.length - 1].T, { speed: 0, dmg: 0 }); cds.bolt = 0`); // setup
    await p.tapSel('.sk.bolt');
    rep.ok(await p.waitFor(`cds.bolt > 0`, 5000), 'tapping the chain lightning tile casts it');
    rep.ok(await p.evaluate(`Math.abs(Math.sin(player.face) - 1) < 0.2`), 'the cast faces the nearest monster (east)');
    // hold the fireball tile: keeps firing until released
    await p.evaluate(`cds.fire = 0`);
    const fb = await p.evaluate(`(() => { const b = document.querySelector('.sk.fire').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
    await p.touch('touchStart', [fb]);
    rep.ok(await p.waitFor(`lmb && (projs.some((q) => q.kind === 'fire') || cds.fire > 0)`, 5000), 'holding the fireball tile fires');
    await p.touch('touchEnd');
    rep.ok(await p.waitFor(`!lmb`, 2000), 'releasing the tile stops firing');
    // pause button
    await p.tapSel('#tPause');
    rep.ok(await p.waitFor(`!document.querySelector('#pause').hidden`, 3000), 'the pause button pauses');
    rep.ok(p.errors.length === 0, 'touch flow: no console errors', p.errors.slice(0, 3));
  } finally { await p.close(); }
}

try { await storyFlow(); await freeFlow(); await terrainFlow(); await menusFlow(); await touchFlow(); }
catch (e) { rep.ok(false, 'e2e crashed', e.message); }
finally { srv?.close(); }
process.exit(rep.done() ? 1 : 0);
