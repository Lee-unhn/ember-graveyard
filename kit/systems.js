// 系統：音效、設定、操作
// 以下各檔是依序載入的一般 script，頂層 const／let／function 在檔案之間以名稱共用（順序見 index.html）。
'use strict';
/* ---------- 音效（全部即時合成） ---------- */
let AC=null,master=null,sfxBus=null,musicBus=null,noiseBuf=null,soundOn=true,lastBoom=0;
function initAudio(){if(AC)return;try{AC=new (window.AudioContext||window.webkitAudioContext)();master=AC.createGain();master.connect(AC.destination);
  sfxBus=AC.createGain();sfxBus.connect(master);musicBus=AC.createGain();musicBus.connect(master);
  noiseBuf=AC.createBuffer(1,AC.sampleRate,AC.sampleRate);const d=noiseBuf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;applySettings();startMusic()}catch(e){AC=null}}
// 背景音樂：程式即時合成的低沉和弦（Am－F－C－E 每 6 秒換一次），走獨立的音樂音量
let musicTimer=null,musicStep=0;
function startMusic(){if(!AC||musicTimer)return;const chords=[[220,261.6,329.6],[174.6,220,261.6],[130.8,196,261.6],[164.8,207.7,246.9]];
  const play=()=>{const t=AC.currentTime,ch=chords[musicStep++%chords.length];
    for(const f of ch)for(const det of [-4,4]){const o=AC.createOscillator(),g=AC.createGain(),lp=AC.createBiquadFilter();o.type='sawtooth';o.frequency.value=f/2;o.detune.value=det;
      lp.type='lowpass';lp.frequency.value=520;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.022,t+2);g.gain.linearRampToValueAtTime(.018,t+5);g.gain.linearRampToValueAtTime(0,t+6.4);
      o.connect(lp).connect(g).connect(musicBus);o.start(t);o.stop(t+6.5)}
    const b=AC.createOscillator(),bg=AC.createGain();b.type='sine';b.frequency.value=ch[2]*2;bg.gain.setValueAtTime(.05,t+.05);bg.gain.exponentialRampToValueAtTime(.001,t+3);b.connect(bg).connect(musicBus);b.start(t+.05);b.stop(t+3)};
  play();musicTimer=setInterval(play,6000)}

// 設定：四種音量、粒子密度、減少震動與停格、字幕大小、掉寶形狀標記（存在瀏覽器裡，讀不到就用預設）
const SET_DEFAULT={fx:'high',bright:1.4,master:.8,music:.5,sfx:.8,voice:.8,particles:'high',reduceShake:false,subSize:1,lootShapes:true};
const SET=Object.assign({},SET_DEFAULT);
try{const s=JSON.parse(localStorage.getItem(EG_KEY('eg-settings'))||'null');if(s&&typeof s==='object')for(const k in SET_DEFAULT)if(typeof s[k]===typeof SET_DEFAULT[k])SET[k]=s[k]}catch(e){}
let DENSITY=1;
function saveSettings(){try{localStorage.setItem(EG_KEY('eg-settings'),JSON.stringify(SET))}catch(e){}}
function applySettings(){DENSITY={low:.4,mid:.7,high:1}[SET.particles]||1;
  if(AC){master.gain.value=.55*SET.master;sfxBus.gain.value=soundOn?SET.sfx:0;musicBus.gain.value=SET.music}
  document.documentElement.style.setProperty('--sub',SET.subSize)}
applySettings();
function nz(dur,f0,f1,type,gain,q=1,delay=0){if(!AC||!soundOn||!sfxBus)return;const t=AC.currentTime+delay,s=AC.createBufferSource();s.buffer=noiseBuf;const f=AC.createBiquadFilter();f.type=type;
  f.frequency.setValueAtTime(f0,t);f.frequency.exponentialRampToValueAtTime(Math.max(20,f1),t+dur);f.Q.value=q;const g=AC.createGain();g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);
  s.connect(f).connect(g).connect(sfxBus);s.start(t);s.stop(t+dur)}
function tone(f0,f1,dur,type,gain,delay=0){if(!AC||!soundOn||!sfxBus)return;const t=AC.currentTime+delay,o=AC.createOscillator(),g=AC.createGain();o.type=type;o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(f1,t+dur);
  g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);o.connect(g).connect(sfxBus);o.start(t);o.stop(t+dur)}
