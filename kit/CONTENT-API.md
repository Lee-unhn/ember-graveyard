# kit/ 與內容包的介面

`kit/` 是引擎：渲染、粒子、地形、法術、怪物、裝備、存檔、設定、後製、像素角色、光影、地面細節、霧、觸控、角色模型載入、故事流程的規則。
**內容**（對白、說話者、塔與幕的設定、首領名稱、語音與模型的路徑）不在 `kit/`，由一組放在 `window.CONTENT` 的資料提供。A 的示範內容在 `content/demo/`；另一個遊戲想只取引擎，就引入 `kit/`，自己寫一組同樣欄位的內容包。

## 載入順序（index.html 負責）

1. three.js（CDN）
2. 內容包的 script（全部先於 `kit/`），每個只做 `window.CONTENT = window.CONTENT || {}` 再補欄位
3. `kit/core.js`、`world.js`、`combat.js`、`systems.js`、`story.js`、`ui.js`、`boot.js`（一般 script，不加 `defer`，依序執行；頂層 `const`／`let`／`function` 在檔案之間以名稱共用，不是 ES module）
4. `kit/controls.js` 起的 `defer` 腳本（觸控與改鍵、閃現 `kit/blink.js`、後製、像素角色、光影、地面細節、霧、角色載入器；`blink.js` 要排在 `controls.js` 之後），整份文件解析完才依文件順序執行
5. 頁面最後一個內嵌 script 只呼叫 `loop()` 啟動主迴圈

`kit/core.js` 開頭檢查 `window.CONTENT`，沒有就丟出明確錯誤，並把原因寫在讀取畫面上（之後任何同步 script 找不到或丟錯，只要讀取畫面還開著，也會顯示「載入失敗：…」）。

## 載入時驗證與缺欄位的處理

| 情況 | 引擎怎麼做 |
|---|---|
| 缺 `towers`／`towerPos`／`acts`、其中一項不是有內容的陣列、塔或幕的欄位不對、`towerPos` 或 `acts` 的數量不等於 `towers` | 停止載入，讀取畫面寫出一行指名欄位的訊息（例：`CONTENT.acts 有 5 幕，要等於 CONTENT.towers 的 4 座`） |
| 缺 `speakers`／`portraits`／`dialog`／`text.bossName`／`voiceDir`／`modelScript`／`id`，或單句對白格式不對 | 補安全預設（空物件、空名字、空頭像、「首領」、不放語音、方塊法師、內容指紋），警告記在 `window.__contentWarnings` 與 `console.warn`，不丟例外 |
| 執行中對白代號、說話者、頭像查不到 | 對白略過、名字留空、頭像留空，記警告；`logic()` 不丟例外 |

## 欄位

| 欄位 | 型別 | 引擎怎麼用 |
|---|---|---|
| `CONTENT.speakers` | `{ 代號: { n: 顯示名, c: 名字顏色, pitch, rate } }` | 對白框的說話者名字與顏色；`pitch`／`rate` 給瀏覽器內建朗讀（預錄語音放不出來時的備援） |
| `CONTENT.portraits` | `{ 代號: SVG 內容字串 }` | 放進 84×84 的 `<svg id="dPortrait">`；代號要與 `speakers` 一致 |
| `CONTENT.dialog` | `{ 對白代號: [[說話者代號, 文字], ...] }` | 引擎用 `playDialog(對白代號)` 播放；預設 `dark` 在首領血量過半時播、`end` 在首領倒下後播（代號可由 `CONTENT.flow` 改，另有 `preBoss`／`preEnding`），其餘代號由 `acts` 指定。查不到的代號（含沒給 `dark`／`end`）直接略過那段對白、故事照常往下走 |
| `CONTENT.towers` | `[{ name, dir, spell, col, c, kind, respond?, respondIgnite?, respondLit? }]` | 每座塔一筆：畫面文字、解鎖的招式（`fire`／`bolt`／`meteor`／`blood`）、塔火顏色（`col` 十六進位、`c` 是 0–1 的 RGB）、粒子種類；順序＝點亮順序 |
| `CONTENT.towerPos` | `[[x, z], ...]` | 與 `towers` 同順序的位置；地形的石板路、障礙與出怪都依這份排 |
| `CONTENT.acts` | `[{ n, mix, dlg?, after }]` | 每幕要擊倒的數量、三種怪的比例、開幕對白代號（選填）、點亮塔後播的對白代號；幕數要等於塔數 |
| `CONTENT.text.bossName` | 字串 | 首領血條名字（`boot.js` 讀取時填入 `#bossbar .nm`）、提示文字、死亡畫面；沒給就用「首領」並記警告 |
| `CONTENT.text.introNote` | 字串（選填） | 標題畫面的開場說明（填入 `#introNote`）；不給就留空 |
| `CONTENT.text.endNote` | 字串（選填） | 結局畫面的結語；不給就留空 |
| `CONTENT.text.loadTips` | 非空的字串陣列（選填） | 讀取畫面的提示，每次隨機挑一句；不給就用示範版的七句 |
| `CONTENT.id` | 字串（`A-Z a-z 0-9 _ -`，最長 40） | 內容包識別：存檔 `eg-save`、設定 `eg-settings`、改鍵 `eg-keys` 的鍵名會變成 `<鍵名>:<id>`，同網域的兩個內容包互不讀到對方的存檔。**id 為 `demo` 時沿用原本的鍵名**（示範版的既有玩家存檔不失效）；其他內容包請取不同的 id。沒給就用內容指紋（`p…`）並記警告 |
| `CONTENT.voiceDir` | 字串（選填，結尾沒有 `/` 會自動補） | 預錄語音資料夾，檔名＝`對白代號_第幾句_說話者代號.ogg`；不給就直接用瀏覽器朗讀，不向伺服器要檔案 |
| `CONTENT.modelScript` | 字串（選填） | 人偶模型的腳本檔（定義 `window.MAGE_GLB`）；不給就用程式拼的方塊法師 |

