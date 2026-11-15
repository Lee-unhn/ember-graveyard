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
];

const LAYOUT = (sel) => `(() => {
  const vw = innerWidth, vh = innerHeight, out = { sideScroll: document.scrollingElement.scrollWidth > vw + 1 };
  const onTitle = !document.querySelector('#intro').hidden; // judge by what is on screen, not by the class the page sets
  const titleHud = onTitle ? [...document.querySelectorAll('.hud')].filter((e) => { const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && r.width * r.height > 0; }).length : 0;
  out.titleHud = titleHud;
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
for (const [vp, w, h] of [['desktop', 1280, 720], ['phone', 375, 667]]) {
  const page = await openPage(url, { width: w, height: h });
  try {
    R.ok(await page.waitFor(`document.querySelector('#loading').hidden && !document.querySelector('#go').disabled`, 60000), `${vp}: loading screen finishes and unlocks the buttons`);
    await page.evaluate(`try{localStorage.clear()}catch(e){}`);
    let n = 0;
    for (const [name, js, sel, after, under = []] of SCENES) {
      await page.evaluate(js);
      if (name === 'dead') await page.waitFor(`!document.querySelector('#dead').hidden`, 5000);
      await sleep(500);
      const f = join(OUT, `${vp}-${String(n++).padStart(2, '0')}-${name}.jpg`);
      writeFileSync(f, Buffer.from((await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 })).result.data, 'base64')); files.push(f);
      const L = await page.evaluate(LAYOUT(sel));
      const bad = [];
      if (L.sideScroll) bad.push('page scrolls sideways');
      if (L.titleHud) bad.push(`${L.titleHud} battle HUD panels behind the title`);
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
