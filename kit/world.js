// 世界：地面與擺設、地形網格與自動演變、可破壞物、法陣材質、主角
// 依序載入的一般 script，頂層名稱在檔案之間共用（見 core.js）。
'use strict';
/* ---------- 地面與擺設 ---------- */
// 地面要切細：Lambert 只在頂點算光，只有四個角時點光源照不亮地面（DEVLOG #54）
const ground=new THREE.Mesh(new THREE.PlaneGeometry(140,140,70,70),new THREE.MeshLambertMaterial({map:groundTex}));
ground.rotation.x=-Math.PI/2;scene.add(ground);
const obstacles=[];
const stoneMat=new THREE.MeshLambertMaterial({color:0x5c606a}),stoneMat2=new THREE.MeshLambertMaterial({color:0x474a52});
const barkMat=new THREE.MeshLambertMaterial({color:0x2a211b});
function freeSpot(minR,maxR){for(let k=0;k<40;k++){const a=rand(0,TAU),r=rand(minR,maxR),x=Math.cos(a)*r,z=Math.sin(a)*r;
  if(obstacles.every(o=>Math.hypot(o.x-x,o.z-z)>o.r+1.6))return [x,z]}return [rand(-30,30),rand(-30,30)]}
// 四座燈塔先佔位，墓碑與枯樹不會生在塔邊；擺完再縮回塔身大小
// 世界擺設用固定種子：每次載入位置相同（測試可重現）
function mulberry32(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const _sysRandom=Math.random;Math.random=mulberry32(20261115);
const TOWER_POS=CONTENT.towerPos;
const towerObs=TOWER_POS.map(([x,z])=>{const o={x,z,r:3};obstacles.push(o);return o});
// 可破壞物：墓碑（壓怪）、枯樹（燒倒）、鐵柵欄（撞斷）、石棺（放出怪物）
const props=[];
function addProp(p){p.q0=p.g?p.g.quaternion.clone():null;p.pos0=p.g?p.g.position.clone():null;p.state='up';p.t=0;p.hp=p.hp0;if(p.ob)p.ob.r0=p.ob.r;props.push(p);return p}
for(let i=0;i<46;i++){const [x,z]=freeSpot(5,40),g=new THREE.Group(),m=Math.random()<.5?stoneMat:stoneMat2,s=rand(.8,1.25);let h;
  if(Math.random()<.75){const b=new THREE.Mesh(new THREE.BoxGeometry(.9,1,.24),m);b.position.y=.5;g.add(b);h=1.45;
    const t=new THREE.Mesh(new THREE.CylinderGeometry(.45,.45,.24,14,1,false,0,Math.PI),m);t.rotation.set(Math.PI/2,0,Math.PI/2);t.position.y=1;g.add(t)}
  else{const a=new THREE.Mesh(new THREE.BoxGeometry(.2,1.7,.2),m);a.position.y=.85;g.add(a);const b=new THREE.Mesh(new THREE.BoxGeometry(.9,.2,.2),m);b.position.y=1.25;g.add(b);h=1.7}
  g.position.set(x,0,z);g.rotation.set(rand(-.12,.12),rand(0,TAU),rand(-.15,.15));g.scale.setScalar(s);scene.add(g);
  const ob={x,z,r:.55*s};obstacles.push(ob);addProp({kind:'tomb',g,x,z,ob,hp0:3,len:h*s})}
for(let i=0;i<12;i++){const [x,z]=freeSpot(8,40),g=new THREE.Group(),h=rand(2.6,4),bm=barkMat.clone();
  const tr=new THREE.Mesh(new THREE.CylinderGeometry(.12,.3,h,7),bm);tr.position.y=h/2;g.add(tr);
  for(let j=0;j<5;j++){const L=rand(.8,1.8),b=new THREE.Mesh(new THREE.CylinderGeometry(.03,.09,L,5),bm);const p=new THREE.Group();
    p.position.y=rand(h*.45,h*.95);p.rotation.set(rand(.5,1.1),rand(0,TAU),0);b.position.y=L/2;p.add(b);g.add(p)}
  g.position.set(x,0,z);g.rotation.y=rand(0,TAU);scene.add(g);const ob={x,z,r:.45};obstacles.push(ob);addProp({kind:'tree',g,x,z,ob,hp0:1,len:h,mat:bm,burn:0,acc:{}})}
const FENCE_N=140,fenceMat=new THREE.MeshLambertMaterial({color:0x1c1d22});
const fencePosts=new THREE.InstancedMesh(new THREE.BoxGeometry(.12,1.6,.12),fenceMat,FENCE_N),fenceRails=new THREE.InstancedMesh(new THREE.BoxGeometry(1,.07,.07),fenceMat,FENCE_N*2);
fencePosts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);fenceRails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
function setFence(i,up){const o=new THREE.Object3D(),a=i/FENCE_N*TAU,am=(i+.5)/FENCE_N*TAU,seg=2*Math.PI*44/FENCE_N;
  o.position.set(Math.cos(a)*44,.8,Math.sin(a)*44);o.rotation.set(0,-a,0);o.scale.setScalar(up?1:.0001);o.updateMatrix();fencePosts.setMatrixAt(i,o.matrix);
  for(let k=0;k<2;k++){o.position.set(Math.cos(am)*44,k?1.3:.55,Math.sin(am)*44);o.rotation.set(0,-am+Math.PI/2,0);o.scale.set(up?seg:.0001,1,1);o.updateMatrix();fenceRails.setMatrixAt(i*2+k,o.matrix)}
  fencePosts.instanceMatrix.needsUpdate=true;fenceRails.instanceMatrix.needsUpdate=true}
