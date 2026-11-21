// 介面：鏡頭、HUD、主迴圈、畫面切換、存檔、設定畫面、按鈕
// 依序載入的一般 script，頂層名稱在檔案之間共用（見 core.js）。
'use strict';
/* ---------- 鏡頭、介面、主迴圈 ---------- */
const camPos=new V3(0,15,11);
let camSnap=false;
function updateCamera(dt){
  // 標題畫面：鏡頭繞著墓園慢慢轉
  if(!running){const a=time*.06,w=new V3(Math.cos(a)*26,16,Math.sin(a)*26);camPos.lerp(w,Math.min(1,dt*2));camera.position.copy(camPos);camera.lookAt(0,0,0);camSnap=true;return}
  // 離開標題後第一格直接跳到角色身後（滑行中瞄準點會偏，DEVLOG #36）
  const off=new V3(0,CAM_H*zoom,CAM_B*zoom),want=new V3(player.pos.x,0,player.pos.z).add(off);if(camSnap){camPos.copy(want);camSnap=false}else camPos.lerp(want,Math.min(1,dt*6));
  camera.position.copy(camPos);if(shakeAmt>.001){camera.position.x+=rand(-1,1)*shakeAmt;camera.position.y+=rand(-1,1)*shakeAmt;camera.position.z+=rand(-1,1)*shakeAmt;shakeAmt*=Math.exp(-dt*9)}
  camera.lookAt(camPos.x,0,camPos.z-CAM_B*zoom+.0001)}
let ambAcc={};
function ambient(dt){rate(ambAcc,'m',6,dt,()=>{const a=rand(0,TAU),r=rand(4,20);SMOKE.emit({x:player.pos.x+Math.cos(a)*r,y:rand(.2,.8),z:player.pos.z+Math.sin(a)*r,vx:rand(-.3,.3),vz:rand(-.3,.3),kind:2,fm:1,life:rand(5,8),s0:4,s1:7,rs:rand(-.1,.1),r:.55,g:.62,b:.8,a0:.12,a1:0,fadeIn:.3})})}
const NOTES=['火焰、爆炸、濃煙都是預先畫好的 4×4 共 16 格翻頁圖，貼在永遠面向鏡頭的方塊上輪播。對應影片第二條路線（請繪圖模型一次畫 16 格）；這版由程式畫，零花費。',
  '不用任何圖片，每片方塊的火焰由顯示卡用數學公式即時算出。對應影片第三條路線：最省、可任意調，但寫實度最低，適合卡通風。',
  '關掉貼圖只畫方塊外框。圓滾滾的火球、拖尾、爆炸，底下全是一片片扁平方塊，跟影片裡關掉貼圖的畫面同一個道理。'];
