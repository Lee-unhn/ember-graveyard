# Godot 移植對照 · Godot Port (P5)

> 把網頁版的火球（Three.js、自寫粒子系統）用同一份參數、同一套翻頁圖，在 Godot 4.7 的 GPUParticles3D 重建一次，並排比較。
> English summary: the web fireball rebuilt in Godot 4.7 with GPUParticles3D from the same parameter table (docs/METHOD.md §1) and the same flipbook frames, rendered with Movie Maker and compared frame by frame. Remaining differences are listed below.

![網頁版與 Godot 版同一時刻並排](media/godot-vs-web.jpg)

## 做法

| 步驟 | 內容 |
|---|---|
| 引擎 | Godot 4.7.2 stable（官方 GitHub 發布，Windows 64 位元，SHA-512 與官方清單相符），Forward Plus 繪圖 |
| 共用素材 | `scripts/export_atlas.mjs` 把網頁版即時畫出的翻頁圖集匯出成四張 512×512 圖：火焰、爆炸、濃煙、光點，放在 `godot/textures/` |
| 場景 | `godot/main.gd` 用程式建好所有節點；鏡頭視角 42 度、位置與網頁版相同；火球從 x = −6.65 以速度 19 飛 0.7 秒後命中 |
| 出圖 | Godot 錄影模式固定每秒 30 格輸出 60 張；網頁版凍結自己的動畫迴圈，逐格推進同一條時間線 |
| 並排 | `scripts/compose_compare.py` 取 0.33 秒（飛行中）、0.80 秒（命中後 0.1 秒）、1.10 秒（煙與火星）三個時刻 |
| 重跑 | 環境變數 `GODOT` 設成 Godot 主控台版執行檔，然後 `node scripts/godot_compare.mjs` |

## 參數對照

| 零件 | 網頁版數值（METHOD.md §1） | Godot 欄位 |
|---|---|---|
| 球芯 | 3 片翻頁火焰、0.7–1.05、自轉、每秒 20–30 格 | `amount = 3`、`explosiveness = 1`、`local_coords = true`、`scale_min/max`、`angular_velocity_min/max`、`anim_speed` |
| 光暈 | 1 片、2.6、橘、透明度 0.32 | 同上，`color_ramp` 固定 0.32 |
| 尾焰 | 每秒 240 片、0.10–0.16 秒、0.5–0.66 → 0.05 | `amount = 240 × 0.16`、`lifetime_randomness`、`scale_curve`、`local_coords = false`（留在原地） |
| 火舌 | 每秒 70 片、0.2–0.3 秒、0.6 → 0.18 | 同上，`direction` 往上、`spread` 120 度 |
| 餘燼 | 每秒 35 顆、0.5–0.9 秒、往上飄、阻力 1.2 | `damping_min/max = 1.2`，固定用光點第 1 格 |
| 跟隨光源 | 橘 0xff7a2e、亮度 2.3、距離 8 | `OmniLight3D`：`light_energy`、`omni_range` |
| 命中爆炸 | 3 片爆炸翻頁、0.45–0.62 秒、2.5 → 3.7、壽命內播完 16 格 | `one_shot`、`anim_speed = 1`（一個壽命播完一張） |
| 命中火星 | 40 顆、速度 5–12、重力 16、阻力 1.4 | `gravity = (0, −16, 0)`、`initial_velocity_min/max` |
| 命中濃煙 | 6 團、一般混色、1.4 → 3.6、透明度 0.55 → 0 | `blend_mode = MIX`、`color_ramp` |

## 結果（2026-11-16）

| 項目 | 數字或觀察 |
|---|---|
| Godot 出圖 | 60 格 960×540 用 1–4 秒；顯示卡每格 0.2 毫秒 |
| 時間與位置 | 兩邊在 0.33 秒的火球位置、0.7 秒的命中點一致 |
| 尾焰與火舌 | 形狀與長度接近 |

## 尚未一致的地方

| 差異 | 觀察 | 已知或推測的原因 |
|---|---|---|
| 命中爆炸 | Godot 版比網頁版小、暗 | 尚未查明；第一次並排時曲線上限被卡在 1，改正後仍偏小 |
| 命中火星 | Godot 版每顆看起來約大三倍 | 尚未查明；第一次並排時火星隨機取到光點表裡的星形格，改成固定第 1 格後形狀一致、大小仍不同 |
| 火星落地反彈 | 網頁版會反彈，Godot 版穿過地面 | Godot 要另外放碰撞節點才會反彈，這版沒有放 |
| 場景 | Godot 版只有素色地面 | 這次只比對特效，墓碑、地形、怪物沒有移植 |