for(let i=0;i<FENCE_N;i++){setFence(i,true);const am=(i+.5)/FENCE_N*TAU;addProp({kind:'fence',idx:i,x:Math.cos(am)*44,z:Math.sin(am)*44,hp0:2})}
scene.add(fencePosts);scene.add(fenceRails);
for(let i=0;i<6;i++){const [x,z]=freeSpot(9,36),g=new THREE.Group(),base=new THREE.Mesh(new THREE.BoxGeometry(1,.6,2),stoneMat2);base.position.y=.3;g.add(base);
  const lid=new THREE.Mesh(new THREE.BoxGeometry(1.12,.16,2.12),stoneMat);lid.position.y=.68;g.add(lid);
  const rune=new THREE.Mesh(new THREE.BoxGeometry(.5,.02,.08),new THREE.MeshBasicMaterial({color:0x6fd8ff}));rune.position.y=.77;lid.add(rune);rune.position.y=.09;
  g.position.set(x,0,z);g.rotation.y=rand(0,TAU);scene.add(g);const ob={x,z,r:.95};obstacles.push(ob);addProp({kind:'sarc',g,x,z,ob,hp0:4,lid,lid0:lid.position.clone()})}
{const mush=new THREE.MeshBasicMaterial({color:0x4fd8c0});for(let i=0;i<70;i++){const [x,z]=freeSpot(3,42);const m=new THREE.Mesh(new THREE.SphereGeometry(rand(.05,.11),6,4),mush);m.position.set(x,.05,z);scene.add(m)}}
towerObs.forEach(o=>o.r=1.1);
Math.random=_sysRandom;  // 擺設完成，戰鬥中的亂數恢復正常

/* ---------- 地形網格：每格 1 單位，88×88 格涵蓋整座墓園（參考 The-Waste-Land 的地形破壞＋地形殺） ---------- */
const GN=88,GH=44,TPX=8;  // 格數、半寬、每格在貼圖上幾像素
const TER={GRASS:0,SOIL:1,PAVE:2,WATER:3,MUD:4,FIRE:5,ASH:6,LAVA:7,CRATER:8,OBSID:9,SHOCK:10,BLOOD:11,WISP:12,BONE:13,STEAM:14};
// ed／pd 每秒對怪／玩家傷害，em／pm 移動倍率，col 地面色，glow 發光色
const TP=[
  {n:'枯草',col:[86,92,52,170],flam:1},
  {n:'墓土',col:[0,0,0,0]},
  {n:'石板路',col:[70,70,76,150],pm:1.1},
  {n:'積水',col:[22,36,52,175],em:.55,pm:.8},
  {n:'泥沼',col:[58,44,30,210],em:.45,pm:.85},
  {n:'火焰',col:[60,26,10,220],ed:18,glow:[255,110,30]},
  {n:'灰燼',col:[44,42,40,220]},
  {n:'熔岩',col:[90,30,8,240],ed:30,pd:12,em:.6,pm:.75,glow:[255,120,30]},
  {n:'坑洞',col:[30,24,20,220],ed:6,em:.7},
  {n:'黑曜石',col:[24,18,34,250],solid:1},
  {n:'帶電水',col:[50,80,110,210],ed:26,em:.5,pm:.8,glow:[120,200,255]},
  {n:'血沼',col:[80,10,18,215],ed:10,em:.5,glow:[90,6,14]},
  {n:'磷火墳',col:[40,60,70,220],glow:[60,170,220]},
  {n:'骨堆',col:[168,160,140,200],flam:1},
  {n:'蒸氣',col:[70,74,78,180],ed:10,em:.9}];
const TT=new Uint8Array(GN*GN),TM=new Float32Array(GN*GN),THP=new Uint8Array(GN*GN);
const cellOf=(x,z)=>{const gx=Math.floor(x+GH),gz=Math.floor(z+GH);return gx<0||gz<0||gx>=GN||gz>=GN?-1:gz*GN+gx};
const cellCenter=i=>new V3(i%GN-GH+.5,0,Math.floor(i/GN)-GH+.5);
const isFlam=t=>t===TER.GRASS||t===TER.BONE;
const isGround=t=>t===TER.GRASS||t===TER.SOIL||t===TER.ASH||t===TER.MUD||t===TER.BONE||t===TER.CRATER;
const tileAt=(x,z)=>{const i=cellOf(x,z);return i<0?TER.SOIL:TT[i]};
const spreadP=nt=>nt===TER.BONE?.12:.08;  // 每 0.2 秒、每個鄰格的延燒機率：草約 2.5 秒燒過一格
function distSeg(px,pz,ax,az,bx,bz){const dx=bx-ax,dz=bz-az,t=clamp(((px-ax)*dx+(pz-az)*dz)/(dx*dx+dz*dz),0,1);return Math.hypot(px-ax-dx*t,pz-az-dz*t)}
// 固定種子的初始地圖：枯草叢、積水、泥沼、通往四塔的石板路、骨堆、磷火墳
function genTerrain(){
  for(let gz=0;gz<GN;gz++)for(let gx=0;gx<GN;gx++){const x=gx-GH+.5,z=gz-GH+.5,i=gz*GN+gx,r=Math.hypot(x,z);let t=TER.SOIL;
    const n1=vnoise(x*.13+3.1,z*.13+7.7),n2=vnoise(x*.085+40.2,z*.085-11.3);
    if(n1>.58)t=TER.GRASS;
    if(n2>.74)t=TER.MUD;if(n2>.79)t=TER.WATER;
    if(h2(gx*7+3,gz*13+1)<.014)t=TER.BONE;
    if(r>8&&h2(gx*3+11,gz*5+2)<.006)t=TER.WISP;
    if(Math.abs(r-9)<.6||TOWER_POS.some(([tx,tz])=>distSeg(x,z,0,0,tx,tz)<.8||Math.hypot(x-tx,z-tz)<2.2))t=TER.PAVE;
    if(r>43)t=TER.SOIL;
    TT[i]=t;TM[i]=0;THP[i]=0}}
