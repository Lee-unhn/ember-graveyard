#!/usr/bin/env node
// Screen self-check loop: open every menu/result screen at desktop and phone size, screenshot it, and assert
// the layout rules a human reviewer would otherwise eyeball (card inside the viewport, no sideways scroll,
// buttons big enough to tap, nothing behind the title screen, zero console errors).
//   node tests/screens.mjs                  screenshots go to .screens/ (gitignored) for a quick look
//   node tests/screens.mjs --save=p3a       also copy them to docs/screens/p3a/ (kept in the repo, course material)
//   node tests/screens.mjs https://...      check a deployed copy
import { mkdirSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { ROOT, serve, openPage, reporter, sleep, spriteInit, lookInit } from './lib/browser.mjs';

const args = process.argv.slice(2);
const remote = args.find((a) => /^https?:/.test(a));
const save = (args.find((a) => a.startsWith('--save=')) || '').slice(7);
const R = reporter('screens' + (remote ? ' @ ' + remote : ''));
const OUT = join(ROOT, '.screens'); mkdirSync(OUT, { recursive: true });

// each scene: how to reach it, which overlay must be on top (null = gameplay view)
// [name, js to reach it, overlay that must be on top, js to undo, overlays allowed underneath]
const SCENES = [
  ['loading', `$('#loading').hidden=false`, '#loading', `$('#loading').hidden=true`, ['intro']],
  ['title', `1`, '#intro'],
  ['title-continue', `writeSave(2);refreshTitle()`, '#intro', `clearSave();refreshTitle()`],
  ['settings', `openSub('settings','intro')`, '#settings', `backSub('settings')`],
  ['help', `openSub('help','intro')`, '#help', `backSub('help')`],
  ['credits', `openSub('credits','intro')`, '#credits', `backSub('credits')`],
  ['play-terrain', `startFree();player.maxhp=player.hp=1e9;for(const e of enemies)killEnemy(e);enemies.length=0;
    const C=(x,z)=>(Math.round(z)+GH)*GN+Math.round(x)+GH;
    for(let x=-9;x<=9;x++)for(let z=-9;z<=9;z++){if(Math.hypot(x-4,z-3)<3.3)setT(C(x,z),TER.LAVA,30);else if(Math.hypot(x+4,z-2)<3)setT(C(x,z),TER.WATER);else if(Math.hypot(x,z+5)<2.4)setT(C(x,z),TER.BLOOD)}
    caAcc=-1e9;zoom=.6`, null],
  ['pause', `togglePause(true)`, '#pause'],
  ['pause-confirm', `$('#pTitle').click()`, '#pause', `$('#pNo').click()`],
  ['result', `togglePause(false);story.actT0=time-95;story.actKills0=player.kills-23;story.actTk0=terrainKills-6;story.actLoot0=pickups-2;story.bestChain=3;showResult(0,null)`, '#result', `closeResult()`],
  ['dead', `caAcc=0;player.hp=1;hurtPlayer(5,'熔岩')`, '#dead'],
  // F14: the same HUD checks without touch controls (a desktop browser zoomed to 200% is 640 x 400 CSS pixels) and in the middle of an act, not only at the boss
  ['fight-hud-desktop', `startStory(0);while(dlg)endDialog();player.maxhp=player.hp=1e9;for(const e of enemies)e.T=Object.assign({},e.T,{speed:0,dmg:0});logic(.1)`, null],
  ['boss-hud-desktop', `startStory(0);while(dlg)endDialog();player.maxhp=player.hp=1e9;startBoss();for(const e of enemies)e.T=Object.assign({},e.T,{speed:0,dmg:0});logic(.1)`, null],
  // optional blink move switched on (DEVLOG timeline #47): a fifth skill tile right after a blink, on the desktop bar and (below) on the touch bar
  ['blink-hud-desktop', `EG.enableBlink(true);startFree();player.maxhp=player.hp=1e9;for(const e of enemies)e.T=Object.assign({},e.T,{speed:0,dmg:0});cds.blink=0;EG.blink(1,0);logic(.1)`, null, `EG.enableBlink(false)`],
  ['touch-play', `document.querySelector('#dead').hidden=true;EGControls.enableTouch();startFree();player.maxhp=player.hp=1e9;for(const e of enemies)e.T=Object.assign({},e.T,{speed:0,dmg:0})`, null],
  // boss fight on a phone: the objective bar and the boss health bar must not cover each other or the status panel, the bag/pause buttons or the rotate hint (DEVLOG #84)
  ['boss-hud', `EGControls.enableTouch();startStory(0);while(dlg)endDialog();player.maxhp=player.hp=1e9;startBoss();for(const e of enemies)e.T=Object.assign({},e.T,{speed:0,dmg:0});logic(.1)`, null],
  ['fight-hud', `startStory(0);while(dlg)endDialog();player.maxhp=player.hp=1e9;for(const e of enemies)e.T=Object.assign({},e.T,{speed:0,dmg:0});logic(.1)`, null],  ['blink-hud', `EG.enableBlink(true);startFree();player.maxhp=player.hp=1e9;for(const e of enemies)e.T=Object.assign({},e.T,{speed:0,dmg:0});cds.blink=0;EG.blink(-1,0);logic(.1)`, null, `EG.enableBlink(false)`],
];

const LAYOUT = (sel) => `(() => {
  const vw = innerWidth, vh = innerHeight, out = { sideScroll: document.scrollingElement.scrollWidth > vw + 1 };
  const onTitle = !document.querySelector('#intro').hidden; // judge by what is on screen, not by the class the page sets
  const titleHud = onTitle ? [...document.querySelectorAll('.hud')].filter((e) => { const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && r.width * r.height > 0; }).length : 0;
  out.titleHud = titleHud;
  // gameplay HUD blocks that are on screen must not overlap each other and must stay inside the viewport
  const hudIds = ['#status', '#objective', '#bossbar', '#bottom', '#hint', '#chainTag', '#touchBtns', '#rotateHint'], seen = [];
  for (const id of hudIds) { const e = document.querySelector(id); if (!e || e.hidden || getComputedStyle(e).display === 'none') continue; const r = e.getBoundingClientRect(); if (r.width * r.height > 0) seen.push([id, r]); }
  out.hudOverlap = []; out.hudOutside = seen.filter(([, r]) => r.left < -1 || r.right > vw + 1).map(([id]) => id);
  for (let i = 0; i < seen.length; i++) for (let j = i + 1; j < seen.length; j++) { const a = seen[i][1], b = seen[j][1]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.hudOverlap.push(seen[i][0] + ' x ' + seen[j][0]); }
  out.bossShown = !document.querySelector('#bossbar').hidden;
  // touch mode: every on-screen touch control is at least 44 px and fully inside the screen
  out.smallTouch = document.body.classList.contains('touch') ? [...document.querySelectorAll('#touchBtns button, .sk')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect())
    .filter((r) => r.width < 44 || r.height < 44 || r.left < 0 || r.right > vw + 1 || r.bottom > vh + 1).length : 0;
  if (${JSON.stringify(sel)}) {
    const o = document.querySelector(${JSON.stringify(sel)}); out.visible = !!o && !o.hidden && getComputedStyle(o).display !== 'none';
    const card = o && o.querySelector('.card'); const b = card && card.getBoundingClientRect();
    out.cardInside = !!b && b.left >= -1 && b.right <= vw + 1 && b.top >= -1;
    out.cardScrollable = !!b && (b.bottom <= vh + 1 || card.scrollHeight > card.clientHeight || o.scrollHeight > o.clientHeight);
    out.smallButtons = [...o.querySelectorAll('button:not([hidden])')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect())
      .filter((r) => r.width < 24 || r.height < 24).length;
    out.others = [...document.querySelectorAll('.overlay')].filter((e) => e !== o && !e.hidden && getComputedStyle(e).display !== 'none').map((e) => e.id);
  }
  return out; })()`;

const srv = remote ? null : await serve();
const url = remote || `http://127.0.0.1:${srv.address().port}/index.html`;
const files = [];
const HUD_SCENES = ['fight-hud-desktop', 'boss-hud-desktop', 'boss-hud', 'fight-hud', 'blink-hud-desktop', 'blink-hud'];
const spritesOnly = args.includes('--sprites-only');
for (const [vp, w, h, only] of spritesOnly ? [] : [['desktop', 1280, 720], ['phone', 375, 667], ['phone-narrow', 320, 568, ['boss-hud']], ['phone-landscape', 667, 375, ['boss-hud']],
  ['zoom-200', 640, 400, HUD_SCENES], ['phone-tall', 375, 812, HUD_SCENES], ['phone-wide', 812, 375, HUD_SCENES]]) {
  const page = await openPage(url, { width: w, height: h });
  try {
    R.ok(await page.waitFor(`document.querySelector('#loading').hidden && !document.querySelector('#go').disabled`, 60000), `${vp}: loading screen finishes and unlocks the buttons`);
    await page.evaluate(`try{localStorage.clear()}catch(e){}`);
    let n = 0;
    for (const [name, js, sel, after, under = []] of SCENES) {
      if (only && !only.includes(name)) continue;
      await page.evaluate(js);
      if (name === 'dead') await page.waitFor(`!document.querySelector('#dead').hidden`, 5000);
      await sleep(500);
      const f = join(OUT, `${vp}-${String(n++).padStart(2, '0')}-${name}.jpg`);
      writeFileSync(f, Buffer.from((await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 })).result.data, 'base64')); files.push(f);
      const L = await page.evaluate(LAYOUT(sel));
      const bad = [];
      if (L.sideScroll) bad.push('page scrolls sideways');
      if (L.titleHud) bad.push(`${L.titleHud} battle HUD panels behind the title`);
      if (L.smallTouch) bad.push(`${L.smallTouch} touch controls under 44 px or off screen`);
      if (name.startsWith('boss-hud') || name.startsWith('fight-hud') || name.startsWith('blink-hud')) {
        if (name.startsWith('boss-hud') && !L.bossShown) bad.push('boss health bar is not shown');
        if (L.hudOverlap.length) bad.push('HUD blocks overlap: ' + L.hudOverlap.join(', '));
        if (L.hudOutside.length) bad.push('HUD blocks leave the screen sideways: ' + L.hudOutside.join(', '));
      }
      if (sel) {
        if (!L.visible) bad.push(sel + ' not visible');
        if (!L.cardInside) bad.push('card leaves the viewport');
        if (!L.cardScrollable) bad.push('card cut off at the bottom with no scroll');
        if (L.smallButtons) bad.push(`${L.smallButtons} buttons under 24px`);
        const extra = L.others.filter((id) => !under.includes(id));
        if (extra.length) bad.push('other overlays also open: ' + extra.join(','));
      }
      R.ok(bad.length === 0, `${vp}: ${name}`, bad.join('; '));
      if (after) await page.evaluate(after);
    }
    R.ok(page.errors.length === 0, `${vp}: console errors 0`, page.errors.slice(0, 3).join(' | '));
  } finally { await page.close(); }
}