function setRoute(v){routeMode=v;shared.uMode.value=v;$('#routeNote').textContent=NOTES[v];for(const b of document.querySelectorAll('#segRoute button'))b.classList.toggle('on',+b.dataset.v===v)}
function setTier(v){upgraded=!!v;for(const b of document.querySelectorAll('#segTier button'))b.classList.toggle('on',+b.dataset.v===v);refreshSkillLabels()}
for(const b of document.querySelectorAll('#segRoute button'))b.onclick=()=>setRoute(+b.dataset.v);
for(const b of document.querySelectorAll('#segTier button'))b.onclick=()=>setTier(+b.dataset.v);
$('#labMin').onclick=()=>{const l=$('#lab');l.classList.toggle('min');$('#labMin').textContent=l.classList.contains('min')?'展開':'收起'};
$('#btnSound').onclick=()=>{soundOn=!soundOn;$('#btnSound').textContent='音效：'+(soundOn?'開':'關');applySettings()};
$('#btnAtlas').onclick=()=>{$('#atlasPop').hidden=!$('#atlasPop').hidden};
let toastT=0,msgT=0;function toast(t){const e=$('#toast');e.textContent=t;e.style.opacity=1;toastT=2.2}
function note(t){const e=$('#msg');e.textContent=t;e.style.opacity=1;msgT=2.4}
const skEls=[...document.querySelectorAll('.sk')];
let fpsAcc=0,fpsN=0;
function updateHud(dt){fpsAcc+=dt;fpsN++;if(fpsAcc>=.5){$('#sFps').textContent=Math.round(fpsN/fpsAcc);fpsAcc=0;fpsN=0}
  $('#sParts').textContent=ADD.list.length+SMOKE.list.length;$("#statKills").textContent=player.kills;$('#sLeft').textContent=enemies.filter(e=>e.alive).length;
  $('#sWave').textContent=story.on?(story.phase==='boss'||story.phase==='outro'||story.phase==='end'?'首領戰':`第 ${story.act+1} 幕`):`第 ${wave} 波`;
  $('#hpfill').style.transform=`scaleX(${player.hp/player.maxhp})`;$('#hptext').textContent=`生命 ${Math.ceil(player.hp)} / ${Math.round(player.maxhp)}`;
  for(const el of skEls){const id=el.dataset.s,cs=castMul();el.querySelector('.cd').style.setProperty('--p',cds[id]/(SPELLS[id].cd/cs)||0);el.classList.toggle('locked',!story.unlocked.has(id))}
  if(toastT>0){toastT-=dt;if(toastT<=0)$('#toast').style.opacity=0}if(msgT>0){msgT-=dt;if(msgT<=0)$('#msg').style.opacity=0}}
function restart(){
  if(story.on){clearWorld();if(story.phase==='boss'){player.pos.set(0,0,14);startBoss()}else if(egBossDownRestart()){}else{player.pos.set(0,0,4);beginAct(story.act)}return}
  clearWorld();player.pos.set(0,0,0);player.kills=0;wave=1;waveTimer=0;spawnWave(50);toast('第 1 波')}
// logic＝規則一格；visuals＝畫面一格。暫停只停 logic。驗收探針直接呼叫這兩個。
function logic(dt){
  for(let i=timers.length-1;i>=0;i--){timers[i].t-=dt;if(timers[i].t<=0){const f=timers[i].fn;timers.splice(i,1);f()}}
  updatePlayer(dt);updateEnemies(dt);updateShocks(dt);updateProjs(dt);updateMeteors(dt);updateBurns(dt);updateRites(dt);updateLoot(dt);updateTerrain(dt);ambient(dt);updateStory(dt);
  if(!story.on&&player.alive&&!enemies.some(e=>e.alive)){if(waveTimer<=0){waveTimer=2.5;toast(`第 ${wave} 波清空`)}else{waveTimer-=dt;if(waveTimer<=0){wave++;spawnWave(50+wave*5);toast(`第 ${wave} 波來了`);waveTimer=0}}}}
function visuals(dt){updateTowers(dt);flushTerrain();ADD.update(dt);SMOKE.update(dt);updateLights(dt);updateCamera(dt);updateTexts(dt);updateDialog(dt);updateHud(dt)}
const clock=new THREE.Clock();
function loop(){requestAnimationFrame(loop);const dt=Math.min(clock.getDelta(),.05);time+=dt;shared.uTime.value=time;
  // 停格：命中瞬間遊戲規則幾乎停住（只走 8%），畫面照常更新
  if(running&&!paused&&!menuOpen){if(hitStop>0){hitStop-=dt;logic(dt*.08)}else logic(dt)}
  visuals(dt);if(window.EGPost)EGPost.render();else renderer.render(scene,camera)}