## 流程、用語、塔的回應狀態、怪物外觀（全部可選）

這四組欄位讓內容包不必靠外掛改寫引擎行為。**全部可選；沒給就是示範版現有的行為與用語**（示範內容一個都沒設，存檔與數值不受影響）。型別或範圍不對，載入時停下來，讀取畫面寫一行指名欄位的訊息（例：`CONTENT.monsters.ghost.scale 要是 0.5 到 3 的數字`）；欄位名打錯、欄位放在不適用的怪物上、指到不存在的對白代號，只記警告、不影響載入。

### `CONTENT.flow`：流程用的對白代號

| 欄位 | 預設 | 說明 |
|---|---|---|
| `preBoss` | 不播 | 最後一座塔的 `after` 對白結束後、首領出場前播放；播完首領才登場。死亡後從首領戰重來不會再播 |
| `preEnding` | 不播 | 首領倒下、`down` 對白播完後、結局畫面出現前播放 |
| `half` | `'dark'` | 首領血量過半時播放的對白（同一時間畫面變暗） |
| `down` | `'end'` | 首領倒下後播放的對白 |

值是 `CONTENT.dialog` 的代號（有內容的字串）。代號查不到就略過那段對白、故事往下走。

### `CONTENT.terms`：介面用語

引擎組句子時用的詞；每個值是有內容的字串。

| 欄位 | 預設 | 用在哪 |
|---|---|---|
| `tower` | `燈塔` | 「這招還沒學會，先點亮燈塔」 |
| `light` | `點亮` | 同上的動詞 |
| `lit` | `點亮了` | 「甲塔點亮了」：提示、目標欄、階段結算標題 |
| `ignite` | `點燃` | 目標欄「點燃甲塔　45%」 |
| `go` | `前往` | 目標欄與提示「前往甲塔」 |
| `undead` | `亡者` | 目標欄「擊倒甦醒的亡者」、各處提示裡對怪物的稱呼 |
| `monster` | `怪物` | 死因沒有指名來源時的稱呼（死亡畫面「擊倒你的是：怪物」） |
| `sarcBreak` | `石棺裂開，殘魂竄了出來` | 打破石棺時的提示（內容包的怪物名字不同時一定要換） |
| `lampName` | `燼燈` | 故事模式開場送的那盞提燈的名字 |
| `lampGet` | `得到一盞燼燈：身邊照亮 5 公尺（按 I 看裝備）` | 收到提燈時的提示 |
| `bossShock` | `首領衝擊波` | 首領衝擊波造成的死因名稱 |
| `lava` | `熔岩` | 站在岩漿上造成的死因名稱 |
| `gas` | `磷火爆炸` | 磷火爆炸造成的死因名稱 |
| `hintGo` | `跟著地上的箭頭與光柱走` | 目標欄「前往某塔」下面的小字 |
| `hintIgnite` | `站在塔下，別離開` | 目標欄「點燃某塔」下面的小字 |
| `hintBoss` | `紫色衝擊波會往外擴散：退到圈外，或貼近牠躲進圈內` | 首領戰目標欄下面的小字 |
| `tipLava`／`tipShock`／`tipGas` | 示範版的三句提示 | 死亡畫面「提示：」那一行，依死因（`lava`／`bossShock`／`gas` 的字串）查；死因是別的來源時用 `tipDefault` |
| `tipDefault` | `被包圍時用星墜清場，或把怪物引進燃燒的草地。` | 死亡畫面預設的提示 |

死因名稱（`monster`、`lava`、`gas`、`bossShock`）同時是查死亡提示的鍵，改名後 `tipLava` 等會跟著對上。
標題、說明、製作群等頁面上的固定文字在 `index.html`，不在這張表內（那些走 `CONTENT.text`）。

### 塔的回應狀態（`CONTENT.towers[i]` 的選填欄位）

| 欄位 | 預設 | 說明 |
|---|---|---|
| `respond` | `false` | `true`＝這座塔不點亮、不噴火，只隨心跳明暗（兩拍一組，約每 1.1 秒）；玩家照樣走到塔下「點燃」，招式照樣解鎖，故事照常往下走 |
| `respondIgnite` | `terms.ignite` | 這座塔進行中的用語（目標欄「守候乙塔　45%」） |
| `respondLit` | `terms.lit` | 這座塔完成的用語（提示與結算標題「乙塔應答了」） |

`respondIgnite`／`respondLit` 只在 `respond` 為 `true` 時使用，否則記警告。

### `CONTENT.monsters`：怪物名稱與外觀

鍵是怪物種類 `spider`／`lizard`／`ghost`／`lord`，值是下表欄位的物件（每個欄位都可選）。範圍限於引擎現有模型能做到的：**換色、縮放、隱藏部件、透明度，不換造型**。顏色一律是 0 到 `0xffffff` 的整數（同 `towers[i].col`）。

