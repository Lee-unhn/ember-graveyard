// Test-only sprite assets: five small atlases drawn on canvases (colour blocks, direction arrows), handed to the page as
// CONTENT.sprites before any page script runs (tests inject this file with Page.addScriptToEvaluateOnNewDocument).
// A has no real pixel art; these blocks only make every cell recognisable by colour:
//   body colour of a character cell = rgb(40 + 40 * row, 40 + 50 * col, 200), feet row (just above the cell's bottom row) = magenta
// window.__EG_SPRITE_OPTS (set before this file) adds fields, e.g. { pixelScreen: { rows: 360 } }.
(function () {
  'use strict';
  const sheet = (fw, fh, cols, rows, draw) => {
    const c = document.createElement('canvas'); c.width = fw * cols; c.height = fh * rows; const g = c.getContext('2d');
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) { g.save(); g.translate(k * fw, r * fh); draw(g, r, k, fw, fh); g.restore(); }
    return c.toDataURL('image/png');
  };
  const px = (g, x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
  const body = (r, k) => `rgb(${40 + 40 * r},${40 + 50 * k},200)`;
  // arrow: 0 down, 1 up, 2 right (the "side" rows face right; facing left is the mirror)
  const arrow = (g, dir, cx, cy) => { for (let i = 0; i < 4; i++) for (let j = -i; j <= i; j++) {
    if (dir === 0) px(g, cx + j, cy + i, '#fff'); else if (dir === 1) px(g, cx + j, cy - i, '#fff'); else px(g, cx + i, cy + j, '#fff'); } };
  // characters: 16 x 24 cells; rows down, up, side, side2 (second row of the side walk), misc (cast, cast, hurt, die)
  const hero = sheet(16, 24, 4, 5, (g, r, k) => {
    g.fillStyle = body(r, k); g.fillRect(3, 2, 10, 20);
    if (r < 4) arrow(g, r === 0 ? 0 : r === 1 ? 1 : 2, r < 2 ? 8 : 6, r === 1 ? 14 : 8);
    g.fillStyle = '#ff00ff'; g.fillRect(3, 22, 10, 1);                               // feet: row 22; row 23 stays empty
  });
  const mon = sheet(16, 16, 4, 2, (g, r, k) => { g.fillStyle = body(r, k); g.fillRect(2, 4, 12, 10); arrow(g, 2, 6, 8); g.fillStyle = '#ff00ff'; g.fillRect(2, 14, 12, 1); });
  // props: 16 x 32; row 0 tomb A, tomb B, tomb fallen, tree, tree burning 1, 2; row 1 tree burnt, sarcophagus, broken, tower unlit, lit 1, lit 2
  const props = sheet(16, 32, 6, 2, (g, r, k) => { g.fillStyle = `rgb(${20 + 30 * k},${150 + 50 * r},${20 + 20 * k})`; g.fillRect(1, 2, 14, 30); });
  // tiles: 16 x 16, 4 x 4; every tile its own flat colour with a darker 1-pixel corner so tile edges are visible
  const TILE = ['#3c8c3c', '#4fa04f', '#6b5133', '#7a7a84', '#2050c8', '#3070e0', '#e06010', '#f0a020', '#505050', '#c03010', '#3a2a20', '#20142c', '#801020', '#ff40ff', '#ffffff', '#000000'];
  const tiles = sheet(16, 16, 4, 4, (g, r, k) => { g.fillStyle = TILE[r * 4 + k]; g.fillRect(0, 0, 16, 16); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, 1, 1); });
  // effects: 16 x 16 on black (blend add); row 0 a ring that grows (explosion), row 1 small dots (projectiles, hits)
  const fx = sheet(16, 16, 4, 2, (g, r, k) => { g.fillStyle = '#000'; g.fillRect(0, 0, 16, 16); g.fillStyle = r ? '#80c0ff' : '#ffa040';
    const R = r ? 2 + k : 2 + k * 2; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if (r ? d <= R : d <= R && d >= R - 1.5) g.fillRect(x, y, 1, 1); } });
  const json = (o) => 'data:application/json,' + encodeURIComponent(JSON.stringify(o));
  window.__EG_TILE_COLORS = TILE;
  const S = {
    atlases: {
      hero: { image: hero, meta: { kind: 'sprite', frameW: 16, frameH: 24, cols: 4, rows: 5, anchor: [0.5, 23 / 24], rowNames: ['down', 'up', 'side', 'side2', 'misc'],
        frames: [{ row: 3, col: 2, empty: true, x: 0, y: 0, w: 0, h: 0 }, { row: 3, col: 3, empty: true, x: 0, y: 0, w: 0, h: 0 }] } },
      mon: { image: mon, meta: json({ kind: 'sprite', frameW: 16, frameH: 16, cols: 4, rows: 2, anchor: [0.5, 15 / 16] }) },   // meta given as a URL (fetched)
      props: { image: props, meta: { kind: 'sprite', frameW: 16, frameH: 32, cols: 6, rows: 2, anchor: [0.5, 1] } },
      tiles: { image: tiles, meta: { kind: 'tile', size: 16, cols: 4, rows: 4 } },
      fx: { image: fx, meta: { kind: 'fx', frameW: 16, frameH: 16, cols: 4, rows: 2, blend: 'add' } },
    },
    actors: {
      player: { atlas: 'hero', idle: { down: [['down', 0]], up: [['up', 0]], side: [['side', 0]] },
        walk: { down: { row: 'down', fps: 8 }, up: { row: 'up', fps: 8 }, side: { frames: [{ row: 'side', from: 0, to: 3 }, { row: 'side2', from: 0, to: 1 }], fps: 8 } },
        cast: [['misc', 0], ['misc', 1]], hurt: { frames: [['misc', 2]], fps: 4 }, die: { frames: [['misc', 3]], fps: 4 } },
      spider: { atlas: 'mon', shadow: .4, idle: [[0, 0]], walk: { row: 0, fps: 8 }, hurt: { frames: [[1, 0]], fps: 6 }, die: { frames: [[1, 1], [1, 2]], fps: 3 } },
    },
    props: {
      tomb: { atlas: 'props', up: [[0, 0], [0, 1]], fallen: [[0, 2]] },
      tree: { atlas: 'props', up: [[0, 3]], burning: { frames: [[0, 4], [0, 5]], fps: 6 }, burnt: [[1, 0]] },
      sarc: { atlas: 'props', up: [[1, 1]], broken: [[1, 2]] },
      tower: { atlas: 'props', unlit: [[1, 3]], lit: { frames: [[1, 4], [1, 5]], fps: 4 } },
    },
    ground: { atlas: 'tiles', tiles: { GRASS: [0, 1], SOIL: [2], PAVE: [3], WATER: { frames: [4, 5], fps: 4 }, FIRE: { frames: [6, 7], fps: 8 }, ASH: [8], LAVA: [9], CRATER: [10], OBSID: [11], BLOOD: [12], default: [13] } },
    fx: {
      fireball: { atlas: 'fx', frames: [[1, 0], [1, 1]], fps: 10 }, orb: { atlas: 'fx', frames: [[1, 2]], fps: 10 },
      explosion: { atlas: 'fx', frames: [{ row: 0 }], fps: 16 }, zap: { atlas: 'fx', frames: [[1, 3]], fps: 10 },
      chain: { atlas: 'fx', frames: [[1, 1], [1, 2]], fps: 20 }, meteor: { atlas: 'fx', frames: [[1, 3]], fps: 8 },
      impact: { atlas: 'fx', frames: [{ row: 0 }], fps: 12 }, ring: { atlas: 'fx', frames: [[0, 3]], fps: 4 }, hit: { atlas: 'fx', frames: [[1, 0], [1, 1]], fps: 20 },
    },
  };
  window.CONTENT = window.CONTENT || {};
  window.CONTENT.sprites = Object.assign(S, window.__EG_SPRITE_OPTS || {});
})();