genTerrain();const TT0=TT.slice();
// 兩張地面貼圖：受光的地面色，加疊發光（火、熔岩、電水、血沼、磷火）
const TW=GN*TPX,tData=new Uint8Array(TW*TW*4),gData=new Uint8Array(TW*TW*4);
const tTex=new THREE.DataTexture(tData,TW,TW,THREE.RGBAFormat),gTex=new THREE.DataTexture(gData,TW,TW,THREE.RGBAFormat);
for(const tx of [tTex,gTex]){tx.magFilter=THREE.LinearFilter;tx.minFilter=THREE.LinearFilter;tx.generateMipmaps=false}
// 柔和邊緣：像素先用低頻雜訊抖動取樣位置，交界因此成為不規則的鋸齒。
// 抖動小於一格，一格改變只影響周圍 3×3；結果只跟像素位置有關，開頁時算成一張表。
function tnoise(x,y){const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy),
  a=h2(ix,iy),b=h2(ix+1,iy),c=h2(ix,iy+1),d=h2(ix+1,iy+1);return a+(b-a)*sx+(c-a)*sy+(a-b-c+d)*sx*sy}
const NBC=new Uint8Array(TW*TW),JB=new Uint8Array(TW*TW),JG=new Uint8Array(TW*TW);
for(let Y=0;Y<TW;Y++)for(let X=0;X<TW;X++){const q=Y*TW+X,px=X%TPX,py=Y%TPX,
  jx=(tnoise(X*.3,Y*.3)-.5)*1.15+(h2(X+311,Y)-.5)*.3,jz=(tnoise(X*.3+57,Y*.3+91)-.5)*1.15+(h2(X,Y+733)-.5)*.3,
  ux=(px+.5)/TPX+Math.max(-.95,Math.min(.95,jx)),uz=1-(py+.5)/TPX+Math.max(-.95,Math.min(.95,jz));
  NBC[q]=(Math.floor(uz)+1)*3+Math.floor(ux)+1;JB[q]=255*h2(X,Y);JG[q]=255*h2(X+977,Y)}
const NBX=[-1,0,1,-1,0,1,-1,0,1],NBZ=[-1,-1,-1,0,0,0,1,1,1];
function paintPx(i){const gx=i%GN,gz=(i/GN)|0,px0=gx*TPX,py0=(GN-1-gz)*TPX;
  for(let py=0;py<TPX;py++)for(let px=0;px<TPX;px++){const q=(py0+py)*TW+px0+px,k=q*4,n=NBC[q],sx=gx+NBX[n],sz=gz+NBZ[n],
    t=TT[sx<0||sz<0||sx>=GN||sz>=GN?i:sz*GN+sx],c=TP[t].col,g=TP[t].glow,j=.82+.36*JB[q]/255;
    tData[k]=c[0]*j;tData[k+1]=c[1]*j;tData[k+2]=c[2]*j;tData[k+3]=c[3];
    if(g){const gj=.7+.6*JG[q]/255;gData[k]=Math.min(255,g[0]*gj);gData[k+1]=Math.min(255,g[1]*gj);gData[k+2]=Math.min(255,g[2]*gj);gData[k+3]=255}
    else{gData[k]=gData[k+1]=gData[k+2]=gData[k+3]=0}}}
// 改一格先記下，畫面更新時一起重畫（含周圍 3×3），只送變動的橫條
const tDirty=new Uint8Array(GN*GN),tDirtyList=[];let terrFull=true;
const terrStats={full:0,partial:0,strips:0,px:0};
function paintCell(i){const gx=i%GN,gz=(i/GN)|0;
  for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){const x=gx+dx,z=gz+dz;if(x<0||z<0||x>=GN||z>=GN)continue;const j=z*GN+x;if(!tDirty[j]){tDirty[j]=1;tDirtyList.push(j)}}}
for(let i=0;i<GN*GN;i++)paintCell(i);
const terrMat=new THREE.MeshLambertMaterial({map:tTex,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});
const glowMat=new THREE.MeshBasicMaterial({map:gTex,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,polygonOffset:true,polygonOffsetFactor:-2});
for(const [m,y] of [[terrMat,.015],[glowMat,.025]]){const p=new THREE.Mesh(new THREE.PlaneGeometry(GN,GN,GN,GN),m);p.rotation.x=-Math.PI/2;p.position.y=y;p.renderOrder=1;scene.add(p)}
function setT(i,t,tm){if(i<0)return;TT[i]=t;TM[i]=tm||0;if(t===TER.OBSID)THP[i]=3;paintCell(i)}