| 欄位 | 範圍 | 說明 |
|---|---|---|
| `name` | 字串 | 顯示名稱（死亡畫面的死因會用）；不改首領血條名字（那是 `text.bossName`） |
| `color` | 顏色 | 身體主色（第一種材質） |
| `color2` | 顏色 | 副色：蜘蛛的腿、蜥蜴的尾與腿、首領的冠刺（第二種材質）；殘魂沒有副色 |
| `eye` | 顏色 | 眼睛（不受光的材質） |
| `glow` | 顏色 | 主色材質的自發光；受擊閃白後會回到這個值 |
| `opacity` | 0–1 | 半透明的怪物（殘魂、首領）的不透明度；本來不透明的材質不受影響 |
| `scale` | 0.5–3 | 整體大小，**只改畫面**（碰撞半徑、血條位置、數值不變）；用內層群組縮放，受擊抖動不會把它蓋回 1 |
| `legs` | 1–4 的整數 | 只給 `spider`：每側留幾隻腳（預設 4） |
| `tail` | 布林 | 只給 `lizard`：`false` 隱藏尾巴 |
| `spikes` | 0–7 的整數 | 只給 `lord`：頭上冠刺留幾根（預設 7） |
| `skirt` | 布林 | 只給 `ghost`：`false` 隱藏下襬，只剩頭 |

### 手機寬度的頂部排版（引擎自帶，不是內容欄位）

寬度 760 像素以下（或橫放時高度不到 480 像素，例如 812×375 的手機），目標欄與首領血條原本會蓋住左上的狀態欄、右上的行囊／暫停鈕與「橫放手機」提示，彼此也會重疊。`kit/boot.js` 載入時加一段樣式：直立時目標欄與血條排在那一排下面，橫放時目標欄排在中間，目標欄限制寬度、文字可折行。樣式由引擎出貨，內容包與頁面不必各自補。

## 戰鬥參數（可選 `CONTENT.combat`）

| 欄位 | 預設（示範版） | 說明 |
|---|---|---|
| `critChance` | 0.12 | 每次命中的暴擊機率；設 0 關閉暴擊與暴擊停格 |
| `critMul` | 1.8 | 暴擊傷害倍率 |
| `meteorSizeDamage` | true | 星墜每顆的大小係數是否乘到傷害；false 時大小不影響傷害 |
| `meteorSizeRadius` | true | 星墜每顆的大小係數是否乘到判定半徑（落點傷害、燃燒、岩漿、毀物）；false 時半徑固定為基準，大小只影響外觀 |
| `aoeJitter` | true | 範圍傷害（焰核彈爆炸、星墜、燃燒、血環無目標時）是否每次乘 ±10% 的隨機；false 時是固定值 |
| `gearDamage` | true | 裝備是否提供火焰傷害與法術傷害百分比；false 時裝備不再擲出這兩種詞綴（改擲生命上限、施法速度、移動速度，條數不變），`fireMul()`、`spellMul()` 恆為 1 |
| `sarcSpawn` | `['ghost']` | 石棺打破時放出的怪物：`spider`／`lizard`／`ghost` 組成的非空陣列（每隻從中隨機挑），或字串 `'mix'`（照當幕的 `acts[i].mix` 比例，只會出現比例大於 0 的怪；自由試玩用預設比例）。每次兩隻 |

傷害要只來自內容包自己的機制時，設 `critChance: 0, meteorSizeDamage: false, meteorSizeRadius: false, aoeJitter: false, gearDamage: false`。型別不對載入時停下並指名欄位（例：`CONTENT.combat.sarcSpawn 要是 "mix"，或 spider／lizard／ghost 組成的非空陣列`）。

## 裝備命名（可選 `CONTENT.loot`）

| 欄位 | 預設 | 說明 |
|---|---|---|
| `names` | 示範版的裝備名 | `{ 種類: [名字, ...] }`，種類是 `staff`、`helm`、`armor`、`gloves`、`boots`、`ring`、`amulet`、`lantern`；沒列到的種類沿用示範名；每個陣列要非空 |
| `prefixes` | 示範版的六個稀有前綴 | 稀有與傳奇裝備名前面隨機加一個；非空的字串陣列 |

只換名字，不換形狀、格數、稀有度與詞綴；詞綴的傷害百分比用 `combat.gearDamage` 關。

## 畫面（可選 `CONTENT.render`）

| 欄位 | 預設 | 說明 |
|---|---|---|
| `shadowTransparentBodies` | false | 畫質「高」時，半透明（不透明度 0.5 以上、一般混合、寫入深度）的主體要不要投影。長袍、幽魂這類外觀為了半透明設成透明材質，預設不投影（示範版現況）；設 true 後它們像不透明的怪物一樣有影子。光柱、地面光暈、貼地陰影不受影響 |

## 引擎行為（不是內容欄位，內容包不必設定）