/* ---------- 畫面：讀取、標題、暫停、設定、操作說明、製作群、階段結算、存檔 ---------- */
const VERSION='v0.4・P3a 換皮';
let menuOpen=false,pickups=0,resultThen=null;
function titleMode(on){document.body.classList.toggle('on-title',on)}titleMode(true);
const MENUS=['pause','settings','help','credits','result'];
function syncMenu(){menuOpen=MENUS.some(id=>!$('#'+id).hidden);if(menuOpen)lmb=false}
function openSub(id,from){const el=$('#'+id);el.dataset.from=from||'';if(from)$('#'+from).hidden=true;el.hidden=false;if(id==='settings')loadSettingsUI();syncMenu();const f=el.querySelector('button,input,select');if(f)f.focus({preventScroll:true});el.scrollTop=0}  // 焦點在底部按鈕時不要把畫面捲下去，手機上才看得到標題（DEVLOG #50）
function backSub(id){const el=$('#'+id);el.hidden=true;const f=el.dataset.from;if(f)$('#'+f).hidden=false;syncMenu()}
function togglePause(force){if(!running||!player.alive||dlg)return;const p=$('#pause'),open=force!==undefined?force:p.hidden;
  if(open){if(menuOpen)return;p.hidden=false;$('#pConfirm').hidden=true;hush()}else p.hidden=true;syncMenu();if(open)$('#pResume').focus()}
// 本機存檔：只記「故事進行到第幾幕」，存在瀏覽器裡；讀不到就當沒有存檔
const SAVE_KEY=EG_KEY('eg-save');
function readSave(){try{const s=JSON.parse(localStorage.getItem(SAVE_KEY)||'null');return s&&s.v===1&&Number.isInteger(s.act)&&s.act>=0&&s.act<ACTS.length?s:null}catch(e){return null}}
function writeSave(act){try{localStorage.setItem(SAVE_KEY,JSON.stringify({v:1,act}))}catch(e){}}
function clearSave(){try{localStorage.removeItem(SAVE_KEY)}catch(e){}}
function refreshTitle(){const s=readSave(),b=$('#goContinue');b.hidden=!s;if(s)b.textContent=`繼續・第 ${s.act+1} 幕`;$('#ver').textContent=VERSION}
function goTitle(){for(const id of MENUS)$('#'+id).hidden=true;resultThen=null;if(dlg){dlg.then=null;endDialog()}running=false;paused=false;clearWorld();story.on=false;story.phase='idle';
  for(const id of ['objective','bossbar','dead','ending'])$('#'+id).hidden=true;if(!$('#inv').hidden)toggleInv();
  TOWERS.forEach(T=>{setTowerLit(T,true);T.beam.visible=false});refreshTitle();titleMode(true);$('#intro').hidden=false;syncMenu()}
