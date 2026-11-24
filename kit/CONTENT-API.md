# kit/ 與內容包的介面

`kit/` 是引擎：渲染、粒子、地形、法術、怪物、裝備、存檔、設定、後製、像素角色、像素圖素材（選用）、夜色與光（選用）、地形動作與法術擴充（選用）、光影、地面細節、霧、觸控、角色模型載入、故事流程的規則。
**內容**（對白、說話者、塔與幕的設定、首領名稱、語音與模型的路徑）不在 `kit/`，由一組放在 `window.CONTENT` 的資料提供。A 的示範內容在 `content/demo/`；另一個遊戲想只取引擎，就引入 `kit/`，自己寫一組同樣欄位的內容包。

## 載入順序（index.html 負責）

1. three.js（CDN）
2. 內容包的 script（全部先於 `kit/`），每個只做 `window.CONTENT = window.CONTENT || {}` 再補欄位
3. `kit/core.js`、`world.js`、`combat.js`、`systems.js`、`story.js`、`ui.js`、`boot.js`（一般 script，不加 `defer`，依序執行；頂層 `const`／`let`／`function` 在檔案之間以名稱共用，不是 ES module）
4. `kit/controls.js` 起的 `defer` 腳本（觸控與改鍵、閃現 `kit/blink.js`、後製、像素角色、光影、地面細節、霧、角色載入器；`blink.js` 要排在 `controls.js` 之後），整份文件解析完才依文件順序執行。像素圖素材模組 `kit/sprites.js`、夜色與光的模組 `kit/look.js`、地形動作與法術擴充的模組 `kit/spellkit.js` 不在 `index.html` 裡：最後一支 `kit/character.js` 看到 `CONTENT.sprites`／`CONTENT.look`／`CONTENT.spellkit` 時才把它們加進頁面（見「像素圖素材」「夜色與光」「地形動作與法術擴充」）
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

## 像素圖素材（可選 `CONTENT.sprites`）

內容包提供 PNG 圖集時，可以把整個畫面換成 2.5D 像素風格：角色、墓碑與樹這類擺設、法術特效是面向鏡頭的像素圖，地面是像素地磚，也可以讓整個場景以約 360 列的低解析度算繪再整數倍放大。**沒有這個欄位時引擎完全不載入這部分程式**：`kit/character.js` 只在 `CONTENT.sprites` 存在時才載入 `kit/sprites.js`（不經過 `index.html`），示範版的畫面、程式與載入的檔案都和以前相同。

- 圖集與 JSON 在背景讀取，讀完那一格才換上；讀取前與讀取失敗時畫面維持原樣（讀不到的圖集記一行警告，用到它的部分不換，其他照常）。
- 只換外觀：碰撞、傷害、破壞、地形演變、掉落都不動。
- 格式不對（型別、範圍、指到不存在的圖集）時整組像素素材停用、畫面維持原樣，`window.__contentWarnings` 與 `console.warn` 記指名欄位的訊息；讀取畫面還開著時也寫在上面。欄位名打錯只記警告。
- 圖片一律最近鄰取樣、不產生縮圖層（mipmap），放大後邊緣是硬的。

### 圖集（`atlases`）

```js
CONTENT.sprites = {
  atlases: {
    hero:  { image: 'content/mypack/hero.png',  meta: 'content/mypack/hero.json' },   // meta 可以是路徑，也可以直接寫物件
    tiles: { image: 'content/mypack/tiles.png', meta: { kind: 'tile', size: 16, cols: 4, rows: 4 } },
  },
  // 下面各節的欄位……
};
```

| `meta.kind` | 欄位 | 說明 |
|---|---|---|
| `sprite` | `frameW`、`frameH`、`cols`、`rows`（正整數）、`anchor`（選填 `[x, y]`，預設 `[0.5, 1]`）、`rowNames`（選填）、`frames`（選填） | 角色與擺設。每格大小相同、由左上角起排；`anchor` 是每格裡站在地面上的那一點，以格寬、格高的比例計（從格的左上角算）：腳底在每格底邊上一列時，48 列高的格寫 `0.979`（47 ÷ 48）。`rowNames` 讓格子能用名字指排（例如 `["down","up","side"]`）。`frames` 裡 `empty: true` 的格會被略過（記警告），其他欄位不必有 |
| `tile` | `size`、`cols`、`rows` | 地磚，每格是一塊 `size`×`size` 的無縫地磚 |
| `fx` | `frameW`、`frameH`、`cols`、`rows`、`blend`（選填，`add` 或 `alpha`，預設 `add`） | 特效，黑底。`add`＝黑色等於透明（疊加發光）；`alpha`＝照圖片的透明度 |

格子的位置不能超出圖檔大小。

### 指定格子的寫法

| 寫法 | 意思 |
|---|---|
| `5` | 第 5 格（由左到右、由上到下，從 0 起算） |
| `[2, 3]`、`["side", 3]` | 第 2 排（或 `rowNames` 裡叫 `side` 的那一排）第 3 欄 |
| `{ row: "side", from: 0, to: 5 }` | 同一排連續幾欄；`to` 比 `from` 小時倒著排；不給 `from`／`to` 就是整排 |

一個清單可以混用，所以**同一個動作可以跨好幾排**，例如 `[{ row: "side", from: 0, to: 3 }, { row: "side2", from: 0, to: 1 }]`。

### 角色（`actors`）

鍵是 `player`（主角）、`spider`、`lizard`、`ghost`、`lord`。有設定的角色換成像素圖、隱藏原本的 3D 模型；**沒設定的怪物照舊用原本的模型**。

| 欄位 | 說明 |
|---|---|
| `atlas` | `sprite` 種類的圖集名 |
| `idle`（必填）、`walk`、`cast`、`cast:fire`／`cast:bolt`／`cast:meteor`／`cast:blood`、`hurt`、`die` | 待機、走、施法（可依招式分開，沒分就用 `cast`）、受傷、倒下。缺的動作用 `idle` 代替 |
| `pose:<名字>`（例 `pose:bow`） | 內容自己用的姿勢（低頭、施法預備、落地……），由擴充腳本呼叫 `EG.pose(角色, 名字, 秒)` 播放：期間取代施法、受傷、走、待機（倒下仍優先），秒數用遊戲時間，不給秒數就一直維持到 `EG.pose(角色, null)`。角色是 `player` 或怪物物件（從事件的 `target` 拿）；這個角色沒有那個姿勢時回傳 `false`、照常顯示。`EG.pose` 只在像素圖模組開著時存在 |
| `ppu` | 每公尺幾個像素（預設 `CONTENT.sprites.ppu`，再沒有就是 27.5：預設鏡頭、畫面 360 列時約一格一像素） |
| `shadow` | 腳下像素影子的半徑（公尺，預設 0.5，0＝不畫） |
| `lit` | `false`＝不受場景光影響（全亮）；預設 `true`，和場景一起受光 |
| `corpse` | 倒下動作播完後再停留幾秒（預設 0） |