- **資源釋放**：怪物死亡或換幕清場時，會釋放它的幾何體與材質；掉落物、焦痕貼花、血環的材質也一併釋放。連續遊玩時上傳到顯示卡的幾何體數量會回到基準附近，不再隨怪物數一路成長。
- **首領倒下後死亡**：首領倒下到結局畫面之間（結尾階段）玩家死亡，按重來不會回到上一幕、也不會抹掉首領戰；直接接著播 `flow.down` 的對白，再進結局。已在結局畫面時按重來，留在結局畫面。
- **首領戰重來不重播首領對白**：重來只是重新生出首領，登場對白（`flow.preBoss`）不會再播。
- **對白中不開行囊**：對白顯示時，I、Tab 與行囊按鈕都不會打開行囊（已經開著的行囊仍可關掉）。
- **施法動作中按下的招式會記住**：按下招式鍵（或點技能格、按右鍵）時，若主角正在做另一招的施法動作，這一次按鍵不會被丟掉，而是記下來（只記最後一次），在目前的動作結束的那一格施放，瞄準用那一格的游標位置。那一格冷卻還沒好、暫停、選單或對白開著、擴充暫停或主角倒下時就不施放，也不再留著。目前的動作被中斷（例如主角倒下）時，記下的按鍵作廢。按住左鍵的連發不會蓋掉記下的按鍵。冷卻未好、還沒學會、暫停中按下的鍵，照舊不施放、也不記住。
- **改鍵等待不外漏**：設定裡某一列正在等按鍵時，只要「設定」畫面被關上（返回鈕、Esc、回標題、開始遊玩，任何方式），等待立刻取消、不綁任何鍵，下一個按鍵照常交給遊戲。
- **回應狀態的塔**（`towers[i].respond: true`）：「點燃」進行中與完成時都不放火焰與爆炸粒子，只有心跳明暗。

## 擴充腳本：法術參數與事件（Extension scripts: spell parameters and events）

內容包只能放資料（上一節的閘門會擋下函式與流程控制）。要在遊戲進行中改數值、聽事件、跳出自己的面板，寫一支**擴充腳本**：排在 `kit/boot.js` 之後載入的一般 script（例如 `<script src="ext/upgrade.js" defer></script>`），透過 `window.EG` 操作引擎。擴充腳本不是內容包，不受「內容只能放資料」的檢查；頁面載入它時，它的大小計入程式碼預算。

### 法術參數表

四招的數字都在 `kit/combat.js` 的 `SPELL_DEF`（預設值），執行中一律經 `spellP(id)` 讀一份可覆寫的副本，**施放與命中當下才讀**，所以改了之後的下一次施放、下一次彈跳就生效。不覆寫時數值與行為和示範版完全相同。

技能列上寫出數字的文字也由這張表產生：升級後的火球「三連發」來自 `fire.shots`、鏈雷「彈跳 6 次」來自 `bolt.bounces`、星墜「十顆連落」來自 `meteor.drops`（1 到 10 寫中文數字，其他寫阿拉伯數字，例如 `drops: 12` 顯示「12顆連落」）。`EG.setSpellParams`／`EG.resetSpellParams` 之後技能列立刻重寫；冷卻圈本來就讀 `cd`。`kit/` 的介面文字裡沒有其他寫死的法術數字（說明頁的「命中炸出 40 顆火星」是爆炸粒子數，不是法術參數）。

| 招式 `id` | 欄位（預設） | 說明 |
|---|---|---|
| 全部 | `cd`、`dur`、`rel` | 冷卻秒數、施法動作秒數、動作進行到幾成時放出（皆再除以施法速度）；技能列的冷卻圈也讀 `cd` |
| `fire` | `shots: 3`、`spread: 0.2` | 升級後一次幾顆、相鄰兩顆的夾角（弧度），以瞄準方向為中心排開；未升級固定 1 顆 |
| `fire` | `damage: 34`、`radius: 2.2`、`speed: 19`、`life: 1.3` | 爆炸傷害（再乘火焰傷害倍率）、爆炸半徑、飛行速度（每秒公尺）、飛行秒數 |
| `fire` | `homingTurn: 0`、`homingCone: 0` | 追蹤：每秒最多轉幾弧度（0＝關閉）、只追飛行方向左右各幾度以內的怪；範圍內挑最近的活怪，只轉水平方向、速度不變 |
| `bolt` | `damage: 30`、`bounces: 6`、`range: 7.5` | 直擊傷害、升級後彈跳次數、每次彈跳找下一隻怪的距離上限 |
| `bolt` | `firstHop: 0.88`、`decay: 0.92`、`hopDelay: 0.075` | 第一跳＝直擊傷害 ×0.88，之後每跳 ×0.92；兩跳之間的秒數。預設下各跳是 30、26.4、24.288 … 第六跳 17.40 |
| `meteor` | `drops: 10`、`interval: 0.17`、`sizeMin: 0.8`、`sizeMax: 1.05` | 升級後落幾顆、相鄰兩顆的間隔秒數、每顆大小係數的亂數範圍（未升級固定一顆大小 1.35） |
| `meteor` | `damage: 60`、`radius: 2.7`、`burnRadius: 2.2`、`burnTime: 3.5` | 落點傷害與半徑（再乘大小係數，見 `CONTENT.combat`）、燃燒地面的半徑與秒數 |
| `meteor` | `pattern: 'scatter'`、`spread: 4.4`、`arcLength: 8`、`arcMinRadius: 0` | 落點排法：`'scatter'`＝第一顆在落點、其餘隨機散在半徑 `spread` 內（示範版）；`'arc'`＝圓心是施法者、半徑是到落點的距離，在施法方向排一段弧長 `arcLength` 公尺的弧，依落下順序從一端排到另一端，中間那顆在落點上。`arcMinRadius`：弧的半徑至少這麼大，落點比它近時整段弧往外推到這個半徑（中間那顆仍在施法方向上）。預設 0＝照舊：落點很近時弧長大於一整圈，會繞著施法者轉一圈以上；設成 `arcLength ÷ 2π` 以上（預設弧長 8 約 1.28）弧就不會閉合成圓，設成 `arcLength ÷ π` 以上不超過半圈 |
| `blink` | `cd: 2.5`、`distance: 5.5`、`invuln: 0.25`、`passEnemies: true`、`passProps: true` | 選用的閃現（見下方「閃現」一節）：冷卻秒數（不受施法速度影響）、瞬移距離（公尺）、瞬移後的無敵秒數、能否穿過怪物（`false`＝停在路上第一隻怪物前）、能否越過擺設與岩石格（`false`＝停在第一個擋路的東西前）。預設值在 `kit/blink.js`，載入時登記進同一張表 |
| `blood` | `bolts: 8`、`damage: 26`、`interval: 0.09`、`seek: 15`、`duration: 2.4` | 血光數、每道傷害、相鄰兩道出手的間隔秒數、找目標的距離上限、法陣多久淡出（收尾的時間點依比例縮放） |

