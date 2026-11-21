// 引擎核心：數學小工具、雜訊、翻頁圖集、渲染器、粒子系統、燈光池、程式畫的貼圖
// 以下各檔是依序載入的一般 script，頂層 const／let／function 在檔案之間以名稱共用（順序見 index.html）。
'use strict';
/*H*/ // 載入失敗時把原因寫在還開著的讀取畫面上（讀取完成後的執行期錯誤不蓋畫面）
/*H*/ function egFail(msg){try{const L=document.querySelector('#loading');if(!L||L.hidden||document.querySelector('#ldfail'))return;const card=L.querySelector('.card')||L,p=document.createElement('p');p.id='ldfail';p.setAttribute('role','alert');
/*H*/   p.style.cssText='color:#ff9a8a;font-size:14px;line-height:1.6;margin:10px 0 0;max-width:46ch;text-align:left';p.textContent='載入失敗：'+msg;card.appendChild(p);const st=document.querySelector('#ldstep');if(st)st.hidden=true}catch(e){}}
/*H*/ window.addEventListener('error',e=>{const t=e.target;if(t&&t!==window){if(t.tagName==='SCRIPT'&&!t.defer&&!t.async)egFail('找不到檔案 '+(t.getAttribute('src')||''));return}egFail(String(e.message||'未知錯誤'))},true);
if(!window.CONTENT)throw new Error('CONTENT 未載入：請先載入 content/<內容包>/*.js 再載入 kit/（見 kit/CONTENT-API.md）');
/*H*/ // 內容驗證：必要欄位缺了就停下並指名欄位；可選欄位補預設並把警告記在 window.__contentWarnings
/*H*/ const CONTENT_WARNINGS=window.__contentWarnings=[];
/*H*/ function cwarn(m){if(CONTENT_WARNINGS.includes(m))return;CONTENT_WARNINGS.push(m);try{console.warn('[content] '+m)}catch(e){}}
/*H*/ // 查不到的鍵不丟例外：回傳預設值並記警告
/*H*/ function egLookup(obj,what,fallback){return new Proxy(obj,{get(t,k){if(typeof k!=='string'||k in t)return t[k];cwarn(what+' '+k+' 不存在，改用預設值');return typeof fallback==='function'?fallback():fallback}})}
/*H*/ function egValidateContent(){const C=window.CONTENT,bad=[],isObj=v=>!!v&&typeof v==='object'&&!Array.isArray(v),num=v=>typeof v==='number'&&isFinite(v);
/*H*/   for(const k of ['towers','towerPos','acts'])if(!Array.isArray(C[k])||!C[k].length)bad.push('CONTENT.'+k+' 缺少，或不是有內容的陣列');
/*H*/   if(!bad.length){
/*H*/     if(C.towerPos.length!==C.towers.length)bad.push('CONTENT.towerPos 有 '+C.towerPos.length+' 筆，要等於 CONTENT.towers 的 '+C.towers.length+' 座');
/*H*/     if(C.acts.length!==C.towers.length)bad.push('CONTENT.acts 有 '+C.acts.length+' 幕，要等於 CONTENT.towers 的 '+C.towers.length+' 座（每座塔對應一幕）');
/*H*/     C.towers.forEach((t,i)=>{if(!isObj(t)||typeof t.name!=='string'||!['fire','bolt','meteor','blood'].includes(t.spell)||!num(t.col)||!Array.isArray(t.c)||t.c.length!==3||!t.c.every(num))bad.push('CONTENT.towers['+i+'] 缺 name、spell、col 或 c（三個 0–1 的數字）');else{if(typeof t.dir!=='string')t.dir='';if(!num(t.kind))t.kind=0;
/*H*/       // respond 的塔不點亮、只隨心跳明暗；respondIgnite／respondLit 是進度與完成用語
/*H*/       if(t.respond!==undefined&&typeof t.respond!=='boolean')bad.push('CONTENT.towers['+i+'].respond 要是 true 或 false');
/*H*/       for(const k of ['respondIgnite','respondLit'])if(t[k]!==undefined){if(typeof t[k]!=='string'||!t[k])bad.push('CONTENT.towers['+i+'].'+k+' 要是有內容的字串');else if(t.respond!==true)cwarn('CONTENT.towers['+i+'].'+k+' 只在 respond 為 true 時使用，這個欄位不會生效')}}});
/*H*/     C.towerPos.forEach((p,i)=>{if(!Array.isArray(p)||!num(p[0])||!num(p[1]))bad.push('CONTENT.towerPos['+i+'] 要是 [x, z] 兩個數字')});
/*H*/     C.acts.forEach((a,i)=>{if(!isObj(a)||!num(a.n)||a.n<1||!Array.isArray(a.mix)||a.mix.length!==3||!a.mix.every(num))bad.push('CONTENT.acts['+i+'] 缺 n（要擊倒幾隻）或 mix（三種怪的比例，三個數字）')})}
/*H*/   // 可選欄位：型別不對停下並指名，欄位名打錯只警告，沒給用預設
/*H*/   const str=v=>typeof v==='string'&&v.length>0,lst=v=>Array.isArray(v)&&v.length>0&&v.every(str),intIn=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b,hex=v=>intIn(v,0,0xffffff),W=(w,m)=>bad.push(w+' 要是 '+m),S='有內容的字串',B='true 或 false';
/*H*/   const checkKeys=(obj,known,what)=>{for(const k of Object.keys(obj))if(!known.includes(k))cwarn(what+'.'+k+' 不是引擎認得的欄位（可用：'+known.join('、')+'），不會生效')};
/*H*/   const objChk=(v,w,known,each)=>{if(v===undefined)return;if(!isObj(v))return W(w,'物件');checkKeys(v,known,w);for(const k of known)if(v[k]!==undefined)each(k,v[k],w+'.'+k)};
/*H*/   const TD={tower:'燈塔',light:'點亮',lit:'點亮了',ignite:'點燃',go:'前往',undead:'亡者',monster:'怪物',sarcBreak:'石棺裂開，殘魂竄了出來',lampName:'燼燈',lampGet:'得到一盞燼燈：身邊照亮 5 公尺（按 I 看裝備）',
/*H*/     bossShock:'首領衝擊波',lava:'熔岩',gas:'磷火爆炸',hintGo:'跟著地上的箭頭與光柱走',hintIgnite:'站在塔下，別離開',hintBoss:'紫色衝擊波會往外擴散：退到圈外，或貼近牠躲進圈內',
/*H*/     tipLava:'熔岩是唯一會傷到你的地形，橘紅發光的地面別久站。',tipShock:'衝擊波會往外擴散：退到圈外，或貼近首領躲在圈內。',tipGas:'藍色磷火墳碰到火或雷會爆炸，施法前先看腳下。',tipDefault:'被包圍時用星墜清場，或把怪物引進燃燒的草地。'};
/*H*/   objChk(C.flow,'CONTENT.flow',['preBoss','preEnding','half','down'],(k,v,w)=>{if(!str(v))W(w,S+'（對白代號）')});
/*H*/   objChk(C.terms,'CONTENT.terms',Object.keys(TD),(k,v,w)=>{if(!str(v))W(w,S)});
/*H*/   objChk(C.monsters,'CONTENT.monsters',['spider','lizard','ghost','lord'],(mk,m,w)=>{if(!isObj(m))return W(w,'物件');
/*H*/     objChk(m,w,['name','color','color2','eye','glow','opacity','scale','legs','tail','spikes','skirt'],(k,v,x)=>{
/*H*/       if(k==='name'){if(!str(v))W(x,S)}else if(['color','color2','eye','glow'].includes(k)){if(!hex(v))W(x,'0 到 0xffffff 的整數顏色')}
/*H*/       else if(k==='opacity'){if(!(num(v)&&v>=0&&v<=1))W(x,'0 到 1 的數字')}else if(k==='scale'){if(!(num(v)&&v>=.5&&v<=3))W(x,'0.5 到 3 的數字')}
/*H*/       else{const only={legs:'spider',spikes:'lord',tail:'lizard',skirt:'ghost'}[k],r=k==='legs'?[1,4]:[0,7];if(only==='spider'||only==='lord'?!intIn(v,r[0],r[1]):typeof v!=='boolean')W(x,only==='spider'||only==='lord'?r[0]+' 到 '+r[1]+' 的整數':B);else if(mk!==only)cwarn(x+' 只有 '+only+' 用得到，不會生效')}})});
/*H*/   objChk(C.combat,'CONTENT.combat',['critChance','critMul','meteorSizeDamage','aoeJitter','meteorSizeRadius','gearDamage','sarcSpawn'],(k,v,w)=>{
/*H*/     if(k==='sarcSpawn'){if(v!=='mix'&&!(lst(v)&&v.every(x=>['spider','lizard','ghost'].includes(x))))W(w,'"mix"，或 spider／lizard／ghost 組成的非空陣列')}else if(['meteorSizeDamage','aoeJitter','meteorSizeRadius','gearDamage'].includes(k)&&typeof v!=='boolean')W(w,B)});
/*H*/   objChk(C.loot,'CONTENT.loot',['names','prefixes'],(k,v,w)=>{if(k==='prefixes'){if(!lst(v))W(w,'非空的字串陣列')}else objChk(v,w,['staff','helm','armor','gloves','boots','ring','amulet','lantern'],(k2,v2,w2)=>{if(!lst(v2))W(w2,'非空的字串陣列')})});
/*H*/   objChk(C.render,'CONTENT.render',['shadowTransparentBodies'],(k,v,w)=>{if(typeof v!=='boolean')W(w,B)});
/*H*/   if(C.blink!==undefined&&typeof C.blink!=='boolean'&&!isObj(C.blink))W('CONTENT.blink','true、false，或閃現參數的物件');
/*H*/   if(isObj(C.text)&&C.text.loadTips!==undefined&&!lst(C.text.loadTips))W('CONTENT.text.loadTips','非空的字串陣列');
/*H*/   if(bad.length)throw new Error('CONTENT 不完整：'+bad.join('；'));
/*H*/   for(const k of ['speakers','portraits','dialog'])if(!isObj(C[k])){cwarn('CONTENT.'+k+' 沒有給：'+(k==='dialog'?'所有對白略過':k==='speakers'?'說話者名字留空':'頭像留空'));C[k]={}}
/*H*/   for(const [id,sp] of Object.entries(C.speakers)){const s=isObj(sp)?sp:(C.speakers[id]={});if(typeof s.n!=='string')s.n='';if(typeof s.c!=='string')s.c='#ffffff';if(!num(s.pitch))s.pitch=1;if(!num(s.rate))s.rate=1}
/*H*/   for(const [id,lines] of Object.entries(C.dialog)){if(!Array.isArray(lines)){cwarn('CONTENT.dialog.'+id+' 不是陣列，略過');delete C.dialog[id];continue}
/*H*/     C.dialog[id]=lines.filter((l,i)=>{const good=Array.isArray(l)&&typeof l[0]==='string'&&typeof l[1]==='string';if(!good)cwarn('CONTENT.dialog.'+id+'['+i+'] 要是 [說話者代號, 文字]，略過這一句');else if(!(l[0] in C.speakers))cwarn('CONTENT.dialog.'+id+'['+i+'] 的說話者 '+l[0]+' 不在 CONTENT.speakers，名字會留空');return good})}
/*H*/   C.acts.forEach((a,i)=>{for(const k of ['dlg','after'])if(a[k]&&!(a[k] in C.dialog))cwarn('CONTENT.acts['+i+'].'+k+' 指到不存在的對白 '+a[k]+'，這段會略過')});
/*H*/   // 流程對白代號：half、down 預設 dark、end；preBoss、preEnding 預設不播
/*H*/   C.flow=Object.assign({half:'dark',down:'end'},C.flow);
/*H*/   for(const k of ['half','down'])if(!(C.flow[k] in C.dialog))cwarn('CONTENT.dialog.'+C.flow[k]+' 沒有給：首領戰的這段對白略過');
/*H*/   for(const k of ['preBoss','preEnding'])if(C.flow[k]&&!(C.flow[k] in C.dialog))cwarn('CONTENT.flow.'+k+' 指到不存在的對白 '+C.flow[k]+'，這段會略過');
/*H*/   // 介面用語表，預設是示範版的用語
/*H*/   C.terms=Object.assign(TD,C.terms);
/*H*/   if(!isObj(C.monsters))C.monsters={};
/*H*/   if(!isObj(C.text))C.text={};if(typeof C.text.bossName!=='string'||!C.text.bossName){cwarn('CONTENT.text.bossName 沒有給，首領名字改用「首領」');C.text.bossName='首領'}
/*H*/   if(typeof C.voiceDir!=='string'||!C.voiceDir)C.voiceDir='';else if(!C.voiceDir.endsWith('/'))C.voiceDir+='/';
/*H*/   if(typeof C.modelScript!=='string')C.modelScript='';
/*H*/   // 內容包識別：存檔鍵名帶上它；demo 沿用原鍵名，沒給 id 用內容指紋
/*H*/   let id=typeof C.id==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(C.id)?C.id:'';
/*H*/   if(!id){let h=0;const s=JSON.stringify([C.towers,C.acts]);for(let i=0;i<s.length;i++)h=(Math.imul(h,31)+s.charCodeAt(i))|0;id='p'+(h>>>0).toString(36);cwarn('CONTENT.id 沒有給，存檔鍵改用內容指紋 '+id)}
/*H*/   C.id=id;return id}
/*H*/ const EG_PACK=egValidateContent();
/*H*/ const EG_FLOW=CONTENT.flow,EG_TERM=CONTENT.terms,EG_MON=CONTENT.monsters;
/*H*/ // 以下是 flow／terms／respond 塔／monsters 等的引擎端函式（說明見 CONTENT-API.md）
/*H*/ function egBossIntro(){EG_FLOW.preBoss?playDialog(EG_FLOW.preBoss,startBoss):startBoss()}
/*H*/ function egShowEnding(){EG_FLOW.preEnding?playDialog(EG_FLOW.preEnding,showEnding):showEnding()}
/*H*/ const egLit=T=>T.respond&&T.respondLit?T.respondLit:EG_TERM.lit,egIgnite=T=>T.respond&&T.respondIgnite?T.respondIgnite:EG_TERM.ignite;
/*H*/ // 回應狀態的塔：不點亮不噴火，只隨心跳明暗
/*H*/ function egRespondSet(T,on){if(!T.respond)return false;T.pulse=!!on;if(!on)return false;T.lit=false;T.light.intensity=0;T.runeMat.color.setHex(T.col).multiplyScalar(.18);return true}
/*H*/ function egPulse(){for(const T of TOWERS)if(T.respond&&T.pulse){const ph=(time*.9)%1,b=Math.exp(-Math.pow((ph-.05)*14,2))+.6*Math.exp(-Math.pow((ph-.3)*14,2));T.light.intensity=.15+1.1*b;T.runeMat.color.setHex(T.col).multiplyScalar(.35+.65*b)}}
/*H*/ // 怪物外觀覆寫：顏色、大小、隱藏部件；mats[0] 身體、mats[1] 四肢／尾／冠刺
/*H*/ function egSkin(type,b){const S=EG_MON[type];if(!S)return b;const m0=b.mats[0],m1=b.mats[1];
/*H*/   if(S.color!==undefined&&m0)m0.color.setHex(S.color);if(S.color2!==undefined&&m1)m1.color.setHex(S.color2);
/*H*/   if(S.glow!==undefined&&m0){m0.emissive.setHex(S.glow);m0.userData.e0.copy(m0.emissive)}
/*H*/   if(S.opacity!==undefined)for(const m of b.mats)if(m.transparent)m.opacity=S.opacity;
/*H*/   const cones=[];b.g.traverse(o=>{if(!o.isMesh)return;if(S.eye!==undefined&&o.material.isMeshBasicMaterial)o.material.color.setHex(S.eye);if(o.geometry.type==='ConeGeometry')cones.push(o)});
/*H*/   if(S.legs!==undefined)b.parts.legs.forEach((L,i)=>{if(i%4>=S.legs)L.piv.visible=false});
/*H*/   if(S.tail===false&&b.parts.tail)b.parts.tail.visible=false;
/*H*/   if(S.spikes!==undefined)cones.filter(o=>!o.geometry.parameters.openEnded).forEach((o,i)=>{if(i>=S.spikes)o.visible=false});
/*H*/   if(S.skirt===false)for(const o of cones)if(o.geometry.parameters.openEnded)o.visible=false;
/*H*/   if(S.scale!==undefined&&S.scale!==1){const inner=new THREE.Group();for(const k of [...b.g.children])inner.add(k);b.g.add(inner);inner.scale.setScalar(S.scale)}
/*H*/   return b}
/*H*/ function EG_KEY(base){return EG_PACK==='demo'?base:base+':'+EG_PACK}
const $=s=>document.querySelector(s);
const V3=THREE.Vector3;
const rand=(a,b)=>a+Math.random()*(b-a), randi=(a,b)=>Math.floor(rand(a,b+1)), pick=a=>a[Math.floor(Math.random()*a.length)];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)), lerp=(a,b,t)=>a+(b-a)*t;
const ss=(e0,e1,x)=>{const t=clamp((x-e0)/(e1-e0),0,1);return t*t*(3-2*t)};
const TAU=Math.PI*2;
function randUnit(){const u=rand(-1,1),a=rand(0,TAU),s=Math.sqrt(1-u*u);return new V3(s*Math.cos(a),u,s*Math.sin(a))}