// pixel sprites (kit/sprites.js) with the test atlases: play view at full resolution and with the whole screen in low resolution.
// The low-resolution shot is read back pixel by pixel: inside the play area every k x k block (k = the scale) must be one colour.
const pngRGBA = (buf) => { // minimal PNG reader (8-bit RGB / RGBA, the formats Chrome writes): returns { w, h, px(x, y) -> [r, g, b] }
  let o = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (o < buf.length) { const n = buf.readUInt32BE(o), t = buf.toString('latin1', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + n); o += 12 + n;
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; } else if (t === 'IDAT') idat.push(d); else if (t === 'IEND') break; }
  const bpp = ct === 6 ? 4 : 3, raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) { const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) { const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      out[y * stride + x] = (src[x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255; } }
  return { w, h, px: (x, y) => [...out.subarray(y * stride + x * bpp, y * stride + x * bpp + 3)] };
};
for (const [vp, w, h] of [['desktop', 1280, 720], ['phone', 375, 667]]) for (const [mode, opts] of [['sprites', {}], ['sprites-lowres', { pixelScreen: { rows: 360 } }]]) {
  if (remote) break;
  const page = await openPage(url, { width: w, height: h, mobile: vp === 'phone', init: spriteInit(opts) });
  try {
    R.ok(await page.waitFor(`!document.querySelector('#go').disabled && window.EGSprites && EGSprites.state.ready`, 60000), `${vp}: ${mode}: test atlases loaded`);
    await page.evaluate(`try{localStorage.clear()}catch(e){};startFree();player.maxhp=player.hp=1e9;for(const e of enemies)e.T=Object.assign({},e.T,{speed:0,dmg:0});
      for(const [x,z] of [[2.5,-2],[-2.5,-1.5],[0,-4]]){spawnEnemy('spider',x,z,1);const e=enemies[enemies.length-1];e.T=Object.assign({},e.T,{speed:0,dmg:0})}
      const C=(x,z)=>(Math.round(z)+GH)*GN+Math.round(x)+GH;for(let x=-6;x<=6;x++)for(let z=-6;z<=2;z++){if(Math.hypot(x-3,z+3)<2)setT(C(x,z),TER.LAVA,30);else if(Math.hypot(x+3,z+2)<1.8)setT(C(x,z),TER.WATER)}caAcc=-1e9;
      window.__fr=0;(function f(){__fr++;requestAnimationFrame(f)})()`);
    await page.waitFor(`EGSprites.state.actors >= 4 && __fr > 6`, 10000); // a few drawn frames, counted by the page itself
    const png = Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64');
    const f = join(OUT, `${vp}-${mode}.png`); writeFileSync(f, png); files.push(f);
    const L = await page.evaluate(`(() => { const d = EGSprites.debug(player); return { side: document.scrollingElement.scrollWidth > innerWidth + 1, k: EGSprites.state.scale, low: EGSprites.state.lowRes, cw: parseFloat(canvas.style.width) || innerWidth, ch: parseFloat(canvas.style.height) || innerHeight, shown: !!d && d.visible, actors: EGSprites.state.actors }; })()`);
    // the block check reads the canvas alone: page overlays (toast, damage numbers, panels) are hidden for a second shot
    const only = mode === 'sprites-lowres' ? (await page.evaluate(`(() => { const st = document.createElement('style'); st.id = 'egOnlyCanvas'; st.textContent = 'body * { visibility: hidden !important } #c { visibility: visible !important }'; document.head.appendChild(st); return 1; })()`),
      await page.waitFor(`(window.__fr0 = window.__fr0 || __fr) && __fr > __fr0 + 2`, 5000), Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')) : png;
    const img = pngRGBA(only), bad = [];
    if (L.side) bad.push('page scrolls sideways'); if (!L.shown) bad.push('player sprite not shown');
    let lum = 0, lum2 = 0, n = 0; for (let y = 0; y < img.h; y += 7) for (let x = 0; x < img.w; x += 7) { const [r, g, b] = img.px(x, y), l = .3 * r + .59 * g + .11 * b; lum += l; lum2 += l * l; n++; }
    const std = Math.sqrt(lum2 / n - (lum / n) ** 2); if (std < 4) bad.push(`blank picture (luminance std ${std.toFixed(1)})`);
    if (mode === 'sprites-lowres') {
      if (!L.low || !Number.isInteger(L.k) || L.k < 2) bad.push('not in low resolution at a whole-number scale ' + L.k);
      // the middle of the play area (HUD panels sit at the edges): every k x k block aligned to the canvas corner must be one colour
      let blocks = 0, mixed = 0; const k = L.k, x0 = Math.ceil(L.cw * .2 / k) * k, x1 = Math.floor(L.cw * .8 / k) * k, y0 = Math.ceil(L.ch * .3 / k) * k, y1 = Math.floor(L.ch * .7 / k) * k;
      for (let y = y0; y < y1; y += k) for (let x = x0; x < x1; x += k) { const c = img.px(x, y).join(); blocks++; for (let j = 0; j < k && c; j++) for (let i = 0; i < k; i++) if (img.px(x + i, y + j).join() !== c) { mixed++; j = k; break; } }
      if (mixed / blocks > .01) bad.push(`${mixed} of ${blocks} ${k}x${k} blocks are not one colour`);
      R.ok(bad.length === 0, `${vp}: ${mode}: ${blocks} blocks checked at x${k}, ${mixed} mixed`, bad.join('; '));
    } else R.ok(bad.length === 0, `${vp}: ${mode}: play view with ${L.actors} sprites`, bad.join('; '));
    R.ok(page.errors.length === 0, `${vp}: ${mode}: console errors 0`, page.errors.slice(0, 3).join(' | '));
  } finally { await page.close(); }
}
// night look (kit/look.js) with the test atlases: the play view with decorations, a lit tower with its halo and no flame, a lava pool glowing
for (const [vp, w, h] of [['desktop', 1280, 720], ['phone', 375, 667]]) {
  if (remote) break;
  const page = await openPage(url, { width: w, height: h, mobile: vp === 'phone', init: lookInit({}, { sprites: {} }) });
  try {
    R.ok(await page.waitFor(`!document.querySelector('#go').disabled && window.EGSprites && EGSprites.state.ready && window.EGLook && EGLook.state.decorReady`, 60000), `${vp}: look: test look and atlases loaded`);
    await page.evaluate(`try{localStorage.clear()}catch(e){};startFree();player.maxhp=player.hp=1e9;for(const e of enemies)e.T=Object.assign({},e.T,{speed:0,dmg:0});
      const T=TOWERS[0];T.lit=true;player.pos.set(T.x,0,T.z+5);camSnap=true;const C=(x,z)=>cellOf(x+.5,z+.5);for(let x=-2;x<=2;x++)for(let z=1;z<=3;z++)setT(C(T.x+x+4,T.z+z),TER.LAVA,30);caAcc=-1e9;
      window.__fr=0;(function f(){__fr++;requestAnimationFrame(f)})()`);
    await page.waitFor(`__fr > 8`, 10000);
    const png = Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64');
    const f = join(OUT, `${vp}-look.png`); writeFileSync(f, png); files.push(f);
    const L = await page.evaluate(`(() => { const T = TOWERS[0], v = new THREE.Vector3(); const onScreen = (x, y, z) => { v.set(x, y, z).project(camera); return Math.abs(v.x) < 1 && Math.abs(v.y) < 1; };
      return { side: document.scrollingElement.scrollWidth > innerWidth + 1, decor: EGLook.decor.filter((I) => I.m && I.m.visible && onScreen(I.x, .5, I.z)).length,
        halo: EGLook.halos.some((h) => h.owner === T && h.m.visible), flame: ADD.list.filter((q) => Math.abs(q.x - T.x) < .6 && Math.abs(q.z - T.z) < .6 && q.y > 3 && q.a0 > 0).length, err: EGLook.state.err }; })()`);
    const img = pngRGBA(png), bad = [];
    if (L.side) bad.push('page scrolls sideways'); if (L.decor < 2) bad.push(`decorations on screen ${L.decor}`); if (!L.halo) bad.push('no halo on the lit tower'); if (L.flame) bad.push(`${L.flame} visible flame particles`); if (L.err) bad.push(L.err);
    let lum = 0, lum2 = 0, n = 0; for (let y = 0; y < img.h; y += 7) for (let x = 0; x < img.w; x += 7) { const [r, g, b] = img.px(x, y), l = .3 * r + .59 * g + .11 * b; lum += l; lum2 += l * l; n++; }
    const std = Math.sqrt(lum2 / n - (lum / n) ** 2); if (std < 4) bad.push(`blank picture (luminance std ${std.toFixed(1)})`);
    R.ok(bad.length === 0, `${vp}: look: play view with ${L.decor} decorations on screen, the lit tower's halo, no visible flame`, bad.join('; '));
    R.ok(page.errors.length === 0, `${vp}: look: console errors 0`, page.errors.slice(0, 3).join(' | '));
  } finally { await page.close(); }
}
srv?.close();
console.log(`  screenshots: ${files.length} in .screens/`);
if (save) {
  const dir = join(ROOT, 'docs', 'screens', save); mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(OUT).filter((x) => x.endsWith('.jpg'))) copyFileSync(join(OUT, f), join(dir, f));
  console.log('  saved to docs/screens/' + save);
}
process.exit(R.done() ? 1 : 0);
