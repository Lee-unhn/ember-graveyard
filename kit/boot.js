// 開機：翻頁圖集換圖、讀取畫面、完成後開放按鈕（主迴圈由頁面最後一行 loop() 啟動）
// 依序載入的一般 script，頂層名稱在檔案之間共用（見 core.js）。
'use strict';
/* ---------- 開場 ---------- */
/*H*/ // 與內容有關的頁面文字由內容包填入
/*H*/ $('#bossbar .nm').textContent=CONTENT.text.bossName;
/*H*/ if(CONTENT.text.introNote)$('#introNote').textContent=CONTENT.text.introNote;
/*H*/ if(CONTENT.text.endNote)$('#ending .note').textContent=CONTENT.text.endNote;
/*H*/ // CONTENT.monsters.<種類>.name 覆寫怪物名稱（外觀覆寫在 core.js 的 egSkin）
/*H*/ for(const [k,m] of Object.entries(EG_MON))if(m.name&&ETYPES[k])ETYPES[k].name=m.name;
/*H*/ // 手機（寬 760 以下或橫放高 480 以下）的頂部排版：目標欄與血條排在狀態欄之下
/*H*/ {const st=document.createElement('style'),sa='env(safe-area-inset-top,0px)';st.id='egPhoneHud';
/*H*/   st.textContent='@media (max-width:760px){#objective{width:max-content;max-width:calc(100vw - 24px);white-space:normal;text-align:center;max-height:76px;overflow:hidden;box-sizing:border-box}}'
/*H*/     +'@media (max-width:760px) and (orientation:portrait){body #rotateHint{top:calc(88px + '+sa+')}#objective{top:calc(124px + '+sa+')}#bossbar{top:calc(206px + '+sa+')}}'
/*H*/     +'@media (max-width:760px) and (orientation:landscape),(max-height:480px) and (orientation:landscape){#objective{max-width:max(160px,calc(100vw - 440px))}#bossbar{top:calc(96px + '+sa+')}}';document.head.appendChild(st)}
setRoute(0);setTier(1);
if(matchMedia('(pointer:coarse)').matches&&!matchMedia('(pointer:fine)').matches)$('#introNote').textContent='這個試玩需要鍵盤與滑鼠，手機上只能看畫面。';
let atlas=null,atlasTex=null,atlasOrig=null;
function refreshAtlas(){atlasTex.needsUpdate=true;const v=$('#atlasView').getContext('2d');v.clearRect(0,0,512,512);v.drawImage(atlas,0,0,512,512)}
function replaceSheet(sheet,img){
  // 黑底圖轉透明：越亮越不透明；顏色除回亮度，疊加發光時才不會變暗
  const t=document.createElement('canvas');t.width=t.height=512;const c=t.getContext('2d');c.drawImage(img,0,0,512,512);
  const d=c.getImageData(0,0,512,512),p=d.data;
  for(let i=0;i<p.length;i+=4){const m=Math.max(p[i],p[i+1],p[i+2]);if(sheet===2){const l=(p[i]+p[i+1]+p[i+2])/3;p[i+3]=Math.min(255,l*1.6);}else{p[i+3]=m;if(m>0){const k=255/m;p[i]=Math.min(255,p[i]*k);p[i+1]=Math.min(255,p[i+1]*k);p[i+2]=Math.min(255,p[i+2]*k)}}}
  const ctx=atlas.getContext('2d'),sx=(sheet%2)*512,sy=Math.floor(sheet/2)*512;ctx.clearRect(sx,sy,512,512);ctx.putImageData(d,sx,sy);refreshAtlas()}
$('#sheetFile').addEventListener('change',e=>{const f=e.target.files[0];if(!f||!atlas)return;const img=new Image();img.onload=()=>{replaceSheet(+$('#sheetSel').value,img);URL.revokeObjectURL(img.src);setRoute(0);note('已換上新的翻頁圖')};
  img.onerror=()=>note('這個檔案讀不出來，請換 PNG 或 JPG');img.src=URL.createObjectURL(f);e.target.value=''});
$('#sheetReset').onclick=()=>{if(!atlas)return;atlas.getContext('2d').putImageData(atlasOrig,0,0);refreshAtlas();note('已還原程式畫的翻頁圖')};
// 讀取：先讓讀取畫面畫出來，再做最花時間的翻頁圖集，完成後才開放按鈕
setTimeout(()=>{$('#ldfill').style.width='45%';$('#ldstep').textContent='畫翻頁圖集…';
  setTimeout(()=>{
    atlas=buildAtlas();atlasOrig=atlas.getContext('2d').getImageData(0,0,1024,1024);
    atlasTex=new THREE.CanvasTexture(atlas);atlasTex.flipY=false;atlasTex.minFilter=THREE.LinearFilter;atlasTex.generateMipmaps=false;shared.uAtlas.value=atlasTex;
    refreshAtlas();$('#ldfill').style.width='100%';$('#ldstep').textContent='完成';
    $('#loading').hidden=true;refreshTitle();
    const go=$('#go');go.disabled=false;go.textContent='自由試玩';go.onclick=startFree;
    const gs=$('#goStory');gs.disabled=false;gs.onclick=()=>startStory(0);
  },40)},30);
$('#again').onclick=restart;