/* ---------- 雜訊（畫圖集與地面用） ---------- */
function h2(x,y){let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263))|0;h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return (h>>>0)/4294967296}
function vnoise(x,y,P){const xi=Math.floor(x),yi=Math.floor(y);let fx=x-xi,fy=y-yi;fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy);
  const m=P?(k=>((k%P)+P)%P):(k=>k);const a=h2(m(xi),m(yi)),b=h2(m(xi+1),m(yi)),c=h2(m(xi),m(yi+1)),d=h2(m(xi+1),m(yi+1));
  return a+(b-a)*fx+(c-a)*fy+(a-b-c+d)*fx*fy}
function fbm(x,y){let v=0,a=.5;for(let i=0;i<4;i++){v+=a*vnoise(x,y);x=x*2.03+17.1;y=y*2.03+9.7;a*=.5}return v/.9375}
function tileFbm(u,v,base,oct){let s=0,a=.5,n=0;for(let i=0;i<oct;i++){const f=base*(1<<i);s+=a*vnoise(u*f,v*f,f);n+=a;a*=.5}return s/n}
function ramp(h){const st=[[0,.35,.02,0],[.3,.9,.18,.03],[.55,1,.5,.1],[.8,1,.85,.4],[1,1,1,.9]];
  for(let i=1;i<st.length;i++){if(h<=st[i][0]){const a=st[i-1],b=st[i],t=(h-a[0])/(b[0]-a[0]);return [lerp(a[1],b[1],t),lerp(a[2],b[2],t),lerp(a[3],b[3],t)]}}return [1,1,.9]}

