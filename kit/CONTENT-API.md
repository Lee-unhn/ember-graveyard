# kit/ 與內容包的介面

`kit/` 是引擎：渲染、粒子、地形、法術、怪物、裝備、存檔、設定、後製、像素角色、光影、地面細節、霧、觸控、角色模型載入、故事流程的規則。
**內容**（對白、說話者、塔與幕的設定、首領名稱、語音與模型的路徑）不在 `kit/`，由一組放在 `window.CONTENT` 的資料提供。A 的示範內容在 `content/demo/`；另一個遊戲想只取引擎，就引入 `kit/`，自己寫一組同樣欄位的內容包。

## 載入順序（index.html 負責）

1. three.js（CDN）
2. 內容包的 script（全部先於 `kit/`），每個只做 `window.CONTENT = window.CONTENT || {}` 再補欄位
3. `kit/core.js`、`world.js`、`combat.js`、`systems.js`、`story.js`、`ui.js`、`boot.js`（一般 script，不加 `defer`，依序執行；頂層 `const`／`let`／`function` 在檔案之間以名稱共用，不是 ES module）
4. `kit/controls.js` 起的 `defer` 腳本（觸控、後製、像素角色、光影、地面細節、霧、角色載入器），整份文件解析完才依文件順序執行
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
| `CONTENT.dialog` | `{ 對白代號: [[說話者代號, 文字], ...] }` | 引擎用 `playDialog(對白代號)` 播放；`dark` 在首領血量過半時播、`end` 在首領倒下後播，其餘代號由 `acts` 指定。查不到的代號（含沒給 `dark`／`end`）直接略過那段對白、故事照常往下走 |
| `CONTENT.towers` | `[{ name, dir, spell, col, c, kind }]` | 每座塔一筆：畫面文字、解鎖的招式（`fire`／`bolt`／`meteor`／`blood`）、塔火顏色（`col` 十六進位、`c` 是 0–1 的 RGB）、粒子種類；順序＝點亮順序 |
| `CONTENT.towerPos` | `[[x, z], ...]` | 與 `towers` 同順序的位置；地形的石板路、障礙與出怪都依這份排 |
| `CONTENT.acts` | `[{ n, mix, dlg?, after }]` | 每幕要擊倒的數量、三種怪的比例、開幕對白代號（選填）、點亮塔後播的對白代號；幕數要等於塔數 |
| `CONTENT.text.bossName` | 字串 | 首領血條名字（`boot.js` 讀取時填入 `#bossbar .nm`）、提示文字、死亡畫面；沒給就用「首領」並記警告 |
| `CONTENT.text.introNote` | 字串（選填） | 標題畫面的開場說明（填入 `#introNote`）；不給就留空 |
| `CONTENT.text.endNote` | 字串（選填） | 結局畫面的結語；不給就留空 |
| `CONTENT.id` | 字串（`A-Z a-z 0-9 _ -`，最長 40） | 內容包識別：存檔 `eg-save`、設定 `eg-settings`、改鍵 `eg-keys` 的鍵名會變成 `<鍵名>:<id>`，同網域的兩個內容包互不讀到對方的存檔。**id 為 `demo` 時沿用原本的鍵名**（示範版的既有玩家存檔不失效）；其他內容包請取不同的 id。沒給就用內容指紋（`p…`）並記警告 |
| `CONTENT.voiceDir` | 字串（選填，結尾沒有 `/` 會自動補） | 預錄語音資料夾，檔名＝`對白代號_第幾句_說話者代號.ogg`；不給就直接用瀏覽器朗讀，不向伺服器要檔案 |
| `CONTENT.modelScript` | 字串（選填） | 人偶模型的腳本檔（定義 `window.MAGE_GLB`）；不給就用程式拼的方塊法師 |

## 邊界（由 `tests/checks.mjs` 把關）

- `kit/` 不得出現內容包擁有的字串：說話者名字、塔名、首領名與其他 `text` 文字、對白句子（比對是真的執行內容檔、從 `CONTENT` 讀出來的，不是固定字表；unicode 跳脫與字串拼接也會被還原後比對），並附「偵測器確實讀到內容」的自我檢查。示範內容擁有的名字見 `content/demo/`。
- 內容包只能放資料：不得出現 `THREE`、`renderer`、`document`、`function`、箭頭函式、`if`／`for`／`while`／`switch`／`try`／`throw`、`new`、`class`、getter／setter、`localStorage`／`fetch`／`eval`／計時器等有副作用的名稱，樣板字串裡的 `${…}` 也一併檢查。閘門檢查 `content/*/` 底下全部的 `.js`，加上 index.html 實際載入的內容 script。
- 內容包的 script 必須全部排在 `kit/` 之前，而且不得加 `defer` 或 `async`；`kit/` 的一般 script 必須照上面第 3 點的順序、`core.js` 排第一，並全部排在第一個 `defer` 之前；頂層 `const`／`let`／`class` 不得在兩個一般 script 重複宣告；頁面載入的本機 script 總量計入 200 KB 程式碼預算。
- 怪物種類與數值（`ETYPES`）、法術數值（`SPELLS`）、裝備詞綴目前仍在 `kit/`；之後商業版要換的話，再往 `CONTENT` 加欄位。