// 招式改地形
const booms=[];
function queueBoom(i,delay=.05){if(TT[i]!==TER.WISP)return;TT[i]=TER.FIRE;TM[i]=.4;paintCell(i);booms.push({i,t:delay})}
function electrify(i){const q=[i],seen=new Set();let n=0;
  while(q.length&&n<140){const c=q.shift();if(seen.has(c))continue;seen.add(c);const t=TT[c];if(t!==TER.WATER&&t!==TER.SHOCK)continue;setT(c,TER.SHOCK,1.4);n++;
    const gx=c%GN,gz=Math.floor(c/GN);if(gx>0)q.push(c-1);if(gx<GN-1)q.push(c+1);if(gz>0)q.push(c-GN);if(gz<GN-1)q.push(c+GN)}}
function applyEl(i,el){if(i<0)return;const t=TT[i];
  if(el==='fire'){if(t===TER.GRASS)setT(i,TER.FIRE,rand(3,5));else if(t===TER.BONE)setT(i,TER.FIRE,rand(6,8));else if(t===TER.WATER||t===TER.SHOCK)setT(i,TER.STEAM,rand(2,3));else if(t===TER.MUD)setT(i,TER.SOIL);else if(t===TER.WISP)queueBoom(i)}
  else if(el==='bolt'){if(t===TER.WATER||t===TER.SHOCK)electrify(i);else if(t===TER.GRASS&&Math.random()<.3)setT(i,TER.FIRE,3);else if(t===TER.WISP)queueBoom(i)}
  else if(el==='meteor'){if(t===TER.OBSID){if(--THP[i]<=0)setT(i,TER.CRATER)}else if(t===TER.WATER||t===TER.SHOCK)setT(i,TER.STEAM,2.5);else if(t===TER.PAVE)setT(i,TER.CRATER);else if(t===TER.WISP)queueBoom(i);else if(isGround(t)||t===TER.FIRE||t===TER.BLOOD)setT(i,TER.LAVA,rand(20,28))}
  else if(el==='crater'){if(isFlam(t))setT(i,TER.FIRE,rand(3,5));else if(t===TER.PAVE||t===TER.SOIL||t===TER.ASH||t===TER.MUD)setT(i,TER.CRATER);else if(t===TER.WATER)setT(i,TER.STEAM,2.5);else if(t===TER.WISP)queueBoom(i)}
  else if(el==='blood'){if(isGround(t)||t===TER.PAVE)setT(i,TER.BLOOD,rand(7,9));else if(t===TER.FIRE)setT(i,TER.ASH)}}
function cellsIn(pos,r,fn){const gx0=Math.floor(pos.x+GH-r),gx1=Math.floor(pos.x+GH+r),gz0=Math.floor(pos.z+GH-r),gz1=Math.floor(pos.z+GH+r);
  for(let gz=Math.max(0,gz0);gz<=Math.min(GN-1,gz1);gz++)for(let gx=Math.max(0,gx0);gx<=Math.min(GN-1,gx1);gx++){const d=Math.hypot(gx-GH+.5-pos.x,gz-GH+.5-pos.z);if(d<=r)fn(gz*GN+gx,d)}}
function terrainBlast(pos,r,el){cellsIn(pos,r,i=>applyEl(i,el))}
function meteorTerrain(pos,r){cellsIn(pos,r,(i,d)=>applyEl(i,d<r*.45?'meteor':'crater'))}
function boom(i){const p=cellCenter(i);TT[i]=TER.CRATER;TM[i]=0;paintCell(i);
  if(running){for(const e of enemies){if(e.alive&&Math.hypot(e.pos.x-p.x,e.pos.z-p.z)<2+e.radius*.5)dealDamage(e,40,'boom')}
    if(player.alive&&Math.hypot(player.pos.x-p.x,player.pos.z-p.z)<1.2)hurtPlayer(8,EG_TERM.gas)}
  cellsIn(p,2,(c,d)=>{const t=TT[c];if(t===TER.WISP)queueBoom(c,.1+Math.random()*.12);else if(isFlam(t))setT(c,TER.FIRE,rand(3,5));else if(t===TER.WATER)setT(c,TER.STEAM,2.5);else if(t===TER.OBSID){if(--THP[c]<=0)setT(c,TER.CRATER)}else if(d<1.1&&(t===TER.SOIL||t===TER.ASH))setT(c,TER.CRATER)});
  damageProps(p,2,2,'boom');explode(new V3(p.x,.5,p.z),.9,[.55,.9,1],false);sfx.boom(.7)}

