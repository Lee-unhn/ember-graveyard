// 故事流程：對白播放、燈塔、幕、首領（文字與數值來自 window.CONTENT）
// 依序載入的一般 script，頂層名稱在檔案之間共用（見 core.js）。
'use strict';
/* ---------- 故事模式：對白、燈塔、首領 ---------- */
const story={on:false,act:0,phase:'idle',unlocked:new Set(['fire','bolt','meteor','blood']),tier:{fire:1},seen:new Set(),killsAt:0,goal:0,ign:0,ambushed:false,t0:0,boss:null};
let paused=false;
function tierOf(id){return story.on?(id==='fire'?story.tier.fire:1):(upgraded?1:0)}
const PORTRAITS=egLookup(CONTENT.portraits,'頭像',''),SPEAKERS=egLookup(CONTENT.speakers,'說話者',()=>({n:'',c:'#ffffff',pitch:1,rate:1})),DLG=egLookup(CONTENT.dialog,'對白',()=>[]);  // 查不到的對白代號／說話者／頭像不丟例外：略過那段對白、名字留空、頭像留空，並記警告

// 語音：瀏覽器內建朗讀（零成本、沒有授權問題；音質依瀏覽器而定）
let voiceOn=true,zhVoice=null;
function pickVoice(){try{const vs=speechSynthesis.getVoices();zhVoice=vs.find(v=>/zh[-_]TW/i.test(v.lang))||vs.find(v=>/zh/i.test(v.lang))||null}catch(e){}}
if('speechSynthesis' in window){pickVoice();try{speechSynthesis.onvoiceschanged=pickVoice}catch(e){}}
// 對白語音：先播預錄檔（CONTENT.voiceDir）；放不出來才改用瀏覽器朗讀
let vAudio=null;
function speak(text,sp,file){if(!voiceOn)return;hush();
  if(file&&CONTENT.voiceDir)try{const a=new Audio(CONTENT.voiceDir+file+'.ogg');a.volume=Math.min(1,SET.voice*SET.master);vAudio=a;window.__voiceFile=file;
    const fb=()=>{if(vAudio===a){vAudio=null;window.__voiceFile=null;tts(text,sp)}};a.onerror=fb;const pr=a.play();if(pr)pr.catch(fb);return}catch(e){}
  tts(text,sp)}
function tts(text,sp){if(!voiceOn||!('speechSynthesis' in window))return;try{const u=new SpeechSynthesisUtterance(text.replace(/[「」…]/g,''));
  if(zhVoice)u.voice=zhVoice;u.lang=zhVoice?zhVoice.lang:'zh-TW';u.pitch=sp.pitch;u.rate=sp.rate;u.volume=Math.min(1,SET.voice*SET.master);speechSynthesis.speak(u)}catch(e){}}
function hush(){if(vAudio){try{vAudio.pause()}catch(e){}vAudio=null}try{speechSynthesis.cancel()}catch(e){}}

let dlg=null;
function playDialog(id,then){dlg={id,lines:DLG[id],i:-1,then,typing:0,full:''};paused=true;lmb=false;$('#dialog').hidden=false;nextLine()}
function nextLine(){if(!dlg)return;if(dlg.i>=0&&dlg.typing<dlg.full.length){dlg.typing=dlg.full.length;$('#dLine').textContent=dlg.full;return}
  dlg.i++;if(dlg.i>=dlg.lines.length){endDialog();return}
  const [who,text]=dlg.lines[dlg.i],sp=SPEAKERS[who];$('#dWho').textContent=sp.n;$('#dWho').style.color=sp.c;$('#dPortrait').innerHTML=PORTRAITS[who];
  dlg.full=text;dlg.typing=0;$('#dLine').textContent='';speak(text,sp,dlg.id+'_'+dlg.i+'_'+who)}
function endDialog(){if(!dlg)return;const t=dlg.then;dlg=null;$('#dialog').hidden=true;paused=false;hush();if(t)t()}
function updateDialog(dt){if(dlg&&dlg.typing<dlg.full.length){dlg.typing=Math.min(dlg.full.length,dlg.typing+dt*30);$('#dLine').textContent=dlg.full.slice(0,Math.floor(dlg.typing))}}
$('#dialog').addEventListener('click',nextLine);
$('#dSkip').addEventListener('click',e=>{e.stopPropagation();endDialog()});