**一個動作**可以寫成：

| 寫法 | 說明 |
|---|---|
| `[格子, …]` | 依序播放，每秒 8 格 |
| `{ frames: [格子, …], fps, loop }` | `fps` 每秒幾格；`loop` 預設：待機與走是 `true`，其他是 `false`（播完停在最後一格） |
| `{ row, from, to, fps, loop }` | 同一排連續幾欄的簡寫 |
| `{ down, up, side, left, right, mirror }` | 依方向分開，每個值是上面任一種。`side` 是面向右的那一排，面向左時左右翻轉；給了 `left`／`right` 就用它，不翻轉。缺的方向依序用 `down`、`up`、`side` 代替。不分方向的動作四個方向共用，面向左時同樣翻轉，`mirror: false` 關掉翻轉 |

**怎麼挑格**：

- 方向（下、上、左、右）以畫面為準：往鏡頭走是下、遠離鏡頭是上。主角走動時看移動方向，站著或施法時看瞄準方向；怪物看牠的移動方向。斜向時偏向原本的方向，不會在對角線上來回跳。
- 狀態優先順序：倒下 → 姿勢（`EG.pose`）→ 施法 → 受傷 → 走 → 待機。施法動作的格數平均分在施法動作的時間內（受施法速度影響）；受傷在被打中時從頭播一次；怪物倒下後即使已從場上移除，也會把倒下動作播完（加上 `corpse` 秒數）才收掉。
- 尺寸：寬＝格寬 ÷ `ppu`、高＝格高 ÷ `ppu`（公尺）。圖與畫面平行（正對鏡頭），所以畫面上的像素是正方形、邊是直的，靠近畫面邊緣也不會歪斜；錨點放在角色的地面位置，浮空的怪與主角跟著上下。所有像素圖彼此平行，前後遮擋依它們在地面上的遠近，和 3D 擺設之間照深度判斷。
- 怪物被擊中時發白（`EG.reduceFlashing(true)` 時減弱，同 3D 模型）。

### 擺設（`props`）

| 鍵 | 狀態欄位 | 什麼時候用 |
|---|---|---|
| `tomb` | `up`（必填）、`fallen` | 立著；被打倒後 |
| `tree` | `up`（必填）、`burning`、`burnt` | 立著；燃燒中（沒給就用 `up`）；燒毀倒下後 |
| `sarc` | `up`（必填）、`broken` | 完整；破開後 |
| `tower` | `unlit`（必填）、`lit` | 未點亮；點亮（回應狀態的塔在心跳時也用 `lit`） |

另有 `atlas`、`ppu`、`lit`（同角色）。有設定的擺設隱藏原本的 3D 模型（塔的引導光柱保留）；狀態欄位沒給時那個狀態不畫。

**狀態的值**：`[格子, …]`＝每個擺設依自己的位置固定挑一格（變化格，不閃爍）；`{ frames: [格子, …], fps }`＝動畫，每個擺設起始格不同（`sync: true` 讓全部同步）；`{ variants: [[格子, …], [格子, …]], fps }`＝每個擺設固定挑一組，再播那一組的動畫。

### 地面（`ground`）

| 欄位 | 說明 |
|---|---|
| `atlas` | `tile` 種類的圖集名 |
| `tiles` | `{ 地形名: 值 }`。地形名是 `GRASS`（枯草）、`SOIL`（墓土）、`PAVE`（石板路）、`WATER`（積水）、`MUD`（泥沼）、`FIRE`（火焰）、`ASH`（灰燼）、`LAVA`（熔岩）、`CRATER`（坑洞）、`OBSID`（黑曜石）、`SHOCK`（帶電水）、`BLOOD`（血沼）、`WISP`（磷火墳）、`BONE`（骨堆）、`STEAM`（蒸氣），另有 `default`。值的寫法同擺設的狀態：清單＝依格座標固定挑一塊（變化格），`{ frames, fps }`＝動畫格（火、水這類，每格起始不同），`{ variants, fps }`＝兩者都要。沒給的地形用 `default`，再沒有用 `SOIL`，再沒有用第一個有給的 |
| `detail` | `true`＝保留 3D 的草叢與碎石；預設 `false`（換成地磚時隱藏） |
| `glow` | `true`＝保留火焰與熔岩上的平滑發光層；預設 `false` |

每個地形格（1 公尺）畫一塊地磚。地形改變（燒焦、積水、熔岩、坑洞……）的那一格立刻換成對應的地磚，動畫格照 `fps` 換格；只把變動的那幾排送進顯示卡。地形範圍外（柵欄以外）的地面鋪 `SOIL` 的第一塊地磚。地磚每塊 `size` 像素時地面貼圖是 88×`size` 見方，超過顯示卡上限時地面維持原樣並記警告（16 像素時是 1408）。

### 特效（`fx`）

| 鍵 | 換掉的是 | 預設大小（公尺） |
|---|---|---|
| `fireball` | 火球投射物的火芯與尾焰（循環，跟著投射物，投射物消失就收掉） | 1.2 |
| `orb` | 鏈雷雷球的光芯（循環，跟著投射物）；飛行中的小電弧與地面火花照舊 | 1.2 |
| `explosion` | 爆炸的粒子：火球命中、血環血光落地、磷火墳爆炸；也是星墜落地沒給 `impact` 時用的 | 3（乘上爆炸本身的大小） |
| `zap` | 雷球命中與每次彈跳命中的火花 | 2 |
| `chain` | 鏈雷彈跳的電弧：從一隻怪拉到下一隻怪的長條 | 0.7（寬） |
| `meteor` | 星墜落下的石塊與它的火尾（落地後的石塊也隱藏）；落點的紅圈照舊 | 2 |
| `impact` | 星墜落地的爆炸 | 5（乘上該顆大小） |
| `ring` | 血環的地面法陣（平貼地面，大小跟著法陣，法陣結束就收掉） | 1（乘上法陣大小） |
| `hit` | 不換任何東西，每次對怪物造成傷害時在牠身上加播一次 | 1 |

| 欄位 | 說明 |
|---|---|
| `atlas`、`frames`（必填） | 圖集名與格子清單（依序播放） |
| `fps` | 每秒幾格，預設 12 |
| `size` | 大小（公尺），預設見上表 |
| `blend` | `add` 或 `alpha`，預設用圖集的 `blend` |
| `particles` | `true`＝原本的粒子照放，翻頁圖疊在上面；預設 `false`（換掉） |

