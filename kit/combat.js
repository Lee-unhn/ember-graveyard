// 戰鬥：狀態與數值、怪物、投射物、星墜、血環、裝備與行囊
// 依序載入的一般 script，頂層名稱在檔案之間共用（見 core.js）。
'use strict';
/* ---------- 狀態與數值 ---------- */
let routeMode=0,upgraded=true,running=false,wave=1,waveTimer=0,time=0,shakeAmt=0,zoom=1,hitStop=0;
// 鏡頭震動與停格都經過這裡：設定開「減少震動與停格」時一律略過
function shake(a){if(!SET.reduceShake)shakeAmt=Math.max(shakeAmt,a)}
function freezeFrame(s){if(!SET.reduceShake)hitStop=Math.max(hitStop,s)}
const stats={fire:0,spell:0,hp:0,cast:0,move:0,light:0};
const castMul=()=>1+stats.cast/100, spellMul=()=>egGearMul(1+stats.spell/100), fireMul=()=>egGearMul((1+stats.fire/100)*spellMul());
// 法術參數表（預設值）；執行中一律經 spellP(id) 讀 SPELLS 這份可覆寫的副本（EG.setSpellParams，見 CONTENT-API.md）
const SPELL_DEF={fire:{cd:.36,dur:.3,rel:.5,shots:3,spread:.2,damage:34,radius:2.2,speed:19,life:1.3,homingTurn:0,homingCone:0},
  bolt:{cd:1.05,dur:.38,rel:.45,damage:30,bounces:6,range:7.5,firstHop:.88,decay:.92,hopDelay:.075},
  meteor:{cd:5,dur:.72,rel:.6,drops:10,damage:60,radius:2.7,burnRadius:2.2,burnTime:3.5,spread:4.4,interval:.17,sizeMin:.8,sizeMax:1.05,pattern:'scatter',arcLength:8,arcMinRadius:0},
  blood:{cd:4.5,dur:1.9,rel:.02,bolts:8,damage:26,interval:.09,duration:2.4,seek:15}},SPELLS=JSON.parse(JSON.stringify(SPELL_DEF));
const cds={fire:0,bolt:0,meteor:0,blood:0};
const timers=[];function after(t,fn){timers.push({t,fn})}

/* ---------- 浮字與血條（畫面上的文字層） ---------- */
const fxLayer=$('#fx'),tv=new V3();
function toScreen(v){tv.copy(v).project(camera);return [(tv.x*.5+.5)*innerWidth,(-tv.y*.5+.5)*innerHeight,tv.z<1&&tv.z>-1]}
const dmgs=[];
function dmgText(pos,val,color,crit){const el=document.createElement('div');el.className='dmg'+(crit?' crit':'');el.textContent=Math.round(val);if(!crit)el.style.color=color;fxLayer.appendChild(el);
  dmgs.push({el,pos:pos.clone().add(new V3(rand(-.3,.3),2,rand(-.3,.3))),t:0,life:.9})}
function updateTexts(dt){for(let i=dmgs.length-1;i>=0;i--){const d=dmgs[i];d.t+=dt;d.pos.y+=dt*1.6;const [x,y,ok]=toScreen(d.pos);const k=d.t/d.life;
  if(k>=1){d.el.remove();dmgs.splice(i,1);continue}d.el.style.opacity=ok?(1-k*k):0;d.el.style.transform=`translate(${x}px,${y}px) translate(-50%,-50%) scale(${1+(k<.12?(.12-k)*4:0)})`}}

/* ---------- 怪物 ---------- */
const enemies=[];
const ETYPES={
  spider:{hp:45,speed:3.9,radius:.55,dmg:6,name:'墓蛛'},
  lizard:{hp:90,speed:2.6,radius:.6,dmg:10,name:'灰蜥'},
  ghost:{hp:130,speed:1.9,radius:.6,dmg:12,name:'殘魂',float:true},
  lord:{hp:4200,speed:1.6,radius:1.4,dmg:20,name:CONTENT.text.bossName,float:true}};
function buildEnemy(type){
  const g=new THREE.Group(),mats=[],parts={legs:[]};
  const M=(c,o={})=>{const m=new THREE.MeshLambertMaterial(Object.assign({color:c},o));m.userData.e0=m.emissive.clone();mats.push(m);return m};
  if(type==='spider'){const bm=M(0x2b2133),lm=M(0x1a1420);
    const b=new THREE.Mesh(new THREE.SphereGeometry(.45,12,8),bm);b.scale.set(1,.65,1.2);b.position.set(0,.5,-.15);g.add(b);
    const h=new THREE.Mesh(new THREE.SphereGeometry(.24,10,8),bm);h.position.set(0,.45,.42);g.add(h);
    const eye=new THREE.MeshBasicMaterial({color:0xff2a2a});for(const s of [-1,1]){const e=new THREE.Mesh(new THREE.SphereGeometry(.045,6,4),eye);e.position.set(.09*s,.52,.63);g.add(e)}
    for(let i=0;i<8;i++){const s=i<4?-1:1,j=i%4,piv=new THREE.Group();piv.position.set(.22*s,.45,-.25+j*.2);
      const leg=new THREE.Mesh(new THREE.CylinderGeometry(.03,.025,.85,5),lm);leg.position.set(.36*s,-.12,0);leg.rotation.z=s*(Math.PI/2-.55);piv.add(leg);g.add(piv);parts.legs.push({piv,ph:j*1.6+(s>0?Math.PI:0)})}}
  else if(type==='lizard'){const bm=M(0x3e5b30),dm=M(0x2a3d22);
    const b=new THREE.Mesh(new THREE.BoxGeometry(.55,.36,1.1),bm);b.position.y=.4;g.add(b);
    const h=new THREE.Mesh(new THREE.BoxGeometry(.38,.28,.45),bm);h.position.set(0,.48,.72);g.add(h);
    const t=new THREE.Mesh(new THREE.ConeGeometry(.18,1.1,6),dm);t.rotation.x=-Math.PI/2;t.position.set(0,.36,-1.05);g.add(t);parts.tail=t;
    const eye=new THREE.MeshBasicMaterial({color:0xffd23a});for(const s of [-1,1]){const e=new THREE.Mesh(new THREE.SphereGeometry(.04,6,4),eye);e.position.set(.17*s,.56,.85);g.add(e)}
    for(let i=0;i<4;i++){const s=i%2?1:-1,piv=new THREE.Group();piv.position.set(.3*s,.32,i<2?.35:-.35);const leg=new THREE.Mesh(new THREE.BoxGeometry(.12,.34,.12),dm);leg.position.y=-.16;piv.add(leg);g.add(piv);parts.legs.push({piv,ph:(i===0||i===3)?0:Math.PI})}}
  else if(type==='lord'){const lm=M(0x2a1840,{transparent:true,opacity:.9,emissive:0x1a0830});
    const h=new THREE.Mesh(new THREE.SphereGeometry(1.1,16,12),lm);h.position.y=3.6;g.add(h);
    const c=new THREE.Mesh(new THREE.ConeGeometry(1.5,3.4,16,1,true),lm);c.rotation.x=Math.PI;c.position.y=2;g.add(c);
    const cm=M(0x3a2058,{emissive:0x2a0f45});
    for(let i=0;i<7;i++){const s=new THREE.Mesh(new THREE.ConeGeometry(.14,.9,5),cm),a=i/7*TAU;s.position.set(Math.cos(a)*.75,4.55,Math.sin(a)*.75);s.rotation.set(Math.sin(a)*.35,0,-Math.cos(a)*.35);g.add(s)}
    const eye=new THREE.MeshBasicMaterial({color:0xc9a6ff});for(const s of [-1,1]){const e=new THREE.Mesh(new THREE.SphereGeometry(.17,8,6),eye);e.position.set(.38*s,3.7,.95);g.add(e)}
    parts.body=g}
  else{const gm=M(0x9fd8e8,{transparent:true,opacity:.72,emissive:0x2a6f80});
    const h=new THREE.Mesh(new THREE.SphereGeometry(.45,14,10),gm);h.position.y=1.5;g.add(h);
    const c=new THREE.Mesh(new THREE.ConeGeometry(.5,1.3,14,1,true),gm);c.rotation.x=Math.PI;c.position.y=.85;g.add(c);
    const eye=new THREE.MeshBasicMaterial({color:0x0b1a22});for(const s of [-1,1]){const e=new THREE.Mesh(new THREE.SphereGeometry(.08,8,6),eye);e.position.set(.16*s,1.55,.38);g.add(e)}
    parts.body=g}
  return {g,mats,parts};
}
function spawnEnemy(type,x,z,hpMul){const T=ETYPES[type],b=egSkin(type,buildEnemy(type));b.g.position.set(x,0,z);scene.add(b.g);
  enemies.push({type,T,g:b.g,mats:b.mats,parts:b.parts,pos:b.g.position,hp:T.hp*hpMul,maxhp:T.hp*hpMul,alive:true,dying:-1,flash:0,atk:rand(.2,.9),aggro:false,wa:rand(0,TAU),wt:0,ph:rand(0,TAU),hpEl:null,radius:T.radius,rotY:0})}