### `window.EG`

| 呼叫 | 作用 |
|---|---|
| `EG.setSpellParams(id, { 欄位: 值, … })` | 覆寫部分欄位，回傳 `true`＝每個欄位都收下。招式或欄位名不存在、型別和預設值不同、數字是負的／`NaN`／無限大、次數欄位（`shots`、`bounces`、`drops`、`bolts`）不是整數、`pattern` 不是 `'scatter'`／`'arc'`：該欄位略過、`console.warn` 一行、回傳 `false`，其他合格欄位照樣生效，**不丟例外** |
| `EG.resetSpellParams(id)` | 該招回到預設；不給 `id` 就四招全部回預設 |
| `EG.spellParams(id)` | 目前生效的參數（複本，改它不影響遊戲） |
| `EG.on(事件, fn)`／`EG.off(事件, fn)` | 訂閱／取消；事件名打錯或 `fn` 不是函式時 `console.warn` 並略過 |
| `EG.pause(on, owner = 'default')` | 擴充腳本自己的暫停：遊戲規則（怪物、投射物、計時器、故事進度）與施法全停，畫面照常更新，適合在塔下跳出升級面板。每個持有者（任意字串）各自按住：`pause(true, 'panel')` 按住、`pause(false, 'panel')` 只放開 `'panel'` 自己那一份；**只要還有任何一個持有者按著，遊戲就停著**。同一個持有者按兩次仍算一份。只給一個參數時持有者是 `'default'`，所以舊的 `pause(true)`／`pause(false)` 寫法行為不變。和暫停選單、對白各自獨立，互不解除 |
| `EG.isPaused()`、`EG.pausedBy()` | 有任何持有者按著就是 `true`；`pausedBy()` 回傳目前按著的持有者陣列（複本） |
| `EG.inCombat()` | 場上有活著的怪，或正在首領戰 |
| `EG.events` | 事件名清單 |
| `EG.enableBlink(on = true)`、`EG.blinkEnabled()` | 開關選用的閃現，回傳開關後的狀態；關閉時技能格、說明列與改鍵列一併移除 |
| `EG.blink(dx, dz)` | 讓主角閃現一次，回傳 `true`＝成功。不給方向就照移動鍵（沒按就往面向）；給 `dx`、`dz`（水平方向，不必是單位長度）就往那個方向，給手把或擴充腳本用。關閉、冷卻中、暫停或選單中、擴充暫停、主角倒下、前方沒有能落腳的位置時回傳 `false`，不扣冷卻 |

### 唯讀查詢（Read-only queries）

每次呼叫都回傳新的物件（複本），改它不會影響遊戲。

| 呼叫 | 回傳 |
|---|---|
| `EG.player()` | `{ x, z, hp, maxHp, alive }`：主角的水平位置、目前與上限生命（引擎內部叫 `player.maxhp`）、是否活著 |
| `EG.towers()` | 每座塔一筆 `{ index, name, spell, x, z, lit, active }`，順序同 `CONTENT.towers`。`lit`＝已完成（一般塔是點亮了；`respond` 塔是已應答，它的 `T.lit` 永遠是 `false`，這裡用完成狀態回報）；`active`＝故事模式中、目前這一幕要去的那座塔，而且還沒完成（自由試玩時全部是 `false`） |
| `EG.ui()` | `{ running, story, dialog, menu, result, ending, inventory, settings }` 布林值：`running` 遊戲進行中（不在標題畫面）；`story` 故事模式（自由試玩與標題畫面是 `false`）；`dialog` 對白框開著；`menu` 任何會擋住遊戲的選單開著（暫停、設定、說明、製作群、階段結算，即引擎的 `menuOpen`）；`result` 階段結算；`ending` 結局畫面；`inventory` 行囊；`settings` 設定 |
| `EG.isTouch()` | 觸控模式是否開著（與 `kit/controls.js` 的 `EGControls.touch` 同一個答案） |
| `EG.enemyCount()` | 場上活著的怪物數（含首領） |
| `EG.nearestEnemy()` | 離主角最近的活怪 `{ distance, type }`（水平距離、種類 `spider`／`lizard`／`ghost`／`lord`）；沒有活怪時 `null` |