// 自動演變：每 0.2 秒掃玩家附近 24 格（細胞自動機）
let caAcc=0;const hot=[],NB=[[1,0],[-1,0],[0,1],[0,-1]];
function automata(dt){const cx=Math.floor(player.pos.x+GH),cz=Math.floor(player.pos.z+GH),R=24,ch=[],dec=[];hot.length=0;
  for(let gz=Math.max(0,cz-R);gz<=Math.min(GN-1,cz+R);gz++)for(let gx=Math.max(0,cx-R);gx<=Math.min(GN-1,cx+R);gx++){const i=gz*GN+gx,t=TT[i];
    if(t===TER.SOIL||t===TER.GRASS||t===TER.PAVE||t===TER.MUD||t===TER.BONE)continue;
    if(t===TER.FIRE){TM[i]-=dt;hot.push(i);if(TM[i]<=0){ch.push(i,TER.ASH,0);continue}
      for(const [dx,dz] of NB){const nx=gx+dx,nz=gz+dz;if(nx<0||nz<0||nx>=GN||nz>=GN)continue;const n=nz*GN+nx,nt=TT[n];
        if(isFlam(nt)){if(Math.random()<spreadP(nt))ch.push(n,TER.FIRE,nt===TER.BONE?7:4)}else if(nt===TER.WISP){if(Math.random()<.25)ch.push(n,-1,0)}}}
    else if(t===TER.LAVA){TM[i]-=dt;hot.push(i);if(TM[i]<=0){ch.push(i,TER.OBSID,0);continue}
      for(const [dx,dz] of NB){const nx=gx+dx,nz=gz+dz;if(nx<0||nz<0||nx>=GN||nz>=GN)continue;const n=nz*GN+nx,nt=TT[n];
        if(nt===TER.WATER||nt===TER.SHOCK){if(Math.random()<.25){ch.push(n,TER.STEAM,3);ch.push(i,TER.OBSID,0)}}
        else if(nt===TER.CRATER){if(Math.random()<.12)ch.push(n,TER.LAVA,Math.max(6,TM[i]*.85))}
        else if(isFlam(nt)){if(Math.random()<.01)ch.push(n,TER.FIRE,4)}}}
    else if(t===TER.WATER){for(const [dx,dz] of NB){const nx=gx+dx,nz=gz+dz;if(nx<0||nz<0||nx>=GN||nz>=GN)continue;const n=nz*GN+nx;if(TT[n]===TER.CRATER&&Math.random()<.15)ch.push(n,TER.WATER,0)}}
    else if(t===TER.STEAM){TM[i]-=dt;hot.push(i);if(TM[i]<=0)ch.push(i,TER.CRATER,0)}
    else if(t===TER.SHOCK){TM[i]-=dt;hot.push(i);if(TM[i]<=0)ch.push(i,TER.WATER,0)}
    else if(t===TER.BLOOD){TM[i]-=dt;hot.push(i);if(TM[i]<=0)ch.push(i,TER.SOIL,0)}
    else if(t===TER.WISP)hot.push(i);
    else if(t===TER.ASH){if(Math.random()<.002)dec.push(i,TER.SOIL,0)}
    else if(t===TER.CRATER){if(Math.random()<.0005)dec.push(i,TER.SOIL,0)}}
  // 慢慢回填的衰退變化優先度最低：先套用，同一輪的流動、燃燒再蓋過去
  for(let k=0;k<dec.length;k+=3)setT(dec[k],dec[k+1],0);
  for(let k=0;k<ch.length;k+=3){const i=ch[k],nt=ch[k+1];if(nt===-1){if(TT[i]===TER.WISP)queueBoom(i)}else if(TT[i]!==nt||nt===TER.LAVA)setT(i,nt,ch[k+2])}}
function emitHot(dt){if(!hot.length)return;rate(emitHot,'acc',Math.min(260,hot.length*4),dt,()=>{const i=hot[Math.floor(Math.random()*hot.length)],t=TT[i],p=cellCenter(i);p.x+=rand(-.45,.45);p.z+=rand(-.45,.45);
  if(t===TER.FIRE)ADD.emit({x:p.x,y:.25,z:p.z,vx:rand(-.2,.2),vy:rand(1,2.2),vz:rand(-.2,.2),kind:0,fm:0,fps:24,life:rand(.4,.7),s0:rand(.5,.9),s1:.12,r:1,g:.8,b:.6,a0:.95,a1:0,fadeIn:.15});
  else if(t===TER.LAVA){if(Math.random()<.5)ADD.emit({x:p.x,y:.12,z:p.z,vy:rand(.6,1.6),vx:rand(-.3,.3),vz:rand(-.3,.3),kind:3,fm:2,frame:8,life:rand(.6,1),s0:.14,s1:.03,r:1,g:.55,b:.2,a0:1,a1:0});
    else ADD.emit({x:p.x,y:.1,z:p.z,vy:rand(.3,.8),kind:0,fm:0,fps:20,life:rand(.4,.6),s0:.55,s1:.1,r:1,g:.6,b:.3,a0:.7,a1:0})}
  else if(t===TER.SHOCK){if(Math.random()<.4){const q=p.clone();q.y=.05;bolt(q,q.clone().add(new V3(rand(-.6,.6),rand(.1,.5),rand(-.6,.6))),.12,.08,false)}}
  else if(t===TER.STEAM)SMOKE.emit({x:p.x,y:.2,z:p.z,vy:rand(.8,1.6),vx:rand(-.2,.2),vz:rand(-.2,.2),kind:2,fm:1,life:rand(1,1.6),s0:.8,s1:2,r:.8,g:.82,b:.85,a0:.35,a1:0,fadeIn:.2});
  else if(t===TER.WISP){if(Math.random()<.35)ADD.emit({x:p.x,y:rand(.3,1.2),z:p.z,vy:rand(.2,.5),vx:rand(-.2,.2),vz:rand(-.2,.2),kind:3,fm:2,frame:0,life:rand(1,1.8),s0:.3,s1:.1,r:.4,g:.85,b:1,a0:.8,a1:0,fadeIn:.3})}
  else if(t===TER.BLOOD){if(Math.random()<.25)ADD.emit({x:p.x,y:.08,z:p.z,vy:rand(.2,.5),kind:3,fm:2,frame:0,life:.6,s0:.16,s1:.03,r:.8,g:.08,b:.12,a0:.8,a1:0})}})}

