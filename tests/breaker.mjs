#!/usr/bin/env node
// Breaker: adversarial checks for the engine/content split (kit/ + content/). Written by someone who did not make the change.
// A check that is RED here is a finding (see incoming/design/breaker_split.md); a GREEN one proves that direction was tried and held.
// It does not edit kit/, content/, index.html or any other test: every variant is built in a temp copy.
//   node tests/breaker.mjs
import os from 'node:os';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { ROOT, serve, openPage, reporter, sleep } from './lib/browser.mjs';
import { pageSources, splitViolations, ownedStrings } from './lib/pagesrc.mjs';

const rep = reporter('breaker');
const BASE = '1e294ad'; // main, before the split
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const work = mkdtempSync(join(tmpdir(), 'eg-breaker-'));
const cleanups = [() => rmSync(work, { recursive: true, force: true })];
const SETTLE_MS = Number(process.env.BREAKER_SETTLE_MS) || 8000; // how long a page may take to become usable; the default is the strict value, a slow or shared machine can raise it (BREAKER_SETTLE_MS=20000)

// ---------------------------------------------------------------- helpers
// Windows: ask PowerShell (counts standby memory); elsewhere (Linux CI): os.freemem (DEVLOG #82)
// minimum free memory before a browser opens: 1 GB by default, EG_MIN_FREE_GB overrides
const MIN_FREE_GB = Number(process.env.EG_MIN_FREE_GB) || 1;
const freeGB = () => process.platform === 'win32'
  ? parseFloat((spawnSync('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB'], { encoding: 'utf8' }).stdout || '').replace(',', '.')) || 0
  : os.freemem() / 1024 ** 3;