### 背景音樂（Background music）

| 呼叫 | 作用 |
|---|---|
| `EG.music(on)` | `false`：停掉引擎內建的背景和弦（不再排下一段），正在響的那一段在約 0.5 秒內淡出，並換上一條新的音樂音量匯流排；之後引擎不會自己再開。`true`：從下一段和弦開始重新播放。在聲音還沒啟動（玩家第一次點擊之前）就呼叫 `false` 也有效 |
| `EG.musicBus()` | 音樂音量的 `GainNode`（設定的「音樂」滑桿控制它；聲音還沒啟動時是 `null`）。擴充腳本把自己的配樂接到這裡，玩家調音樂音量就會跟著變。**`EG.music(false)` 會換一條新的匯流排**，所以要在關掉內建音樂之後再取，或每次用到時再取 |

```js
// 用自己的配樂取代內建音樂（第一次點擊之後聲音才會啟動）
EG.music(false);
addEventListener('pointerdown', () => { const bus = EG.musicBus(); if (bus && !window.myScore) window.myScore = startMyScore(bus.context, bus); });
```

### 後製參數（Post-processing uniforms）

`EGPost.uniforms` 是最後一道合成的 shader 參數，擴充腳本可以每格改（例如做漸變）。**只在畫質「高」（後製開著）時有作用**；畫質低、或沒有顯示卡而自動關掉後製時，畫面直接輸出，這些值不影響畫面。`tMain`、`tSoft`、`tBloom` 是引擎每格填的貼圖，不要改。

| 欄位 | 預設 | 建議範圍 | 作用 |
|---|---|---|---|
| `uExp.value` | 1.22 | 0.5–2 | 整體亮度倍率（在對比與飽和度之前） |
| `uBloom.value` | 0.9 | 0–2 | 亮部光暈強度 |
| `uTilt.value` | 1 | 0–1 | 畫面上下緣的模糊（移軸）；0＝整張清楚 |
| `uSat.value` | 0.9 | 0–2 | 飽和度；0＝黑白 |
| `uCon.value` | 1.1 | 0.5–2 | 對比（以偏暗的 0.22 為中心） |
| `uVig.value` | 0.3 | 0–1 | 四角變暗 |
| `uTint.value` | `(1, 1, 1)` | 每個分量 0–2 | 色調：最後輸出的紅、綠、藍各乘上這三個數（`THREE.Vector3`，用 `EGPost.uniforms.uTint.value.set(r, g, b)` 改） |
| `uCA.value` | 0 | 0–0.05 | 色差：紅色往畫面外、藍色往畫面內偏移，偏移量＝到畫面中心的距離 × 這個值（畫面角落約為值的一半，以畫面寬高為 1 計）；0＝關閉 |

- 預設值下的輸出與加入色調、色差之前的版本逐像素相同（`tests/unit.spec.js` 拿目前的 shader 和拿掉這兩段的 shader 各畫一次，比對實際遊戲畫面與雜訊輸入兩種情況）。
- 設定裡沒有獨立的「減少扭曲」選項；「減少震動與停格」打開時色差一律不作用（引擎每格把內部係數 `uCAk` 設為 0，擴充腳本設的 `uCA` 值保留，關掉這個選項後恢復）。色調不受影響。
- `EGPost.finalMat` 是這道合成的 `ShaderMaterial`（給測試比對用，一般不需要動）。

### 保留按鍵（Reserved keys）

| 呼叫 | 作用 |
|---|---|
| `EG.reserveKey(code, label)` | 把一個 `KeyboardEvent.code`（例：`'KeyQ'`、`'F9'`）保留給擴充腳本。之後在設定的「按鍵」列把任何動作改到這個鍵，會被拒絕，那一列顯示「這個鍵保留給 label」並繼續等下一個鍵（和引擎自己保留的 Space／Esc／P／Tab／R 一樣）。保留的當下，若玩家存下的按鍵已經把某個動作綁在這個鍵上：`console.warn` 一行、該動作改回預設鍵，按鍵列立刻重畫；預設鍵剛好就是這個鍵時，該動作改成不綁任何鍵（列上顯示「—」）。改回的值只在記憶體裡，玩家下次改任何按鍵時才會一起存下；所以每次載入都會再檢查、再警告一次。`code` 不是有內容的字串時 `console.warn` 並略過 |
| `EG.reservedKeys()` | `{ code: label }`（複本） |

「按鍵恢復預設」按鈕不看保留清單：請保留預設按鍵用不到的鍵（`KeyW` `KeyA` `KeyS` `KeyD` `Digit1`–`Digit4` `KeyI` 以外）。保留只擋改鍵，不會攔下遊戲本身對那個鍵的處理；按下時要做什麼，由擴充腳本自己聽 `keydown`。閃現的鍵（預設 `KeyF`）不論閃現開不開都算在按鍵表裡，所以擴充腳本保留 `KeyF` 時同樣會警告並把閃現改成不綁鍵；想同時用閃現，請保留別的鍵。

### 量測用：固定亂數與清空特效（Determinism for measurement）