不跟著東西的特效播完最後一格就收掉；跟著東西的（火球、雷球、星墜、血環）在那個東西消失時收掉。爆炸原本的燈光閃光、鏡頭震動、停格與音效都保留，爆炸的染色（例如血光的紅）也套在翻頁圖上。沒指定的特效照舊用粒子。重來、換幕清場與 `EG.clearEffects()` 會把進行中的翻頁圖一起清掉。翻頁圖面向鏡頭；同時最多 400 個，超過的不畫。

### 整個畫面的低解析度（`pixelScreen`）

| 值 | 說明 |
|---|---|
| 不給、`false` | 關閉：畫面解析度照舊 |
| `true` | 以約 360 列算繪 |
| `{ rows: 120 到 1080 的整數 }` | 以約這麼多列算繪 |

開啟後整個場景（地面、擺設、角色、粒子、後製）都在低解析度的畫布上算繪，放大倍數＝視窗高度（裝置像素）÷ `rows` 四捨五入（至少 1），畫布以剛好整數倍、最近鄰的方式放大（`image-rendering: pixelated`）；視窗大小不是整數倍時右邊與下面留下不到一個放大像素的空白。例：1280×800 的視窗是 640×400 的畫面放大 2 倍，1920×1080 是 640×360 放大 3 倍。

- **鏡頭對齊像素**：每次算繪前，鏡頭的位置對齊到一個低解析度像素的格線（畫面左右與上下兩個方向，以鏡頭對準的地面距離計），算完再還原，遊戲的瞄準不受影響。角色與擺設的位置也對齊同一組格線，所以移動不到一個像素時畫面完全不變，不會閃。
- **移軸模糊關閉**：這個模式下最後一道合成的 `uTilt` 一律當作 0（擴充腳本設的值保留，模式關閉時照舊）。光暈、調色、四角變暗照舊。
- 沒有顯示卡（軟體算繪）時引擎本來就把像素比例壓在 0.75 以下，這時放大倍數至少取到讓像素比例不超過 0.75。

**已知的限制**：畫質「高」時月光的陰影跟著主角連續移動，沒有對齊像素，陰影邊緣在移動時會有一點閃動；地面霧本來就會飄動。

### 與其他畫面功能的關係

- 有任何角色換成像素圖、或開啟 `pixelScreen` 時，引擎原本「角色另外用低解析度畫一次再疊上去」的那一層關閉，還是 3D 模型的角色（沒設定像素圖的怪物）改在主畫面裡和其他東西一起畫，遮擋關係正確。只換地面或擺設時那一層照舊。
- `CONTENT.monsters` 的換色、縮放只作用在 3D 模型；換成像素圖的角色用自己的 `ppu`。
- 擴充腳本可以讀 `EGSprites.state`（`active`、`ready`、`lowRes`、`scale`、`w`、`h`、`actors`、`props`、`fx`）與 `EGSprites.debug(主角／怪物／擺設)`（目前的動作、方向、格子、是否翻轉）。

### 範例

```js
window.CONTENT = window.CONTENT || {};
CONTENT.sprites = {
  pixelScreen: true,
  atlases: {
    mage: { image: 'content/mypack/mage.png', meta: 'content/mypack/mage.json' },   // kind sprite，rowNames ["down","up","side"]
    mobs: { image: 'content/mypack/mobs.png', meta: 'content/mypack/mobs.json' },
    deco: { image: 'content/mypack/deco.png', meta: 'content/mypack/deco.json' },
    tiles: { image: 'content/mypack/tiles.png', meta: 'content/mypack/tiles.json' }, // kind tile
    fx: { image: 'content/mypack/fx.png', meta: 'content/mypack/fx.json' },          // kind fx
  },
  actors: {
    player: {
      atlas: 'mage',
      idle: { down: { row: 'down', from: 0, to: 1, fps: 2 }, up: { row: 'up', from: 0, to: 1, fps: 2 }, side: { row: 'side', from: 0, to: 1, fps: 2 } },
      walk: { down: { row: 'down', from: 2, to: 5, fps: 10 }, up: { row: 'up', from: 2, to: 5, fps: 10 }, side: { row: 'side', from: 2, to: 5, fps: 10 } },
      cast: { down: [['down', 6], ['down', 7]], up: [['up', 6], ['up', 7]], side: [['side', 6], ['side', 7]] },
      hurt: { frames: [['down', 8]], fps: 6 }, die: { frames: [['down', 9], ['down', 10]], fps: 6 },
    },
    spider: { atlas: 'mobs', idle: [[0, 0]], walk: { row: 0, from: 0, to: 3, fps: 12 }, die: { frames: [[1, 0], [1, 1], [1, 2]], fps: 8 } },
  },
  props: {
    tomb: { atlas: 'deco', up: [[0, 0], [0, 1], [0, 2]], fallen: [[0, 3]] },
    tree: { atlas: 'deco', up: [[1, 0]], burning: { frames: [[1, 1], [1, 2]], fps: 8 }, burnt: [[1, 3]] },
    tower: { atlas: 'deco', unlit: [[2, 0]], lit: { frames: [[2, 1], [2, 2], [2, 3]], fps: 6 } },
  },
  ground: { atlas: 'tiles', tiles: { SOIL: [0, 1, 2, 3], GRASS: [4, 5, 6], WATER: { frames: [8, 9], fps: 3 }, FIRE: { frames: [10, 11], fps: 8 }, LAVA: { frames: [12, 13], fps: 4 } } },
  fx: { fireball: { atlas: 'fx', frames: [{ row: 0 }], fps: 12 }, explosion: { atlas: 'fx', frames: [{ row: 1 }], fps: 16 } },
};
```

A 沒有正式的像素素材；測試用程式在畫布上畫出的色塊與方向箭頭當圖集（`tests/lib/sprite-fixture.js`），測試頁在載入前把它交給 `CONTENT.sprites`。

## 夜色與光（可選 `CONTENT.look`）

內容包可以重調夜色與光：清除色、霧、環境光與月光的顏色與強度、地面薄霧、地面上點光源的亮度分階、每種地形的色調與自發光、像素圖的補光、塔的燈與火焰，以及內容包自己擺的裝飾（可帶燈）。只改畫面：規則、碰撞（`block` 除外，見下）、傷害、地形演變都不動，也**不抽亂數**（`EG.seed` 固定亂數的場景有沒有這個模組，抽到的序列相同）。**沒有這個欄位時引擎完全不載入這部分程式**：`kit/character.js` 只在 `CONTENT.look` 存在時才載入 `kit/look.js`，示範版的畫面、程式與載入的檔案都和以前相同。