function pickType(mix){const r=Math.random();return r<mix[0]?'spider':r<mix[0]+mix[1]?'lizard':'ghost'}
function spawnWave(n,mix=[.45,.35,.2],hpMul=1+(wave-1)*.25){for(let i=0;i<n;i++){let x,z;do{const a=rand(0,TAU),r=rand(12,40);x=Math.cos(a)*r;z=Math.sin(a)*r}while(Math.hypot(x-player.pos.x,z-player.pos.z)<11);
  spawnEnemy(pickType(mix),x,z,hpMul)}}
function dealDamage(e,amt,kind,src){if(!e.alive)return;const cc=combatCfg(),crit=cc.critChance>0&&Math.random()<cc.critChance;if(crit)amt*=cc.critMul;e.hp-=amt;egEmit('hit',{spell:kind,kind,source:src||null,target:e,amount:amt});e.flash=.09;e.flinch=.14;e.aggro=true;e.lastKind=kind;if(crit)freezeFrame(.05);
  const col={fire:'#ffab5c',bolt:'#9fdcff',blood:'#ff6475',burn:'#d98b4a',terrain:'#c9e06a',crush:'#e0d6c2',boom:'#7fe0ff'}[kind]||'#fff';dmgText(e.pos,amt,col,crit);
  if(!e.hpEl&&e.type!=='lord'){e.hpEl=document.createElement('div');e.hpEl.className='hpb';e.hpEl.innerHTML='<i></i>';fxLayer.appendChild(e.hpEl)}
  if(e.hpEl)e.hpEl.firstChild.style.transform=`scaleX(${Math.max(0,e.hp/e.maxhp)})`;
  if(e.hp<=0)killEnemy(e)}
function aoe(pos,r,dmg,kind,skip,src){for(const e of enemies){if(!e.alive||e===skip)continue;if(Math.hypot(e.pos.x-pos.x,e.pos.z-pos.z)<r+e.radius*.5)dealDamage(e,dmg*egAoeJit(),kind,src)}}
function killEnemy(e){e.alive=false;e.dying=0;player.kills++;egEmit('kill',e.type);if(e.hpEl){e.hpEl.remove();e.hpEl=null}
  if(e.type==='lord'){dropLoot(e.pos,3);dropLoot(e.pos,3);onBossDead(e);return}
  if(isTerrainKind(e.lastKind))onTerrainKill(e);
  const c=e.type==='ghost'?[.5,.85,1]:e.type==='lizard'?[.5,.9,.4]:[.8,.3,.9];
  for(let i=0;i<14;i++){const d=randUnit();ADD.emit({x:e.pos.x,y:.8,z:e.pos.z,vx:d.x*3,vy:Math.abs(d.y)*4+1,vz:d.z*3,kind:3,fm:2,frame:0,life:rand(.4,.7),s0:.25,s1:.05,r:c[0],g:c[1],b:c[2],a0:.9,a1:0,grav:6,drag:1})}
  for(let i=0;i<3;i++)SMOKE.emit({x:e.pos.x+rand(-.3,.3),y:.6,z:e.pos.z+rand(-.3,.3),vy:rand(.4,.9),kind:2,fm:1,life:rand(.9,1.3),s0:1,s1:2.2,r:.45,g:.45,b:.5,a0:.45,a1:0});
  if(Math.random()<(e.type==='ghost'?.5:.3))dropLoot(e.pos)}
