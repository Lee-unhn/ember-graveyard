#!/usr/bin/env node
// Screen self-check loop: open every menu/result screen at desktop and phone size, screenshot it, and assert
// the layout rules a human reviewer would otherwise eyeball (card inside the viewport, no sideways scroll,
// buttons big enough to tap, nothing behind the title screen, zero console errors).
//   node tests/screens.mjs                  screenshots go to .screens/ (gitignored) for a quick look
//   node tests/screens.mjs --save=p3a       also copy them to docs/screens/p3a/ (kept in the repo, course material)
//   node tests/screens.mjs https://...      check a deployed copy
import { mkdirSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, serve, openPage, reporter, sleep } from './lib/browser.mjs';

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
  ['touch-play', `document.querySelector('#dead').hidden=true;EGControls.enableTouch();startFree();player.maxhp=player.hp=1e9;for(const e of enemies)e.T=Object.assign({},e.T,{speed:0,dmg:0})`, null],
  // boss fight on a phone: the objective bar and the boss health bar must not cover each other or the status panel, the bag/pause buttons or the rotate hint (DEVLOG #84)
  ['boss-hud', `EGControls.enableTouch();startStory(0);while(dlg)endDialog();player.maxhp=player.hp=1e9;startBoss();for(const e of enemies)e.T=Object.assign({},e.T,{speed:0,dmg:0});logic(.1)`, null],
  ['fight-hud', `startStory(0);while(dlg)endDialog();player.maxhp=player.hp=1e9;for(const e of enemies)e.T=Object.assign({},e.T,{speed:0,dmg:0});logic(.1)`, null],
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
const HUD_SCENES = ['fight-hud-desktop', 'boss-hud-desktop', 'boss-hud', 'fight-hud'];
for (const [vp, w, h, only] of [['desktop', 1280, 720], ['phone', 375, 667], ['phone-narrow', 320, 568, ['boss-hud']], ['phone-landscape', 667, 375, ['boss-hud']],
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
      if (name.startsWith('boss-hud') || name.startsWith('fight-hud')) {
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
srv?.close();
console.log(`  screenshots: ${files.length} in .screens/`);
if (save) {
  const dir = join(ROOT, 'docs', 'screens', save); mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(OUT).filter((x) => x.endsWith('.jpg'))) copyFileSync(join(OUT, f), join(dir, f));
  console.log('  saved to docs/screens/' + save);
}
process.exit(R.done() ? 1 : 0);