- 載入時檢查型別：任何一項不對，整個模組停用、畫面維持原樣，`window.__contentWarnings` 與 `console.warn` 記指名欄位的訊息（讀取畫面還開著時也寫在上面）。欄位名打錯只記警告。`CONTENT.look = {}` 時模組開著但什麼都不改，畫面逐像素相同。
- 顏色一律寫 `"#rrggbb"` 或 0 到 0xffffff 的整數。
- 強度的倍率（`mul`）乘在引擎每格算好的值上（首領戰變暗、設定的畫面亮度照舊），每格重算一次，不會累乘。

| 欄位 | 說明 |
|---|---|
| `clear` | 畫面最遠處（霧的盡頭）的清除色 |
| `fog` | `{ color, mul }`：霧色；`mul` 乘在霧的濃度上 |
| `hemi` | `{ sky, ground, mul }`：環境光的天空側、地面側顏色與強度倍率 |
| `moon` | `{ color, mul }`：月光的顏色與強度倍率 |
| `highMul` | 畫質「高」（後製開著）時環境光與月光再乘這個數；後製會提亮整體，兩種畫質的顏色才接近。預設 1 |
| `mist` | `{ color, mul }`：地面薄霧三層的顏色與不透明度倍率 |
| `terrain` | `{ 地形名或 default: { tint: [r, g, b], glow } }`。`tint` 是 0–1 的色調，在受光之前乘在地面（地形層）上，柵欄外的地面乘 `SOIL`（沒有就 `default`）的色調；`glow` 0–1 是那種地形自己發光的比例，用地面原本的顏色再乘上該像素亮度的平方（亮的裂縫與火苗發光、暗的底色不亮，不加平滑漸層）。每格一個像素的資料，地形改變時只把變了的格送進顯示卡 |
| `steps` | `{ perUnit, dither }`：地面上點光源（塔、法術、燈、裝飾的燈）的亮度變成階梯，每 1 單位亮度 `perUnit` 階；階與階的交界 `dither`（0–1）寬用 4×4 網點交錯。月光不分階。只作用在地面與地形層（角色與擺設是四個頂點的方片，分階看不出來） |
| `towers` | `{ y, distance, mul, colors, halo, flame }`：塔的燈的高度、照亮半徑（設了就改用平方衰減）、強度倍率、依塔的順序的顏色；`halo` 見下；`flame` 是點亮的塔上方的火焰粒子：`true`（預設，照舊在 3.8 公尺）、`false`（不畫）、數字（改在這個高度，公尺）。`false` 時粒子仍以大小 0、全透明的方式發出，所以引擎為它抽的亂數一個不少 |
| `actors` | `{ diffuse, fill, fillColor }`：像素圖角色（`CONTENT.sprites.actors`，`lit` 不是 false 的）受光的比例、補光強度與顏色。補光用角色自己的圖當自發光，暗處輪廓清楚、冷色光下不偏色 |
| `props` | 同上，給像素圖擺設（`CONTENT.sprites.props`） |
| `decor` | 裝飾清單，見下 |

**光暈**（`towers.halo`、`decor[i].halo`）：`{ color, size, y, peak }`。像素光暈：同心的 4 階亮度、階間網點，貼圖一個像素＝畫面一個像素（每公尺 `CONTENT.sprites.ppu` 像素，預設 27.5），加亮混合、不受霧影響。塔的光暈只在點亮時（回應狀態的塔在心跳時）出現，顏色預設是那座塔的燈色。

**裝飾**（`decor`，每項一組）：

| 欄位 | 說明 |
|---|---|
| `atlas` 或 `image`＋`meta` | 圖：`CONTENT.sprites.atlases` 裡的一個名字，或直接給圖檔與 JSON（格式同圖集） |
| `cell` | 格子：0 起的編號（由左而右、由上而下）或 `[排, 欄]` |
| `shrink` | 1–8 的整數：整格縮成 1/n，每 n×n 取出現最多的不透明顏色（像素密度和其他圖相同、細節變少）。預設 1 |
| `at` | `[[x, z], …]`：沒有 `near` 時是場地上的位置（必填）；有 `near` 時是相對每個擺設的位移（預設 `[[0, 0]]`） |
| `near` | `tower`、`tomb`、`tree`、`sarc`：放在每座塔／每塊墓碑／每棵樹／每具石棺旁。依附的擺設不是立著（倒下、燃燒、破開）時裝飾跟著不畫、燈熄 |
| `share` | 0–1，有 `near` 時依擺設位置的雜湊固定挑這個比例（每次開局都挑同樣幾個，不抽亂數）。預設 1 |
| `block` | 0 以上：擋路的半徑（公尺），載入時加進障礙。預設 0（不擋路）。只對單獨擺的與放在塔旁的有效；依附在會倒下的擺設旁的一律不擋路（記警告） |
| `light` | `{ color, distance, intensity, y }`：每個裝飾一盞點光源，載入時就加好（數量固定，遊戲中途不加燈，材質不會重編）；全部裝飾合計最多 16 盞，超過的不加燈並記警告 |
| `halo` | 光暈，顏色預設是燈的顏色 |
| `flicker` | 燈與光暈的閃動速度倍率，0＝不閃。閃動是三個正弦的組合（約 ±12%，不抽亂數），`EG.reduceFlashing(true)` 時剩三成 |

裝飾和像素圖一樣正對鏡頭、腳底在地面上；有 `CONTENT.sprites` 時位置也對齊低解析度的像素格線。

```js
CONTENT.look = {
  clear: '#100f22', fog: { color: '#1b1a33', mul: 0.8 },
  hemi: { sky: '#5d6a9a', ground: '#1b1a33', mul: 1.35 }, moon: { color: '#a9b8f0', mul: 1.25 }, highMul: 0.8,
  terrain: { SOIL: { tint: [0.62, 0.82, 1] }, LAVA: { tint: [0.8, 0.7, 0.6], glow: 1 } },
  steps: { perUnit: 3, dither: 0.35 },
  towers: { y: 2.2, distance: 9, mul: 0.4, halo: { size: 3.6, y: 1.6, peak: 0.4 }, flame: false },
  actors: { diffuse: 0.35, fill: 0.75, fillColor: '#ffe8c8' },
  decor: [
    { atlas: 'deco', cell: 5, near: 'tower', at: [[-2.7, 0.9], [2.7, 0.9]], light: { color: '#ff9a3c', distance: 6, intensity: 1.4, y: 1.2 }, halo: { size: 2.6, y: 1.1 } },
    { atlas: 'deco', cell: 6, shrink: 2, near: 'tomb', share: 0.2, at: [[0.55, 0.3]], flicker: 1.4, halo: { color: '#ffd36a', size: 1.2, y: 0.45 } },
  ],
};
```

擴充腳本可以讀 `EGLook.state`（`on`、`frames`、`mats`、`decor`、`lights`、`halos`、`decorReady`、`patched`、`flame`、`err`）與 `EGLook.validate(值)`（回傳問題清單，空的表示可用）。