const sfx={cast:()=>nz(.22,1800,500,'bandpass',.22,1.2),whoosh:()=>nz(.18,2500,700,'bandpass',.08,2),
  boom:s=>{if(!AC)return;const n=AC.currentTime;if(n-lastBoom<.04)return;lastBoom=n;nz(.35+.5*s,900,50,'lowpass',.55*Math.min(1.2,s),.7);tone(110,40,.3+.3*s,'sine',.3*Math.min(1,s))},
  zap:()=>{for(let i=0;i<4;i++)tone(rand(600,1800),rand(200,500),.04,'square',.05,i*.025);nz(.12,6000,2000,'highpass',.12)},
  pick:()=>{tone(880,880,.12,'sine',.12);tone(1320,1320,.18,'sine',.1,.08)},hurt:()=>nz(.15,500,150,'lowpass',.25),
  blood:()=>{tone(140,55,.9,'sine',.25);nz(.8,300,1200,'bandpass',.08,3)}};

/* ---------- 操作 ---------- */
const KB_DEFAULT={up:'KeyW',left:'KeyA',down:'KeyS',right:'KeyD',fire:'Digit1',bolt:'Digit2',meteor:'Digit3',blood:'Digit4',inv:'KeyI'};
const KB=Object.assign({},KB_DEFAULT);try{const k=JSON.parse(localStorage.getItem(EG_KEY('eg-keys'))||'{}');for(const n in KB_DEFAULT)if(typeof k[n]==='string')KB[n]=k[n]}catch(e){}
const keys={},mouse=new THREE.Vector2(),aim=new V3(),ray=new THREE.Raycaster(),gplane=new THREE.Plane(new V3(0,1,0),0);let lmb=false;
addEventListener('keydown',e=>{keys[e.code]=true;
  if(e.code==='Space'){e.preventDefault();if(dlg)nextLine();else if(!$('#result').hidden)closeResult();return}
  if(e.code==='Tab'){e.preventDefault();toggleInv()}if(e.code===KB.inv)toggleInv();
  if(e.code==='KeyR'&&!$('#dead').hidden)restart();
  const m=['fire','bolt','meteor','blood'].find(s=>KB[s]===e.code);if(m)tryCast(m);
  if(e.code==='Escape'||e.code==='KeyP'){if(!$('#settings').hidden)backSub('settings');else if(!$('#help').hidden)backSub('help');else if(!$('#credits').hidden)backSub('credits');
    else if(!$('#inv').hidden)toggleInv();else if(!$('#result').hidden)closeResult();else togglePause()}});
addEventListener('keyup',e=>{keys[e.code]=false});
addEventListener('blur',()=>{for(const k in keys)keys[k]=false;lmb=false});
canvas.addEventListener('mousemove',e=>{mouse.set(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1)});
canvas.addEventListener('mousedown',e=>{if(e.button===0)lmb=true;if(e.button===2)tryCast('bolt')});
addEventListener('mouseup',e=>{if(e.button===0)lmb=false});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('wheel',e=>{zoom=clamp(zoom+Math.sign(e.deltaY)*.08,.65,1.5)},{passive:true});
for(const el of document.querySelectorAll('.sk'))el.addEventListener('click',()=>tryCast(el.dataset.s));
function toggleInv(){const p=$('#inv');p.hidden=!p.hidden;if(!p.hidden)renderInv();else hideTip()}
$('#invClose').onclick=toggleInv;

function tryCast(id){if(!running||paused||menuOpen||!player.alive)return;
  if(!story.unlocked.has(id)){if(story.on)note('這招還沒學會，先點亮燈塔');return}
  if(player.cast||cds[id]>0)return;
  const s=SPELLS[id],cs=castMul();
  ray.setFromCamera(mouse,camera);ray.ray.intersectPlane(gplane,aim);
  player.face=Math.atan2(aim.x-player.pos.x,aim.z-player.pos.z);
  let target=aim.clone();const d=target.distanceTo(new V3(player.pos.x,0,player.pos.z));if(d>17)target=player.pos.clone().setY(0).lerp(target,17/d);
  player.cast={id,t:0,dur:s.dur/cs,rel:s.rel,released:false,target};cds[id]=s.cd/cs;
  if(id==='blood'){startBlood();player.cast.released=true}else sfx.cast()}
function releaseCast(c){const h=handPos(),dir=new V3(c.target.x-h.x,0,c.target.z-h.z).normalize();
  if(c.id==='fire'){if(tierOf('fire')){for(const a of [-.2,0,.2])spawnFireball(h,dir.clone().applyAxisAngle(new V3(0,1,0),a))}else spawnFireball(h,dir)}
  else if(c.id==='bolt')spawnOrb(h,dir);
  else if(c.id==='meteor')castMeteor(c.target)}