/* ---------- 翻頁圖集：四張 4×4 表（火焰／爆炸／濃煙／光點），對應影片「一張圖畫 16 格」路線 ---------- */
function buildAtlas(){
  const S=1024,C=128,cv=document.createElement('canvas');cv.width=cv.height=S;
  const ctx=cv.getContext('2d'),img=ctx.createImageData(S,S),D=img.data;
  for(let sheet=0;sheet<4;sheet++){
    const sx=(sheet%2)*512,sy=Math.floor(sheet/2)*512;
    for(let f=0;f<16;f++){
      const cx=sx+(f%4)*C,cy=sy+Math.floor(f/4)*C,t=f/16,pr=f/15;
      for(let py=0;py<C;py++)for(let px=0;px<C;px++){
        const u=(px+.5)/C-.5,v=(py+.5)/C-.5,r=Math.hypot(u,v);
        let R=0,G=0,B=0,A=0;
        if(sheet===0){
          const n=(1-t)*fbm(u*4+3,v*4+t*3)+t*fbm(u*4+3,v*4+(t-1)*3);
          let h=(.5-r)*2.2+(n-.5)*1.25+Math.max(-v,0)*.5*n;h=clamp(h,0,1);[R,G,B]=ramp(h);A=ss(0,.25,h);
        }else if(sheet===1){
          const Rr=.08+.38*(1-Math.pow(1-pr,2.5)),n=fbm(u*5+11,v*5+4),d=r/Rr;
          const shell=1-ss(0,1,d),inner=lerp(1,ss(0,.8,d),pr),h=shell*(1-pr*.85)*(.6+n*.9)*inner;
          [R,G,B]=ramp(clamp(h*(1.2-pr*.6),0,1));A=clamp(h*1.6,0,1)*(1-pr*pr*pr);
        }else if(sheet===2){
          const n=fbm(u*3+f*.05+20,v*3-f*.08),Rr=.25+.2*pr;
          A=clamp((1-ss(Rr*.3,Rr,r))*(.4+n*.8),0,1);R=G=B=clamp(.22+.18*n-v*.25,0,1);
        }else{
          if(f<8)A=Math.exp(-r*r*28)+Math.exp(-r*r*400)*.5;
          else A=Math.exp(-r*r*40)+Math.max(Math.exp(-Math.abs(u)*40)*Math.exp(-v*v*25),Math.exp(-Math.abs(v)*40)*Math.exp(-u*u*25));
          A=clamp(A,0,1);R=G=B=1;
        }
        A*=ss(.47,.4,Math.max(Math.abs(u),Math.abs(v)));  // 外圈約 4 像素必為全透明，線性取樣才不會滲到隔壁格
        const k=((cy+py)*S+cx+px)*4;D[k]=R*255;D[k+1]=G*255;D[k+2]=B*255;D[k+3]=A*255;
      }
    }
  }
  ctx.putImageData(img,0,0);return cv;
}