**依賴**：地面分階與地形色調是在 three.js r128 的 Lambert 著色器原文上插一段；引擎升級 three.js 時原文對不上，就記一行警告、分階不作用（畫面回到不分階），`tests/look.spec.js` 會紅。

## 地形動作與法術擴充（可選 `CONTENT.spellkit`）

內容包設了 `CONTENT.spellkit`（物件，或只寫 `true`）時，`kit/character.js` 才把 `kit/spellkit.js` 加進頁面（和 `kit/sprites.js`、`kit/look.js` 同一種載入法），示範版不下載也不執行。它加上：三種地形元素、給擴充腳本用的地形動作、四招的新參數、怪物狀態、四個事件、擺設自發光、技能列的名稱與圖示、「地形助攻」計數、可換的地形連鎖提示音。

**新參數全部是預設值時，四招的行為和沒有這個模組時完全相同**：同樣的傷害、同樣的地形、抽同樣多次亂數（`tests/unit.mjs` 用固定種子打一場固定的仗，示範頁與開了模組的頁逐筆比對每一下傷害、整張地形與下一個亂數）。新的程式路徑只在對應的參數被設定時才走。

### 欄位

| 欄位 | 預設 | 說明 |
|---|---|---|
| `ember` | 2 | 「火種」燒幾秒（見下方 `ember` 元素） |
| `lightDelay` | 0.3 | 光照到磷火墳後幾秒引爆 |
| `volt` | `{ water: 1.4, recharge: 2.8, blood: 1.4, steam: 0.7, mud: 0.7, fence: 1, fenceRange: 6, fenceReach: 0.5, fenceDps: 26 }` | `volt` 元素的帶電秒數：積水、已帶電的水再通一次電、血沼、蒸氣、泥沼、鐵柵欄；柵欄往左右各傳幾公尺、貼著柵欄多近會受電、每秒傷害 |
| `chainTone` | 引擎原本的音 | 「地形連鎖 ×N」的提示音。`false`＝不出聲；物件 `{ freq: 440, rise: 1.06, max: 20, sweep: 1.5, dur: 0.14, wave: 'triangle', vol: 0.12, fade: 1 }`：第 N 跳的音高＝`freq × rise^min(N, max)`，結尾音高再乘 `sweep`，音量＝`vol × fade^(N−2)`。`rise: 1` 就是每跳同一個音高（不成上行音階），`fade` 小於 1 就逐跳變小 |
| `assist` | `false` | `true`：階段結算畫面在「地形擊殺」下面多一列「地形助攻 N 隻」（只在結算畫面，結局畫面不顯示） |
| `skills` | — | `{ fire|bolt|meteor|blood: { name, label, icon } }`：技能列一開始就換上的名稱、名稱下的小字、圖示（同 `EG.setSkill`） |

型別不對：整個模組不生效、頁面維持原樣，讀取時的內容警告逐欄寫出（例：`CONTENT.spellkit.chainTone.wave 要是sine、square、sawtooth、triangle 其中之一`）。欄位名打錯、`skills` 裡不是招式名的鍵只警告。

### 三種新的地形元素

引擎原本的元素（`fire`、`bolt`、`meteor`、`crater`、`blood`）不變；新元素只在內容要求時才用（法術參數的 `elem`、`trail`、`hopElem` 等，或 `EG.terrain`）。

| 元素 | 打在 | 變成 |
|---|---|---|
| `ember`（火種） | 墓土、灰燼 | 燒 `ember` 秒的火，之後成灰燼 |
|  | 石板路、坑洞 | 燒 `ember` 秒的火，之後**還原**成石板路／坑洞 |
|  | 枯草、骨堆、積水、泥沼、磷火墳 | 同 `fire` |
|  | 血沼 | 灰燼 |
|  | 火焰 | 剩餘時間至少 `ember` 秒 |
|  | 熔岩 | 再多 5 秒（最多 28 秒） |
|  | 黑曜石 | 耐久 −1（第 3 次成坑洞） |
|  | 蒸氣 | 提早 1 秒散去 |
| `light`（光） | 磷火墳 | `lightDelay` 秒後引爆（同火焰引爆的規則與傷害） |
|  | 血沼 | 照乾成墓土 |
|  | 其他 | 不變（照樣發 `terrainHit` 事件，給畫面特效用） |
| `volt`（雷） | 積水 | 整片相連的水帶電 `volt.water` 秒（最多 140 格，同引擎） |
|  | 帶電水 | 整片再帶電 `volt.recharge` 秒 |
|  | 血沼 | 整片相連的血沼帶電 `volt.blood` 秒，之後**還原**成血沼（剩下的血沼時間照舊） |
|  | 蒸氣 | 整片相連的蒸氣帶電 `volt.steam` 秒，之後還原成蒸氣 |
|  | 泥沼 | 只有那一格帶電 `volt.mud` 秒，之後還原成泥沼 |
|  | 枯草、骨堆 | 30% 起火 |
|  | 磷火墳 | 引爆 |
|  | 黑曜石 | 耐久 −1 |

帶電的格就是「帶電水」：每秒 26、移動 ×0.5（引擎原本的數值）。「還原」的格在它自己燒完或電完的那一刻變回原本的種類；中途被別的元素改掉（例如火種被血環的血光蓋成灰燼），就照新的變化走、不再還原。

### 地形動作（`EG.terrain`）

| 呼叫 | 作用 |
|---|---|
| `EG.terrain.area(x, z, r, el, secs?)` | 圓內每格施加元素 `el`；`secs` 給了就是這一次的火種秒數。`volt` 也讓半徑內的鐵柵欄帶電。回傳格數 |
| `EG.terrain.path([[x, z], …], el, width = 1, secs?)` | 沿折線、寬 `width` 的每一格施加一次 |
| `EG.terrain.ring(x, z, r, el, width = 1, secs?)` | 圓周上寬 `width` 的每一格施加一次（中間不動） |
| `EG.terrain.sweep(x0, z0, x1, z1, el, secs = 0.6, width = 0.9, fx = 'fire', emberSecs?)` | 一個點在 `secs` 秒內從起點走到終點，經過的格各施加一次（滾火、火線、光線、電弧）；`fx` 是沿路的粒子：`'fire'`、`'light'`、`'volt'`、`'blood'` 或 `false`（不畫） |
| `EG.terrain.strike(x, z, r = 1.5)` | 落雷點：墓土與灰燼燒火種、其他格 `volt`、半徑內的枯樹起火、鐵柵欄帶電 |
| `EG.terrain.quench(x, z, r = 2)` | 熔岩碰到積水的地方立刻成黑曜石牆，水成蒸氣 |
| `EG.terrain.fence(x, z, r = 1)` | 半徑內的鐵柵欄帶電：沿線左右各 `volt.fenceRange` 公尺，遇到斷掉的那段就停；貼著帶電柵欄（`volt.fenceReach` 以內）的怪每秒受 `volt.fenceDps`（算地形傷害、地形殺），柵欄發藍光 |
| `EG.terrain.cellAt(x, z)` | `{ cell, type, timer, returnsTo }`：那一格的種類名（`TER` 的鍵）、剩餘秒數、之後會還原成什麼（沒有就是 `null`） |
| `EG.terrain.elements` | 可用的元素名 |