// 四座燈塔：石柱＋火盆＋符文環＋常駐燈（開局就建好，燈光數量固定）
const TOWERS=CONTENT.towers.map(t=>({...t}));
{const stone=new THREE.MeshLambertMaterial({color:0x4d5059}),bowlMat=new THREE.MeshLambertMaterial({color:0x2b2c31,side:THREE.DoubleSide});
  TOWERS.forEach((T,i)=>{const [x,z]=TOWER_POS[i];T.x=x;T.z=z;T.lit=false;T.acc={};const g=new THREE.Group();g.position.set(x,0,z);
    const base=new THREE.Mesh(new THREE.CylinderGeometry(1.1,1.3,.5,10),stone);base.position.y=.25;g.add(base);
    const col=new THREE.Mesh(new THREE.CylinderGeometry(.45,.65,3,8),stone);col.position.y=2;g.add(col);
    T.runeMat=new THREE.MeshBasicMaterial({color:T.col});T.runeMat.color.multiplyScalar(.18);
    for(const y of [1.2,2.4]){const band=new THREE.Mesh(new THREE.TorusGeometry(.58-y*.04,.06,6,24),T.runeMat);band.rotation.x=Math.PI/2;band.position.y=y;g.add(band)}
    const bowl=new THREE.Mesh(new THREE.CylinderGeometry(.8,.4,.5,10,1,true),bowlMat);bowl.position.y=3.65;g.add(bowl);
    T.beam=new THREE.Mesh(beamGeo,new THREE.MeshBasicMaterial({map:beamTex,color:T.col,transparent:true,opacity:.6,blending:THREE.AdditiveBlending,depthWrite:false}));
    T.beam.scale.set(3,4,3);T.beam.position.y=7;T.beam.visible=false;g.add(T.beam);
    T.light=new THREE.PointLight(T.col,0,15,2);T.light.position.set(x,4.3,z);scene.add(T.light);scene.add(g)})}
function setTowerLit(T,on){if(egRespondSet(T,on))return;T.lit=on;T.light.intensity=on?2.2:0;T.runeMat.color.setHex(T.col).multiplyScalar(on?1:.18)}
const guide=new THREE.Mesh(new THREE.ConeGeometry(.28,.8,3),new THREE.MeshBasicMaterial({color:0xffe0a0,transparent:true,opacity:.85,depthWrite:false}));
guide.rotation.order='YXZ';guide.visible=false;scene.add(guide);
let dark=0,darkT=0;function setDark(v,instant){darkT=v;if(instant)dark=v}
function updateTowers(dt){egPulse();
  for(const T of TOWERS){if(T.lit){T.light.intensity=2.2*(.85+Math.random()*.3);
      rate(T.acc,'f',T.kind?34:26,dt,()=>ADD.emit({x:T.x+rand(-.3,.3),y:3.8,z:T.z+rand(-.3,.3),vx:rand(-.2,.2),vy:rand(1.2,2.2),vz:rand(-.2,.2),kind:T.kind,fm:T.kind?2:0,frame:0,fps:24,
        life:rand(.5,.8),s0:T.kind?.7:1.2,s1:.15,r:T.c[0],g:T.c[1],b:T.c[2],a0:1,a1:0}))}
    if(T.beam.visible)T.beam.material.opacity=.45+.2*Math.sin(time*4)}
  const T=story.on&&(story.phase==='goto'||story.phase==='ignite')?TOWERS[story.act]:null;
  if(T){const dx=T.x-player.pos.x,dz=T.z-player.pos.z,d=Math.hypot(dx,dz)||1;guide.visible=d>3;guide.material.color.setHex(T.col);
    guide.position.set(player.pos.x+dx/d*1.8,.2,player.pos.z+dz/d*1.8);guide.rotation.set(Math.PI/2,Math.atan2(dx,dz),0)}else guide.visible=false;
  dark+=(darkT-dark)*Math.min(1,dt*1.5);// 畫面亮度（設定）：只放大環境光與月光、霧變薄；法術與燈塔的光不變，特效不會被沖淡
  const B=SET.bright;scene.fog.density=(.026+.032*dark)/Math.max(1,B);hemi.intensity=(.6-.44*dark)*B;moon.intensity=(.5-.38*dark)*B}