function updateEnemies(dt){
  const list=enemies;
  for(let i=list.length-1;i>=0;i--){const e=list[i];
    if(e.dying>=0){e.dying+=dt;const k=e.dying/.55;e.g.scale.set(1+k*.3,Math.max(.01,1-k),1+k*.3);e.g.position.y=-k*.3;if(k>=1){scene.remove(e.g);egFree(e.g);list.splice(i,1)}continue}
    if(e.flinch>0){e.flinch=Math.max(0,e.flinch-dt);const k=e.flinch/.14;e.g.scale.set(1+.16*k,1-.12*k,1+.16*k)}else if(e.g.scale.x!==1)e.g.scale.set(1,1,1);  // 受擊抖動
    if(e.flash>0){e.flash-=dt;for(const m of e.mats)m.emissive.setRGB(.85,.75,.7).multiplyScalar(egFlashOff?.3:1)}else for(const m of e.mats)m.emissive.copy(m.userData.e0);
    const dx=player.pos.x-e.pos.x,dz=player.pos.z-e.pos.z,d=Math.hypot(dx,dz)||1;let mx=0,mz=0;
    if(player.alive&&(d<24||e.aggro)){e.aggro=true;if(d>e.radius+.55){mx=dx/d;mz=dz/d}}
    else{e.wt-=dt;if(e.wt<=0){e.wa=rand(0,TAU);e.wt=rand(1,3)}mx=Math.cos(e.wa)*.35;mz=Math.sin(e.wa)*.35}
    const tm=terrainEffects(e,dt);if(!e.alive)continue;
    e.pos.x+=mx*e.T.speed*tm*dt;e.pos.z+=mz*e.T.speed*tm*dt;
    for(let j=0;j<i;j++){const f=list[j];if(!f.alive)continue;const ox=e.pos.x-f.pos.x,oz=e.pos.z-f.pos.z,od=Math.hypot(ox,oz),min=e.radius+f.radius;
      if(od<min&&od>1e-4){const p=(min-od)*.5;e.pos.x+=ox/od*p;e.pos.z+=oz/od*p;f.pos.x-=ox/od*p;f.pos.z-=oz/od*p}}
    if(!e.T.float)pushOut(e.pos,e.radius);else{const R=Math.hypot(e.pos.x,e.pos.z);if(R>42.5){e.pos.x*=42.5/R;e.pos.z*=42.5/R}}
    const pd=Math.hypot(player.pos.x-e.pos.x,player.pos.z-e.pos.z);if(pd<e.radius+.45&&pd>1e-4){const p=e.radius+.45-pd;e.pos.x-=(player.pos.x-e.pos.x)/pd*p;e.pos.z-=(player.pos.z-e.pos.z)/pd*p}
    if(mx||mz){const ty=Math.atan2(mx,mz);let df=ty-e.rotY;df=Math.atan2(Math.sin(df),Math.cos(df));e.rotY+=df*Math.min(1,dt*10);e.g.rotation.y=e.rotY}
    const sp=(mx||mz)?1:.2;e.ph+=dt*(e.type==='spider'?18:10)*sp;
    for(const L of e.parts.legs){if(e.type==='spider')L.piv.rotation.y=Math.sin(e.ph+L.ph)*.4;else L.piv.rotation.x=Math.sin(e.ph+L.ph)*.6}
    if(e.parts.tail)e.parts.tail.rotation.z=Math.sin(e.ph*.5)*.4;
    if(e.T.float){e.g.position.y=(e.type==='lord'?.35:.25)+Math.sin(time*2.4+e.ph*.1)*.15}
    if(e.type==='lord')bossAI(e,dt);
    if(player.alive&&pd<e.radius+.95){e.atk-=dt;if(e.atk<=0){e.atk=.9;hurtPlayer(e.T.dmg*(1+(wave-1)*.15),e.T.name)}}
    if(e.hpEl){const [x,y,ok]=toScreen(tv.set(e.pos.x,e.T.float?2.4:1.5,e.pos.z));e.hpEl.style.transform=`translate(${x-22}px,${y}px)`;e.hpEl.style.display=ok?'block':'none'}
  }
}
function pushOut(p,r){for(const o of obstacles){if(!o.r)continue;const dx=p.x-o.x,dz=p.z-o.z,d=Math.hypot(dx,dz),m=o.r+r;if(d<m&&d>1e-4){p.x=o.x+dx/d*m;p.z=o.z+dz/d*m}}
  solidPush(p,r);
  const R=Math.hypot(p.x,p.z);if(R>42.5){p.x*=42.5/R;p.z*=42.5/R}}