/* ---------- 渲染器與場景 ---------- */
const canvas=$('#c');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.75));
renderer.setClearColor(0x090b11);
const scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0x0b0e16,.026);
const camera=new THREE.PerspectiveCamera(42,1,.1,220);
// 鏡頭在主角後上方：高 13、後 11，斜約 50 度、距離 17
const CAM_H=13,CAM_B=11;
function resize(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()}
addEventListener('resize',resize);resize();
const hemi=new THREE.HemisphereLight(0x6f84b8,0x1c1410,.6);scene.add(hemi);
const moon=new THREE.DirectionalLight(0xa4b6ff,.5);moon.position.set(-20,30,10);scene.add(moon);

/* ---------- 粒子系統：一個系統一次畫完，每片方塊永遠轉向鏡頭 ---------- */
const PVS=`
attribute vec3 iPos;attribute vec4 iCol;attribute vec4 iData;attribute float iSeed;
varying vec2 vUv;varying vec4 vCol;varying vec3 vD;
void main(){
  vec4 mv=modelViewMatrix*vec4(iPos,1.0);
  float c=cos(iData.y),s=sin(iData.y);vec2 q=position.xy;
  mv.xy+=vec2(c*q.x-s*q.y,s*q.x+c*q.y)*iData.x;
  gl_Position=projectionMatrix*mv;vUv=uv;vCol=iCol;vD=vec3(iData.z,iData.w,iSeed);
}`;
const PFS=`
uniform sampler2D uAtlas;uniform float uMode;uniform float uTime;
varying vec2 vUv;varying vec4 vCol;varying vec3 vD;
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*vn(p);p=p*2.03+17.1;a*=.5;}return v/.9375;}
vec3 ramp(float h){vec3 c=mix(vec3(.35,.02,0.),vec3(.9,.18,.03),smoothstep(0.,.3,h));c=mix(c,vec3(1.,.5,.1),smoothstep(.3,.55,h));
  c=mix(c,vec3(1.,.85,.4),smoothstep(.55,.8,h));return mix(c,vec3(1.,1.,.9),smoothstep(.8,1.,h));}
void main(){
  float kind=vD.y;vec4 o;
  if(uMode<.5){
    vec2 sheet=vec2(mod(kind,2.),floor(kind/2.));float f=floor(mod(vD.x,16.));
    vec2 cell=vec2(mod(f,4.),floor(f/4.));
    o=texture2D(uAtlas,(sheet*4.+cell+vec2(vUv.x,1.-vUv.y)*.98+.01)/8.);
  }else if(uMode<1.5){
    vec2 p=vUv-.5;float r=length(p);
    if(kind<.5){float n=fbm(p*4.+vec2(0.,-uTime*3.)+vD.z*13.);float h=clamp((.5-r)*2.2+(n-.5)*1.25+max(p.y,0.)*.5*n,0.,1.);o=vec4(ramp(h),smoothstep(0.,.25,h));}
    else if(kind<1.5){float pr=clamp(vD.x/15.,0.,1.);float R=.08+.38*(1.-pow(1.-pr,2.5));float n=fbm(p*5.+vD.z*7.);float d=r/R;
      float h=(1.-smoothstep(0.,1.,d))*(1.-pr*.85)*(.6+n*.9)*mix(1.,smoothstep(0.,.8,d),pr);
      o=vec4(ramp(clamp(h*(1.2-pr*.6),0.,1.)),clamp(h*1.6,0.,1.)*(1.-pr*pr*pr));}
    else if(kind<2.5){float pr=clamp(vD.x/15.,0.,1.);float n=fbm(p*3.+vec2(0.,-uTime*.4)+vD.z*5.);float R=.25+.2*pr;
      o=vec4(vec3(clamp(.22+.18*n+p.y*.25,0.,1.)),clamp((1.-smoothstep(R*.3,R,r))*(.4+n*.8),0.,1.));}
    else{float a=exp(-r*r*28.)+exp(-r*r*400.)*.5;
      if(vD.x>7.5)a=exp(-r*r*40.)+max(exp(-abs(p.x)*40.)*exp(-p.y*p.y*25.),exp(-abs(p.y)*40.)*exp(-p.x*p.x*25.));
      o=vec4(1.,1.,1.,clamp(a,0.,1.));}
    o.a*=smoothstep(.47,.4,max(abs(p.x),abs(p.y)));
  }else{
    float e=max(abs(vUv.x-.5),abs(vUv.y-.5));o=vec4(1.,1.,1.,mix(.07,.95,step(.44,e)));
  }
  o*=vCol;if(o.a<.004)discard;gl_FragColor=o;
}`;
const shared={uAtlas:{value:null},uMode:{value:0},uTime:{value:0}};
class PSys{
  constructor(max,blending,order){
    this.max=max;this.list=[];this.pool=[];
    const g=new THREE.InstancedBufferGeometry(),base=new THREE.PlaneGeometry(1,1);
    g.setIndex(base.index);g.setAttribute('position',base.attributes.position);g.setAttribute('uv',base.attributes.uv);
    const mk=(n,s)=>{const a=new THREE.InstancedBufferAttribute(new Float32Array(max*s),s);a.setUsage(THREE.DynamicDrawUsage);g.setAttribute(n,a);return a};
    this.aPos=mk('iPos',3);this.aCol=mk('iCol',4);this.aData=mk('iData',4);this.aSeed=mk('iSeed',1);
    g.instanceCount=0;this.g=g;
    const m=new THREE.ShaderMaterial({uniforms:shared,vertexShader:PVS,fragmentShader:PFS,transparent:true,depthWrite:false,blending});
    this.mesh=new THREE.Mesh(g,m);this.mesh.frustumCulled=false;this.mesh.renderOrder=order;scene.add(this.mesh);
  }
  emit(o){
    if(this.list.length>=this.max)return null;
    if(!o.follow&&DENSITY<1&&Math.random()>DENSITY)return null;  // 設定裡的粒子密度：低／中只發部分方塊
    const q=this.pool.pop()||{};
    q.x=o.x||0;q.y=o.y||0;q.z=o.z||0;q.vx=o.vx||0;q.vy=o.vy||0;q.vz=o.vz||0;q.age=0;q.life=o.life||1;
    q.s0=o.s0??1;q.s1=o.s1??q.s0;q.rot=o.rot??Math.random()*TAU;q.rs=o.rs||0;
    q.r=o.r??1;q.g=o.g??1;q.b=o.b??1;q.a0=o.a0??1;q.a1=o.a1??0;q.grav=o.grav||0;q.drag=o.drag||0;
    q.kind=o.kind||0;q.fm=o.fm||0;q.fps=o.fps||24;q.frame=o.frame??Math.floor(Math.random()*16);q.seed=Math.random();q.fadeIn=o.fadeIn||0;
    q.follow=o.follow||null;q.ox=o.ox||0;q.oy=o.oy||0;q.oz=o.oz||0;
    this.list.push(q);return q;
  }
  update(dt){
    const L=this.list;
    for(let i=L.length-1;i>=0;i--){
      const q=L[i];q.age+=dt;let dead=q.age>=q.life;
      if(q.follow){if(q.follow.dead)dead=true;else{q.x=q.follow.pos.x+q.ox;q.y=q.follow.pos.y+q.oy;q.z=q.follow.pos.z+q.oz}}
      if(dead){L[i]=L[L.length-1];L.pop();this.pool.push(q);continue}
      if(!q.follow){
        q.vy-=q.grav*dt;if(q.drag){const k=Math.max(0,1-q.drag*dt);q.vx*=k;q.vy*=k;q.vz*=k}
        q.x+=q.vx*dt;q.y+=q.vy*dt;q.z+=q.vz*dt;
        if(q.grav>0&&q.y<.04){q.y=.04;q.vy*=-.3;q.vx*=.6;q.vz*=.6}
      }
      q.rot+=q.rs*dt;
    }
    const P=this.aPos.array,C=this.aCol.array,Dd=this.aData.array,S=this.aSeed.array;
    for(let i=0;i<L.length;i++){
      const q=L[i],t=q.follow?0:Math.min(q.age/q.life,1);
      let a=q.a0+(q.a1-q.a0)*t;if(q.fadeIn)a*=Math.min(1,t/q.fadeIn);
      P[i*3]=q.x;P[i*3+1]=q.y;P[i*3+2]=q.z;
      C[i*4]=q.r;C[i*4+1]=q.g;C[i*4+2]=q.b;C[i*4+3]=a;
      Dd[i*4]=q.s0+(q.s1-q.s0)*t;Dd[i*4+1]=q.rot;
      Dd[i*4+2]=q.fm===0?q.frame+q.age*q.fps:q.fm===1?t*15.999:q.frame;Dd[i*4+3]=q.kind;S[i]=q.seed;
    }
    for(const a of [this.aPos,this.aCol,this.aData,this.aSeed]){a.updateRange.offset=0;a.updateRange.count=L.length*a.itemSize;a.needsUpdate=true}
    this.g.instanceCount=L.length;
  }
}
const SMOKE=new PSys(3000,THREE.NormalBlending,10);
const ADD=new PSys(12000,THREE.AdditiveBlending,20);
function rate(acc,key,r,dt,fn){acc[key]=(acc[key]||0)+r*dt;while(acc[key]>=1){acc[key]--;fn()}}

