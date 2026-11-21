// 引擎核心：數學小工具、雜訊、翻頁圖集、渲染器、粒子系統、燈光池、程式畫的貼圖
// 以下各檔是依序載入的一般 script，頂層 const／let／function 在檔案之間以名稱共用（順序見 index.html）。
'use strict';
if(!window.CONTENT)throw new Error('CONTENT 未載入：請先載入 content/<內容包>/*.js 再載入 kit/（見 kit/CONTENT-API.md）');
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
// 鏡頭在主角後上方：高 13、後 11，約斜 50 度往下看、距離 17（原本高 18.5、斜 59 度，幾乎正上方）
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