| 呼叫 | 作用 |
|---|---|
| `EG.seed(n)` | 從現在起 `Math.random` 換成以整數 `n` 起始的固定序列（與擺設墓碑用的同一個產生器）。引擎所有的亂數都經過 `Math.random`（`rand`、`randi`、`pick`、暴擊、範圍傷害的 ±10%、出怪、掉寶、粒子），所以都跟著固定。**換掉的是整頁的 `Math.random`**，同一頁的其他程式庫與擴充腳本也會拿到這個序列。再呼叫 `EG.seed(n)` 會從頭開始同一個序列 |
| `EG.seed(null)` | 換回頁面原本的亂數 |
| `EG.clearEffects()` | 清掉所有進行中的特效：粒子、浮字、投射物（火球、雷球）、星墜與落地的石塊、燃燒的地面（含焦痕）、血環、首領衝擊波，以及**所有排定中的計時器**（還沒落下的星墜、還沒跳的鏈雷都在裡面；故事流程的計時器也會被清掉，所以別在故事轉場中呼叫）。另外把環境、地形、塔火的發射計時歸零，同一個亂數序列才會產生同樣多的粒子、抽同樣多次亂數。怪物、掉落物、地形格子、墓碑等擺設**不動**（要整個重來用引擎的 `clearWorld()`） |

同樣的初始狀態、同一個 `seed`、先 `clearEffects()`，再照同一份腳本推進遊戲（例如每格 `logic(1/60)`），造成的每一次傷害與總傷害都一樣（`tests/unit.spec.js` 的 `EG.seed + EG.clearEffects` 測試跑兩次比對）。用畫面自己的迴圈跑時，每格的時間長短不固定，結果不保證相同。

### 事件

| 事件 | 參數 | 何時 |
|---|---|---|
| `towerLit` | 塔的索引（0 起算） | 玩家點亮一座塔（階段結算畫面出現前 1 秒）；從存檔繼續時直接亮起的塔不算（見 `continueGame`） |
| `newGame` | 從第幾幕開始（恆為 `0`） | 開始一段新的故事：標題畫面的故事模式、結局畫面的「再玩一次」、沒有存檔時按「繼續」。發生在清場、塔全部熄滅之後，`actStart` 之前 |
| `continueGame` | 從第幾幕接著玩 | 從存檔繼續。發生時前面幾幕的塔已經亮起、招式已經解鎖，`EG.towers()` 已回報它們 `lit: true`、要去的那座 `active: true`；這些塔**不會**另外發 `towerLit`。之後才發 `actStart`。擴充腳本要知道存檔裡哪些塔已亮，就在這個事件裡讀 `EG.towers()` |
| `actStart` | 幕的索引 | 每一幕開始（開幕對白之前）；死亡後從本幕重來也會再發一次 |
| `bossStart` | — | 首領出場（重來首領戰也算一次） |
| `bossDown` | — | 首領倒下 |
| `cast` | 招式 `id` | 一次施放成立（已扣冷卻）。施法動作中按下而記住的招式（見「引擎行為」），在它真的施放的那一格才發 |
| `hit` | `{ spell, kind, source, target, amount }` | 每次對怪物造成傷害；`amount` 已含暴擊。`kind` 是傷害種類，也就是地形系統用的元素（`fire`／`bolt`／`blood`，以及地形與物件造成的 `burn`、`terrain`、`crush`、`boom`）；`spell` 與 `kind` 相同（舊欄位，保留相容）。`source` 是**真正造成這一下的法術部位**：`'fire'` 火球爆炸、`'meteor'` 星墜落地、`'meteorBurn'` 星墜留下的燃燒地面、`'bolt'` 鏈雷直擊、`'boltChain'` 鏈雷彈跳、`'boltSplash'` 未升級鏈雷打中後的周圍濺射、`'blood'` 血環的血光（含目標已倒、落空時的小範圍爆開）；不是法術造成的（燃燒的草地與熔岩、磷火爆炸、倒下的墓碑、直接呼叫 `dealDamage`）是 `null`。例：星墜落地是 `kind: 'fire', source: 'meteor'`，它的燃燒地面是 `kind: 'burn', source: 'meteorBurn'` |
| `kill` | 怪物種類（`spider`／`lizard`／`ghost`／`lord`） | 怪物倒下 |
| `playerDeath` | 死因文字（死亡畫面上那一個） | 主角倒下 |
| `restart` | — | 按下重來，清場之前 |
| `ending` | — | 結局畫面出現 |
| `blink` | `{ from: { x, z }, to: { x, z } }` | 一次閃現成立（已扣冷卻、主角已在新位置） |
| `dialogStart` | 對白代號 | 一段對白開始：對白框已打開、遊戲已停（`EG.ui().dialog` 為 `true`），第一句出現之前。代號查不到時也會發，緊接著就是 `dialogEnd` |
| `dialogEnd` | 對白代號 | 一段對白結束（播完、按「略過」或回標題）：對白框已關、遊戲已恢復，對白結束後要接的流程（例如首領登場）執行之前 |

每個監聽函式各自包在 `try`／`catch` 裡：丟出例外只會 `console.warn` 一行，後面的監聽函式照跑，遊戲這一格照常走完。

### 閃現（選用的第五個基本動作）

動作遊戲常用的短距離瞬移，引擎內建、**預設關閉**：示範版不開，畫面、按鍵、說明頁都和以前一樣。