async function waitForMemory() {
  for (let i = 0; i < 60; i++) { const g = freeGB(); if (g >= MIN_FREE_GB || process.platform !== 'win32') return g; console.log(`  (free memory ${g.toFixed(1)} GB < ${MIN_FREE_GB} GB, waiting 30 s)`); await sleep(30000); }
  return freeGB();
}
function demoContent() {
  const ctx = {}; ctx.window = ctx; vm.createContext(ctx); // the content files assign to a bare global `CONTENT`, so they need a real global object
  for (const f of ['story.js', 'world.js']) vm.runInContext(read('content/demo/' + f), ctx);
  return JSON.parse(JSON.stringify(ctx.CONTENT));
}
// git-ignored paths (local design drafts in incoming/, screenshots, the private main file) are never published,
// so the copy leaves them out, exactly like the publish gates do in the real checkout (DEVLOG #83)
const IGNORED = (() => {
  const r = spawnSync('git', ['-C', ROOT, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory'], { encoding: 'utf8' });
  return new Set(r.status === 0 ? r.stdout.split('\n').filter(Boolean).map((s) => s.replace(/\/$/, '')) : []);
})();
function freshCopy(name) { // a copy of the worktree without .git / heavy folders / ignored files, for planting defects
  const dir = join(work, name);
  cpSync(ROOT, dir, { recursive: true, filter: (s) => !/[\\/](\.git|node_modules)([\\/]|$)/.test(s) && !IGNORED.has(relative(ROOT, s).replace(/\\/g, '/')) });
  return dir;
}
function edit(dir, file, fn) { const p = join(dir, file); const t = readFileSync(p, 'utf8'); const n = fn(t); if (n === t) throw new Error(`edit did not apply: ${file}`); writeFileSync(p, n); }
function killTree(pid) { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }); }
// run the repo's own static gates against a planted copy
function runChecksStatic(dir) { // tests/checks.mjs, stopped as soon as its static section is over (the rest needs a browser)
  return new Promise((res) => {
    const pr = spawn(process.execPath, [join(ROOT, 'tests', 'checks.mjs')], { env: { ...process.env, EG_ROOT: dir }, cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = ''; const done = () => { killTree(pr.pid); res(out); };
    const t = setTimeout(done, 30000);
    pr.stdout.on('data', (d) => { out += d; if (/README links the development log/.test(out)) { clearTimeout(t); setTimeout(done, 100); } });
    pr.on('exit', () => { clearTimeout(t); res(out); });
  });
}
const failLines = (out) => out.split('\n').filter((l) => /^\s+FAIL /.test(l)).map((l) => l.trim());
function runSmokeStatic(dir) { const r = spawnSync(process.execPath, [join(dir, 'scripts', 'smoke.mjs')], { cwd: dir, encoding: 'utf8', timeout: 60000 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; }

// ================================================================ A. behaviour parity with main (static, git)
// The hardening that fixed this report's findings (DEVLOG §5 #68-#80) is the ONLY allowed difference from main, and it is spelled out:
//  - new engine lines carry the marker /*H*/ at the start of the line (only core.js and boot.js may hold them, checked below);
//  - the few main lines that had to change are undone by REVERSE (kit text -> main text), each replacement must really occur in kit/;
//  - HTML_FORWARD turns main's index.html into what the page must look like now (content-specific text moved into the content pack).
// Anything else that differs from main is still a finding.
const MARK = '/*H*/';
const REVERSE = [
  // blink key collision, modifier keys, ending screen, new-run reset, reduced flashing (DEVLOG timeline #49): Ctrl/Meta/Alt combos do not cast or open the bag; no cast or movement
  // behind the ending screen; clearWorld resets cooldowns, the queued cast, hit-stop, shake and leftover effects; with EG.reduceFlashing on, pooled flashes and the hit whitening dim (off = main)
  ["if(e.code===KB.inv&&!egMod(e))toggleInv();", "if(e.code===KB.inv)toggleInv();"], ["if(m&&!egMod(e))tryCast(m);", "if(m)tryCast(m);"],
  ["function tryCast(id,poll){if(egHeld||egEnd())return;", "function tryCast(id,poll){if(egHeld)return;"], ["if(player.alive&&!egEnd()){", "if(player.alive){"],
  ["player.tacc=0;egRun();", "player.tacc=0;"], ["function flash(pos,color,inten,dist,life){if(egFlashOff)inten*=.3;", "function flash(pos,color,inten,dist,life){"],
  [".setRGB(.85,.75,.7).multiplyScalar(egFlashOff?.3:1)}", ".setRGB(.85,.75,.7)}"],
  // key taps during another cast, dialogue events, built-in music switch, post-effect tint and aberration (DEVLOG timeline #48): a press made while another cast runs is
  // kept and cast when that cast ends (the held left button polls with a flag so it cannot replace it); the defaults reproduce main's behaviour and picture
  ["function tryCast(id,poll){", "function tryCast(id){"], ["if(player.cast&&!poll)egQ=[id,player.cast];", ""], ["if(lmb)tryCast('fire',1);", "if(lmb)tryCast('fire');"],
  ["if(c.t>=c.dur){player.cast=null;if(egQ[1]===c)tryCast(egQ[0])}}", "if(c.t>=c.dur)player.cast=null}"], ["musicTimer||egMusicOff)return", "musicTimer)return"],
  ["hidden=false;egEmit('dialogStart',id);nextLine()}", "hidden=false;nextLine()}"], ["const t=dlg.then,i=dlg.id;dlg=null;", "const t=dlg.then;dlg=null;"], ["hush();egEmit('dialogEnd',i);if(t)t()}", "hush();if(t)t()}"],
  [", uCA, uCAk; uniform vec3 uTint;", ";"], [" if (uCA * uCAk > 0.0) { vec2 o = (vUv - .5) * uCA * uCAk; sharp.r = texture2D(tMain, vUv + o).r; sharp.b = texture2D(tMain, vUv - o).b; soft.r = texture2D(tSoft, vUv + o).r; soft.b = texture2D(tSoft, vUv - o).b; }", ""],
  ["c * uTint, 0.0", "c, 0.0"], [", uCA: { value: 0 }, uCAk: { value: 1 }, uTint: { value: new T.Vector3(1, 1, 1) } });", " });"],
  ["finalMat.uniforms.uCAk.value = SET.reduceShake ? 0 : 1; pass(finalMat, null);", "pass(finalMat, null);"], ["uniforms: finalMat.uniforms, finalMat };", "uniforms: finalMat.uniforms };"],
  // optional blink move, meteor arc minimum radius, remap wait (DEVLOG timeline #47): the blink itself lives in the new deferred module kit/blink.js;
  // in the parity files only the meteor table gains arcMinRadius (default 0 = main) and controls.js gains the line that ends a remap wait when settings close
  ["arcLength:8,arcMinRadius:0}", "arcLength:8}"],
  ["\n  // leaving settings (close button, Esc, title, play) ends a pending wait, so the next key is not bound by accident\n  const st = $('#settings'); if (st) new MutationObserver(() => { if (waiting && st.hidden) { waiting = null; redrawKeys(); } }).observe(st, { attributes: true, attributeFilter: ['hidden'] });", ""],
  // extension interface, second round (DEVLOG timeline #46): hit events name the spell part that caused them, skill-bar numbers come from the spell table,
  // new-game / continue events, the remap rows can be redrawn. These undo the newest edits first, so the older pairs below still find their text.
  ["function dealDamage(e,amt,kind,src){", "function dealDamage(e,amt,kind){"], ["{spell:kind,kind,source:src||null,", "{spell:kind,"],
  ["function aoe(pos,r,dmg,kind,skip,src){", "function aoe(pos,r,dmg,kind,skip){"], ["egAoeJit(),kind,src)", "egAoeJit(),kind)"],
  ["'fire',0,'fire')", "'fire')"], ["'bolt','bolt')", "'bolt')"], ["'bolt',hit,'boltSplash')", "'bolt',hit)"], ["'bolt','boltChain')", "'bolt')"],
  ["'fire',0,'meteor')", "'fire')"], ["'burn',0,'meteorBurn')", "'burn')"], ["'blood','blood')", "'blood')"], ["'blood',0,'blood')", "'blood')"],
  ["egZh(spellP('fire').shots)+'連發'", "'三連發'"], ["`彈跳 ${spellP('bolt').bounces} 次`", "'彈跳 6 次'"], ["egZh(spellP('meteor').drops)+'顆連落'", "'十顆連落'"],
  ["function startStory(fromAct=0,cont){", "function startStory(fromAct=0){"], ["story.act=fromAct;egEmit(cont?'continueGame':'newGame',fromAct);beginAct(fromAct)}", "beginAct(fromAct)}"],
  ["startStory(s?s.act:0,!!s)", "startStory(s?s.act:0)"], ["label, aimNow, redrawKeys }", "label, aimNow }"],
  ["EG_KEY('eg-save')", "'eg-save'"], ["EG_KEY('eg-settings')", "'eg-settings'"], ["EG_KEY('eg-keys')", "'eg-keys'"],
  // spell parameter table, extension events and the extension pause (DEVLOG timeline #45): each line below is a main line with one literal number swapped for a read through spellP(id) (the defaults in SPELL_DEF are main's literals), or with one egEmit(...) call or egHeld check added. They run first because the meteor lines are also touched by the #42/#44 pairs further down.
  ["const SPELL_DEF={fire:{cd:.36,dur:.3,rel:.5,shots:3,spread:.2,damage:34,radius:2.2,speed:19,life:1.3,homingTurn:0,homingCone:0},\n  bolt:{cd:1.05,dur:.38,rel:.45,damage:30,bounces:6,range:7.5,firstHop:.88,decay:.92,hopDelay:.075},\n  meteor:{cd:5,dur:.72,rel:.6,drops:10,damage:60,radius:2.7,burnRadius:2.2,burnTime:3.5,spread:4.4,interval:.17,sizeMin:.8,sizeMax:1.05,pattern:'scatter',arcLength:8},\n  blood:{cd:4.5,dur:1.9,rel:.02,bolts:8,damage:26,interval:.09,duration:2.4,seek:15}},SPELLS=JSON.parse(JSON.stringify(SPELL_DEF));", "const SPELLS={fire:{cd:.36,dur:.3,rel:.5},bolt:{cd:1.05,dur:.38,rel:.45},meteor:{cd:5,dur:.72,rel:.6},blood:{cd:4.5,dur:1.9,rel:.02}};"],
  ["e.hp-=amt;egEmit('hit',{spell:kind,target:e,amount:amt});", "e.hp-=amt;"],
  ["player.kills++;egEmit('kill',e.type);", "player.kills++;"],
  ["const F=spellP('fire'),p={kind:'fire',pos:origin.clone(),vel:dir.clone().multiplyScalar(F.speed),life:F.life,", "const p={kind:'fire',pos:origin.clone(),vel:dir.clone().multiplyScalar(19),life:1.3,"],
  ["if(p.kind==='fire'){egHome(p,dt);fireTrail(p,dt)}", "if(p.kind==='fire')fireTrail(p,dt);"],
  ["if(p.kind==='fire'){const F=spellP('fire');explode(p.pos,1);aoe(p.pos,F.radius,F.damage*fireMul(),'fire');", "if(p.kind==='fire'){explode(p.pos,1);aoe(p.pos,2.2,34*fireMul(),'fire');"],
  ["if(hit){const B=spellP('bolt');dealDamage(hit,B.damage*spellMul(),'bolt');if(tierOf('bolt'))chain(hit,new Set([hit]),B.bounces,B.damage*spellMul()*B.firstHop);", "if(hit){dealDamage(hit,30*spellMul(),'bolt');if(tierOf('bolt'))chain(hit,new Set([hit]),6,30*spellMul()*.88);"],
  ["if(n<=0)return;const B=spellP('bolt');after(B.hopDelay,()=>{", "if(n<=0)return;after(.075,()=>{"],
  ["let best=null,bd=B.range;", "let best=null,bd=7.5;"],
  ["chain(best,hitSet,n-1,dmg*B.decay)", "chain(best,hitSet,n-1,dmg*.92)"],
  ["const M=spellP('meteor');for(let i=0;i<M.drops;i++){const a=rand(0,TAU),r=i?Math.sqrt(Math.random())*M.spread:0;dropMeteor(M.pattern==='arc'?egArc(T,i,M):new V3(T.x+Math.cos(a)*r,0,T.z+Math.sin(a)*r),rand(M.sizeMin,M.sizeMax),i*M.interval)}}", "for(let i=0;i<10;i++){const a=rand(0,TAU),r=i?Math.sqrt(Math.random())*4.4:0;dropMeteor(new V3(T.x+Math.cos(a)*r,0,T.z+Math.sin(a)*r),rand(.8,1.05),i*.17)}}"],
  ["const M=spellP('meteor');aoe(p,M.radius*", "aoe(p,2.7*"],
  ["addBurn(p,M.burnRadius*egMetR(s),M.burnTime);", "addBurn(p,2.2*egMetR(s),3.5);"],
  ["const ts=o.t,R=spellP('blood'),q=R.duration/2.4;", "const ts=o.t;"],
  ["ss(1.9*q,2.4*q,ts)", "ss(1.9,2.4,ts)"],
  ["ts<1.8*q)", "ts<1.8)"],
  ["distanceTo(chest)<R.seek)", "distanceTo(chest)<15)"],
  [".slice(0,R.bolts);", ".slice(0,8);"],
  ["for(let k=0;k<R.bolts;k++){const b={ang:k/R.bolts*TAU,", "for(let k=0;k<8;k++){const b={ang:k/8*TAU,"],
  ["launchAt:.95+k*R.interval,", "launchAt:.95+k*.09,"],
  ["dealDamage(b.target,R.damage*spellMul(),'blood')", "dealDamage(b.target,26*spellMul(),'blood')"],
  ["ts>2.45*q&&", "ts>2.45&&"],
  ["function tryCast(id){if(egHeld)return;", "function tryCast(id){"],
  ["const s=spellP(id),cs=castMul();", "const s=SPELLS[id],cs=castMul();"],
  ["cds[id]=s.cd/cs;egEmit('cast',id);", "cds[id]=s.cd/cs;"],
  ["const F=spellP('fire');for(let i=0;i<F.shots;i++)spawnFireball(h,dir.clone().applyAxisAngle(new V3(0,1,0),(i-(F.shots-1)/2)*F.spread))}", "for(const a of [-.2,0,.2])spawnFireball(h,dir.clone().applyAxisAngle(new V3(0,1,0),a))}"],
  ["player.cast=null;egEmit('playerDeath',src);", "player.cast=null;"],
  ["cds[id]/(spellP(id).cd/cs)", "cds[id]/(SPELLS[id].cd/cs)"],
  ["function restart(){egEmit('restart');", "function restart(){"],
  ["&&!menuOpen&&!egHeld){", "&&!menuOpen){"],
  ["story.act=i;egEmit('actStart',i);", "story.act=i;"],
  ["egEmit('towerLit',story.act);const A=ACTS", "const A=ACTS"],
  ["hidden=false;egEmit('bossStart');", "hidden=false;"],
  ["function onBossDead(e){egEmit('bossDown');", "function onBossDead(e){"],
  ["story.phase='end';egEmit('ending');", "story.phase='end';"],
  ['for(const a of ACTS.slice(0,fromAct))if(a.dlg)story.seen.add(a.dlg)', "story.seen.add('intro')"],
  // combat switches for content packs (DEVLOG timeline #42): the defaults reproduce main exactly
  ['const cc=combatCfg(),crit=cc.critChance>0&&Math.random()<cc.critChance;if(crit)amt*=cc.critMul;', 'const crit=Math.random()<.12;if(crit)amt*=1.8;'],
  ['M.damage*(combatCfg().meteorSizeDamage?s:1)*fireMul()', '60*s*fireMul()'],
  // content fields for flow / terms / respond towers / monsters (DEVLOG timeline #43): each line below is a main line with one expression swapped for a call into the /*H*/ helpers in kit/core.js; the defaults reproduce main's text exactly
  ["`${EG_TERM.undead}被火光吸引過來了`", "'亡者被火光吸引過來了'"],
  ["${T.name}${egLit(T)}`", "${T.name}點亮了`"],
  ["else egBossIntro()", "else startBoss()"],
  ["擊倒甦醒的${EG_TERM.undead}　", "擊倒甦醒的亡者　"],
  ["`${EG_TERM.go}${TOWERS[story.act].name}`", "`前往${TOWERS[story.act].name}`"],
  ["`${egIgnite(T)}${T.name}　", "`點燃${T.name}　"],
  ["`${EG_TERM.go}${T.name}（", "`前往${T.name}（"],
  ["召來了${EG_TERM.undead}`", "召來了亡者`"],
  ["`更多${EG_TERM.undead}從墳裡爬出來`", "'更多亡者從墳裡爬出來'"],
  ["playDialog(EG_FLOW.half,null)", "playDialog('dark',null)"],
  ["playDialog(EG_FLOW.down,egShowEnding)", "playDialog('end',showEnding)"],
  ["function setTowerLit(T,on){if(egRespondSet(T,on))return;", "function setTowerLit(T,on){"],
  ["function updateTowers(dt){egPulse();", "function updateTowers(dt){"],
  ["note(`這招還沒學會，先${EG_TERM.light}${EG_TERM.tower}`)", "note('這招還沒學會，先點亮燈塔')"],
  ["TOWERS[act].name+egLit(TOWERS[act])", "TOWERS[act].name+'點亮了'"],
  ["b=egSkin(type,buildEnemy(type));", "b=buildEnemy(type);"],
  // engine switches and fixes for the commercial slice's breaker report (DEVLOG timeline #44): again each line is a main line with one call into the /*H*/ helpers in kit/core.js swapped in; the defaults reproduce main
  ["spellMul=()=>egGearMul(1+stats.spell/100)", "spellMul=()=>1+stats.spell/100"],
  ["fireMul=()=>egGearMul((1+stats.fire/100)*spellMul())", "fireMul=()=>(1+stats.fire/100)*spellMul()"],
  ["dealDamage(e,dmg*egAoeJit(),kind)", "dealDamage(e,dmg*rand(.9,1.1),kind)"],
  ["*egMetR(s)", "*s"],
  ["keys=egPool(b.pool).sort", "keys=[...b.pool].sort"],
  ["(r.k>=3?pick(egPrefixes()):'')+pick(egBaseNames(b))", "(r.k>=3?pick(PREFIX):'')+pick(b.names)"],
  ["spawnEnemy(egSarcType(),", "spawnEnemy('ghost',"],
  ["note(EG_TERM.sarcBreak)", "note('石棺裂開，殘魂竄了出來')"],
  ["hurtPlayer(8,EG_TERM.gas)", "hurtPlayer(8,'磷火爆炸')"],
  ["hurtPlayer(a,EG_TERM.lava)", "hurtPlayer(a,'熔岩')"],
  ["hurtPlayer(22,EG_TERM.bossShock)", "hurtPlayer(22,'首領衝擊波')"],
  ["function hurtPlayer(d,src=EG_TERM.monster)", "function hurtPlayer(d,src='怪物')"],
  ["it.name=EG_TERM.lampName", "it.name='燼燈'"],
  ["note(EG_TERM.lampGet)", "note('得到一盞燼燈：身邊照亮 5 公尺（按 I 看裝備）')"],
  ["story.phase==='ignite'?EG_TERM.hintIgnite:EG_TERM.hintGo", "story.phase==='ignite'?'站在塔下，別離開':'跟著地上的箭頭與光柱走'"],
  ["obj(`擊敗${CONTENT.text.bossName}`,EG_TERM.hintBoss)", "obj(`擊敗${CONTENT.text.bossName}`,'紫色衝擊波會往外擴散：退到圈外，或貼近牠躲進圈內')"],
  ["egFx(T)&&explode(", "explode("],
  ["story.phase==='ignite'&&egFx(T))rate(T.acc,'ig'", "story.phase==='ignite')rate(T.acc,'ig'"],
  ["}else if(egBossDownRestart()){}else{", "}else{"],
  ["function toggleInv(){if(egNoBag())return;", "function toggleInv(){"],
  ["(m.transparent && !egShadowBody(m))", "m.transparent"],
  ["const DEATH_TIPS={[EG_TERM.lava]:EG_TERM.tipLava,[EG_TERM.bossShock]:EG_TERM.tipShock,[EG_TERM.gas]:EG_TERM.tipGas};", "const DEATH_TIPS={'熔岩':'熔岩是唯一會傷到你的地形，橘紅發光的地面別久站。','首領衝擊波':'衝擊波會往外擴散：退到圈外，或貼近首領躲在圈內。','磷火爆炸':'藍色磷火墳碰到火或雷會爆炸，施法前先看腳下。'};"],
  ["const DEFAULT_TIP=EG_TERM.tipDefault;", "const DEFAULT_TIP='被包圍時用星墜清場，或把怪物引進燃燒的草地。';"],
  ["const LOAD_TIPS=CONTENT.text.loadTips||[", "const LOAD_TIPS=["],
  // releasing geometry and materials when things leave the scene (F10, F16)
  ["scene.remove(e.g);egFree(e.g);", "scene.remove(e.g);"],
  ["scene.remove(L.g);egFreeMat(L.g);", "scene.remove(L.g);"],
  ["scene.remove(s.mesh);egFreeMat(s.mesh)", "scene.remove(s.mesh)"],
  ["scene.remove(m.mesh);egFreeMat(m.mesh);scene.remove(m.ring);egFreeMat(m.ring)", "scene.remove(m.mesh);scene.remove(m.ring)"],
  ["scene.remove(m.ring);egFreeMat(m.ring);const p", "scene.remove(m.ring);const p"],
  ["scene.remove(b.decal);egFree(b.decal)}", "scene.remove(b.decal)}"],
  ["scene.remove(b.decal);egFree(b.decal);burns", "scene.remove(b.decal);b.decal.material.dispose();burns"],
  ["scene.remove(o.mesh);egFree(o.mesh);rites", "scene.remove(o.mesh);o.mesh.material.dispose();rites"]];
const HTML_FORWARD = [['<div class="nm">無燈之主</div>', '<div class="nm"></div>'],
  ['<p class="note" id="introNote">故事模式約 15 分鐘：點亮四座燈塔、學會四招法術，最後對上無燈之主。自由試玩：四招全開，可切換拆解台。需要鍵盤與滑鼠；怪物死後會掉裝備，走過去自動撿起，按 I 穿上。</p>', '<p class="note" id="introNote"></p>'],
  ['color:#d6cdb9">四座燈塔重新亮起。燼語墓園今晚會很安靜。</p>', 'color:#d6cdb9"></p>']];
const unhardened = (t) => t.split('\n').filter((l) => !l.trim().startsWith(MARK)).join('\n');
const reversed = (t) => REVERSE.reduce((s, [now, was]) => s.split(now).join(was), t);
function parity() {
  const git = (a) => spawnSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const old = git(['show', `${BASE}:index.html`]);
  if (old.status !== 0) { rep.ok(false, `parity: cannot read ${BASE}:index.html from git`, old.stderr); return; }
  const mainTags = [...old.stdout.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).sort((a, b) => b.length - a.length);
  const { scripts } = pageSources(ROOT);
  const kitBlockingRaw = scripts.filter((s) => s.local && !s.defer && /^kit\//.test(s.src));
  const kitBlocking = reversed(unhardened(kitBlockingRaw.map((s) => s.text).join('\n')));
  const Hlines = kitBlockingRaw.map((s) => [s.src, s.text.split('\n').filter((l) => l.trim().startsWith(MARK)).length]).filter(([, n]) => n);
  rep.ok(Hlines.every(([f]) => f === 'kit/core.js' || f === 'kit/boot.js'), 'parity: the /*H*/ hardening marker appears only in kit/core.js and kit/boot.js (content validation, load errors, page text from content)', Hlines);
  const allKit = kitBlockingRaw.map((s) => s.text).join('\n');
  // the six deferred modules are reversed too (byte-for-byte check below), so a replacement may live there
  const kitAndDeferred = allKit + ['controls', 'pixel', 'lighting', 'detail', 'mist', 'postfx'].map((f) => read(`kit/${f}.js`)).join('\n');
  // checked in order, on the text the earlier pairs have already undone: a newer edit to an already-changed line is undone first
  let undone = kitAndDeferred; const unused = [];
  for (const [now, was] of REVERSE) { if (!undone.includes(now)) unused.push(now); undone = undone.split(now).join(was); }
  rep.ok(unused.length === 0, 'parity: every recorded replacement of a main line really occurs in kit/ (the list of allowed deviations cannot rot)', unused);
  const norm = (t) => t.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
  const A = norm(mainTags[0]), B = norm(kitBlocking), sa = new Set(A), sb = new Set(B);
  const demo = JSON.stringify(demoContent());
  const contentish = (l) => /assets\/voice/.test(l) || /[一-鿿]/.test(l) &&/沐炎|灰翁|無燈之主|焰之塔|[雷星血]之塔|assets\/voice|[a-z]\d?:\[\[|\['(?:elder|lord|mu)'|^(?:mu|elder|lord):'<rect/.test(l)
    || /^const (TOWER_POS|PORTRAITS|SPEAKERS|DLG|TOWERS|ACTS)=/.test(l) || /^(?:intro|t\d|dark|end):\[\[/.test(l) || /^\{name:'/.test(l) || /^\['(?:elder|lord|mu)'/.test(l)
    || /^(?:mu|elder|lord):['{]/.test(l) || /^loop\(\);$/.test(l) || /^lord:\{hp:4200/.test(l);
  const onlyMain = A.filter((l) => !sb.has(l) && !contentish(l)), onlyKit = B.filter((l) => !sa.has(l) && !/CONTENT/.test(l));
  rep.ok(onlyMain.length === 0 && onlyKit.length === 0, 'parity: kit/ blocking scripts equal main\'s inline game script line by line except content and CONTENT reads', { onlyMain: onlyMain.slice(0, 5), onlyKit: onlyKit.slice(0, 5) });
  const stripScripts = (h) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const forward = HTML_FORWARD.reduce((s, [a, b]) => s.split(a).join(b), old.stdout);
  const ha = stripScripts(forward), hb = stripScripts(read('index.html'));
  rep.ok(JSON.stringify(ha) === JSON.stringify(hb) && HTML_FORWARD.every(([a]) => old.stdout.includes(a)), 'parity: index.html markup (scripts and comments removed) is unchanged except the three texts that moved into the content pack (boss name, intro note, ending note), so every element id, label and default text is the same');
  const moved = []; for (const f of ['controls', 'pixel', 'lighting', 'detail', 'mist', 'postfx']) if (git(['show', `${BASE}:assets/${f}.js`]).stdout !== reversed(read(`kit/${f}.js`))) moved.push(f);
  rep.ok(moved.length === 0, 'parity: the six deferred modules moved to kit/ byte for byte (apart from the storage keys going through EG_KEY)', moved);
  // the keys the player's browser data lives under must be the very same strings as before
  const keys = (t) => [...t.matchAll(/['"](eg-[a-z]+)['"]/g)].map((m) => m[1]).sort().join();
  rep.ok(keys(mainTags[0] + git(['show', `${BASE}:assets/controls.js`]).stdout + git(['show', `${BASE}:assets/postfx.js`]).stdout) === keys(allKit + read('kit/controls.js') + read('kit/postfx.js')), 'parity: storage key names (eg-settings, eg-keys, eg-save) unchanged');
}

// ================================================================ B. isolation: can the split check be fooled, is kit/ really clean
function isolation() {
  const kit = (text) => [{ name: 'kit/x.js', text }];
  const content = (text) => [{ name: 'content/y.js', text }];
  const okContent = 'window.CONTENT={dialog:{a:[["x","一二三四五六七八"]]},speakers:{s:{n:"灰翁"}},towers:[{name:"焰之塔"}],text:{bossName:"無燈之主"}};';
  // control: the detector does fire on the plain form
  rep.ok(splitViolations(kit("const a='灰翁';"), content(okContent)).length > 0, 'isolation(control): a plain planted speaker name in kit/ is flagged');
  // the same with the REAL content files (they write to a bare global `CONTENT`; the detector evaluates them with a `window` argument only)
  const realContent = ['story.js', 'world.js'].map((f) => ({ name: 'content/demo/' + f, text: read('content/demo/' + f) }));
  const realHits = (s) => splitViolations(kit(`const a='${s}';`), realContent).filter((v) => v.startsWith('kit/'));
  rep.ok(realHits('燈火守著亡者的夢。火一滅，他們就醒了，而且很餓。').length > 0 && realHits('星之塔').length > 0, 'isolation: with the real content files, a dialogue sentence or a tower name copied into kit/ is caught (the strings are read from the content pack)',
    { dialogueLine: realHits('燈火守著亡者的夢。火一滅，他們就醒了，而且很餓。').length, towerName: realHits('星之塔').length });
  const seen = ownedStrings(realContent);
  rep.ok(seen.errors.length === 0 && seen.read === realContent.length && seen.owned.size > 20 && seen.owned.has('星之塔') && seen.owned.has('燈火守著亡者的夢。火一滅，他們就醒了，而且很餓。'), 'isolation(self-check): the detector really read the real content files (every file ran, tower names and dialogue lines are in its list)', { files: seen.read, of: realContent.length, strings: seen.owned.size, errors: seen.errors });
  const slipped = (list) => list.filter(([, k, c]) => splitViolations(k, c).length === 0).map(([n]) => n);
  rep.ok(slipped([['unicode-escape', kit("const a='\\u7070\\u7fc1';"), content(okContent)], ['concatenation', kit("const a='灰'+'翁';"), content(okContent)]]).length === 0,
    'isolation: a demo name written as \\u escapes or as two joined strings in kit/ is still caught', slipped([['unicode-escape', kit("const a='\\u7070\\u7fc1';"), content(okContent)], ['concatenation', kit("const a='灰'+'翁';"), content(okContent)]]));
  rep.ok(splitViolations(kit("const a='燈熄了。';"), content('window.CONTENT={dialog:{a:[["x","燈熄了。"]]}};')).length > 0, 'isolation: a short (under 6 characters) dialogue line copied into kit/ is caught');
  rep.ok(splitViolations(kit("toast('Z龍');"), content('window.CONTENT={text:{bossName:"Z龍"}};')).length > 0, 'isolation: a content pack\'s own boss name (CONTENT.text.bossName) copied into kit/ is caught, not just the hard-coded demo names');
  const hide = [['template-literal', "window.CONTENT={a:`${(()=>{document.title='x';})()}`};"], ['apostrophe-in-comment', "window.CONTENT={a:1}; /* ' */ function hid(){ THREE.x=1 } /* ' */"]];
  const hid = hide.filter(([, t]) => splitViolations([], content(t)).length === 0).map(([n]) => n);
  rep.ok(hid.length === 0, 'isolation: engine logic cannot hide inside a template literal or behind an apostrophe in a comment of a content file', hid);
  const eff = [['localStorage', 'window.CONTENT={get a(){localStorage.clear();return 1}};'], ['fetch', 'window.CONTENT={get a(){return fetch("x")}};'], ['eval', 'window.CONTENT={get a(){return eval("1")}};'], ['setTimeout', 'window.CONTENT={get a(){return setTimeout(0)}};']];
  const slip = eff.filter(([, t]) => splitViolations([], content(t)).length === 0).map(([n]) => n);
  rep.ok(slip.length === 0, 'isolation: a content file with side effects (localStorage / fetch / eval / timers / getters) is flagged as engine logic', slip);
  // does the real gate look at the content pack index.html loads, or only at the folder called demo?
  const dir = freshCopy('gate-private');
  mkdirSync(join(dir, 'content', 'private'), { recursive: true });
  const C = demoContent(); C.speakers.mu.n = '乙丙測試名'; writeFileSync(join(dir, 'content', 'private', 'pack.js'), 'window.CONTENT=' + JSON.stringify(C) + ';\n');
  edit(dir, 'index.html', (h) => h.replace(/<script src="content\/demo\/story.js"><\/script>\n<script src="content\/demo\/world.js"><\/script>/, '<script src="content/private/pack.js"></script>'));
  edit(dir, 'kit/ui.js', (t) => t + "\ntoast('乙丙測試名');\n");
  return runChecksStatic(dir).then((out) => {
    const row = out.split('\n').find((l) => /kit\/ holds no demo content/.test(l)) || '';
    rep.ok(/FAIL/.test(row), 'isolation: the split gate follows the content scripts index.html loads (a kit/ file holding a name from content/private/ must turn it red)', row.trim() || out.slice(-300));
  });
}
function kitHoldsNoDemo() {
  const owned = ['沐炎', '灰翁', '無燈之主', '焰之塔', '雷之塔', '星之塔', '血之塔'];
  const hits = [];
  const walk = (d) => { for (const n of readdirSync(join(ROOT, d))) { const p = d + '/' + n; if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (!/\.(ogg|png|jpg)$/.test(n)) { const t = read(p); for (const w of owned) if (t.includes(w)) hits.push(`${p}: ${w}`); } } };
  walk('kit');
  rep.ok(hits.length === 0, 'isolation: nothing under kit/ (docs included) names a demo speaker, tower or boss', hits);
  const html = read('index.html'); const inHtml = owned.filter((w) => html.includes(w));
  rep.ok(inHtml.length === 0, 'isolation: index.html (the page that is meant to be reused with another pack) names no demo speaker, tower or boss', inHtml);
  const stale = ['README.md', 'docs/VOICE.md', 'docs/METHOD.md', 'docs/GODOT.md', 'docs/ROUTES.md', 'docs/SCREENS.md'].filter((f) => /assets\/(mage-model|voice|controls|character|pixel|postfx|lighting|detail|mist)/.test(read(f)));
  rep.ok(stale.length === 0, 'docs: no document still points at the old assets/ locations of the model, voices or scripts (they moved to content/demo/ and kit/)', stale);
  const lit = [...read('kit/story.js').matchAll(/['"](intro|t[1-9]|dark|end)['"]/g)].map((m) => m[1]);
  rep.ok(lit.filter((x) => x !== 'dark' && x !== 'end').length === 0, 'isolation: kit/story.js refers to no dialogue id except the two documented ones (dark, end)', [...new Set(lit)]);
}

// ================================================================ C. gates: do the new static gates miss real problems
async function gates() {
  const smokeOf = (dir) => runSmokeStatic(dir);
  const d0 = freshCopy('gate-base'); const baseChecks = new Set(failLines(await runChecksStatic(d0))), baseSmoke = new Set(failLines(smokeOf(d0).out));
  rep.ok(baseChecks.size === 0 && baseSmoke.size === 0, 'gates(control): an untouched copy passes the own static gates of the repo (so a red below is caused by the planted defect)', [...baseChecks, ...baseSmoke]);
  const added = (out, base) => failLines(out).filter((l) => !base.has(l));
  // 1. a local engine script outside kit/ and content/ is not counted by the 200 KB code budget
  let dir = freshCopy('gate-budget');
  mkdirSync(join(dir, 'vendor'), { recursive: true }); writeFileSync(join(dir, 'vendor', 'big.js'), '/*' + 'x'.repeat(300 * 1024) + '*/\n');
  edit(dir, 'index.html', (h) => h.replace('<script src="kit/controls.js" defer></script>', '<script src="kit/controls.js" defer></script>\n<script src="vendor/big.js" defer></script>'));
  let r = smokeOf(dir);
  rep.ok(added(r.out, baseSmoke).length > 0, 'gates: 300 KB of extra local script outside kit/ and content/ turns the code budget red', r.out.split('\n').filter((l) => /code|FAIL/.test(l)).slice(0, 4));
  // 2. content script with defer / async passes the order gate although it runs after kit/
  for (const attr of ['defer', 'async']) {
    dir = freshCopy('gate-' + attr);
    edit(dir, 'index.html', (h) => h.replace('<script src="content/demo/story.js">', `<script src="content/demo/story.js" ${attr}>`));
    const out = await runChecksStatic(dir);
    rep.ok(added(out, baseChecks).length > 0, `gates: a content script marked ${attr} (so it runs after kit/ has already read window.CONTENT) turns a static gate red`, out.split('\n').filter((l) => /content scripts/.test(l)));
  }
  // 3. kit files in the wrong order
  dir = freshCopy('gate-order');
  edit(dir, 'index.html', (h) => h.replace('<script src="kit/core.js"></script>\n<script src="kit/world.js"></script>', '<script src="kit/world.js"></script>\n<script src="kit/core.js"></script>'));
  let out = await runChecksStatic(dir);
  rep.ok(added(out, baseChecks).length > 0, 'gates: kit/world.js listed before kit/core.js turns a static gate red', out.split('\n').filter((l) => /order|before/.test(l)).slice(0, 3));
  // 4. duplicate function across two kit files (the check the split had to rework): control, must stay green-detecting
  dir = freshCopy('gate-dupfn');
  edit(dir, 'kit/core.js', (t) => t + '\nfunction breakerDup(){return 1}\n'); edit(dir, 'kit/ui.js', (t) => t + '\nfunction breakerDup(){return 2}\n');
  out = await runChecksStatic(dir);
  rep.ok(failLines(out).some((l) => /declared twice/.test(l)), 'gates(control): the same function declared in two kit files is caught');
  // 5. duplicate top-level const across two kit files is a SyntaxError in the browser; before the split one compile of one script saw it
  dir = freshCopy('gate-dupconst');
  edit(dir, 'kit/core.js', (t) => t + '\nconst breakerDupConst=1;\n'); edit(dir, 'kit/ui.js', (t) => t + '\nconst breakerDupConst=2;\n');
  const sm = smokeOf(dir); out = await runChecksStatic(dir);
  rep.ok(added(sm.out, baseSmoke).length > 0 || added(out, baseChecks).length > 0, 'gates: the same top-level const declared in two kit files (a SyntaxError in the browser) turns a static gate red', { smokeExit: sm.code, checksFails: added(out, baseChecks).length });
  // 6. mutation test: every needle must exist exactly once in the code files, otherwise the planted defect lands somewhere else than intended
  const needles = ['<!doctype html>\n', "if(!story.unlocked.has(id)){if(story.on)note(`這招還沒學會，先${EG_TERM.light}${EG_TERM.tower}`);return}", 'A*=ss(.47,.4,', 'if(Math.random()<spreadP(nt))ch.push(', 'Math.random=mulberry32(20261115);', 'if(!running||paused||menuOpen||!player.alive)return;', 'function tnoise(x,y){', 'EG_FLOW.preBoss?playDialog(EG_FLOW.preBoss,startBoss):startBoss()'];
  const files = ['index.html', ...readdirSync(join(ROOT, 'kit')).filter((x) => x.endsWith('.js')).map((x) => 'kit/' + x)];
  const counts = needles.map((n) => files.reduce((c, f) => c + read(f).split(n).length - 1, 0));
  rep.ok(counts.every((c) => c === 1), 'gates(control): each of the eight mutation needles occurs exactly once across index.html + kit/*.js (so the planted defect lands where intended)', counts);
  // mutation 7 renames tnoise( in whichever file first contains 'function vnoise(x,y){': check it is the file that holds the planted copy, so two vnoise stay a duplicate
  const planted = files.filter((f) => read(f).includes('function tnoise(x,y){'))[0];
  const firstVn = files.find((f) => (read(f).replace('function tnoise(x,y){', 'function vnoise(x,y){')).includes('function vnoise(x,y){'));
  rep.ok(planted === firstVn, 'gates(control): mutation 7 renames tnoise( in the file that now holds the shadowing vnoise', { planted, firstVn });
}

// ================================================================ D. runtime: bad / odd content, load order, file://
const STEP = `window.__step = (n, dt = 1/60) => { for (let k = 0; k < n; k++) { time += dt; shared.uTime.value = time; if (!paused) logic(dt); visuals(dt); } };`;
const FLOW = `window.__flow = () => {
  const out = { acts: [], err: null };
  try {
    startStory(0);
    let n = 0;
    while (n++ < 5000) {
      if (dlg) endDialog(); if (!$('#result').hidden) closeResult();
      if (story.phase === 'boss' || story.phase === 'end' || story.phase === 'outro') break;
      if (story.phase === 'fight') player.kills = story.killsAt + story.goal;
      if ((story.phase === 'goto' || story.phase === 'ignite') && TOWERS[story.act]) { const T = TOWERS[story.act]; player.pos.set(T.x, 0, T.z); }
      for (const e of enemies) if (e.T && e.T.dmg) e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 });
      player.hp = player.maxhp; __step(6);
      if (out.acts[out.acts.length - 1] !== story.act) out.acts.push(story.act);
    }
  } catch (e) { out.err = String(e && e.message || e); }
  out.phase = story.phase; out.act = story.act; return out; };
window.__boss = (mode) => {
  const out = { err: null };
  try {
    const b = story.boss; for (const e of enemies) if (e !== b && e.T) e.T = Object.assign({}, e.T, { speed: 0, dmg: 0 });
    if (mode === 'dark') { b.hp = b.maxhp * .4; for (let i = 0; i < 20; i++) { if (dlg) endDialog(); __step(5); } }
    else { b.hp = 0; killEnemy(b); for (let i = 0; i < 400 && story.phase !== 'end'; i++) { if (dlg) endDialog(); __step(5); } }
  } catch (e) { out.err = String(e && e.message || e); }
  out.phase = story.phase; return out; };`;

const exceptions = (p) => p.errors.filter((e) => !/Failed to load resource/.test(e));
async function runtime() {
  const mem = await waitForMemory();
  console.log(`  (free memory ${mem.toFixed(1)} GB, opening one headless Chrome)`);
  const site = join(work, 'site'); mkdirSync(site, { recursive: true });
  for (const d of ['kit', 'content']) cpSync(join(ROOT, d), join(site, d), { recursive: true });
  const html0 = read('index.html');
  const tagPair = '<script src="content/demo/story.js"></script>\n<script src="content/demo/world.js"></script>';
  if (!html0.includes(tagPair)) throw new Error('index.html content script tags changed shape');
  const writeVariant = (name, mutate, { html } = {}) => {
    const C = demoContent(); mutate && mutate(C);
    writeFileSync(join(site, 'content', name + '.js'), 'window.CONTENT = window.CONTENT || {};\nObject.assign(window.CONTENT, ' + JSON.stringify(C) + ');\n');
    writeFileSync(join(site, name + '.html'), (html ? html(html0) : html0).replace(tagPair, `<script src="content/${name}.js"></script>`));
  };
  // ---- variants
  writeVariant('control');
  const fields = ['portraits', 'speakers', 'dialog', 'towers', 'towerPos', 'acts', 'text'];
  for (const f of fields) writeVariant('missing_' + f, (C) => { delete C[f]; });
  writeVariant('towers3', (C) => { C.towers = C.towers.slice(0, 3); C.towerPos = C.towerPos.slice(0, 3); C.acts = C.acts.slice(0, 3); });
  writeVariant('towers5', (C) => { C.towers.push({ name: '風之塔', dir: '北', spell: 'fire', col: 0x88ff88, c: [.5, 1, .5], kind: 0 }); C.towerPos.push([-10, -12]); C.acts.push({ n: 10, mix: [1, 0, 0], after: 't4' }); });
  writeVariant('acts_ne_towers', (C) => { C.acts.push({ n: 10, mix: [1, 0, 0], after: 't4' }); });
  writeVariant('after_missing', (C) => { C.acts[0].after = 'nope'; });
  writeVariant('no_dark', (C) => { delete C.dialog.dark; });
  writeVariant('no_end', (C) => { delete C.dialog.end; });
  writeVariant('unknown_speaker', (C) => { C.dialog.intro[0][0] = 'narrator'; });
  writeVariant('no_portrait_for_one', (C) => { delete C.portraits.elder; });
  writeVariant('empty_intro', (C) => { C.dialog.intro = []; });
  writeVariant('no_voiceDir', (C) => { delete C.voiceDir; });
  writeVariant('voice_missing', (C) => { C.voiceDir = 'content/none/'; });
  writeVariant('no_modelScript', (C) => { delete C.modelScript; });
  writeVariant('model_404', (C) => { C.modelScript = 'content/none/model.js'; });
  writeVariant('renamed_boss', (C) => { C.text.bossName = '白霜巨龍'; });
  writeVariant('blink_pack', (C) => { C.blink = { distance: 7 }; });
  writeVariant('other_pack_id', (C) => { C.id = 'frost-dragon'; C.towers.push(C.towers[0]); C.towerPos.push([-10, -12]); C.acts.push({ n: 10, mix: [1, 0, 0], after: 't4' }); });
  writeVariant('other_pack', (C) => { delete C.id; C.towers.push(C.towers[0]); C.towerPos.push([-10, -12]); C.acts.push({ n: 10, mix: [1, 0, 0], after: 't4' }); });
  // load-order / 404 variants
  writeVariant('content_after_kit', null, { html: (h) => h.replace(tagPair, '').replace('<script src="kit/boot.js"></script>', '<script src="kit/boot.js"></script>\n' + tagPair) });
  writeVariant('kit_story_404', null, { html: (h) => h.replace('kit/story.js', 'kit/story_404.js') });
  writeVariant('kit_controls_404', null, { html: (h) => h.replace('kit/controls.js', 'kit/controls_404.js') });
  writeVariant('kit_character_404', null, { html: (h) => h.replace('kit/character.js', 'kit/character_404.js') });

  const srv = await serve(site); cleanups.push(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const p = await openPage(base + 'control.html', { width: 1280, height: 800 });
  cleanups.push(() => p.close());
  const readyExpr = `!!document.querySelector('#go') && !document.querySelector('#go').disabled`;
  async function load(url, { settle = SETTLE_MS } = {}) {
    await p.send('Page.navigate', { url: 'about:blank' }); await sleep(150); p.errors.length = 0;
    await p.send('Page.navigate', { url }); const t0 = Date.now(); let ready = false;
    while (Date.now() - t0 < settle) { await sleep(200); ready = await p.evaluate(readyExpr).catch(() => false); if (ready) break; if (p.errors.length && Date.now() - t0 > 3000) break; }
    const info = await p.evaluate(`({ stuck: !!document.querySelector('#loading') && !document.querySelector('#loading').hidden && !!document.querySelector('#go') && document.querySelector('#go').disabled,
      diag: /CONTENT|載入失敗|錯誤|error/i.test((document.querySelector('#loading') || {}).innerText || '') })`).catch(() => ({ stuck: true, diag: false }));
    return { ready, ...info, exc: exceptions(p).slice(0, 3) };
  }
  const prep = async () => { await p.evaluate(STEP + FLOW + 'requestAnimationFrame = () => 0;'); };

  // ---- control
  const c = await load(base + 'control.html');
  if (!rep.ok(c.ready && c.exc.length === 0, 'runtime(control): the demo content, split into a temp copy, loads and the title screen is usable', c)) { console.log('  environment cannot load the demo page (CDN offline?); the other runtime checks are skipped'); return; }
  await prep();
  let f = await p.evaluate('__flow()');
  let b = f.phase === 'boss' ? await p.evaluate(`__boss('dark')`) : null; let e2 = f.phase === 'boss' ? await p.evaluate(`__boss('end')`) : null;
  rep.ok(f.err === null && f.phase === 'boss' && f.acts.join() === '0,1,2,3' && b && !b.err && e2 && !e2.err && e2.phase === 'end', 'runtime(control): story driven programmatically from act 1 through boss, dark dialogue and ending', { f, b, e2 });
  // save format
  const save = await p.evaluate(`(() => { writeSave(2); const s = localStorage.getItem('eg-save'); clearSave(); return s; })()`);
  rep.ok(save === '{"v":1,"act":2}', 'parity: the save written for act 3 is exactly {"v":1,"act":2}', save);

  // ---- 1. each documented field missing: expect no uncaught exception, or a visible explanation
  for (const fld of fields) {
    const r = await load(base + `missing_${fld}.html`); let use = null;
    if (r.ready) { await prep(); use = await p.evaluate(`(() => { try { startFree(); __step(30); startStory(0); __step(30); if (dlg) endDialog(); __step(30); return null; } catch (e) { return String(e.message); } })()`); }
    rep.ok((r.ready && r.exc.length === 0 && use === null) || (!r.ready && r.diag), `content: CONTENT.${fld} missing -> the page still works (free play and story start), or says what is missing on screen`, { ready: r.ready, stuckOnLoadingScreen: r.stuck, shownToPlayer: r.diag, firstException: r.exc[0] || use });
  }
  // ---- 1b. towers / acts of other sizes
  for (const v of ['towers3', 'towers5']) {
    const r = await load(base + v + '.html'); let res = { err: 'not loaded' };
    if (r.ready) { await prep(); res = await p.evaluate('__flow()'); if (res.phase === 'boss') { const e = await p.evaluate(`__boss('end')`); res.phase = e.phase; res.err = res.err || e.err; } }
    const n = v === 'towers3' ? 3 : 5;
    rep.ok(r.ready && res.err === null && res.phase === 'end' && res.acts.length === n, `content: ${n} towers and ${n} acts play from the first act to the ending`, { r: { ready: r.ready, exc: r.exc }, res });
  }
  { const r = await load(base + 'acts_ne_towers.html'); let res = { err: null, phase: '' };
    if (r.ready) { await prep(); res = await p.evaluate('__flow()'); }
    rep.ok(!r.ready ? r.diag : /CONTENT|acts|towers/i.test(String(res.err)), 'content: 5 acts with 4 towers is reported with a message that names the mismatch (not a bare TypeError)', { loaded: r.ready, err: res.err, phase: res.phase }); }
  // ---- 1c. dialogue problems
  { const r = await load(base + 'after_missing.html'); await prep(); const res = await p.evaluate('__flow()');
    rep.ok(res.err === null && res.acts.length >= 2, 'content: an act whose "after" dialogue code does not exist does not freeze the story at the first tower', { err: res.err, acts: res.acts, phase: res.phase, ready: r.ready }); }
  for (const [v, mode, label] of [['no_dark', 'dark', 'dark (half-health) dialogue'], ['no_end', 'end', 'end dialogue']]) {
    await load(base + v + '.html'); await prep(); const res = await p.evaluate('__flow()'); let bo = { err: 'no boss' };
    if (res.phase === 'boss') bo = await p.evaluate(`__boss('${mode}')`);
    rep.ok(res.err === null && !bo.err && (mode === 'dark' || bo.phase === 'end'), `content: a pack without the ${label} still gets through the boss fight`, { flowErr: res.err, boss: bo });
  }
  { await load(base + 'unknown_speaker.html'); await prep(); const res = await p.evaluate(`(() => { try { startStory(0); return { err: null, who: $('#dWho').textContent }; } catch (e) { return { err: String(e.message) }; } })()`);
    rep.ok(res.err === null, 'content: a dialogue line whose speaker is not in CONTENT.speakers shows without an exception', res); }
  { await load(base + 'no_portrait_for_one.html'); await prep(); const res = await p.evaluate(`(() => { try { startStory(0); return { err: null, svg: $('#dPortrait').innerHTML }; } catch (e) { return { err: String(e.message) }; } })()`);
    rep.ok(res.err === null && res.svg !== 'undefined', 'content: a speaker without a portrait gets an empty portrait, not the text "undefined"', res); }
  { await load(base + 'empty_intro.html'); await prep(); const res = await p.evaluate(`(() => { try { startStory(0); __step(30); return { err: null, phase: story.phase, paused }; } catch (e) { return { err: String(e.message) }; } })()`);
    rep.ok(res.err === null && res.phase === 'fight' && res.paused === false, 'content(control): an empty dialogue array is skipped and the fight starts', res); }
  // ---- 1d. voice
  { await load(base + 'no_voiceDir.html'); await prep(); p.errors.length = 0; await p.evaluate('startStory(0)'); await sleep(1200);
    rep.ok(!p.errors.some((e) => /undefined/.test(e)), 'content: a pack without voiceDir (no recordings) does not ask the server for files named "undefined…ogg"', p.errors.filter((e) => /undefined/.test(e)).slice(0, 2)); }
  { await load(base + 'voice_missing.html'); await prep(); p.errors.length = 0; const res = await p.evaluate(`(() => { try { startStory(0); return { err: null, line: $('#dLine').textContent.length >= 0 }; } catch (e) { return { err: String(e.message) }; } })()`); await sleep(1200);
    rep.ok(res.err === null && exceptions(p).length === 0, 'content(control): recordings that do not exist fall back to browser speech with no exception', { res, exc: exceptions(p).slice(0, 2) }); }
  // ---- 1e. model
  for (const v of ['no_modelScript', 'model_404']) {
    const r = await load(base + v + '.html'); await sleep(1500);
    const st = await p.evaluate(`({ ready: EGChar.state.ready, failed: EGChar.state.failed })`).catch(() => ({}));
    rep.ok(r.ready && exceptions(p).length === 0 && st.ready !== true, `content(control): ${v === 'no_modelScript' ? 'no modelScript' : 'a modelScript that 404s'} keeps the block mage and throws nothing`, { r, st, exc: exceptions(p).slice(0, 2) });
  }
  // ---- 1f. the boss name the content gives
  { await load(base + 'renamed_boss.html'); await prep(); const res = await p.evaluate(`(() => { try { startStory(0); startBoss(); return { err: null, bar: (document.querySelector('#bossbar .nm') || {}).textContent, obj: $('#objective').textContent }; } catch (e) { return { err: String(e.message) }; } })()`);
    rep.ok(res.err === null && res.bar === '白霜巨龍', 'content: CONTENT.text.bossName is what the boss health bar shows', res); }
  // ---- 1f2. a content pack that turns the optional blink on with its own distance (DEVLOG timeline #47); the control pack leaves it off
  { const off = (await load(base + 'control.html')).ready && await p.evaluate(`!EG.blinkEnabled() && !document.querySelector('.sk[data-s=blink]')`);
    await load(base + 'blink_pack.html'); await prep();
    const res = await p.evaluate(`(() => { try { startFree(); for (const o of obstacles) o.r = 0; player.pos.set(0, 0, 0); const on = EG.blinkEnabled(), tile = !!document.querySelector('.sk[data-s=blink]'), moved = EG.blink(1, 0) && player.pos.x;
      EG.resetSpellParams(); return { err: null, on, tile, moved, d: EG.spellParams('blink').distance }; } catch (e) { return { err: String(e.message) }; } })()`);
    rep.ok(off && res.err === null && res.on && res.tile && Math.abs(res.moved - 7) < 1e-9 && res.d === 7, 'content: CONTENT.blink turns the blink on with its own distance (7, still 7 after a reset); without it the blink stays off', { off, res }); }
  // ---- 1g. saves from another pack on the same origin
  { await load(base + 'control.html'); await p.evaluate(`localStorage.setItem('eg-save', JSON.stringify({ v: 1, act: 3 }))`);
    await load(base + 'other_pack.html'); const cont = await p.evaluate(`!document.querySelector('#goContinue').hidden`);
    await p.evaluate(`localStorage.removeItem('eg-save')`);
    rep.ok(!cont, 'content: a save written by the demo pack (same origin, same eg-save key) is not offered as "continue" by a different pack', { continueButtonShown: cont }); }
  { await load(base + 'control.html'); await p.evaluate(`localStorage.setItem('eg-save', JSON.stringify({ v: 1, act: 3 }))`);
    await load(base + 'other_pack_id.html'); const cont = await p.evaluate(`!document.querySelector('#goContinue').hidden`);
    const keysUsed = await p.evaluate(`(() => { writeSave(1); const k = Object.keys(localStorage).filter((x) => /^eg-/.test(x)); clearSave(); return k; })()`);
    await p.evaluate(`localStorage.removeItem('eg-save')`);
    rep.ok(!cont && keysUsed.includes('eg-save:frost-dragon'), 'content: a pack with its own CONTENT.id keeps its save under eg-save:<id> and never sees the demo save', { continueButtonShown: cont, keysUsed }); }
  { await load(base + 'control.html'); await p.evaluate(`localStorage.setItem('eg-save', JSON.stringify({ v: 1, act: 3 }))`);
    await load(base + 'control.html'); const cont2 = await p.evaluate(`!document.querySelector('#goContinue').hidden`); await p.evaluate(`localStorage.removeItem('eg-save')`);
    rep.ok(cont2, 'content(control): the demo pack (id "demo") still reads its own old eg-save key, so players keep their saves', { cont2 }); }
  // ---- 1h. optional fields missing: safe defaults and a recorded warning
  { await load(base + 'missing_speakers.html'); await prep(); const res = await p.evaluate(`(() => { try { startStory(0); return { err: null, who: $('#dWho').textContent, warn: window.__contentWarnings.length }; } catch (e) { return { err: String(e.message) }; } })()`);
    rep.ok(res.err === null && res.who === '' && res.warn > 0, 'content: a pack without speakers shows empty names and records warnings in window.__contentWarnings (no exception)', res); }

  // ---- 2. load order and missing kit files
  { const r = await load(base + 'content_after_kit.html', { settle: 5000 });
    rep.ok(r.ready || r.diag, 'load order: content loaded after kit/ -> the player gets a message (not a loading screen that never ends)', { exc: r.exc.slice(0, 1), stuckOnLoadingScreen: r.stuck, shownToPlayer: r.diag });
    rep.ok(r.exc.some((e) => /CONTENT 未載入/.test(e)), 'load order(control): content loaded after kit/ throws the explicit "CONTENT 未載入" error', r.exc.slice(0, 2)); }
  { const r = await load(base + 'kit_story_404.html', { settle: 5000 });
    rep.ok(r.ready || r.diag, 'load order: kit/story.js fails to load (404) -> the player gets a message (not a loading screen that never ends)', { exc: r.exc.slice(0, 1), stuckOnLoadingScreen: r.stuck, shownToPlayer: r.diag }); }
  for (const v of ['kit_controls_404', 'kit_character_404']) { const r = await load(base + v + '.html');
    rep.ok(r.ready && r.exc.length === 0, `load order(control): ${v.replace('_404', '')}.js (a deferred module) failing to load leaves the game playable`, { r }); }

  // ---- 3. file:// (open index.html by double-click)
  { const root = pathToFileURL(join(site, 'control.html')).href; const r = await load(root);
    let res = null; if (r.ready) { await prep(); res = await p.evaluate(`(() => { try { startFree(); __step(30); return { err: null, enemies: enemies.length }; } catch (e) { return { err: String(e.message) }; } })()`); }
    rep.ok(r.ready && r.exc.length === 0 && res && res.err === null, 'load order: opened straight from disk (file://) the page loads and free play starts', { r, res }); }
  await p.close();
}

// ================================================================ run
try {
  parity();
  await isolation();
  kitHoldsNoDemo();
  await gates();
  await runtime();
} catch (e) { rep.ok(false, 'breaker crashed', String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
finally { for (const c of cleanups.reverse()) { try { await c(); } catch {} } }
process.exit(rep.done() ? 1 : 0);