/* ---------- 燈光池：固定 10 盞，避免數量變動造成卡頓 ---------- */
const LP=[];for(let i=0;i<10;i++){const l=new THREE.PointLight(0xffffff,0,8,2);scene.add(l);LP.push({l,busy:false,t:0,life:0,i0:0,follow:null,flick:0,born:0})}
let lightClock=0;
function getLight(force){let s=LP.find(x=>!x.busy);if(!s&&force){s=LP.reduce((a,b)=>a.born<b.born?a:b)}return s}
function flash(pos,color,inten,dist,life){const s=getLight(true);s.busy=true;s.follow=null;s.t=0;s.life=life;s.i0=inten;s.born=lightClock;s.flick=0;
  s.l.color.setHex(color);s.l.distance=dist;s.l.position.copy(pos);s.l.intensity=inten}
function attachLight(obj,color,inten,dist,force=true,flick=0){const s=getLight(force);if(!s)return null;s.busy=true;s.follow=obj;s.t=0;s.life=Infinity;s.i0=inten;s.born=lightClock;s.flick=flick;
  s.l.color.setHex(color);s.l.distance=dist;s.l.intensity=inten;s.owner=obj;return s}
function releaseLight(h,obj){if(h&&h.busy&&h.owner===obj&&h.life===Infinity){h.busy=false;h.l.intensity=0;h.follow=null}}
const lampLight=new THREE.PointLight(0xffb36b,0,1,1);scene.add(lampLight);
function updateLamp(){const r=stats.light;lampLight.intensity=r>0&&player.alive?1.5:0;lampLight.distance=Math.max(1,r*1.6);
  lampLight.position.set(player.pos.x,2.4,player.pos.z)}