function fmtTime(s){s=Math.max(0,Math.round(s));return `${Math.floor(s/60)} 分 ${String(s%60).padStart(2,'0')} 秒`}
// 階段結算：每點亮一座燈塔就停下來看這一幕的成績
function showResult(act,then){const rows=[['用時',fmtTime(time-story.actT0)],['擊倒',(player.kills-story.actKills0)+' 隻'],['地形擊殺',(terrainKills-story.actTk0)+' 隻'],
    ['最高地形連鎖',story.bestChain>=2?'×'+story.bestChain:'沒有'],['撿到裝備',(pickups-story.actLoot0)+' 件']];
  $('#rTitle').textContent=TOWERS[act].name+egLit(TOWERS[act]);$('#rHead').textContent=`第 ${act+1} 幕　完成`;
  $('#rTab').innerHTML=rows.map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');resultThen=then;$('#result').hidden=false;syncMenu();$('#rNext').focus()}
function closeResult(){if($('#result').hidden)return;$('#result').hidden=true;syncMenu();const f=resultThen;resultThen=null;if(f)f()}
// 設定畫面
const SLIDERS=[['sMaster','oMaster','master'],['sMusic','oMusic','music'],['sSfx','oSfx','sfx'],['sVoice','oVoice','voice']];
function loadSettingsUI(){for(const [i,o,k] of SLIDERS){$('#'+i).value=Math.round(SET[k]*100);$('#'+o).textContent=Math.round(SET[k]*100)}
  $('#sParticles').value=SET.particles;$('#sFx').value=SET.fx;$('#sShake').checked=SET.reduceShake;$('#sShapes').checked=SET.lootShapes;$('#sSub').value=Math.round(SET.subSize*100);$('#oSub').textContent=Math.round(SET.subSize*100)+'%';$('#sBright').value=Math.round(SET.bright*100);$('#oBright').textContent=Math.round(SET.bright*100)+'%'}
for(const [i,o,k] of SLIDERS)$('#'+i).addEventListener('input',e=>{SET[k]=e.target.value/100;$('#'+o).textContent=e.target.value;applySettings();saveSettings()});
$('#sParticles').addEventListener('change',e=>{SET.particles=e.target.value;applySettings();saveSettings()});
$('#sFx').addEventListener('change',e=>{SET.fx=e.target.value;saveSettings()});
$('#sShake').addEventListener('change',e=>{SET.reduceShake=e.target.checked;if(SET.reduceShake){shakeAmt=0;hitStop=0}saveSettings()});
$('#sShapes').addEventListener('change',e=>{SET.lootShapes=e.target.checked;saveSettings();for(const L of loots)L.el.textContent=rarMark(L.it.rar)+L.it.name;if(!$('#inv').hidden)renderInv()});
$('#sBright').addEventListener('input',e=>{SET.bright=e.target.value/100;$('#oBright').textContent=e.target.value+'%';saveSettings()});
$('#sSub').addEventListener('input',e=>{SET.subSize=e.target.value/100;$('#oSub').textContent=e.target.value+'%';applySettings();saveSettings()});
$('#sReset').onclick=()=>{Object.assign(SET,SET_DEFAULT);applySettings();saveSettings();loadSettingsUI();note('設定已恢復預設')};
// 按鈕
$('#btnSettings').onclick=()=>openSub('settings','intro');$('#btnHelp').onclick=()=>openSub('help','intro');$('#btnCredits').onclick=()=>openSub('credits','intro');
$('#pResume').onclick=()=>togglePause(false);$('#pSettings').onclick=()=>openSub('settings','pause');$('#pHelp').onclick=()=>openSub('help','pause');
$('#pRestart').onclick=()=>{togglePause(false);restart()};$('#pTitle').onclick=()=>{$('#pConfirm').hidden=false;$('#pYes').focus()};$('#pNo').onclick=()=>{$('#pConfirm').hidden=true};$('#pYes').onclick=goTitle;
$('#sBack').onclick=()=>backSub('settings');$('#hBack').onclick=()=>backSub('help');$('#cBack').onclick=()=>backSub('credits');
$('#rNext').onclick=closeResult;$('#deadTitle').onclick=goTitle;$('#endCredits').onclick=()=>openSub('credits','ending');
$('#goContinue').onclick=()=>{const s=readSave();startStory(s?s.act:0)};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&running&&!menuOpen&&!dlg&&player.alive)togglePause(true)});
// 死因與提示、讀取畫面的提示
const DEATH_TIPS={[EG_TERM.lava]:EG_TERM.tipLava,[EG_TERM.bossShock]:EG_TERM.tipShock,[EG_TERM.gas]:EG_TERM.tipGas};
const DEFAULT_TIP=EG_TERM.tipDefault;
const LOAD_TIPS=CONTENT.text.loadTips||['火球打中枯草會點燃整片草地，站在火裡的怪物會一直扣血。','鏈雷打進積水，整片相連的水都會帶電。','墓碑被炸三次會朝反方向倒下，壓死路徑上的怪物。',
  '熔岩碰到積水會凝成黑曜石牆，可以拿來擋路。','藍色磷火墳會連鎖爆炸，引怪物過去再點燃。','1.2 秒內連續地形擊殺，會累積「地形連鎖」。','設定裡可以降低粒子密度、關掉震動與停格。'];
$('#ldtip').textContent=pick(LOAD_TIPS);$('#ldfill').style.width='20%';