// 地形殺與地形連鎖
let terrainKills=0,chainN=0,chainT=-9;
const isTerrainKind=k=>k==='terrain'||k==='crush'||k==='boom';
function onTerrainKill(e){terrainKills++;if(Math.random()<.6)dropLoot(e.pos);
  chainN=time-chainT<1.2?chainN+1:1;chainT=time;if(story.on)story.bestChain=Math.max(story.bestChain||0,chainN);
  if(chainN>=2){const el=$('#chainTag');el.textContent=`地形連鎖 ×${chainN}`;el.style.color=chainN>=8?'#ff5a7a':chainN>=4?'#ffe066':'#ffb35c';el.hidden=false;
    el.classList.remove('pop');void el.offsetWidth;el.classList.add('pop');tone(440*Math.pow(1.06,Math.min(chainN,20)),440*Math.pow(1.06,Math.min(chainN,20))*1.5,.14,'triangle',.12)}}
function terrainEffects(e,dt){
  if(e.type==='lord'){const t=tileAt(e.pos.x,e.pos.z);const m=t===TER.LAVA?4:t===TER.FIRE?2:0;if(m){e.tacc=(e.tacc||0)+TP[t].ed*m*dt;if(e.tacc>=12){const a=e.tacc;e.tacc=0;dealDamage(e,a,'terrain')}}return 1}
  if(e.T.float)return 1;
  const tp=TP[tileAt(e.pos.x,e.pos.z)];
  if(tp.ed){e.tacc=(e.tacc||0)+tp.ed*dt;if(e.tacc>=6||e.tacc>=e.hp){const a=e.tacc;e.tacc=0;dealDamage(e,a,'terrain')}}
  return tp.em||1}

// 可破壞物：受擊、倒下、壓怪
function damageProps(pos,r,dmg,src){for(const p of props){if(p.state!=='up')continue;const d=Math.hypot(p.x-pos.x,p.z-pos.z);if(d>r+.6)continue;
  if(p.kind==='tree'){if(src==='fire'||src==='meteor'||src==='boom')igniteTree(p);continue}
  p.hp-=dmg;if(p.hp<=0)breakProp(p,pos)}}
function igniteTree(p){if(p.state!=='up')return;p.state='burning';p.t=6;p.src=null}
function breakProp(p,src){p.hp=0;const away=new V3(p.x-src.x,0,p.z-src.z);if(away.lengthSq()<1e-4)away.set(Math.random()-.5,0,Math.random()-.5);away.normalize();p.dir=away;
  if(p.ob)p.ob.r=0;
  if(p.kind==='fence'){p.state='broken';setFence(p.idx,false);
    for(let k=0;k<10;k++){const d=randUnit();SMOKE.emit({x:p.x,y:.8,z:p.z,vx:d.x*4,vy:Math.abs(d.y)*4,vz:d.z*4,kind:2,fm:2,frame:3,life:rand(.6,1),s0:.25,s1:.15,grav:14,r:.12,g:.12,b:.14,a0:.9,a1:.7})}return}
  if(p.kind==='sarc'){p.state='broken';p.t=0;for(let k=0;k<2;k++)spawnEnemy(egSarcType(),p.x+rand(-1.5,1.5),p.z+rand(-1.5,1.5),1+(story.on?story.act*.15:(wave-1)*.25));
    dropLoot(new V3(p.x,0,p.z),1+Math.floor(Math.random()*2));note(EG_TERM.sarcBreak);
    for(let k=0;k<14;k++){const d=randUnit();SMOKE.emit({x:p.x,y:.7,z:p.z,vx:d.x*3,vy:Math.abs(d.y)*3+1,vz:d.z*3,kind:2,fm:1,life:rand(.8,1.4),s0:.8,s1:2,r:.4,g:.45,b:.55,a0:.6,a1:0})}return}
  p.state='falling';p.t=0;p.axis=new V3(p.dir.z,0,-p.dir.x)}
const _q=new THREE.Quaternion();
function crush(p){for(const e of enemies){if(!e.alive||e.T.float)continue;const rx=e.pos.x-p.x,rz=e.pos.z-p.z,along=rx*p.dir.x+rz*p.dir.z,side=Math.abs(rx*p.dir.z-rz*p.dir.x);
    if(along>-.2&&along<p.len+.3&&side<.55+e.radius)dealDamage(e,80,'crush')}
  for(let k=0;k<12;k++){const a=rand(0,p.len);SMOKE.emit({x:p.x+p.dir.x*a,y:.2,z:p.z+p.dir.z*a,vx:rand(-1,1),vy:rand(.5,1.4),vz:rand(-1,1),kind:2,fm:1,life:rand(.8,1.3),s0:.8,s1:2,r:.45,g:.42,b:.4,a0:.5,a1:0})}
  shake(.18);sfx.boom(.5)}
const upBuf=new Uint8Array(TW*TPX*4),upSrc={isDataTexture:true,image:{data:null,width:0,height:0}},upPos=new THREE.Vector2(),
  bandLo=new Int16Array(GN),bandHi=new Int16Array(GN);
function subUpload(tex,data,x,y,w,h){const n=w*4;for(let r=0;r<h;r++){const s=((y+r)*TW+x)*4;upBuf.set(data.subarray(s,s+n),r*n)}
  upSrc.image.data=upBuf.subarray(0,n*h);upSrc.image.width=w;upSrc.image.height=h;upPos.set(x,y);renderer.copyTextureToTexture(upPos,upSrc,tex)}