/* ---------- 投射物 ---------- */
const projs=[];
function fireballVisual(p,tint=[1,1,1],scale=1){
  // 球芯：三片永遠面向鏡頭的翻頁火焰疊在一起，各自轉速不同；外加一圈光暈
  ADD.emit({follow:p,kind:0,life:1e9,s0:1.05*scale,rs:2.6,fm:0,fps:24,r:tint[0],g:tint[1],b:tint[2],a0:1,a1:1});
  ADD.emit({follow:p,kind:0,life:1e9,s0:.85*scale,rs:-3.2,fm:0,fps:30,r:tint[0],g:tint[1]*.95,b:tint[2]*.9,a0:1,a1:1});
  ADD.emit({follow:p,kind:0,life:1e9,s0:.7*scale,rs:4.1,fm:0,fps:20,r:tint[0],g:tint[1]*.9,b:tint[2]*.75,a0:1,a1:1});
  ADD.emit({follow:p,kind:3,fm:2,frame:0,life:1e9,s0:2.6*scale,r:tint[0],g:.5*tint[1],b:.15*tint[2],a0:.32,a1:.32});
}
function fireTrail(p,dt,tint=[1,1,1],scale=1){
  // 尾焰：每秒 240 片，0.1 秒內縮到幾乎看不見
  rate(p.acc,'trail',240,dt,()=>ADD.emit({x:p.pos.x+rand(-.12,.12),y:p.pos.y+rand(-.12,.12),z:p.pos.z+rand(-.12,.12),vx:-p.vel.x*.05+rand(-.4,.4),vy:rand(-.2,.5),vz:-p.vel.z*.05+rand(-.4,.4),
    kind:0,fm:0,fps:30,life:rand(.1,.16),s0:rand(.5,.66)*scale,s1:.05,r:tint[0],g:.85*tint[1],b:.7*tint[2],a0:1,a1:.5}));
  // 火舌：往外竄的短命火片
  rate(p.acc,'tongue',70,dt,()=>{const d=randUnit();ADD.emit({x:p.pos.x,y:p.pos.y,z:p.pos.z,vx:d.x*1.6,vy:d.y*1.6+.6,vz:d.z*1.6,kind:0,fm:0,fps:26,life:rand(.2,.3),s0:.6*scale,s1:.18,rs:rand(-3,3),r:tint[0],g:tint[1],b:tint[2],a0:.9,a1:0})});
  // 餘燼：飄起來的小星點
  rate(p.acc,'ember',35,dt,()=>{const d=randUnit();ADD.emit({x:p.pos.x,y:p.pos.y,z:p.pos.z,vx:d.x*1.4,vy:Math.abs(d.y)*1.2+.8,vz:d.z*1.4,kind:3,fm:2,frame:8+randi(0,7),life:rand(.5,.9),s0:.14*scale,s1:.04,drag:1.2,r:tint[0],g:.6*tint[1],b:.2*tint[2],a0:1,a1:0})});
}
function explode(pos,scale=1,tint=[1,1,1],sound=true){
  for(let i=0;i<3;i++)ADD.emit({x:pos.x+rand(-.2,.2)*scale,y:pos.y+rand(-.1,.25)*scale,z:pos.z+rand(-.2,.2)*scale,kind:1,fm:1,life:rand(.45,.62),s0:2.5*scale,s1:3.7*scale,rs:rand(-1,1),r:tint[0],g:tint[1],b:tint[2],a0:1,a1:1});
  ADD.emit({x:pos.x,y:pos.y,z:pos.z,kind:3,fm:2,frame:0,life:.14,s0:5*scale,s1:6.5*scale,r:tint[0],g:.75*tint[1],b:.4*tint[2],a0:.9,a1:0});
  for(let i=0;i<40;i++){const d=randUnit();d.y=Math.abs(d.y)*.9+.1;const sp=rand(5,12)*Math.sqrt(scale);
    ADD.emit({x:pos.x,y:pos.y,z:pos.z,vx:d.x*sp,vy:d.y*sp,vz:d.z*sp,kind:3,fm:2,frame:8+randi(0,7),life:rand(.45,.9),s0:.22,s1:.05,grav:16,drag:1.4,r:tint[0],g:.75*tint[1],b:.35*tint[2],a0:1,a1:0})}
  const n=Math.round(6*scale);for(let i=0;i<n;i++)SMOKE.emit({x:pos.x+rand(-.4,.4)*scale,y:pos.y+rand(0,.4),z:pos.z+rand(-.4,.4)*scale,vx:rand(-.6,.6),vy:rand(.6,1.4),vz:rand(-.6,.6),kind:2,fm:1,life:rand(1.1,1.8),s0:1.4*scale,s1:3.6*scale,rs:rand(-.5,.5),r:.5,g:.46,b:.44,a0:.55,a1:0,fadeIn:.08});
  flash(tv.set(pos.x,pos.y+.6,pos.z),tint[1]<.5?0xff2a40:0xff8a3a,4.5*scale,10*scale,.4);
  shake(.16*scale);freezeFrame(.035*Math.min(scale,1.6));if(sound)sfx.boom(scale);
}
function spawnFireball(origin,dir){
  const F=spellP('fire'),p={kind:'fire',pos:origin.clone(),vel:dir.clone().multiplyScalar(F.speed),life:F.life,dead:false,acc:{}};
  fireballVisual(p);p.light=attachLight(p,0xff7a2e,2.3,8);projs.push(p);
}
function spawnOrb(origin,dir){
  const p={kind:'bolt',pos:origin.clone(),vel:dir.clone().multiplyScalar(13),life:1.3,dead:false,acc:{}};
  ADD.emit({follow:p,kind:3,fm:2,frame:0,life:1e9,s0:1.1,r:.85,g:.95,b:1,a0:.95,a1:.95});
  ADD.emit({follow:p,kind:3,fm:2,frame:0,life:1e9,s0:2.8,r:.3,g:.6,b:1,a0:.45,a1:.45});
  ADD.emit({follow:p,kind:3,fm:2,frame:9,life:1e9,s0:1.5,rs:6,r:.6,g:.85,b:1,a0:.8,a1:.8});
  p.light=attachLight(p,0x6fb8ff,2.6,9,true,.6);projs.push(p);
}
function updateProjs(dt){
  for(let i=projs.length-1;i>=0;i--){const p=projs[i];p.pos.addScaledVector(p.vel,dt);p.life-=dt;
    if(p.kind==='fire'){egHome(p,dt);fireTrail(p,dt)}
    else{
      rate(p.acc,'arc',16,dt,()=>bolt(p.pos,p.pos.clone().add(randUnit().multiplyScalar(rand(.6,1.2))),.16,.08,false));
      rate(p.acc,'gnd',7,dt,()=>{const a=rand(0,TAU),r=rand(.6,1.8),g=new V3(p.pos.x+Math.cos(a)*r,.05,p.pos.z+Math.sin(a)*r);bolt(p.pos,g,.22,.12,false);applyEl(cellOf(g.x,g.z),'bolt');
        for(let k=0;k<6;k++){const d=randUnit();ADD.emit({x:g.x,y:.1,z:g.z,vx:d.x*3,vy:Math.abs(d.y)*3,vz:d.z*3,kind:3,fm:2,frame:0,life:.3,s0:.15,s1:.03,grav:10,r:.6,g:.85,b:1,a0:1,a1:0})}});
    }
    let hit=null;for(const e of enemies){if(e.alive&&Math.hypot(e.pos.x-p.pos.x,e.pos.z-p.pos.z)<e.radius+.45){hit=e;break}}
    if(hit||p.life<=0||Math.hypot(p.pos.x,p.pos.z)>44){p.dead=true;projs.splice(i,1);
      if(p.kind==='fire'){const F=spellP('fire');explode(p.pos,1);aoe(p.pos,F.radius,F.damage*fireMul(),'fire',0,'fire');terrainBlast(p.pos,1.6,'fire');damageProps(p.pos,1.8,1,'fire')}
      else{zapBurst(p.pos);sfx.zap();terrainBlast(p.pos,.9,'bolt');if(hit){const B=spellP('bolt');dealDamage(hit,B.damage*spellMul(),'bolt','bolt');if(tierOf('bolt'))chain(hit,new Set([hit]),B.bounces,B.damage*spellMul()*B.firstHop);else aoe(hit.pos,1.6,14*spellMul(),'bolt',hit,'boltSplash')}}
    }
  }
}
function zapBurst(pos){ADD.emit({x:pos.x,y:pos.y,z:pos.z,kind:3,fm:2,frame:9,life:.18,s0:4,s1:5,r:.5,g:.8,b:1,a0:.9,a1:0});
  for(let i=0;i<24;i++){const d=randUnit(),sp=rand(4,9);ADD.emit({x:pos.x,y:pos.y,z:pos.z,vx:d.x*sp,vy:d.y*sp,vz:d.z*sp,kind:3,fm:2,frame:0,life:rand(.25,.5),s0:.18,s1:.03,grav:8,drag:2,r:.6,g:.85,b:1,a0:1,a1:0})}
  flash(pos,0x7fc8ff,4,9,.25)}
function chain(from,hitSet,n,dmg){if(n<=0)return;const B=spellP('bolt');after(B.hopDelay,()=>{
  let best=null,bd=B.range;for(const e of enemies){if(!e.alive||hitSet.has(e))continue;const d=Math.hypot(e.pos.x-from.pos.x,e.pos.z-from.pos.z);if(d<bd){bd=d;best=e}}
  if(!best)return;const a=new V3(from.pos.x,1,from.pos.z),b=new V3(best.pos.x,1,best.pos.z);bolt(a,b,.32,.16,true);zapBurst(b);sfx.zap();
  hitSet.add(best);applyEl(cellOf(best.pos.x,best.pos.z),'bolt');dealDamage(best,dmg,'bolt','boltChain');chain(best,hitSet,n-1,dmg*B.decay)})}
function boltPath(a,b){let pts=[a.clone(),b.clone()],d=a.distanceTo(b)*.22;
  for(let l=0;l<4;l++){const np=[];for(let i=0;i<pts.length-1;i++){const m=pts[i].clone().lerp(pts[i+1],.5);m.x+=rand(-d,d);m.y+=rand(-d,d)*.6;m.z+=rand(-d,d);np.push(pts[i],m)}np.push(pts[pts.length-1]);pts=np;d*=.5}return pts}