在一次施法的處理中（法術參數、事件的監聽函式裡）呼叫，改到的地形引爆的磷火、讓擺設倒下的壓擊都算**這次施法的爆發**（見下方「每次施法的紀錄」）。

### 四招的新參數

和原本的參數放在同一張表（`EG.setSpellParams`、`EG.spellParams`、`EG.resetSpellParams` 照舊）。元素名可用上一節的八種；空字串＝不施加。

| 招式 | 欄位（預設） | 說明 |
|---|---|---|
| `fire` | `pierce: false` | 穿過怪物不爆（每隻穿過一次發 `spell` 事件 `pass`），飛完才爆 |
| `fire` | `toAim: false`、`maxRange: 17` | 飛到這次施法瞄準的點才爆（三連發時各自沿自己的方向飛同樣遠），最遠 `maxRange` 公尺 |
| `fire` | `reflect: 0` | 從別的格飛進積水、帶電水、黑曜石的格時反彈幾次（發 `reflect`） |
| `fire` | `seed: 0`、`seedRadius: 1.5` | 大於 0：飛到瞄準點落地成「種子」（發 `seed`），等 `seed` 秒，有怪走進 `seedRadius` 內或時間到就爆 |
| `fire` | `elem: 'fire'` | 爆炸改地形的元素（例 `'volt'`：積水整片帶電而不是變蒸氣，柵欄帶電） |
| `fire` | `trail: ''`、`trailWidth: 1` | 飛行路徑經過的格施加這個元素（每格一次） |
| `fire` | `sweeps: 0`、`sweepLength: 3`、`sweepTime: 0.6`、`sweepSpread: 0.7`、`sweepElem: 'ember'` | 爆炸後往前方扇形滾出幾團（相鄰夾角 `sweepSpread` 弧度），`sweepTime` 秒滾 `sweepLength` 公尺，經過的格施加 `sweepElem`（本身不打傷害） |
| `bolt` | `fromSky: 0`、`skyRange: 16`、`pickRadius: 2` | 大於 0：不射雷球，瞄準點（最遠 `skyRange`）先出現預警圈，`fromSky` 秒後從天上劈下：打 `pickRadius` 內最近的怪，之後照常彈跳（發 `warn`、`strike`） |
| `bolt` | `strikeRadius: 1.5`、`strikeElem: 'volt'` | 天上劈下的那一點改地形的範圍與元素（`'volt'` 時同 `EG.terrain.strike`） |
| `bolt` | `hitElem: 'bolt'` | 雷球命中點與飛行中打到地面的元素 |
| `bolt` | `hopElem: 'bolt'` | 每一跳打到的那一格的元素 |
| `bolt` | `path: ''`、`pathWidth: 1` | 每一跳在兩隻怪之間的地面施加的元素（火線、光線） |
| `bolt` | `waterNet: false` | 目前的目標站在積水或帶電水上時，下一跳也可以跳到同一片相連水面上的任何怪（不受 `range` 限制，挑最近的） |
| `bolt` | `arcs: true` | `false`：彈跳不畫引擎的電弧與命中閃光（內容自己畫） |
| `bolt` | `hopDelay` | 原本就有；設 0 時同一格之內一路跳完 |
| `meteor` | `pattern: 'line'`、`lineStart: 3`、`lineGap: 1.6` | 從施法者往瞄準方向 `lineStart` 公尺起，每 `lineGap` 公尺一顆，由近到遠依序落下 |
| `meteor` | `pattern: 'ring'`、`ringRadius: 3.5` | 以瞄準點為圓心、半徑 `ringRadius` 排成一圈依序落下 |
| `meteor` | `elem: 'meteor'` | `'volt'`：落點的積水整片帶電（不變蒸氣），其他地面照舊成熔岩與坑洞；其他元素：整個落點範圍改施加那個元素 |
| `meteor` | `quench: false` | 每顆落下後，熔岩碰到積水的地方立刻成黑曜石牆、水成蒸氣 |
| `meteor` | `plow: 0` | 最後一顆落下後，沿第一顆到最後一顆的方向再往前犁出幾公尺坑洞（引擎原本的規則會讓熔岩流進坑洞） |
| `meteor` | `arcBolt: 0` | 大於 0：相鄰兩顆的落點之間在地上拉一道電弧（畫面停留這麼多秒），經過的格施加 `volt`（發 `arc`） |
| `blood` | `focus: false` | 八道血光全部射向離瞄準點最近的怪（`seek` 以內）；牠中途倒下，還沒命中的改射離牠最近的怪 |
| `blood` | `crawl: 0`、`crawlElem: ''` | 大於 0：血光貼著地面以每秒這麼多公尺竄向目標，經過的格施加 `crawlElem` |
| `blood` | `elem: 'blood'` | 血光落點改地形的元素（例 `'ember'`：落點燒火種） |
| `blood` | `fireWall: 0`、`wallElem: 'ember'` | 大於 0：法陣出現時在這個半徑畫一圈 `wallElem`，火種秒數＝法陣的 `duration`（發 `wall`） |

### 怪物狀態

| 呼叫 | 作用 |
|---|---|
| `EG.status(怪物, 'root', 秒)` | 定身：不移動（仍受地形傷害） |
| `EG.status(怪物, 'stun', 秒)` | 麻痺：不能近身攻擊，仍可移動 |
| `EG.status(怪物, 'ground', 秒)` | 落地：浮空的怪（不含首領）暫時站到地上，受地面地形傷害與倒下的擺設壓擊 |
| `EG.statusOf(怪物)` | `{ root, stun, ground }` 剩餘秒數 |

怪物物件從 `hit`、`spell` 事件的 `target` 拿。時間用遊戲時間算（暫停時不走）；同一種狀態取較長的那個；`EG.clearEffects()` 全部清掉。每次成立發 `status` 事件。

### 事件（模組開著時才有）

