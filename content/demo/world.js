// 示範內容（A 的燼語墓園）：塔與幕的設定、首領名稱、資料檔路徑
// 只放資料；kit/ 載入時讀 window.CONTENT。換內容＝另寫一組同樣欄位的檔案（見 kit/CONTENT-API.md）。
'use strict';
window.CONTENT = window.CONTENT || {};
// 塔：name／dir 畫面文字，spell 解鎖的招式，col／c／kind 塔火顏色與粒子；位置在 towerPos（同順序）
CONTENT.towers=[
  {name:'焰之塔',dir:'北',spell:'fire',col:0xff7a2e,c:[1,.55,.2],kind:0},
  {name:'雷之塔',dir:'東',spell:'bolt',col:0x6fb8ff,c:[.45,.75,1],kind:3},
  {name:'星之塔',dir:'南',spell:'meteor',col:0xffc35a,c:[1,.8,.45],kind:0},
  {name:'血之塔',dir:'西',spell:'blood',col:0xff2a3c,c:[1,.15,.25],kind:3}];
CONTENT.towerPos=[[0,-15],[16,-1],[1,16],[-16,1]];
// 幕：n＝這幕要擊倒的數量，mix＝三種怪的比例，dlg＝開幕對白代號，after＝點亮塔後播的對白代號
CONTENT.acts=[{dlg:'intro',n:18,mix:[1,0,0],after:'t1'},{n:24,mix:[.6,.4,0],after:'t2'},{n:28,mix:[.45,.35,.2],after:'t3'},{n:30,mix:[.35,.35,.3],after:'t4'}];
// 內容包識別：存檔鍵名用它區分；'demo' 沿用原鍵名，其他內容包請取不同的 id
CONTENT.id='demo';
// 畫面文字：bossName 首領名；introNote 標題說明、endNote 結局結語（後兩項選填）
CONTENT.text={bossName:'無燈之主',
  introNote:'故事模式約 15 分鐘：點亮四座燈塔、學會四招法術，最後對上無燈之主。自由試玩：四招全開，可切換拆解台。需要鍵盤與滑鼠；怪物死後會掉裝備，走過去自動撿起，按 I 穿上。',
  endNote:'四座燈塔重新亮起。燼語墓園今晚會很安靜。'};
// 對白語音檔的資料夾（檔名＝對白代號_第幾句_說話者.ogg）、人偶模型的腳本檔
CONTENT.voiceDir='content/demo/voice/';
CONTENT.modelScript='content/demo/models/mage-model.js';