function bolt(a,b,w,life,branch){
  // 閃電：沿折線鋪滿短命光點，粗光＋白芯兩層
  const pts=boltPath(a,b);
  for(let i=0;i<pts.length-1;i++){const p0=pts[i],p1=pts[i+1],len=p0.distanceTo(p1),n=Math.max(1,Math.ceil(len/.12));
    for(let s=0;s<n;s++){const t=s/n,x=lerp(p0.x,p1.x,t),y=Math.max(.05,lerp(p0.y,p1.y,t)),z=lerp(p0.z,p1.z,t);
      ADD.emit({x,y,z,kind:3,fm:2,frame:0,life,s0:w,s1:w*.5,r:.45,g:.72,b:1,a0:.85,a1:0});
      if(s%2===0)ADD.emit({x,y,z,kind:3,fm:2,frame:0,life:life*.8,s0:w*.38,s1:w*.2,r:1,g:1,b:1,a0:1,a1:0})}}
  if(branch&&a.distanceTo(b)>2.5){const k=randi(4,11),o=pts[k];bolt(o,o.clone().add(randUnit().multiplyScalar(a.distanceTo(b)*.28)),w*.55,life,false)}
}

/* ---------- 星墜（隕石） ---------- */
const rockGeo=(()=>{const g=new THREE.IcosahedronGeometry(1,2),p=g.attributes.position;
  for(let i=0;i<p.count;i++){const v=new V3(p.getX(i),p.getY(i),p.getZ(i)).normalize();const n=vnoise(v.x*2.3+v.y*3.1+5,v.z*2.7-v.y*1.3+9);v.multiplyScalar(.82+n*.4);p.setXYZ(i,v.x,v.y,v.z)}
  g.computeVertexNormals();return g})();
const rockMat=new THREE.MeshStandardMaterial({color:0x2a211d,roughness:.95,metalness:0,emissive:0xff5a14,emissiveMap:crackTex,emissiveIntensity:1.8,flatShading:true});
const ringGeo=new THREE.RingGeometry(.88,1,48);
const meteors=[],rocks=[],burns=[];
function castMeteor(T){if(!tierOf('meteor')){dropMeteor(T,1.35,0);return}
  const M=spellP('meteor');for(let i=0;i<M.drops;i++){const a=rand(0,TAU),r=i?Math.sqrt(Math.random())*M.spread:0;dropMeteor(M.pattern==='arc'?egArc(T,i,M):new V3(T.x+Math.cos(a)*r,0,T.z+Math.sin(a)*r),rand(M.sizeMin,M.sizeMax),i*M.interval)}}
function dropMeteor(T,sc,delay){after(delay,()=>{
  const ring=new THREE.Mesh(ringGeo,new THREE.MeshBasicMaterial({color:0xff5a2a,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));
  ring.rotation.x=-Math.PI/2;ring.position.set(T.x,.06,T.z);ring.scale.setScalar(2.4*sc);scene.add(ring);
  const from=new V3(T.x-7,22,T.z-6),mesh=new THREE.Mesh(rockGeo,rockMat.clone());mesh.scale.setScalar(.85*sc);mesh.position.copy(from);scene.add(mesh);
  const m={pos:from.clone(),from,to:T.clone(),t:0,dur:.75,sc,mesh,ring,acc:{},dead:false,vel:new V3(7,-22,6).multiplyScalar(1/.75)};
  m.light=attachLight(m,0xff6a20,3,12,sc>1.2);meteors.push(m)})}
function updateMeteors(dt){
  for(let i=meteors.length-1;i>=0;i--){const m=meteors[i];m.t+=dt;const k=Math.min(1,m.t/m.dur),e=k*k*.45+k*.55;
    m.pos.lerpVectors(m.from,m.to,e);m.pos.y=Math.max(m.pos.y,.2);m.mesh.position.copy(m.pos);m.mesh.rotation.x+=dt*3;m.mesh.rotation.z+=dt*2.2;
    m.ring.material.opacity=.25+.55*k;m.ring.scale.setScalar(2.4*m.sc*(1.15-.15*k+Math.sin(m.t*30)*.03));
    const s=m.sc;
    rate(m.acc,'f',180,dt,()=>ADD.emit({x:m.pos.x+rand(-.5,.5)*s,y:m.pos.y+rand(-.4,.5)*s,z:m.pos.z+rand(-.5,.5)*s,vx:-m.vel.x*.06+rand(-.6,.6),vy:-m.vel.y*.06,vz:-m.vel.z*.06+rand(-.6,.6),kind:0,fm:0,fps:28,life:rand(.25,.4),s0:1.7*s,s1:.3,rs:rand(-2,2),r:1,g:.85,b:.65,a0:1,a1:0}));
    rate(m.acc,'s',45,dt,()=>SMOKE.emit({x:m.pos.x,y:m.pos.y+.3,z:m.pos.z,vx:rand(-.3,.3),vy:rand(.2,.6),vz:rand(-.3,.3),kind:2,fm:1,life:rand(1.2,1.6),s0:1.2*s,s1:3*s,rs:rand(-.6,.6),r:.3,g:.27,b:.25,a0:.5,a1:0,fadeIn:.1}));
    rate(m.acc,'e',40,dt,()=>{const d=randUnit();ADD.emit({x:m.pos.x,y:m.pos.y,z:m.pos.z,vx:d.x*2,vy:d.y*2+1,vz:d.z*2,kind:3,fm:2,frame:8+randi(0,7),life:rand(.4,.8),s0:.18,s1:.04,drag:1,r:1,g:.6,b:.2,a0:1,a1:0})});
    if(k>=1){meteors.splice(i,1);m.dead=true;scene.remove(m.ring);egFreeMat(m.ring);const p=m.to.clone();p.y=.35;
      explode(p,1.7*s);
      for(let j=0;j<30;j++){const d=randUnit(),sp=rand(4,9);SMOKE.emit({x:p.x,y:.3,z:p.z,vx:d.x*sp,vy:Math.abs(d.y)*sp+2,vz:d.z*sp,kind:2,fm:2,frame:randi(0,4),life:rand(.6,1),s0:.35,s1:.2,grav:18,r:.2,g:.16,b:.13,a0:.9,a1:.6})}
      const M=spellP('meteor');aoe(p,M.radius*egMetR(s),M.damage*(combatCfg().meteorSizeDamage?s:1)*fireMul(),'fire',0,'meteor');addBurn(p,M.burnRadius*egMetR(s),M.burnTime);meteorTerrain(p,2.2*egMetR(s));damageProps(p,2.6*egMetR(s),3,'meteor');
      m.mesh.position.set(p.x,.15*s,p.z);rocks.push({mesh:m.mesh,t:0});
      shake(.38*s)}
  }
  for(let i=rocks.length-1;i>=0;i--){const r=rocks[i];r.t+=dt;r.mesh.material.emissiveIntensity=1.8*Math.max(0,1-r.t/2.2);if(r.t>2.2)r.mesh.position.y-=dt*.6;
    if(r.t>3.4){scene.remove(r.mesh);r.mesh.material.dispose();rocks.splice(i,1)}}
}
function addBurn(pos,r,life){const decal=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:scorchTex,transparent:true,depthWrite:false,opacity:.9}));
  decal.rotation.x=-Math.PI/2;decal.rotation.z=rand(0,TAU);decal.position.set(pos.x,.03+Math.random()*.01,pos.z);decal.scale.setScalar(r*2.4);scene.add(decal);
  const b={pos:new V3(pos.x,.4,pos.z),r,life,t:0,acc:{},tick:.25,decal,dead:false,ly:.3};b.light=attachLight(b,0xff6a24,1.6,r*3,false,.5);burns.push(b)}