function flushTerrain(){
  if(tDirtyList.length){bandLo.fill(GN);bandHi.fill(-1);
    for(const i of tDirtyList){tDirty[i]=0;paintPx(i);const gx=i%GN,gz=(i/GN)|0;if(gx<bandLo[gz])bandLo[gz]=gx;if(gx>bandHi[gz])bandHi[gz]=gx}
    tDirtyList.length=0;let area=0;for(let z=0;z<GN;z++)if(bandHi[z]>=0)area+=(bandHi[z]-bandLo[z]+1)*TPX*TPX;
    if(terrFull||area>TW*TW*.35){tTex.needsUpdate=true;gTex.needsUpdate=true;terrFull=false;terrStats.full++;terrStats.px+=TW*TW}
    else{for(let z=0;z<GN;z++)if(bandHi[z]>=0){const x=bandLo[z]*TPX,y=(GN-1-z)*TPX,w=(bandHi[z]-bandLo[z]+1)*TPX;
        subUpload(tTex,tData,x,y,w,TPX);subUpload(gTex,gData,x,y,w,TPX);terrStats.strips++}
      terrStats.partial++;terrStats.px+=area}}
  glowMat.opacity=.85+.15*Math.sin(time*3)}
function updateProps(dt){for(const p of props){
  if(p.kind==='tree'&&p.state==='up'&&tileAt(p.x,p.z)===TER.FIRE)igniteTree(p);
  if(p.state==='burning'){p.t-=dt;rate(p.acc,'f',36,dt,()=>ADD.emit({x:p.x+rand(-.3,.3),y:rand(.3,p.len),z:p.z+rand(-.3,.3),vy:rand(1,2),vx:rand(-.3,.3),vz:rand(-.3,.3),kind:0,fm:0,fps:24,life:rand(.4,.7),s0:rand(.6,1),s1:.15,r:1,g:.8,b:.6,a0:.95,a1:0}));
    rate(p.acc,'g',1,dt,()=>terrainBlast(new V3(p.x,0,p.z),1.4,'fire'));p.mat.color.setHex(0x2a211b).multiplyScalar(Math.max(.25,p.t/6));
    if(p.t<=0){p.dir=new V3(Math.random()-.5,0,Math.random()-.5).normalize();p.axis=new V3(p.dir.z,0,-p.dir.x);p.state='falling';p.t=0;if(p.ob)p.ob.r=0}}
  else if(p.state==='falling'){p.t+=dt;const k=Math.min(1,p.t/.5);_q.setFromAxisAngle(p.axis,k*k*Math.PI/2*.94);p.g.quaternion.copy(_q).multiply(p.q0);
    if(k>=1){p.state='down';crush(p)}}
  else if(p.kind==='sarc'&&p.state==='broken'&&p.t<1){p.t+=dt;p.lid.position.set(p.lid0.x+p.t*1.6,p.lid0.y+Math.sin(p.t*Math.PI)*1.2,p.lid0.z);p.lid.rotation.z=-p.t*1.2}}}
function resetProps(){for(const p of props){p.state='up';p.t=0;p.hp=p.hp0;if(p.ob)p.ob.r=p.ob.r0;
  if(p.kind==='fence')setFence(p.idx,true);else{p.g.quaternion.copy(p.q0);p.g.position.copy(p.pos0)}
  if(p.kind==='tree')p.mat.color.setHex(0x2a211b);if(p.kind==='sarc'){p.lid.position.copy(p.lid0);p.lid.rotation.set(0,0,0)}}}
function resetTerrain(){TT.set(TT0);TM.fill(0);THP.fill(0);booms.length=0;hot.length=0;for(let i=0;i<GN*GN;i++)paintCell(i);terrFull=true;resetProps();terrainKills=0;chainN=0;chainT=-9;$('#chainTag').hidden=true}
function updateTerrain(dt){caAcc+=dt;if(caAcc>=.2){automata(caAcc);caAcc=0}
  for(let k=booms.length-1;k>=0;k--){booms[k].t-=dt;if(booms[k].t<=0){const b=booms[k];booms.splice(k,1);boom(b.i)}}
  updateProps(dt);emitHot(dt);
  if(chainN&&time-chainT>1.4){$('#chainTag').hidden=true;chainN=0}}
function solidPush(p,r){const gx0=Math.floor(p.x+GH-r),gx1=Math.floor(p.x+GH+r),gz0=Math.floor(p.z+GH-r),gz1=Math.floor(p.z+GH+r);
  for(let gz=Math.max(0,gz0);gz<=Math.min(GN-1,gz1);gz++)for(let gx=Math.max(0,gx0);gx<=Math.min(GN-1,gx1);gx++){if(!TP[TT[gz*GN+gx]].solid)continue;
    const x0=gx-GH,z0=gz-GH,qx=clamp(p.x,x0,x0+1),qz=clamp(p.z,z0,z0+1),dx=p.x-qx,dz=p.z-qz,d=Math.hypot(dx,dz);
    if(d<r){if(d>1e-5){p.x=qx+dx/d*r;p.z=qz+dz/d*r}else{const cxm=x0+.5,czm=z0+.5,ax=p.x-cxm,az=p.z-czm;if(Math.abs(ax)>Math.abs(az))p.x=cxm+Math.sign(ax||1)*(.5+r);else p.z=czm+Math.sign(az||1)*(.5+r)}}}}