const ACTS=CONTENT.acts;
function obj(main,sub){const o=$('#objective');o.hidden=false;o.innerHTML=main+(sub?`<small>${sub}</small>`:'')}
function refreshSkillLabels(){$('#mfire').textContent=tierOf('fire')?'三連發':'單發';$('#mbolt').textContent=tierOf('bolt')?'彈跳 6 次':'單擊';$('#mmeteor').textContent=tierOf('meteor')?'十顆連落':'單顆'}
function clearWorld(){for(const e of enemies){scene.remove(e.g);egFree(e.g);if(e.hpEl)e.hpEl.remove()}enemies.length=0;for(const L of loots){scene.remove(L.g);egFreeMat(L.g);L.el.remove()}loots.length=0;
  for(const p of projs)p.dead=true;projs.length=0;for(const s of shocks){scene.remove(s.mesh);egFreeMat(s.mesh)}shocks.length=0;timers.length=0;
  player.alive=true;player.hp=player.maxhp;player.cast=null;player.tacc=0;P.g.rotation.set(0,0,0);$('#dead').hidden=true;$('#bossbar').hidden=true;story.boss=null;setDark(0,true);
  for(const m of meteors){m.dead=true;scene.remove(m.mesh);egFreeMat(m.mesh);scene.remove(m.ring);egFreeMat(m.ring)}meteors.length=0;for(const b of burns){b.dead=true;scene.remove(b.decal);egFree(b.decal)}burns.length=0;
  for(const id of MENUS)$('#'+id).hidden=true;resultThen=null;syncMenu();
  resetTerrain()}
function startStory(fromAct=0){if(typeof fromAct!=='number')fromAct=0;initAudio();titleMode(false);$('#intro').hidden=true;$('#ending').hidden=true;running=true;clearWorld();player.pos.set(0,0,4);player.kills=0;pickups=0;
  Object.assign(story,{on:true,act:0,phase:'idle',unlocked:new Set(['fire']),tier:{fire:0},seen:new Set(),t0:time,bestChain:0});
  TOWERS.forEach(T=>{setTowerLit(T,false);T.beam.visible=false});
  // 從存檔繼續：前面幾幕的燈塔直接點亮、法術直接解鎖，開場對白不再播
  for(let k=0;k<fromAct;k++){const T=TOWERS[k];setTowerLit(T,true);if(T.spell==='fire')story.tier.fire=1;else story.unlocked.add(T.spell)}
  if(fromAct>0)for(const a of ACTS.slice(0,fromAct))if(a.dlg)story.seen.add(a.dlg);
  $('#tierLbl').hidden=true;$('#segTier').hidden=true;refreshSkillLabels();giveLamp();beginAct(fromAct)}
// 故事模式開場送一盞普通提燈；已經有就不送。行囊不存檔，所以從存檔繼續時也會送
function giveLamp(){if(equipped.light||inv.some(i=>i.slot==='light'))return;const it=makeItem(0,BASES.find(b=>b.slot==='light'));it.name=EG_TERM.lampName;
  if(place(it)){equip(it);note(EG_TERM.lampGet)}}
function startFree(){initAudio();titleMode(false);$('#intro').hidden=true;$('#ending').hidden=true;running=true;clearWorld();
  Object.assign(story,{on:false,phase:'idle',unlocked:new Set(['fire','bolt','meteor','blood'])});$('#objective').hidden=true;$('#tierLbl').hidden=false;$('#segTier').hidden=false;
  TOWERS.forEach(T=>{setTowerLit(T,true);T.beam.visible=false});player.pos.set(0,0,0);player.kills=0;wave=1;waveTimer=0;refreshSkillLabels();spawnWave(50);toast('第 1 波')}
function beginAct(i){story.act=i;egEmit('actStart',i);const A=ACTS[i];story.ambushed=false;story.ign=0;if(story.on)writeSave(i);
  Object.assign(story,{actT0:time,actKills0:player.kills,actTk0:terrainKills,actLoot0:pickups,bestChain:0});
  const go=()=>{story.phase='fight';story.killsAt=player.kills;story.goal=A.n;spawnWave(A.n,A.mix,1+i*.15);toast(`第 ${i+1} 幕`)};
  if(A.dlg&&!story.seen.has(A.dlg)){story.seen.add(A.dlg);story.phase='dialog';playDialog(A.dlg,go)}else go()}