function updateBurns(dt){for(let i=burns.length-1;i>=0;i--){const b=burns[i];b.t+=dt;const fade=1-ss(b.life-.6,b.life,b.t);
  if(b.t<b.life-.4)rate(b.acc,'f',22*b.r,dt,()=>{const a=rand(0,TAU),rr=Math.sqrt(Math.random())*b.r*.9;
    ADD.emit({x:b.pos.x+Math.cos(a)*rr,y:.2,z:b.pos.z+Math.sin(a)*rr,vx:rand(-.2,.2),vy:rand(1,2.2),vz:rand(-.2,.2),kind:0,fm:0,fps:24,life:rand(.4,.7),s0:rand(.5,1),s1:.15,r:1,g:.8,b:.6,a0:.95,a1:0,fadeIn:.15})});
  rate(b.acc,'e',8,dt,()=>ADD.emit({x:b.pos.x+rand(-b.r,b.r)*.7,y:.2,z:b.pos.z+rand(-b.r,b.r)*.7,vy:rand(.8,1.6),vx:rand(-.3,.3),vz:rand(-.3,.3),kind:3,fm:2,frame:8,life:rand(.8,1.2),s0:.12,s1:.03,r:1,g:.55,b:.2,a0:1,a1:0}));
  b.tick-=dt;if(b.tick<=0&&b.t<b.life){b.tick=.5;aoe(b.pos,b.r,7*fireMul(),'burn',0,'meteorBurn');const a=rand(0,TAU),rr=Math.random()*b.r;applyEl(cellOf(b.pos.x+Math.cos(a)*rr,b.pos.z+Math.sin(a)*rr),'fire')}
  b.decal.material.opacity=.9*fade;if(b.light&&b.light.owner===b)b.light.i0=1.6*fade;
  if(b.t>=b.life){b.dead=true;scene.remove(b.decal);egFree(b.decal);burns.splice(i,1)}}}

/* ---------- 血環（法陣＋八道血光） ---------- */
const rites=[];
function startBlood(){const c=player.pos.clone(),mat=runeMaterial(),mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),mat);
  mesh.rotation.x=-Math.PI/2;mesh.position.set(c.x,.05,c.z);mesh.scale.setScalar(.01);scene.add(mesh);
  const o={t:0,cs:castMul(),c,mesh,bolts:[],pos:new V3(c.x,.4,c.z),dead:false,acc:{}};o.light=attachLight(o,0xff1f35,2.6,8);rites.push(o);sfx.blood()}
function updateRites(dt){
  for(let i=rites.length-1;i>=0;i--){const o=rites[i];o.t+=dt*o.cs;const ts=o.t,R=spellP('blood'),q=R.duration/2.4;
    const op=ss(.12,.4,ts)*(1-ss(1.9*q,2.4*q,ts));setOpacity(o.mesh.material,op);o.mesh.scale.setScalar(.01+3.4*ss(.1,.5,ts));o.mesh.rotation.z+=dt*.7;
    if(o.light&&o.light.owner===o)o.light.i0=2.6*op+.01;
    if(ts>.2&&ts<1.8*q)rate(o.acc,'r',45,dt,()=>{const a=rand(0,TAU),r=rand(1.3,1.7);ADD.emit({x:o.c.x+Math.cos(a)*r,y:.1,z:o.c.z+Math.sin(a)*r,vy:rand(.8,2),kind:3,fm:2,frame:0,life:rand(.5,.9),s0:.22,s1:.05,r:1,g:.15,b:.22,a0:.9,a1:0})});
    if(ts>=.55&&!o.bolts.length){
      const chest=new V3(player.pos.x,1.4+player.float,player.pos.z);
      const targets=enemies.filter(e=>e.alive&&e.pos.distanceTo(chest)<R.seek).sort((a,b)=>a.pos.distanceTo(chest)-b.pos.distanceTo(chest)).slice(0,R.bolts);
      for(let k=0;k<R.bolts;k++){const b={ang:k/R.bolts*TAU,state:0,pos:chest.clone(),dead:false,acc:{},launchAt:.95+k*R.interval,target:targets.length?targets[k%targets.length]:null,t:0};
        ADD.emit({follow:b,kind:0,life:1e9,s0:.6,rs:4,fm:0,fps:30,r:1,g:.28,b:.33,a0:1,a1:1});
        ADD.emit({follow:b,kind:3,fm:2,frame:0,life:1e9,s0:1.4,r:1,g:.1,b:.15,a0:.55,a1:.55});o.bolts.push(b)}}
    for(const b of o.bolts){if(b.dead)continue;
      if(b.state===0){b.ang+=dt*7;const chest=new V3(player.pos.x,1.4+player.float,player.pos.z);
        b.pos.set(chest.x+Math.cos(b.ang)*1.15,chest.y+Math.sin(b.ang*2)*.18,chest.z+Math.sin(b.ang)*1.15);
        if(ts>=b.launchAt){b.state=1;b.from=b.pos.clone();const out=b.from.clone().sub(chest).setY(0).normalize();
          b.ctrl=b.from.clone().addScaledVector(out,3).add(new V3(0,2.2,0));
          if(!b.target){const a=player.face+rand(-.8,.8),r=rand(6,9);b.end=new V3(player.pos.x+Math.sin(a)*r,.8,player.pos.z+Math.cos(a)*r)}sfx.whoosh()}}
      else{b.t+=dt/.48;const end=b.target&&b.target.alive?new V3(b.target.pos.x,.9,b.target.pos.z):(b.end||(b.end=new V3(b.target.pos.x,.9,b.target.pos.z)));
        const t=Math.min(1,b.t),u=1-t;b.pos.set(u*u*b.from.x+2*u*t*b.ctrl.x+t*t*end.x,u*u*b.from.y+2*u*t*b.ctrl.y+t*t*end.y,u*u*b.from.z+2*u*t*b.ctrl.z+t*t*end.z);
        rate(b.acc,'t',140,dt,()=>ADD.emit({x:b.pos.x+rand(-.06,.06),y:b.pos.y,z:b.pos.z+rand(-.06,.06),kind:0,fm:0,fps:30,life:rand(.12,.18),s0:.48,s1:.05,r:1,g:.2,b:.26,a0:1,a1:.3}));
        if(t>=1){b.dead=true;explode(b.pos,.5,[1,.25,.32],false);sfx.boom(.45);
          terrainBlast(new V3(b.pos.x,0,b.pos.z),1.2,'blood');
          if(b.target&&b.target.alive)dealDamage(b.target,R.damage*spellMul(),'blood','blood');else aoe(b.pos,1.3,18*spellMul(),'blood',0,'blood')}}}
    if(ts>2.45*q&&o.bolts.every(b=>b.dead)){o.dead=true;scene.remove(o.mesh);egFree(o.mesh);rites.splice(i,1)}}
}

