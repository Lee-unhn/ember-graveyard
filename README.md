# Ember Graveyard · 燼語墓園

**Play in the browser → https://lee-unhn.github.io/ember-graveyard/** (keyboard + mouse)

[中文說明見下](#中文說明)

A single-file WebGL prototype that rebuilds four top-down 3D spells — fireball, chain lightning, meteor rain and a blood-rune barrage — using one decomposition method: **never paste a whole effect video into a 3D game; split every spell into flipbook textures, code-driven particles + lights, and 3D meshes, then let code decide when it fires, where it flies and where it explodes.** An in-game *Lab* panel switches between three texture routes live so you can compare them side by side.

![Gameplay: meteor rain and a triple fireball](docs/media/gameplay.jpg)

| Same fireball, three texture routes |
|---|
| ![Flipbook atlas vs procedural shader vs quads only](docs/media/routes.jpg) |

## Two ways to play

- **Story mode · Chapter 1** (about 15 minutes) — you are an apprentice fire mage keeping a graveyard whose four lighthouses have gone dark. Clear each wave, stand under the next lighthouse to relight it, and every lighthouse teaches you one spell. Dialogue between waves has portraits and browser text-to-speech. The chapter ends with a boss, the Lord of the Unlit, who sends out expanding shockwaves, summons the dead and plunges the graveyard into darkness at half health.
- **Free play** — all four spells unlocked, endless waves, and the Lab panel to switch texture routes and basic/upgraded spells.

## What it demonstrates

| Idea | How it shows up in the game |
|---|---|
| Three building blocks | Flipbook sheets (fire, explosion, smoke, sparks — 4×4 frames each), a GPU-instanced particle system with a fixed pool of 10 point lights, and procedural meshes (meteor rock, monsters, loot) |
| Billboards make it round | The fireball core is three overlapping camera-facing quads spinning at different speeds, plus a glow quad |
| Trail and impact numbers | 240 trail quads per second that shrink out within 0.1 s; 40 sparks with gravity and bounce on impact; a light that travels with the projectile |
| Three texture routes | **Flipbook atlas** (16 frames drawn once), **procedural shader** (noise computed per pixel, no images), **quads only** (outlines, to see the trick) |
| Bring your own atlas | Draw a black-background 4×4 sheet with any image model and upload it from the Lab panel; black turns transparent automatically |
| Basic → upgraded | single → triple fireball, single hit → lightning that chains 6 times, one meteor → 10-meteor rain |
| A small ARPG loop | 50 monsters per wave, damage numbers, health bars, loot beams, a shape-based grid inventory (staff 1×4, helmet 2×2, armour 2×3) and stats that change when you equip |

Everything — textures, rune circle, rock, sounds — is generated in code. No downloaded art assets.

## Controls

| Input | Action |
|---|---|
| `W A S D` | Move |
| Mouse | Aim |
| Left click / `1` | Fireball |
| Right click / `2` | Chain lightning |
| `3` | Meteor (lands at the cursor) |
| `4` | Blood rune barrage |
| `I` | Inventory (left click equip, right click discard) |
| Wheel | Zoom |
| `Space` / click | Next dialogue line |

## Architecture

```mermaid
flowchart LR
  subgraph INPUT[👤 Player input]
    KEYS([Keyboard · WASD, 1-4, I]):::input
    MOUSE([Mouse · aim, left, right]):::input
    UPLOAD([Upload 4×4 black-background sheet]):::input
  end
  subgraph UI[🖥️ UI layer]
    LAB[Lab panel · texture route, basic or upgraded]:::ui
    HUD[Status, skill bar, health]:::ui
    INV[Inventory · 10×6 shaped grid, 7 slots]:::ui
    FXL[Overlay · damage numbers, health bars]:::ui
  end
  subgraph LOGIC[⚙️ Game logic]
    LOOP[/Main loop · dt ≤ 0.05 s/]:::pipeline
    CAST[/Casting · cooldown, gesture, release/]:::pipeline
    SPELLS[/Four spells/]:::pipeline
    ENEMY[/Monster AI · chase, separate, bite/]:::pipeline
    LOOT[/Loot and stats/]:::pipeline
  end
  subgraph VFX[🔥 Three building blocks]
    ATLAS[(Flipbook atlas 1024² · 4 sheets × 16 frames)]:::model
    SHADER[/Shader modes · atlas, procedural, quads/]:::pipeline
    PSYS[Particle system · 12000 additive + 3000 smoke, camera-facing quads]:::worker
    LIGHTS[Light pool · 10 lights]:::worker
    MESH[(Procedural meshes · meteor, monsters, loot)]:::model
  end
  subgraph OUT[🖼️ Output]
    CANVAS[(WebGL canvas · Three.js r128)]:::output
    SND[(WebAudio synthesized sound)]:::output
  end
  KEYS --> CAST
  MOUSE --> CAST
  UPLOAD --> ATLAS
  LAB -. route .-> SHADER
  LAB -. tier .-> SPELLS
  LOOP --> CAST
  LOOP --> HUD
  CAST --> SPELLS
  SPELLS --> PSYS
  SPELLS --> LIGHTS
  SPELLS --> MESH
  SPELLS --> ENEMY
  ENEMY --> LOOT
  LOOT --> INV
  INV -. stats .-> CAST
  ENEMY -. hit .-> FXL
  ATLAS --> SHADER
  SHADER --> PSYS
  PSYS --> CANVAS
  LIGHTS --> CANVAS
  MESH --> CANVAS
  SPELLS -. impact .-> SND
  classDef input fill:#74c7ec,stroke:#1e6091,color:#000
  classDef ui fill:#cba6f7,stroke:#5b2d8a,color:#000
  classDef pipeline fill:#fdd97a,stroke:#7d6608,color:#000
  classDef model fill:#a6e3a1,stroke:#1e6f1a,color:#000
  classDef output fill:#f5c2e7,stroke:#7a2e6d,color:#000
  classDef worker fill:#94e2d5,stroke:#1d6e62,color:#000
```

## Gameplay flow

```mermaid
flowchart TD
  START([Open page]):::input --> BUILD[/Draw flipbook atlas in code/]:::pipeline --> INTRO[Intro · Enter the graveyard]:::ui
  INTRO --> SPAWN[/Spawn wave · 50 monsters/]:::pipeline --> FIGHT[Fight]:::worker
  FIGHT --> PRESS([Key or mouse]):::input --> CD[/Cooldown check/]:::pipeline --> POSE[/Spell-specific gesture/]:::pipeline --> RELEASE[/Release · spawn spell/]:::pipeline
  RELEASE --> FLY[/Flight · core quads, 240 trail quads/s, travelling light/]:::pipeline --> HIT[/Impact · explosion flipbook, 40 sparks, smoke/]:::pipeline
  HIT --> AFTER[/Aftermath · burning ground, lightning chain/]:::pipeline
  HIT --> DMG[/Damage · 12% crit ×1.8/]:::pipeline
  AFTER --> DMG --> KILL[Kill]:::worker --> DROP[(Loot drop)]:::output --> PICK[/Walk over to pick up/]:::pipeline --> EQUIP[/Equip · stats recalculated/]:::pipeline
  EQUIP -. damage, cooldown, health .-> CD
  KILL -. wave cleared .-> CLEAR[/Next wave in 2.5 s · +5 monsters, +25% HP/]:::pipeline -.-> SPAWN
  FIGHT -. health reaches 0 .-> DEAD([Fallen · try again]):::safety -.-> SPAWN
  classDef input fill:#74c7ec,stroke:#1e6091,color:#000
  classDef ui fill:#cba6f7,stroke:#5b2d8a,color:#000
  classDef pipeline fill:#fdd97a,stroke:#7d6608,color:#000
  classDef safety fill:#fab387,stroke:#7a3f10,color:#000
  classDef output fill:#f5c2e7,stroke:#7a2e6d,color:#000
  classDef worker fill:#94e2d5,stroke:#1d6e62,color:#000
```

Interactive versions with pan, zoom and a clickable mind map: open [`docs/diagrams/2026-11-15_EmberGraveyard_預設圖/architecture.html`](docs/diagrams/2026-11-15_EmberGraveyard_預設圖/architecture.html) locally (works offline).

## Method notes and parameters

[`docs/METHOD.md`](docs/METHOD.md) — the full breakdown: building blocks, every number used (emitter rates, lifetimes, sizes, gravity), the three texture routes with cost notes, and image-model prompts for drawing your own 4×4 sheets.

## Run and test locally

```bash
python -m http.server 8794
```

Then open `http://localhost:8794`. Opening `index.html` directly also works.

```bash
node scripts/smoke.mjs --browser
```

Static gates (size, allowed hosts, script compiles, privacy scan) plus a headless Chrome probe that casts all four spells, checks damage, particle peak, GL errors in all three texture routes, equipment stats and console errors, then plays story mode from the opening to the ending (four lighthouses lit, four spells unlocked, boss shockwave and darkness phase, ending screen). `--selftest` proves the gates turn red on a poisoned copy; `--url=<site>` probes a deployed copy. Needs Node 18+ and Chrome (or set `CHROME_PATH`).

## Roadmap

| Phase | Scope |
|---|---|
| P0 ✅ | Public repo, GitHub Pages, smoke harness, diagrams |
| P1 ✅ | Story mode chapter 1: four lighthouses, spell unlocks, dialogue with voice, the Lord of the Unlit |
| P2 | Destructible terrain and terrain kills: spells reshape the ground, terrain spreads and flows, tombstones topple onto monsters |
| P3 | New skin: low-poly characters with animation, image-model flipbooks compared side by side, better voices |
| P4 | Touch controls for phones |
| P5 | Port the fireball emitters to Godot and compare |

## Credits

- Method inspired by a video walkthrough of building top-down 3D spell effects with AI: https://www.youtube.com/watch?v=waaAXPt7RG8 . No footage or assets from the video are used; this project re-implements the idea from scratch.
- [Three.js](https://threejs.org/) r128 (MIT), loaded from cdnjs. Noto Sans TC / Noto Serif TC via Google Fonts (SIL OFL). See [NOTICE.md](NOTICE.md).
- Author: JasonLee ([Lee-unhn](https://github.com/Lee-unhn)). Code under the [MIT License](LICENSE).

---

## 中文說明

**瀏覽器直接玩 → https://lee-unhn.github.io/ember-graveyard/**（需要鍵盤與滑鼠）

單一 HTML 檔的 WebGL 試玩：用同一套拆解法做出四招俯視角 3D 法術（焰核彈、鏈雷、星墜、血環）。核心觀念是**整段特效影片不能直接放進 3D 遊戲**：每招都要拆成翻頁圖、程式控制的粒子與燈光、3D 模型三種零件，再由程式決定何時射、往哪飛、在哪炸。遊戲內的「拆解台」可以即時切換三條貼圖路線，並排比較效果。

### 兩種玩法

- **故事模式・第一章**（約 15 分鐘）：你是見習火術師，墓園的四座燈塔全熄了，亡者醒了過來。每一幕先清掉一波怪，再站到下一座燈塔下把它點亮，每點亮一座就學會一招法術。波次之間有附頭像的對白，並用瀏覽器內建語音朗讀。最後的首領是「無燈之主」：會放往外擴散的衝擊波、召喚亡者，血量剩一半時讓整座墓園陷入黑暗。
- **自由試玩**：四招全開、波次無限，可以用拆解台切換貼圖路線與基礎／升級法術。

### 看得到的重點

| 觀念 | 在遊戲裡的樣子 |
|---|---|
| 三種零件 | 翻頁圖（火焰、爆炸、濃煙、光點，各 4×4 共 16 格）、一次畫完的粒子系統加上固定 10 盞的燈光池、程式捏出的模型（隕石、怪物、裝備） |
| 方塊永遠面向鏡頭 | 火球球心是三片疊在一起、轉速不同的方塊，再加一圈光暈 |
| 尾焰與命中的數字 | 尾焰每秒 240 片、每片 0.1 秒內縮小熄滅；命中炸出 40 顆會落地反彈的火星；一盞燈跟著火球飛、照亮地面 |
| 三條貼圖路線 | 翻頁圖集（16 格一次畫好）、程式即時算（每個像素用雜訊公式算，不用圖片）、只看方塊（只畫外框，看穿效果怎麼做出來） |
| 換上自己畫的圖 | 用任何繪圖模型畫一張黑底 4×4 圖，從拆解台上傳，黑色會自動變透明 |
| 基礎與升級 | 單發變三連發、單擊變彈跳 6 次、單顆隕石變十顆連落 |
| 小型動作遊戲循環 | 每波 50 隻怪、傷害數字、血條、掉寶光柱、照形狀占格的背包（法杖 1×4、頭盔 2×2、胸甲 2×3），穿上裝備數值會變 |

貼圖、法陣、石頭、音效全部由程式產生，沒有使用任何下載的美術素材。

### 操作

| 輸入 | 動作 |
|---|---|
| `W A S D` | 移動 |
| 滑鼠 | 瞄準 |
| 左鍵／`1` | 焰核彈 |
| 右鍵／`2` | 鏈雷 |
| `3` | 星墜（落在游標處） |
| `4` | 血環 |
| `I` | 行囊（左鍵穿上、右鍵丟掉） |
| 滾輪 | 鏡頭遠近 |
| `空白鍵`／點一下 | 下一句對白 |

### 架構圖與流程圖

上方兩張 mermaid 圖在 GitHub 上直接顯示。可縮放、可點選心智圖的互動版在 [`docs/diagrams/2026-11-15_EmberGraveyard_預設圖/architecture.html`](docs/diagrams/2026-11-15_EmberGraveyard_預設圖/architecture.html)，下載後離線開啟即可。

### 方法與參數

[`docs/METHOD.md`](docs/METHOD.md) 收錄完整拆解：三種零件、每個數字（發射頻率、壽命、大小、重力）、三條貼圖路線的成本比較，以及請繪圖模型畫 4×4 翻頁圖的提示詞。

### 本機執行與驗收

```bash
python -m http.server 8794
```

開 `http://localhost:8794`；直接雙擊 `index.html` 也可以。

```bash
node scripts/smoke.mjs --browser
```

靜態閘門（大小、外連網域、程式可編譯、隱私掃描）加上無頭 Chrome 探針：四招各施放一次並確認造成傷害，同時檢查粒子峰值、三條路線無繪圖錯誤、穿裝後數值、主控台錯誤數；再把故事模式從開場跑到結局（四座塔全亮、四招全解鎖、首領衝擊波與黑暗階段、結局畫面）。加 `--selftest` 會用一份故意弄壞的副本證明閘門會變紅；加 `--url=<網址>` 可直接測線上版。需要 Node 18 以上與 Chrome（或設定 `CHROME_PATH`）。

### 階段規劃

| 階段 | 內容 |
|---|---|
| P0 ✅ | 公開 repo、GitHub Pages、驗收工具、架構圖與流程圖 |
| P1 ✅ | 故事模式第一章：四座燈塔、法術解鎖、有語音的對白、首領無燈之主 |
| P2 | 地形破壞與地形殺：法術改寫地面、地形會蔓延流動、墓碑倒下壓死怪 |
| P3 | 換皮：附動畫的低多邊形角色、用繪圖模型畫的翻頁圖並排實測、更好的語音 |
| P4 | 手機觸控操作 |
| P5 | 把火球發射器移植到 Godot 並排比較 |

### 致謝與授權

- 方法參考一支示範影片：https://www.youtube.com/watch?v=waaAXPt7RG8 。本專案沒有使用影片中的任何畫面或素材，全部從頭實作。
- [Three.js](https://threejs.org/) r128（MIT），由 cdnjs 載入；字型 Noto Sans TC／Noto Serif TC 由 Google Fonts 提供（SIL OFL）。詳見 [NOTICE.md](NOTICE.md)。
- 作者：JasonLee（[Lee-unhn](https://github.com/Lee-unhn)）。程式碼以 [MIT 授權](LICENSE) 釋出。