/* ---------- 法陣材質（三種路線各一） ---------- */
const DEBUG_FS=`varying vec2 vUv;uniform vec3 uCol;uniform float uOp;void main(){float e=max(abs(vUv.x-.5),abs(vUv.y-.5));gl_FragColor=vec4(uCol,mix(.07,.95,step(.47,e))*uOp);}`;
const BASIC_VS=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const RUNE_FS=`varying vec2 vUv;uniform vec3 uCol;uniform float uOp;
float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float sd(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float t=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*t);}
void main(){vec2 p=vUv-.5;float r=length(p)*2.,a=atan(p.y,p.x),l=0.;
  l+=smoothstep(.014,0.,abs(r-.94))+smoothstep(.008,0.,abs(r-.885))+smoothstep(.012,0.,abs(r-.66))+smoothstep(.007,0.,abs(r-.61))+smoothstep(.01,0.,abs(r-.165));
  if(r>.68&&r<.87){float ca=(a+3.14159)/6.28318*24.,ci=floor(ca);vec2 g=vec2(fract(ca),(r-.68)/.19);
    float b1=smoothstep(.09,0.,abs(g.x-.3-.4*h(vec2(ci,1.))))*step(.12,g.y)*step(g.y,.88);
    float b2=smoothstep(.09,0.,abs(g.y-.25-.5*h(vec2(ci,2.))))*step(.22,g.x)*step(g.x,.78);
    float b3=smoothstep(.1,0.,abs(g.x-g.y))*step(.5,h(vec2(ci,3.)))*step(.15,g.y)*step(g.y,.85);
    l+=max(max(b1,b2),b3)*.9;}
  for(int i=0;i<8;i++){float a0=float(i)*.785398-1.5708,a1=float(i+3)*.785398-1.5708;l+=smoothstep(.007,0.,sd(p,vec2(cos(a0),sin(a0))*.293,vec2(cos(a1),sin(a1))*.293));}
  float glow=exp(-abs(r-.94)*28.)*.45+exp(-r*3.)*.25;l=clamp(l,0.,1.)+glow;
  gl_FragColor=vec4(uCol*l,l*uOp*smoothstep(1.,.97,r));}`;
function runeMaterial(){
  const u={uCol:{value:new THREE.Color(0xff2436)},uOp:{value:0}};
  if(routeMode===0){const m=new THREE.MeshBasicMaterial({map:runeTex,color:0xff2a3c,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,opacity:0});m.userData.u=null;return m}
  const m=new THREE.ShaderMaterial({uniforms:u,vertexShader:BASIC_VS,fragmentShader:routeMode===1?RUNE_FS:DEBUG_FS,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false});m.userData.u=u;return m}
function setOpacity(m,o){if(m.userData.u)m.userData.u.uOp.value=o;else m.opacity=o}

/* ---------- 主角 ---------- */
const player={pos:new V3(0,0,0),face:0,hp:100,maxhp:100,alive:true,cast:null,float:0,kills:0,walk:0,arms:[0,.12,0,-.12],hurtT:0};
const P={g:new THREE.Group()};
{const robe=new THREE.MeshLambertMaterial({color:0x3b2350}),trim=new THREE.MeshLambertMaterial({color:0x8a6a3a}),skin=new THREE.MeshLambertMaterial({color:0xc9a98e});
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.2,.55,1.35,12),robe);body.position.y=.68;P.g.add(body);
  const belt=new THREE.Mesh(new THREE.TorusGeometry(.29,.035,6,16),trim);belt.rotation.x=Math.PI/2;belt.position.y=1.0;P.g.add(belt);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.23,14,10),skin);head.position.y=1.56;P.g.add(head);
  P.hatGroup=new THREE.Group();P.g.add(P.hatGroup);
  const brim=new THREE.Mesh(new THREE.CylinderGeometry(.44,.44,.04,18),robe);brim.position.y=1.72;P.hatGroup.add(brim);
  const hat=new THREE.Mesh(new THREE.ConeGeometry(.3,.8,14),robe);hat.position.y=2.1;hat.rotation.z=-.15;P.hatGroup.add(hat);
  const mkArm=s=>{const piv=new THREE.Group();piv.position.set(.3*s,1.32,0);const arm=new THREE.Mesh(new THREE.BoxGeometry(.13,.62,.13),robe);arm.position.y=-.3;piv.add(arm);
    const hand=new THREE.Mesh(new THREE.SphereGeometry(.08,8,6),skin);hand.position.y=-.64;piv.add(hand);P.g.add(piv);return piv};
  P.armR=mkArm(-1);P.armL=mkArm(1);
  const staff=new THREE.Mesh(new THREE.CylinderGeometry(.03,.03,1.6,6),new THREE.MeshLambertMaterial({color:0x4a3220}));staff.position.set(0,-.62,.0);staff.rotation.x=Math.PI/2;
  const gem=new THREE.Mesh(new THREE.OctahedronGeometry(.1),new THREE.MeshBasicMaterial({color:0xff9a4a}));gem.position.set(0,.85,0);staff.add(gem);
  const stg=new THREE.Group();stg.add(staff);stg.position.y=-.02;P.armR.add(stg);P.staffGroup=stg;staff.position.set(0,-.64,.25);staff.rotation.x=1.25;
  const sh=new THREE.Mesh(new THREE.CircleGeometry(.6,20),new THREE.MeshBasicMaterial({color:0,transparent:true,opacity:.45,depthWrite:false}));sh.rotation.x=-Math.PI/2;sh.position.y=.02;P.shadow=sh;scene.add(sh);
  scene.add(P.g);
  // P3b：有人偶模型就換上（kit/character.js），載入失敗就維持程式拼出來的方塊法師
  window.EGP=P;if(window.EGChar)EGChar.start()}
function handPos(){const f=player.face;return new V3(player.pos.x+Math.sin(f)*.6,1.15+player.float,player.pos.z+Math.cos(f)*.6)}