function ambush(T){const A=ACTS[story.act];for(let i=0;i<6;i++){const a=rand(0,TAU),r=rand(9,12);spawnEnemy(pickType(A.mix),T.x+Math.cos(a)*r,T.z+Math.sin(a)*r,1+story.act*.15)}note(`${EG_TERM.undead}被火光吸引過來了`)}
function igniteTower(T){setTowerLit(T,true);T.beam.visible=false;story.phase='dialog';egFx(T)&&explode(new V3(T.x,3.8,T.z),1.1,[1,1,1],true);shake(.3);
  if(T.spell==='fire')story.tier.fire=1;else story.unlocked.add(T.spell);refreshSkillLabels();toast(`${T.name}${egLit(T)}`);obj(`${T.name}${egLit(T)}`,'');
  egEmit('towerLit',story.act);const A=ACTS[story.act];after(1,()=>showResult(story.act,()=>playDialog(A.after,()=>{if(story.act<ACTS.length-1)beginAct(story.act+1);else egBossIntro()})))}
function updateStory(dt){if(!story.on)return;
  if(story.phase==='fight'){const k=Math.min(story.goal,player.kills-story.killsAt);obj(`擊倒甦醒的${EG_TERM.undead}　${k} / ${story.goal}`,`第 ${story.act+1} 幕`);
    if(k>=story.goal){story.phase='goto';TOWERS[story.act].beam.visible=true;toast(`${EG_TERM.go}${TOWERS[story.act].name}`);sfx.pick()}}
  else if(story.phase==='goto'||story.phase==='ignite'){const T=TOWERS[story.act],d=Math.hypot(player.pos.x-T.x,player.pos.z-T.z);
    if(d<2.8&&player.alive){if(story.phase==='goto'){story.phase='ignite';if(!story.ambushed){story.ambushed=true;ambush(T)}}story.ign=Math.min(1,story.ign+dt/3)}
    else if(story.phase==='ignite'){story.ign=Math.max(0,story.ign-dt/4);if(story.ign<=0)story.phase='goto'}
    if(story.phase==='ignite'&&egFx(T))rate(T.acc,'ig',10+60*story.ign,dt,()=>{const a=rand(0,TAU),r=rand(.6,2.4);
      ADD.emit({x:T.x+Math.cos(a)*r,y:.1,z:T.z+Math.sin(a)*r,vx:-Math.cos(a)*r*.6,vy:rand(2,4),vz:-Math.sin(a)*r*.6,kind:3,fm:2,frame:0,life:.7,s0:.22,s1:.05,r:T.c[0],g:T.c[1],b:T.c[2],a0:1,a1:0})});
    obj(story.phase==='ignite'?`${egIgnite(T)}${T.name}　${Math.round(story.ign*100)}%`:`${EG_TERM.go}${T.name}（${T.dir}方）`,story.phase==='ignite'?EG_TERM.hintIgnite:EG_TERM.hintGo);
    if(story.ign>=1)igniteTower(T)}
  else if(story.phase==='boss'&&story.boss){$('#bossfill').style.transform=`scaleX(${Math.max(0,story.boss.hp/story.boss.maxhp)})`;obj(`擊敗${CONTENT.text.bossName}`,EG_TERM.hintBoss)}}

// 首領
const shocks=[],shockGeo=new THREE.RingGeometry(.9,1,72);
function startBoss(){story.phase='boss';spawnEnemy('lord',0,0,1);const b=enemies[enemies.length-1];b.aggro=true;b.shockT=3;b.flags={};story.boss=b;$('#bossbar').hidden=false;egEmit('bossStart');
  for(let i=0;i<30;i++){const d=randUnit();SMOKE.emit({x:rand(-1,1),y:1+rand(0,2),z:rand(-1,1),vx:d.x*3,vy:Math.abs(d.y)*2,vz:d.z*3,kind:2,fm:1,life:rand(1.4,2.2),s0:2,s1:5,r:.25,g:.12,b:.35,a0:.8,a1:0})}
  flash(new V3(0,2,0),0x9a5cff,6,16,.8);shake(.5);sfx.blood();toast(CONTENT.text.bossName)}
function summon(e,n){for(let i=0;i<n;i++){const a=rand(0,TAU),r=rand(4,7),x=e.pos.x+Math.cos(a)*r,z=e.pos.z+Math.sin(a)*r;spawnEnemy(Math.random()<.6?'spider':'ghost',x,z,1.5);
  for(let k=0;k<4;k++)SMOKE.emit({x,y:.4,z,vx:rand(-1,1),vy:rand(.5,1.5),vz:rand(-1,1),kind:2,fm:1,life:1.2,s0:1,s1:2.5,r:.3,g:.2,b:.4,a0:.6,a1:0})}}