/* ---------- 裝備與行囊 ---------- */
const BASES=[
  {type:'staff',slot:'weapon',names:['灰燼法杖','枯骨長杖','餘火之杖'],w:1,h:4,pool:['fire','spell','cast']},
  {type:'helm',slot:'head',names:['舊墓盔','守夜者頭盔','燼紋兜帽'],w:2,h:2,pool:['hp','spell','cast']},
  {type:'armor',slot:'body',names:['裂紋胸甲','守墓人長袍','灰鱗護甲'],w:2,h:3,pool:['hp','fire','move']},
  {type:'gloves',slot:'hands',names:['焦痕手套','縫線護手'],w:2,h:2,pool:['cast','fire','spell']},
  {type:'boots',slot:'feet',names:['夜行靴','泥沼長靴'],w:2,h:2,pool:['move','hp','cast']},
  {type:'ring',slot:'ring',names:['燼環','骨戒','月石戒指'],w:1,h:1,pool:['cast','spell','fire']},
  {type:'amulet',slot:'neck',names:['墓光護符','餘燼墜飾'],w:1,h:1,pool:['spell','fire','hp']},
  {type:'lantern',slot:'light',names:['燼燈','守夜提燈','墓火燈籠'],w:1,h:2,pool:['spell','hp','move']}];
// 照明物的光圈半徑依稀有度（5、7、9、12），一般數值少一條
const LAMP_R=[5,7,9,12];
const RANGE={fire:[8,24],spell:[5,14],hp:[15,45],cast:[5,14],move:[4,11]};
const SLABEL={fire:'火焰傷害',spell:'法術傷害',hp:'生命上限',cast:'施法速度',move:'移動速度',light:'照明半徑'};
// m＝形狀標記：稀有度除了顏色也用形狀分辨（色弱也看得出來）
const RAR=[{n:'普通',k:1,mul:1,w:50,c:'#d9d2c3',m:'○'},{n:'魔法',k:2,mul:1.15,w:32,c:'#6fa8ff',m:'●'},{n:'稀有',k:3,mul:1.35,w:14,c:'#ffd54a',m:'▲'},{n:'傳奇',k:3,mul:1.8,w:4,c:'#ff8a2a',m:'◆'}];
const rarMark=r=>SET.lootShapes?r.m+' ':'';
const PREFIX=['焚夜','靜默','血月','灰燼王的','守墓人的','無名者的'];
const SLOTS=[{id:'weapon',n:'武器',tall:true},{id:'head',n:'頭部'},{id:'body',n:'身體',tall:true},{id:'neck',n:'頸部'},{id:'hands',n:'手部'},{id:'ring',n:'戒指'},{id:'feet',n:'腳部'},{id:'light',n:'照明'}];
const ICON={
  staff:'<svg viewBox="0 0 10 40"><line x1="5" y1="10" x2="5" y2="38" stroke="currentColor" stroke-width="2"/><path d="M5 1 L8.5 6 L5 11 L1.5 6Z" fill="currentColor"/></svg>',
  helm:'<svg viewBox="0 0 40 40"><path d="M6 27 Q6 6 20 6 Q34 6 34 27 L34 33 L26 33 L26 24 L14 24 L14 33 L6 33Z" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
  armor:'<svg viewBox="0 0 40 60"><path d="M8 8 L15 4 Q20 10 25 4 L32 8 L36 22 L30 24 L30 54 L10 54 L10 24 L4 22Z" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
  gloves:'<svg viewBox="0 0 40 40"><path d="M10 34 L10 14 L13 8 L16 14 L17 6 L20 6 L21 14 L23 7 L26 8 L26 16 L31 14 L32 18 L27 26 L27 34Z" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
  boots:'<svg viewBox="0 0 40 40"><path d="M12 5 L22 5 L22 24 L34 28 L34 34 L8 34 L8 26 L12 22Z" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
  ring:'<svg viewBox="0 0 20 20"><circle cx="10" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 2 L13 6 L10 8 L7 6Z" fill="currentColor"/></svg>',
  lantern:'<svg viewBox="0 0 20 40"><path d="M10 2 L10 7 M6 7 L14 7 L15 11 L15 31 L14 35 L6 35 L5 31 L5 11Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 15 Q13 20 10 27 Q7 20 10 15Z" fill="currentColor"/></svg>',
  amulet:'<svg viewBox="0 0 20 20"><path d="M3 2 L10 11 L17 2" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="10" cy="14" r="4.2" fill="currentColor"/></svg>'};
const COLS=10,ROWS=6,CELL=34;
const inv=[],equipped={};
function makeItem(force,base){const b=base||pick(BASES);let w=Math.random()*100,r=RAR[0];for(const x of RAR){if(w<x.w){r=x;break}w-=x.w}if(force!=null)r=RAR[force];
  const lamp=b.slot==='light',keys=egPool(b.pool).sort(()=>Math.random()-.5).slice(0,lamp?r.k-1:r.k),st={};for(const k of keys)st[k]=Math.round(rand(...RANGE[k])*r.mul);
  if(lamp)st.light=LAMP_R[RAR.indexOf(r)];
  const name=(r.k>=3?pick(egPrefixes()):'')+pick(egBaseNames(b));return {id:Math.random().toString(36).slice(2),base:b,type:b.type,slot:b.slot,w:b.w,h:b.h,rar:r,st,name}}
function fits(x,y,w,h,skip){if(x<0||y<0||x+w>COLS||y+h>ROWS)return false;for(const it of inv){if(it===skip)continue;if(x<it.x+it.w&&x+w>it.x&&y<it.y+it.h&&y+h>it.y)return false}return true}
function place(it){for(let y=0;y<=ROWS-it.h;y++)for(let x=0;x<=COLS-it.w;x++)if(fits(x,y,it.w,it.h)){it.x=x;it.y=y;inv.push(it);return true}return false}
function recalc(){for(const k in stats)stats[k]=0;for(const s in equipped){const it=equipped[s];if(it)for(const k in it.st)stats[k]+=it.st[k]}
  const ratio=player.hp/player.maxhp;player.maxhp=100+stats.hp;player.hp=Math.max(1,player.maxhp*ratio);renderInv()}