| 開啟方式 | 寫法 |
|---|---|
| 內容包 | `CONTENT.blink = true`；或給參數物件，例如 `CONTENT.blink = { distance: 7, cd: 3 }`，這些值經 `EG.setSpellParams('blink', …)` 檢查後成為閃現的預設值（之後 `EG.resetSpellParams` 回到它們）。型別不對（不是 true、false 或物件）載入時停下並指名欄位；物件裡的欄位名或數值不對，照 `EG.setSpellParams` 的規則警告並略過 |
| 擴充腳本 | `EG.enableBlink(true)`；參數用 `EG.setSpellParams('blink', { … })` 改，和四招相同 |

- **方向**：按下時照移動鍵（觸控的左半邊搖桿也是設定移動鍵），沒按方向鍵就往主角面向；不需要滑鼠。`EG.blink(dx, dz)` 可直接給方向，之後接手把只要呼叫它。
- **落點**：沿方向每 0.2 公尺以內檢查一次，取最遠、能站的那一點：不出場地（半徑 42.5 公尺），不落在墓碑、樹、石棺、塔等擺設或岩石格裡（以主角半徑 0.4 計）。`passProps: false` 時遇到第一個擋路的東西就停，`passEnemies: false` 時停在第一隻怪物前。找不到能站的位置就不閃現、不扣冷卻。
- **時機**：和施法相同的限制（遊戲進行中、沒有暫停或選單、沒有擴充暫停、主角活著）；施法動作中也能閃現，不打斷施法。冷卻與無敵都用遊戲時間計，暫停時不走。無敵期間所有對主角的傷害（含熔岩）都不生效。
- **按鍵**：預設 `F`，存在同一份改鍵設定裡（`KB.blink`），設定的「按鍵」列多一列「閃現」可改；與別的動作互換、保留鍵（`EG.reserveKey`）的規則同其他按鍵。
- **畫面**：開啟後技能列多一格「閃現」（顯示按鍵、距離與冷卻圈），說明頁多一行，觸控模式下這一格就是觸控按鈕（點一下閃現）。關閉時這三樣都移除。
- **特效與音效**：全部用現有的粒子池、翻頁圖與燈光池：出發與抵達各一團紫色星形火星、一張染色的爆炸翻頁圖、一圈地面光暈與往上竄的火星，中間一道殘影，抵達點一盞 0.35 秒的閃光，鏡頭小震一下；一次約 110 片粒子。粒子數照設定的粒子密度（低／中只發一部分）；「減少震動與停格」打開時不震，閃光強度降到約三分之一（設定裡沒有獨立的「減少閃光」選項）。音效是即時合成的短促上掃音（`sfx.blink`）。
- **事件**：`blink`，參數 `{ from: { x, z }, to: { x, z } }`。

### 範例：塔下的升級面板

```js
// ext/upgrade.js：排在 kit/boot.js 之後載入。點亮第一座塔時停住遊戲，讓玩家選「火球追蹤」
EG.on('towerLit', (i) => {
  if (i !== 0) return;
  EG.pause(true, 'upgrade');   // 持有者 'upgrade'：放開時只放開這一份，不影響別的擴充腳本的暫停
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:60;padding:16px 20px;background:#1b1a22;color:#eee;border:1px solid #555;text-align:center';
  box.innerHTML = '<p>選一個升級</p><button type="button">火球會追著最近的怪轉彎</button>';
  box.querySelector('button').onclick = () => {
    EG.setSpellParams('fire', { homingTurn: 4, homingCone: 40 });
    box.remove();
    EG.pause(false, 'upgrade');
  };
  document.body.appendChild(box);
});
EG.on('ending', () => EG.resetSpellParams('fire'));
```

## 邊界（由 `tests/checks.mjs` 把關）

- `kit/` 不得出現內容包擁有的字串：說話者名字、塔名、首領名與其他 `text` 文字、對白句子（比對是真的執行內容檔、從 `CONTENT` 讀出來的，不是固定字表；unicode 跳脫與字串拼接也會被還原後比對），並附「偵測器確實讀到內容」的自我檢查。示範內容擁有的名字見 `content/demo/`。
- 內容包只能放資料：不得出現 `THREE`、`renderer`、`document`、`function`、箭頭函式、`if`／`for`／`while`／`switch`／`try`／`throw`、`new`、`class`、getter／setter、`localStorage`／`fetch`／`eval`／計時器等有副作用的名稱，樣板字串裡的 `${…}` 也一併檢查。閘門檢查 `content/*/` 底下全部的 `.js`，加上 index.html 實際載入的內容 script。
- 內容包的 script 必須全部排在 `kit/` 之前，而且不得加 `defer` 或 `async`；`kit/` 的一般 script 必須照上面第 3 點的順序、`core.js` 排第一，並全部排在第一個 `defer` 之前；頂層 `const`／`let`／`class` 不得在兩個一般 script 重複宣告；頁面載入的本機 script 總量計入 214 KB 程式碼預算（延後載入的 `kit/blink.js` 也算在內）。
- 法術數值在 `kit/combat.js` 的 `SPELL_DEF`，執行中由擴充腳本用 `EG.setSpellParams` 改（見上一節），內容包不設定。怪物種類與數值（`ETYPES`）、裝備的形狀與詞綴數值範圍目前仍在 `kit/`（怪物的名稱與外觀可用 `CONTENT.monsters` 覆寫、裝備名稱用 `CONTENT.loot`、裝備傷害詞綴用 `combat.gearDamage` 關，數值本身不行）；之後其他內容包要換的話，再往 `CONTENT` 加欄位。
