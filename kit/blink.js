// Blink: optional fifth basic move, a short teleport with a cooldown. Off unless CONTENT.blink or EG.enableBlink(true) (kit/CONTENT-API.md).
(function () {
'use strict';
const $=s=>document.querySelector(s),L=c=>window.EGControls?EGControls.label(c):c;
// parameters sit in the spell table: EG.setSpellParams('blink',{...}) and resetSpellParams work as for the four spells
const D=SPELL_DEF.blink={cd:2.5,distance:5.5,invuln:.25,passEnemies:true,passProps:true};
SPELLS.blink={...D};cds.blink=0;KB_DEFAULT.blink='KeyF';
let k;try{k=JSON.parse(localStorage.getItem(EG_KEY('eg-keys'))||'{}').blink}catch(e){}
KB.blink=typeof k==='string'?k:'KeyF';if(EG_RK[KB.blink])EG.reserveKey(KB.blink,EG_RK[KB.blink]);
// a map saved before blink may use F: the earlier action keeps a shared key, blink gets none
const one=()=>{const u={};for(const n in KB){const c=KB[n];if(c&&u[c]){KB[n]='';egW(n+' unbound, '+c+' is taken')}u[c]=1}};one();
let on=false,inv=0,ui=null;
// invulnerability window in game time, cleared by a new run
const hurt0=hurtPlayer,up0=updatePlayer,cw0=clearWorld;
window.clearWorld=function(){inv=0;return cw0.apply(this,arguments)};
window.hurtPlayer=function(){if(inv>0)return;return hurt0.apply(this,arguments)};
window.updatePlayer=dt=>{inv=Math.max(0,inv-dt);up0(dt)};
const inArena=(x,z)=>Math.hypot(x,z)<=42.5;
const solid=(x,z)=>{for(const o of obstacles)if(o.r&&Math.hypot(x-o.x,z-o.z)<o.r+.4)return true;const p={x,z};solidPush(p,.4);return p.x!==x||p.z!==z};
// farthest free spot on the line (checked every 0.2 m or less): never outside the arena, never inside a prop or rock tile
function reach(x0,z0,dx,dz,P){let best=0;const n=Math.ceil(P.distance/.2);
  for(let i=1;i<=n;i++){const t=P.distance*i/n,x=x0+dx*t,z=z0+dz*t;
    if(!inArena(x,z))break;
    if(!P.passEnemies&&enemies.some(e=>e.alive&&Math.hypot(e.pos.x-x,e.pos.z-z)<e.radius+.4))break;
    if(solid(x,z)){if(P.passProps)continue;break}best=t}
  return best}
// direction: given (gamepad, extension), else the movement keys (also the touch stick), else where the mage faces
function blink(dx,dz){if(!on||egHeld||egEnd()||!running||paused||menuOpen||!player.alive||cds.blink>0)return false;
  if(dx==null){dx=(keys[KB.right]?1:0)-(keys[KB.left]?1:0);dz=(keys[KB.down]?1:0)-(keys[KB.up]?1:0)}
  dx=+dx||0;dz=+dz||0;if(!dx&&!dz){dx=Math.sin(player.face);dz=Math.cos(player.face)}
  const l=Math.hypot(dx,dz),P=SPELLS.blink,x0=player.pos.x,z0=player.pos.z,t=reach(x0,z0,dx/l,dz/l,P);if(t<=0)return false;
  player.pos.x=x0+dx/l*t;player.pos.z=z0+dz/l*t;cds.blink=P.cd;inv=P.invuln;fx(x0,z0,player.pos.x,player.pos.z);sfx.blink();
  egEmit('blink',{from:{x:x0,z:z0},to:{x:player.pos.x,z:player.pos.z}});return true}
// effect from the existing pools: star sparks, tinted explosion flipbook and ground glow at both ends, a spark trail, one pooled light;
// particle density follows the quality setting (ADD.emit), "reduce shake" and EG.reduceFlashing drop the shake and dim the flash
const S=(o,c=1)=>ADD.emit({kind:3,fm:2,frame:8+randi(0,7),r:.7*c,g:.55*c,b:1,a0:1,a1:0,...o});
function burst(x,z,k){for(let i=0;i<24;i++){const a=i/24*TAU,s=rand(5,9)*k;S({x,y:.9,z,vx:Math.cos(a)*s,vy:rand(-.5,1.5),vz:Math.sin(a)*s,life:rand(.3,.55),s0:.5,s1:.08,drag:3})}
  for(let i=0;i<8;i++)S({x:x+rand(-.4,.4),y:.2,z:z+rand(-.4,.4),vy:rand(4,7)*k,life:rand(.4,.6),s0:.35,s1:.05,drag:1},1.2);
  ADD.emit({x,y:.9,z,kind:1,fm:1,life:.4,s0:1.8*k,s1:3.2*k,r:.55,g:.45,b:1,a0:1,a1:0});S({x,y:.15,z,frame:0,life:.35,s0:3*k,s1:4.5*k,a0:.9},.7)}
function fx(x0,z0,x1,z1){burst(x0,z0,1);burst(x1,z1,1.3);
  for(let i=0;i<=20;i++){const t=i/20,x=x0+(x1-x0)*t,z=z0+(z1-z0)*t;S({x,y:1,z,frame:0,life:rand(.25,.45),s0:.9,s1:.1,a0:.8},.6);S({x:x+rand(-.2,.2),y:rand(.4,1.6),z:z+rand(-.2,.2),vy:rand(.2,.8),life:rand(.2,.45)*(.5+t),s0:.45,s1:.08,a0:.9},.8)}
  flash(tv.set(x1,1.2,z1),0x8f7bff,SET.reduceShake?1.5:5,9,.35);egFlashOff||shake(.06)}
sfx.blink=()=>{nz(.16,700,4200,'bandpass',.16,2);tone(420,1260,.12,'sine',.08);tone(1680,840,.14,'triangle',.05,.08)};
// Ctrl/Meta/Alt combos are browser shortcuts (Ctrl+F): ignored; Shift is not
addEventListener('keydown',e=>{if(on&&e.code===KB.blink&&!e.repeat&&!egMod(e))blink()});
// skill tile, help line and remap row exist only while blink is on
const css=document.createElement('style');css.textContent='.sk.blink .n{color:#b9a6ff}';document.head.appendChild(css);
function build(){const t=document.createElement('div'),h=document.createElement('span'),r=document.createElement('div');
  t.className='sk blink';t.dataset.s='blink';t.innerHTML='<span class="k"></span><span class="n">閃現</span><span class="m"></span><div class="cd"></div>';
  // stops controls.js's own tile handler (added if touch is switched on later), which would cast a spell named blink
  const go=e=>{e.preventDefault();e.stopImmediatePropagation();blink()};t.addEventListener('touchstart',go,{passive:false});t.addEventListener('click',go);
  h.id='hBlink';h.innerHTML='<kbd></kbd>閃現（往移動方向瞬移）';
  r.className='srow';r.innerHTML='<span>閃現</span><button class="btn keybtn" type="button" data-k="blink" aria-label="變更「閃現」的按鍵"></button><span></span>';
  $('#skills')?.appendChild(t);$('#help .ctrl')?.appendChild(h);const kr=$('#keyRows');kr?.insertBefore(r,kr.lastElementChild);return [t,h,r]}
function sync(){if(!ui)return;const P=SPELLS.blink,key=L(KB.blink),q=(i,s)=>ui[i].querySelector(s),set=(el,v)=>{if(el.textContent!==v)el.textContent=v},b=q(2,'.keybtn');
  set(q(0,'.k'),window.EGControls&&EGControls.touch?'':key);set(q(0,'.m'),P.distance+' 公尺');q(0,'.cd').style.setProperty('--p',cds.blink/P.cd||0);set(q(1,'kbd'),key);
  if(!b.classList.contains('waiting'))set(b,key)}
(function loop(){requestAnimationFrame(loop);sync()})();
function enable(v=true){on=!!v;inv=0;if(on)one();if(on&&!ui){ui=build();sync()}else if(!on&&ui){for(const el of ui)el.remove();ui=null}return on}
Object.assign(EG,{enableBlink:enable,blinkEnabled:()=>on,blink:(dx,dz)=>blink(dx,dz)});
// a content pack turns it on with CONTENT.blink: true, or with an object of parameters that become its defaults
const C=window.CONTENT&&CONTENT.blink;if(C){if(typeof C==='object'){EG.setSpellParams('blink',C);Object.assign(D,SPELLS.blink)}enable(true)}
})();