function hurtPlayer(d,src='怪物'){if(!player.alive)return;player.hp-=d;player.lastHurt=src;player.hurtT=.25;sfx.hurt();$('#vig').style.boxShadow='inset 0 0 160px rgba(200,0,20,.55)';
  if(player.hp<=0){player.hp=0;player.alive=false;player.cast=null;
    $('#deadCause').textContent='擊倒你的是：'+player.lastHurt;$('#deadTip').textContent='提示：'+(DEATH_TIPS[player.lastHurt]||DEFAULT_TIP);
    $('#deadSub').textContent=story.on?(story.phase==='boss'?`倒在首領戰・重新挑戰${CONTENT.text.bossName}`:`倒在第 ${story.act+1} 幕・從本幕重來`):`撐到第 ${wave} 波・擊倒 ${player.kills} 隻`;setTimeout(()=>{if(running&&!player.alive)$('#dead').hidden=false},900)}}

function updatePlayer(dt){
  for(const k in cds)cds[k]=Math.max(0,cds[k]-dt);
  ray.setFromCamera(mouse,camera);ray.ray.intersectPlane(gplane,aim);
  if(player.alive){
    if(lmb)tryCast('fire');
    let mx=(keys[KB.right]?1:0)-(keys[KB.left]?1:0),mz=(keys[KB.down]?1:0)-(keys[KB.up]?1:0);const l=Math.hypot(mx,mz);
    const c=player.cast,root=c&&c.id==='blood'?0:c?.45:1,ptp=TP[tileAt(player.pos.x,player.pos.z)],sp=6.2*(1+stats.move/100)*root*(ptp.pm||1);
    if(ptp.pd){player.tacc=(player.tacc||0)+ptp.pd*dt;if(player.tacc>=4){const a=player.tacc;player.tacc=0;hurtPlayer(a,'熔岩')}}
    if(l){player.pos.x+=mx/l*sp*dt;player.pos.z+=mz/l*sp*dt;player.walk+=dt*10*root}
    pushOut(player.pos,.4);
    if(!c)player.face=Math.atan2(aim.x-player.pos.x,aim.z-player.pos.z);
    if(c){c.t+=dt;if(!c.released&&c.t/c.dur>=c.rel){c.released=true;releaseCast(c)}if(c.t>=c.dur)player.cast=null}
    player.hp=Math.min(player.maxhp,player.hp+dt*2);
    // 每招不同手勢：右臂前推／雙手前伸／高舉後下劈／雙手高舉浮空
    let tr=l?[Math.sin(player.walk)*.5,.12,-Math.sin(player.walk)*.5,-.12]:[0,.12,0,-.12],fl=0;
    if(c){const k=c.t/c.dur;
      if(c.id==='fire')tr=k<.45?[.7,.2,0,-.15]:[-1.55,.05,.2,-.15];
      if(c.id==='bolt')tr=[-1.4,.38,-1.4,-.38];
      if(c.id==='meteor')tr=k<.55?[-3.05,.1,-.3,-.2]:[-.85,0,0,-.2];
      if(c.id==='blood'){tr=[-2.7,.55,-2.7,-.55];fl=k<.85?.65:0}}
    const a=player.arms,r=Math.min(1,dt*16);for(let i=0;i<4;i++)a[i]+=(tr[i]-a[i])*r;
    P.armR.rotation.set(a[0],0,a[1]);P.armL.rotation.set(a[2],0,a[3]);
    player.float+=(fl-player.float)*Math.min(1,dt*6);
    P.g.rotation.set(0,player.face,0);
    player.moving=!!l;player.speedK=sp/6.2;
  }else if(!P.skinned){P.g.rotation.x=Math.min(Math.PI/2,P.g.rotation.x+dt*3)}
  P.g.position.set(player.pos.x,player.float+(player.cast?0:Math.abs(Math.sin(player.walk))*.04),player.pos.z);
  P.shadow.position.set(player.pos.x,.02,player.pos.z);P.shadow.scale.setScalar(1-player.float*.4);if(P.skinned)EGChar.update(dt,player,THREE);
  if(player.hurtT>0){player.hurtT-=dt;if(player.hurtT<=0)$('#vig').style.boxShadow='inset 0 0 160px rgba(200,0,20,0)'}
}