| 事件 | 參數 | 何時 |
|---|---|---|
| `spell` | `{ type, spell, x, z, target?, cast, … }` | 新參數的時刻：`pass`（穿過）、`reflect`、`seed`、`explode`（火球或命中元素不同的雷球爆開；`seed: true` 表示是種子）、`warn`（天上的預警圈出現）、`strike`、`hop`（每一跳，`from`、`target`）、`land`（每顆星墜落地與每道血光落地；星墜附 `index`、`count`、`last`、`aim`）、`arc`、`wall` |
| `status` | `{ target, kind, secs }` | `EG.status` 成立 |
| `terrainHit` | `{ cell, x, z, el, from, to, cast }` | 任何元素打到一格（引擎原本的元素也算），`from`／`to` 是打之前、之後的種類名；沒有改變時兩者相同 |
| `terrainChange` | `{ cell, x, z, from, to, cast }` | 任何一格的種類改變（含自動演變：延燒、燒完、流動；這些的 `cast` 是 `null`） |

沒有任何監聽函式時，這四個事件不組參數、不花時間。

### 擺設自發光（`EG.glow`）

`EG.glow(擺設, { color: '#ffffff', strength: 1, secs: 0.5 })`：在擺設上疊一層相加混色的同形狀（3D 模型或像素圖都可以），`secs` 秒內淡出後移除；鐵柵欄是逐段發光。`EG.propsNear(x, z, r, kind?)` 回傳半徑內的擺設（`tomb`、`tree`、`fence`、`sarc`；是遊戲裡的物件本身，請只讀）。`EG.reduceFlashing(true)` 時亮度乘 0.3。

### 技能列（`EG.setSkill`）

`EG.setSkill(id, { name, label, icon })`：`name` 換技能格的名稱、`label` 換名稱下的小字（引擎原本寫「三連發」「彈跳 6 次」的那一行；之後引擎重寫小字時照樣保留內容給的）、`icon` 是圖檔網址（顯示在技能格右上角 18×18、像素不模糊，不蓋住按鍵提示）。值給 `null` 就回到引擎原本的。招式名或欄位不對：`console.warn` 一行、回傳 `false`，其他合格欄位照樣生效。

### 地形助攻

吃過地形傷害（`terrain`、`crush`、`boom`）、最後被法術打倒的怪，算一次「地形助攻」。地形殺的意思不變（最後一擊是地形的才算）。`EG.terrainAssists()` 回傳開新局以來的數目；`assist: true` 時顯示在階段結算。

### 每次施法的紀錄（引擎本身，不用開模組）

每次施放（`tryCast` 成立）引擎建一筆紀錄 `{ id, n, mul }`：`n` 是第幾次施法、`mul` 預設 1。在 `cast` 事件的監聽函式裡用 `EG.castInfo()` 拿到這一筆（是紀錄本身，不是複本），設定 `mul` 就**鎖定這次施法的傷害係數**：這次施法造成的每一下傷害都乘上它——火球與雷球的命中、鏈雷每一跳、星墜每一顆與它留下的燃燒地面、血環每一道血光，以及這次施法**引爆的磷火**（含接著連爆的）與這次施法**打倒的墓碑、點燃的枯樹倒下時的壓擊**。留在地上的地形（火、熔岩、帶電水、血沼……）與不是這次施法引起的磷火爆、壓擊一律 ×1。`hit` 事件多一個 `cast` 欄位：造成這一下的那次施法的紀錄（地形與其他傷害是 `null`）。不設 `mul` 時每一下都和以前相同。

## 引擎行為（不是內容欄位，內容包不必設定）