function renderInv(){
  const grid=$('#grid');grid.style.width=COLS*CELL+'px';grid.style.height=ROWS*CELL+'px';grid.innerHTML='';
  for(const it of inv){const d=document.createElement('div');d.className='it';d.style.cssText=`left:${it.x*CELL}px;top:${it.y*CELL}px;width:${it.w*CELL}px;height:${it.h*CELL}px;border-color:${it.rar.c};color:${it.rar.c}`;
    d.innerHTML=ICON[it.type]+(SET.lootShapes?`<span class="rmark">${it.rar.m}</span>`:'');d.onclick=()=>equip(it);d.oncontextmenu=e=>{e.preventDefault();inv.splice(inv.indexOf(it),1);hideTip();renderInv();note('丟掉了 '+it.name)};
    d.onmousemove=e=>showTip(it,e);d.onmouseleave=hideTip;grid.appendChild(d)}
  const eq=$('#equip');eq.innerHTML='';
  for(const s of SLOTS){const d=document.createElement('div');d.className='slot'+(s.tall?' tall':'');const it=equipped[s.id];
    if(it){d.style.borderStyle='solid';d.style.borderColor=it.rar.c;d.style.color=it.rar.c;d.innerHTML=ICON[it.type];d.onclick=()=>unequip(s.id);d.onmousemove=e=>showTip(it,e,true);d.onmouseleave=hideTip}
    else d.textContent=s.n;eq.appendChild(d)}
  const f=v=>v?'+'+v+'%':'—';
  $('#sheet').innerHTML=`<h4>角色數值</h4><div>生命上限<span class="v">${Math.round(player.maxhp)}</span></div><div>火焰傷害<span class="v">${f(stats.fire)}</span></div><div>法術傷害<span class="v">${f(stats.spell)}</span></div><div>施法速度<span class="v">${f(stats.cast)}</span></div><div>移動速度<span class="v">${f(stats.move)}</span></div><div>照明半徑<span class="v">${stats.light?stats.light+' 公尺':'—'}</span></div><div>焰核彈單發<span class="v">${Math.round(34*fireMul())}</span></div><div>星墜單顆<span class="v">${Math.round(60*fireMul())}</span></div>`}
function equip(it){const old=equipped[it.slot];inv.splice(inv.indexOf(it),1);equipped[it.slot]=it;
  if(old&&!place(old)){equipped[it.slot]=old;inv.push(it);note('行囊放不下換下來的裝備');renderInv();return}
  hideTip();sfx.pick();recalc()}
function unequip(slot){const it=equipped[slot];if(!it)return;if(!place(it)){note('行囊滿了');return}delete equipped[slot];hideTip();recalc()}
function showTip(it,e,eq){const t=$('#tip');t.hidden=false;
  t.innerHTML=`<div class="t" style="color:${it.rar.c}">${rarMark(it.rar)}${it.name}</div><div class="r">${it.rar.n}・${SLOTS.find(s=>s.id===it.slot).n}・占 ${it.w}×${it.h} 格</div>`+
    Object.entries(it.st).map(([k,v])=>`<div>${SLABEL[k]} ${k==='light'?v+' 公尺':'+'+v+(k==='hp'?'':'%')}</div>`).join('')+`<div class="r">${eq?'左鍵卸下':'左鍵穿上・右鍵丟掉'}</div>`;
  t.style.left=Math.min(e.clientX+14,innerWidth-200)+'px';t.style.top=Math.min(e.clientY+14,innerHeight-160)+'px'}
function hideTip(){$('#tip').hidden=true}

const loots=[];
const lootGeo={staff:new THREE.CylinderGeometry(.05,.05,1.5,6),helm:new THREE.SphereGeometry(.34,12,8,0,TAU,0,Math.PI/2),armor:new THREE.BoxGeometry(.6,.7,.28),
  gloves:new THREE.BoxGeometry(.22,.3,.14),boots:new THREE.BoxGeometry(.24,.34,.4),ring:new THREE.TorusGeometry(.2,.06,8,16),lantern:new THREE.CylinderGeometry(.16,.2,.42,8),amulet:new THREE.TorusGeometry(.17,.04,6,16)};
const beamGeo=new THREE.CylinderGeometry(.05,.24,3.6,10,1,true);
function dropLoot(pos,force){const it=makeItem(force),g=new THREE.Group(),col=new THREE.Color(it.rar.c);
  const m=new THREE.Mesh(lootGeo[it.type],new THREE.MeshLambertMaterial({color:col,emissive:col.clone().multiplyScalar(.35)}));
  if(it.type==='staff')m.rotation.z=1.1;if(it.type==='gloves'||it.type==='boots'){const m2=m.clone();m2.position.x=.3;g.add(m2)}g.add(m);
  const beam=new THREE.Mesh(beamGeo,new THREE.MeshBasicMaterial({map:beamTex,color:col,transparent:true,opacity:it.rar.k===1?.18:it.rar.n==='傳奇'?.75:.45,blending:THREE.AdditiveBlending,depthWrite:false}));
  beam.position.y=1.6;g.add(beam);g.position.set(pos.x+rand(-.4,.4),.4,pos.z+rand(-.4,.4));scene.add(g);
  const el=document.createElement('div');el.className='lootl';el.style.color=it.rar.c;el.textContent=rarMark(it.rar)+it.name;el.style.display='none';fxLayer.appendChild(el);
  loots.push({it,g,m,el,t:0});for(let i=0;i<10;i++){const d=randUnit();ADD.emit({x:g.position.x,y:.5,z:g.position.z,vx:d.x*2,vy:Math.abs(d.y)*3,vz:d.z*2,kind:3,fm:2,frame:8,life:.6,s0:.2,s1:.04,grav:6,r:col.r,g:col.g,b:col.b,a0:1,a1:0})}}
let fullNoteT=0;
function updateLoot(dt){fullNoteT-=dt;
  for(let i=loots.length-1;i>=0;i--){const L=loots[i];L.t+=dt;L.m.rotation.y+=dt*1.5;L.g.position.y=.4+Math.sin(L.t*3)*.08;
    const [x,y,ok]=toScreen(tv.set(L.g.position.x,1.1,L.g.position.z));L.el.style.transform=`translate(${x}px,${y}px) translate(-50%,-100%)`;L.el.style.display=ok?'block':'none';
    if(player.alive&&Math.hypot(L.g.position.x-player.pos.x,L.g.position.z-player.pos.z)<1.3){
      if(place(L.it)){pickups++;scene.remove(L.g);egFreeMat(L.g);L.el.remove();loots.splice(i,1);note('撿到 '+L.it.name+'（按 I 穿上）');sfx.pick();if(!$('#inv').hidden)renderInv()}
      else if(fullNoteT<=0){fullNoteT=2;note('行囊滿了，按 I 整理或丟掉')}}}}