function updateLights(dt){lightClock+=dt;updateLamp();for(const s of LP){if(!s.busy)continue;s.t+=dt;
  if(s.life===Infinity){if(!s.follow||s.follow.dead){s.busy=false;s.l.intensity=0;continue}s.l.position.set(s.follow.pos.x,s.follow.pos.y+(s.follow.ly||0),s.follow.pos.z);s.l.intensity=s.i0*(s.flick?(1-s.flick*.5+Math.random()*s.flick):1)}
  else{const k=1-s.t/s.life;if(k<=0){s.busy=false;s.l.intensity=0}else s.l.intensity=s.i0*k*k}}}

/* ---------- 程式畫出的貼圖 ---------- */
function canvasTex(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);return t}
const groundTex=canvasTex(256,256,(ctx,w,h)=>{const im=ctx.createImageData(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const u=x/w,v=y/h,n=tileFbm(u,v,4,5),g=tileFbm(u+.37,v+.11,2,3),k=(y*w+x)*4,m=ss(.45,.62,g),b=.62+.7*n;
  im.data[k]=lerp(46,30,m)*b;im.data[k+1]=lerp(38,44,m)*b;im.data[k+2]=lerp(33,30,m)*b;im.data[k+3]=255}ctx.putImageData(im,0,0)});
groundTex.wrapS=groundTex.wrapT=THREE.RepeatWrapping;groundTex.repeat.set(14,14);
const crackTex=canvasTex(256,128,(ctx,w,h)=>{const im=ctx.createImageData(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const n=tileFbm(x/w,y/h,6,3),c=Math.pow(clamp(1-Math.abs(n-.5)*7,0,1),3),k=(y*w+x)*4;im.data[k]=255*c;im.data[k+1]=120*c;im.data[k+2]=30*c;im.data[k+3]=255}ctx.putImageData(im,0,0)});
const scorchTex=canvasTex(256,256,(ctx,w,h)=>{const im=ctx.createImageData(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const u=x/w-.5,v=y/h-.5,r=Math.hypot(u,v)*2,n=fbm(u*6+3,v*6),a=clamp((1-ss(.3,1,r+(n-.5)*.5))*.95,0,1),k=(y*w+x)*4;
  im.data[k]=20+40*n*(1-r);im.data[k+1]=10;im.data[k+2]=6;im.data[k+3]=a*255}ctx.putImageData(im,0,0)});