- **資源釋放**：怪物死亡或換幕清場時，會釋放它的幾何體與材質；掉落物、焦痕貼花、血環的材質也一併釋放。連續遊玩時上傳到顯示卡的幾何體數量會回到基準附近，不再隨怪物數一路成長。
- **首領倒下後死亡**：首領倒下到結局畫面之間（結尾階段）玩家死亡，按重來不會回到上一幕、也不會抹掉首領戰；直接接著播 `flow.down` 的對白，再進結局。已在結局畫面時按重來，留在結局畫面。
- **首領戰重來不重播首領對白**：重來只是重新生出首領，登場對白（`flow.preBoss`）不會再播。
- **對白中不開行囊**：對白顯示時，I、Tab 與行囊按鈕都不會打開行囊（已經開著的行囊仍可關掉）。
- **施法動作中按下的招式會記住**：按下招式鍵（或點技能格、按右鍵）時，若主角正在做另一招的施法動作，這一次按鍵不會被丟掉，而是記下來（只記最後一次），在目前的動作結束的那一格施放，瞄準用那一格的游標位置。那一格冷卻還沒好、暫停、選單或對白開著、擴充暫停或主角倒下時就不施放，也不再留著。目前的動作被中斷（例如主角倒下）時，記下的按鍵作廢。按住左鍵的連發不會蓋掉記下的按鍵。冷卻未好、還沒學會、暫停中按下的鍵，照舊不施放、也不記住。
- **新的一局從乾淨的狀態開始**：開新故事、從存檔繼續、重來（`R`）、自由試玩、回標題，都會先把四招與閃現的冷卻歸零，並清掉上一局留下的施法佇列（施法動作中按下、還沒施放的招式）、停格、鏡頭震動、閃現的無敵窗、進行中的血環與其他殘留特效（同 `EG.clearEffects()`）。
- **結局畫面時不能操作**：結局畫面顯示時（`EG.ui().ending`），招式鍵、點技能格、按住左鍵、閃現鍵與 `EG.blink()` 都不作用，移動鍵也不會讓主角走動。結局畫面的按鈕照常可按。
- **組合鍵留給瀏覽器**：按住 `Ctrl`、`Alt` 或 `Meta`（⌘）時，招式鍵、行囊鍵與閃現鍵都不作用（例如 `Ctrl+F` 是瀏覽器的搜尋，不會閃現）。`Shift` 不是瀏覽器快捷鍵，按住時照常施法與閃現。移動鍵不受影響。
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
| `EG.castInfo()` | 正在施法的那一次的紀錄 `{ id, n, mul }`（紀錄本身）；在 `cast` 事件裡設 `mul` 就鎖定這次施法的傷害係數（見「地形動作與法術擴充」的「每次施法的紀錄」）。沒有在施法時是 `null` |
| `EG.on(事件, fn)`／`EG.off(事件, fn)` | 訂閱／取消；事件名打錯或 `fn` 不是函式時 `console.warn` 並略過 |
| `EG.pause(on, owner = 'default')` | 擴充腳本自己的暫停：遊戲規則（怪物、投射物、計時器、故事進度）與施法全停，畫面照常更新，適合在塔下跳出升級面板。每個持有者（任意字串）各自按住：`pause(true, 'panel')` 按住、`pause(false, 'panel')` 只放開 `'panel'` 自己那一份；**只要還有任何一個持有者按著，遊戲就停著**。同一個持有者按兩次仍算一份。只給一個參數時持有者是 `'default'`，所以舊的 `pause(true)`／`pause(false)` 寫法行為不變。和暫停選單、對白各自獨立，互不解除 |
| `EG.isPaused()`、`EG.pausedBy()` | 有任何持有者按著就是 `true`；`pausedBy()` 回傳目前按著的持有者陣列（複本） |
| `EG.inCombat()` | 場上有活著的怪，或正在首領戰 |
| `EG.events` | 事件名清單 |
| `EG.enableBlink(on = true)`、`EG.blinkEnabled()` | 開關選用的閃現，回傳開關後的狀態；關閉時技能格、說明列與改鍵列一併移除 |
| `EG.reduceFlashing(on)`、`EG.flashingReduced()` | 擴充腳本告訴引擎「玩家要求減少閃光」（例如擴充腳本自己的設定選項），回傳開關後的狀態；**預設關閉**，關閉時畫面與數值和以前完全相同。開啟時：燈光池的每一次短暫閃光（星墜與火球的爆炸、鏈雷命中、首領登場、衝擊波打中主角、閃現抵達點）亮度乘 0.3；怪物被擊中時的發白乘 0.3；閃現不震鏡頭（閃光同「減少震動與停格」降到約三分之一）。不改粒子、翻頁圖、光暈與鏈雷的電弧本身；其他鏡頭震動與停格仍由玩家的「減少震動與停格」決定。開關不存檔，擴充腳本每次載入時自己設定 |
| `EG.blink(dx, dz)` | 讓主角閃現一次，回傳 `true`＝成功。不給方向就照移動鍵（沒按就往面向）；給 `dx`、`dz`（水平方向，不必是單位長度）就往那個方向，給手把或擴充腳本用。關閉、冷卻中、暫停或選單中、擴充暫停、結局畫面、主角倒下、前方沒有能落腳的位置時回傳 `false`，不扣冷卻 |

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
| `hit` | `{ spell, kind, source, target, amount }` | 每次對怪物造成傷害；`amount` 已含暴擊。`kind` 是傷害種類，也就是地形系統用的元素（`fire`／`bolt`／`blood`，以及地形與物件造成的 `burn`、`terrain`、`crush`、`boom`）；`spell` 與 `kind` 相同（舊欄位，保留相容）。`source` 是**真正造成這一下的法術部位**：`'fire'` 火球爆炸、`'meteor'` 星墜落地、`'meteorBurn'` 星墜留下的燃燒地面、`'bolt'` 鏈雷直擊、`'boltChain'` 鏈雷彈跳、`'boltSplash'` 未升級鏈雷打中後的周圍濺射、`'blood'` 血環的血光（含目標已倒、落空時的小範圍爆開）；不是法術造成的（燃燒的草地與熔岩、磷火爆炸、倒下的墓碑、直接呼叫 `dealDamage`）是 `null`。例：星墜落地是 `kind: 'fire', source: 'meteor'`，它的燃燒地面是 `kind: 'burn', source: 'meteorBurn'`。`cast` 是造成這一下的那次施法的紀錄（`EG.castInfo()` 的那一筆；這次施法引爆的磷火與打倒、點燃的擺設壓擊也算），其他是 `null` |
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
- **時機**：和施法相同的限制（遊戲進行中、沒有暫停或選單、沒有擴充暫停、不在結局畫面、主角活著）；施法動作中也能閃現，不打斷施法。冷卻與無敵都用遊戲時間計，暫停時不走；新的一局開始時冷卻歸零、無敵窗取消。無敵期間所有對主角的傷害（含熔岩）都不生效。
- **按鍵**：預設 `F`，存在同一份改鍵設定裡（`KB.blink`），設定的「按鍵」列多一列「閃現」可改；與別的動作互換、保留鍵（`EG.reserveKey`）的規則同其他按鍵。**一個鍵只給一個動作**：載入時（以及每次開啟閃現時）若有兩個動作綁在同一個鍵，按鍵表裡排在前面的動作留著這個鍵，後面的改成不綁鍵（改鍵列與技能格顯示「—」）並 `console.warn` 一行；閃現排在最後，所以閃現出現之前存下、已經把 `F` 給了某一招的改鍵，載入後 `F` 仍是那一招，閃現不綁鍵，玩家到設定的按鍵列自己指定。按住 `Ctrl`／`Alt`／`Meta` 時閃現鍵不作用（`Ctrl+F` 是瀏覽器搜尋），按住 `Shift` 照常閃現。
- **畫面**：開啟後技能列多一格「閃現」（顯示按鍵、距離與冷卻圈），說明頁多一行，觸控模式下這一格就是觸控按鈕（點一下閃現）。關閉時這三樣都移除。
- **特效與音效**：全部用現有的粒子池、翻頁圖與燈光池：出發與抵達各一團紫色星形火星、一張染色的爆炸翻頁圖、一圈地面光暈與往上竄的火星，中間一道殘影，抵達點一盞 0.35 秒的閃光，鏡頭小震一下；一次約 110 片粒子。粒子數照設定的粒子密度（低／中只發一部分）；「減少震動與停格」打開時不震，閃光強度降到約三分之一；擴充腳本呼叫 `EG.reduceFlashing(true)` 時同樣不震、閃光降到約三分之一（設定畫面沒有獨立的「減少閃光」選項，由擴充腳本提供）。音效是即時合成的短促上掃音（`sfx.blink`）。
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
- 內容包的 script 必須全部排在 `kit/` 之前，而且不得加 `defer` 或 `async`；`kit/` 的一般 script 必須照上面第 3 點的順序、`core.js` 排第一，並全部排在第一個 `defer` 之前；頂層 `const`／`let`／`class` 不得在兩個一般 script 重複宣告；頁面載入的本機 script 總量計入 216.125 KB 程式碼預算（延後載入的 `kit/blink.js` 也算在內）；`index.html` 沒有載入、由其他 kit 檔案視需要加進頁面的模組（目前是 `kit/sprites.js`、`kit/look.js` 與 `kit/spellkit.js`）另計，合計不超過 120 KB，且每一支都要能編譯（`scripts/smoke.mjs` 把關）。
- 法術數值在 `kit/combat.js` 的 `SPELL_DEF`，執行中由擴充腳本用 `EG.setSpellParams` 改（見上一節），內容包不設定。怪物種類與數值（`ETYPES`）、裝備的形狀與詞綴數值範圍目前仍在 `kit/`（怪物的名稱與外觀可用 `CONTENT.monsters` 覆寫、裝備名稱用 `CONTENT.loot`、裝備傷害詞綴用 `combat.gearDamage` 關，數值本身不行）；之後其他內容包要換的話，再往 `CONTENT` 加欄位。