function bossAI(e,dt){e.shockT-=dt;
  if(e.shockT<=0){e.shockT=5.2;const m=new THREE.Mesh(shockGeo,new THREE.MeshBasicMaterial({color:0xa05cff,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
    m.rotation.x=-Math.PI/2;m.position.set(e.pos.x,.08,e.pos.z);scene.add(m);shocks.push({x:e.pos.x,z:e.pos.z,t:0,mesh:m,hit:false});sfx.boom(.8);shake(.25)}
  rate(e.parts,'aura',30,dt,()=>{const a=rand(0,TAU),r=rand(.5,1.8);SMOKE.emit({x:e.pos.x+Math.cos(a)*r,y:rand(.3,3.5),z:e.pos.z+Math.sin(a)*r,vy:rand(.3,.8),kind:2,fm:1,life:rand(1,1.6),s0:1.2,s1:2.6,r:.22,g:.1,b:.32,a0:.55,a1:0})});
  const f=e.hp/e.maxhp;
  if(f<.66&&!e.flags.s1){e.flags.s1=true;summon(e,7);note(`${CONTENT.text.bossName}召來了${EG_TERM.undead}`)}
  if(f<.5&&!e.flags.dark){e.flags.dark=true;setDark(1);after(9,()=>setDark(0));playDialog(EG_FLOW.half,null)}
  if(f<.33&&!e.flags.s2){e.flags.s2=true;summon(e,9);note(`更多${EG_TERM.undead}從墳裡爬出來`)}}
function updateShocks(dt){for(let i=shocks.length-1;i>=0;i--){const s=shocks[i];s.t+=dt;const k=s.t/1.5,r=1+k*13;s.mesh.scale.setScalar(r);s.mesh.material.opacity=.9*(1-k*.6);
  for(const p of props)if(p.state==='up'&&(p.kind==='tomb'||p.kind==='fence')&&Math.abs(Math.hypot(p.x-s.x,p.z-s.z)-r)<.8){p.hp-=3;if(p.hp<=0)breakProp(p,new V3(s.x,0,s.z))}
  if(!s.hit&&player.alive&&r>2.2){const d=Math.hypot(player.pos.x-s.x,player.pos.z-s.z);if(Math.abs(d-r)<.75){s.hit=true;hurtPlayer(22,EG_TERM.bossShock);flash(player.pos.clone().setY(1),0xa05cff,3,6,.3)}}
  rate(s,'p',90,dt,()=>{const a=rand(0,TAU);ADD.emit({x:s.x+Math.cos(a)*r,y:.15,z:s.z+Math.sin(a)*r,vy:rand(.5,1.5),kind:3,fm:2,frame:0,life:.4,s0:.35,s1:.05,r:.65,g:.35,b:1,a0:.9,a1:0})});
  if(k>=1){scene.remove(s.mesh);s.mesh.material.dispose();shocks.splice(i,1)}}}
function onBossDead(e){egEmit('bossDown');story.phase='outro';$('#bossbar').hidden=true;$('#objective').hidden=true;const c=e.pos.clone();
  for(let i=0;i<6;i++)after(i*.22,()=>explode(new V3(c.x+rand(-2,2),rand(.5,2.5),c.z+rand(-2,2)),1.3,[.75,.5,1]));
  after(1.4,()=>{for(const o of enemies)if(o.alive)killEnemy(o);setDark(0)});
  after(2.8,()=>playDialog(EG_FLOW.down,egShowEnding))}
function showEnding(){story.phase='end';egEmit('ending');clearSave();const s=Math.round(time-story.t0);
  $('#endSub').textContent=`用時 ${Math.floor(s/60)} 分 ${String(s%60).padStart(2,'0')} 秒・擊倒 ${player.kills} 隻・地形擊殺 ${terrainKills}（${player.kills?Math.round(terrainKills/player.kills*100):0}%）`;$('#ending').hidden=false;$('#objective').hidden=true}
$('#endAgain').onclick=()=>startStory(0);$('#endFree').onclick=startFree;
$('#btnVoice').onclick=()=>{voiceOn=!voiceOn;$('#btnVoice').textContent='語音：'+(voiceOn?'開':'關');if(!voiceOn)hush()};