const beamTex=canvasTex(4,128,(ctx,w,h)=>{const g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,'rgba(255,255,255,0)');g.addColorStop(1,'rgba(255,255,255,1)');ctx.fillStyle=g;ctx.fillRect(0,0,w,h)});
const runeTex=canvasTex(512,512,(ctx)=>{
  let sd=7;const r=()=>{sd=(sd*16807)%2147483647;return sd/2147483647};
  ctx.translate(256,256);ctx.strokeStyle='#fff';ctx.fillStyle='#fff';ctx.shadowColor='#fff';ctx.shadowBlur=10;ctx.lineCap='round';
  const ring=(rad,w)=>{ctx.lineWidth=w;ctx.beginPath();ctx.arc(0,0,rad,0,TAU);ctx.stroke()};
  ring(240,5);ring(226,2);ring(168,4);ring(156,2);ring(42,3);
  for(let i=0;i<24;i++){ctx.save();ctx.rotate(i/24*TAU);ctx.lineWidth=3.2;const n=2+Math.floor(r()*3);
    for(let j=0;j<n;j++){ctx.beginPath();ctx.moveTo(-11+r()*22,-218+r()*38);ctx.lineTo(-11+r()*22,-218+r()*38);ctx.stroke()}
    if(r()<.4){ctx.beginPath();ctx.arc(0,-196,4,0,TAU);ctx.stroke()}ctx.restore()}
  ctx.lineWidth=3;ctx.beginPath();for(let i=0;i<=8;i++){const a=(i*3%8)/8*TAU-Math.PI/2;const x=Math.cos(a)*150,y=Math.sin(a)*150;i?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.stroke();
  ctx.lineWidth=2;ctx.beginPath();for(let i=0;i<=8;i++){const a=(i/8)*TAU-Math.PI/2;const x=Math.cos(a)*108,y=Math.sin(a)*108;i?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.stroke();
});
/*H*/ // CONTENT.combat 的開關，預設＝示範版
/*H*/ const combatCfg=()=>{const c=(window.CONTENT&&CONTENT.combat)||{};return{critChance:c.critChance??.12,critMul:c.critMul??1.8,meteorSizeDamage:c.meteorSizeDamage??true,
/*H*/   aoeJitter:c.aoeJitter??true,meteorSizeRadius:c.meteorSizeRadius??true,gearDamage:c.gearDamage??true,sarcSpawn:c.sarcSpawn??['ghost']}};
/*H*/ // 範圍傷害隨機、星墜半徑、裝備傷害、石棺怪物
/*H*/ const egAoeJit=()=>combatCfg().aoeJitter?rand(.9,1.1):1, egMetR=s=>combatCfg().meteorSizeRadius?s:1, egGearMul=m=>combatCfg().gearDamage?m:1;
/*H*/ const egSarcType=()=>{const s=combatCfg().sarcSpawn;return s==='mix'?pickType(story.on&&ACTS[story.act]?ACTS[story.act].mix:[.45,.35,.2]):pick(s)};
/*H*/ // 裝備：關掉傷害詞綴時換成別的詞綴；名稱可由 CONTENT.loot 覆寫
/*H*/ const egPool=pool=>{if(combatCfg().gearDamage)return [...pool];const keep=pool.filter(k=>k!=='fire'&&k!=='spell');for(const k of ['hp','cast','move'])if(keep.length<pool.length&&!keep.includes(k))keep.push(k);return keep};
/*H*/ const egBaseNames=b=>((CONTENT.loot||{}).names||{})[b.type]||b.names, egPrefixes=()=>(CONTENT.loot||{}).prefixes||PREFIX;
/*H*/ // 物件移除時釋放幾何體與材質；egFreeMat 只放材質（共用幾何體）
/*H*/ const egFreeMat=o=>o.traverse(c=>{if(c.material)for(const m of [].concat(c.material))m.dispose()});
/*H*/ const egFree=o=>o.traverse(c=>{if(c.geometry)c.geometry.dispose();if(c.material)for(const m of [].concat(c.material))m.dispose()});
/*H*/ // 回應塔不放火焰；結尾死亡重來；對白中不開行囊；半透明主體投影
/*H*/ const egFx=T=>!T.respond;
/*H*/ function egBossDownRestart(){if(story.phase==='outro'){playDialog(EG_FLOW.down,egShowEnding);return true}if(story.phase==='end'){showEnding();return true}return false}
/*H*/ const egNoBag=()=>!!dlg&&$('#inv').hidden;
/*H*/ // lighting.js 的 mark() 用 (m.transparent && !egShadowBody(m)) 決定半透明主體投不投影
/*H*/ const egShadowBody=m=>!!((CONTENT.render||{}).shadowTransparentBodies)&&m.blending===THREE.NormalBlending&&m.depthWrite&&m.opacity>=.5;
/*H*/ // 擴充腳本介面 window.EG（kit/ 之後載入的 script 用，見 CONTENT-API.md）：法術參數、事件、暫停
/*H*/ const spellP=id=>SPELLS[id],EG_EV={},EG_EVENTS='towerLit actStart bossStart bossDown cast hit kill playerDeath restart ending newGame continueGame blink dialogStart dialogEnd'.split(' ');let egHeld=false;
/*H*/ // egQ＝施法動作中按下的招式與當時的動作（動作結束那格施放）；egMusicOff＝擴充腳本關掉內建音樂
/*H*/ let egQ=[],egMusicOff=false;
/*H*/ // 暫停的持有者、保留鍵、技能列數字（1–10 寫中文數字）
/*H*/ const EG_PO=new Set(),EG_RK={},egZh=n=>n>0&&n<11?'一二三四五六七八九十'[n-1]:n;
/*H*/ addEventListener('keydown',e=>{const b=EG_RK[e.code]&&$('.keybtn.waiting');if(b){e.preventDefault();e.stopImmediatePropagation();b.textContent='這個鍵保留給'+EG_RK[e.code]}},true);
/*H*/ const egW=m=>console.warn('[EG] '+m);
/*H*/ function egEmit(n,a){const L=EG_EV[n];if(L)for(const f of [...L])try{f(a)}catch(e){egW(n+' listener threw: '+(e&&e.message||e))}}
/*H*/ // 火球追蹤：轉向前方 homingCone 度以內最近的活怪，每秒最多轉 homingTurn 弧度
/*H*/ function egHome(p,dt){const F=spellP('fire');if(!(F.homingTurn>0))return;const sp=Math.hypot(p.vel.x,p.vel.z),c=Math.cos(F.homingCone*Math.PI/180);let best=null,bd=1e9;
/*H*/   for(const e of enemies){if(!e.alive)continue;const dx=e.pos.x-p.pos.x,dz=e.pos.z-p.pos.z,d=Math.hypot(dx,dz)||1e-6;if((dx*p.vel.x+dz*p.vel.z)/(d*sp)>=c&&d<bd){bd=d;best=e}}
/*H*/   if(!best)return;const cur=Math.atan2(p.vel.x,p.vel.z),df=Math.atan2(best.pos.x-p.pos.x,best.pos.z-p.pos.z)-cur,a=cur+clamp(Math.atan2(Math.sin(df),Math.cos(df)),-F.homingTurn*dt,F.homingTurn*dt);p.vel.x=Math.sin(a)*sp;p.vel.z=Math.cos(a)*sp}
/*H*/ // 星墜 arc 排法：圓心是施法者、半徑是到落點的距離（至少 arcMinRadius），在施法方向排一段長 arcLength 的弧，依落下順序從一端排到另一端
/*H*/ function egArc(T,i,M){const x=player.pos.x,z=player.pos.z,R=Math.max(M.arcMinRadius,Math.hypot(T.x-x,T.z-z)||1),a=Math.atan2(T.z-z,T.x-x)+(M.drops>1?i/(M.drops-1)-.5:0)*M.arcLength/R;return new V3(x+Math.cos(a)*R,0,z+Math.sin(a)*R)}
/*H*/ window.EG={on(n,f){if(!EG_EVENTS.includes(n)||typeof f!=='function')return egW('on: unknown event or not a function: '+n);(EG_EV[n]=EG_EV[n]||[]).push(f)},
/*H*/   off(n,f){const L=EG_EV[n]||[],i=L.indexOf(f);if(i>=0)L.splice(i,1)},
/*H*/   setSpellParams(id,o){const D=SPELL_DEF[id];if(!D||!o||typeof o!=='object'){egW('setSpellParams: unknown spell or not an object: '+id);return false}let all=true;
/*H*/     for(const k of Object.keys(o)){const v=o[k],d=D[k],good=d!==undefined&&typeof v===typeof d&&(typeof v==='string'?['scatter','arc'].includes(v):v>=0&&isFinite(v)&&(!/^(shots|bounces|drops|bolts)$/.test(k)||Number.isInteger(v)));
/*H*/       if(good)SPELLS[id][k]=v;else{all=false;egW('setSpellParams: '+id+'.'+k+' ignored (unknown key, wrong type or out of range)')}}refreshSkillLabels();return all},
/*H*/   resetSpellParams(id){for(const k of id===undefined?Object.keys(SPELL_DEF):[id])if(SPELL_DEF[k])Object.assign(SPELLS[k],SPELL_DEF[k]);else egW('resetSpellParams: unknown spell '+k);refreshSkillLabels()},
/*H*/   spellParams(id){return SPELLS[id]?{...SPELLS[id]}:undefined},
/*H*/   pause(on,o='default'){EG_PO[on?'add':'delete'](o);egHeld=EG_PO.size>0},isPaused:()=>egHeld,pausedBy:()=>[...EG_PO],inCombat:()=>enemies.some(e=>e.alive)||story.phase==='boss',events:[...EG_EVENTS],
/*H*/   player:()=>({x:player.pos.x,z:player.pos.z,hp:player.hp,maxHp:player.maxhp,alive:player.alive}),
/*H*/   towers:()=>TOWERS.map((T,i)=>({index:i,name:T.name,spell:T.spell,x:T.x,z:T.z,lit:!!(T.lit||T.pulse),active:story.on&&i===story.act&&!T.lit&&!T.pulse})),
/*H*/   ui(){const h=i=>!$('#'+i).hidden;return{running,story:story.on,dialog:!!dlg,menu:menuOpen,result:h('result'),ending:h('ending'),inventory:h('inv'),settings:h('settings')}},
/*H*/   isTouch:()=>!!(window.EGControls&&EGControls.touch),reservedKeys:()=>({...EG_RK}),
/*H*/   enemyCount:()=>enemies.filter(e=>e.alive).length,nearestEnemy(){let b=null,d=1/0;for(const e of enemies){const k=Math.hypot(e.pos.x-player.pos.x,e.pos.z-player.pos.z);if(e.alive&&k<d){d=k;b=e}}return b&&{distance:d,type:b.type}},
/*H*/   music(on){egMusicOff=!on;if(!AC)return;if(on)return startMusic();if(!musicTimer)return;clearInterval(musicTimer);musicTimer=null;const o=musicBus;o.gain.setTargetAtTime(0,AC.currentTime,.1);setTimeout(()=>o.disconnect(),900);(musicBus=AC.createGain()).connect(master);applySettings()},musicBus:()=>musicBus,
/*H*/   reserveKey(c,l){if(typeof c!=='string'||!c)return egW('reserveKey: not a key code: '+c);EG_RK[c]=String(l||c);
/*H*/     for(const n in KB)if(KB[n]===c){const d=KB_DEFAULT[n]===c?'':KB_DEFAULT[n];egW(`reserveKey: ${c} was bound to ${n}, now ${d||'unbound'}`);KB[n]=d}window.EGControls&&EGControls.redrawKeys()},
/*H*/   seed(n){Math.random=n==null?_sysRandom:mulberry32(n)},
/*H*/   clearEffects(){for(const S of [ADD,SMOKE]){S.pool.push(...S.list);S.list.length=0}const k=(L,f)=>{for(const o of L.splice(0)){o.dead=true;f(o)}},r=(m,g)=>{scene.remove(m);(g?egFree:egFreeMat)(m)};
/*H*/     k(projs,o=>0);k(meteors,o=>{r(o.mesh);r(o.ring)});k(rocks,o=>r(o.mesh));k(burns,o=>r(o.decal,1));k(rites,o=>r(o.mesh,1));k(shocks,o=>r(o.mesh));k(dmgs,o=>o.el.remove());timers.length=caAcc=emitHot.acc=0;ambAcc={};for(const T of TOWERS)T.acc={}}};
