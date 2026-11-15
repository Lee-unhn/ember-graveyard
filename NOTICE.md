# Notice · 第三方與授權範圍

## Scope of the MIT License · MIT 授權涵蓋範圍

The MIT License in `LICENSE` covers the source code, diagrams and documentation written for this repository, including the textures, sounds and meshes that the code generates at runtime.

`LICENSE` 的 MIT 授權涵蓋本 repo 撰寫的程式碼、圖與文件，包含程式執行時產生的貼圖、音效與模型。

## Third-party components · 第三方元件（不在本專案 MIT 範圍內，依各自授權）

| Component | Use | License | Source |
|---|---|---|---|
| Three.js r128 | WebGL rendering | MIT | https://github.com/mrdoob/three.js (loaded from cdnjs.cloudflare.com) |
| Noto Sans TC, Noto Serif TC | UI typefaces | SIL Open Font License 1.1 | Google Fonts |
| Three.js GLTFLoader (r128) | Loads the mage model | MIT | three@0.128.0 examples, loaded from cdn.jsdelivr.net |
| Universal Animation Library [Standard] by Quaternius | Mage body (Mannequin mesh and skeleton) and 7 animations: idle, jog, spell enter / idle / shoot, hit, death | CC0 1.0 (public domain) | https://quaternius.itch.io/universal-animation-library (free Standard download, 2026-11-15). Slimmed by `scripts/slim_glb.py` into `assets/mage-model.js` (UVs and unchanging bone tracks removed, colours restyled) |

## Reference · 參考

The decomposition method was inspired by a public video walkthrough: https://www.youtube.com/watch?v=waaAXPt7RG8 . No footage, images or other assets from the video are included. Game names, characters and art referenced in that video are not used.

拆解法參考自一支公開示範影片。本 repo 不含該影片的任何畫面、圖片或素材，也沒有使用影片中提到的任何遊戲名稱、角色或美術。

## User-uploaded atlases · 使用者上傳的翻頁圖

Images you upload through the Lab panel stay in your browser and are never sent anywhere. Their rights stay with you and the terms of the tool you used to make them.

從拆解台上傳的圖片只留在你的瀏覽器，不會傳到任何地方；其權利歸你所有，並受你使用的繪圖工具條款約束。
