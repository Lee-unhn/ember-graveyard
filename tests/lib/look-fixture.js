// Test-only CONTENT.look (kit/look.js): every field set to a value whose effect a test can read back. Injected before any page
// script (Page.addScriptToEvaluateOnNewDocument), after tests/lib/sprite-fixture.js when the page also gets the test atlases.
// Decorations use the fixture's "props" atlas (16 x 32 cells, 6 columns): one pair beside every tower with a light, a small one
// beside a fixed share of the tombstones with a halo, and one standing alone that blocks the way.
// window.__EG_LOOK_OPTS (set before this file) replaces fields, e.g. { towers: { flame: 2.1 } }; __EG_LOOK_NO_DECOR drops the decorations.
(function () {
  'use strict';
  const L = {
    clear: '#141830',
    fog: { color: '#20243c', mul: 0.8 },
    hemi: { sky: '#506090', ground: '#202040', mul: 1.3 },
    moon: { color: '#a0b0f0', mul: 1.2 },
    highMul: 0.8,
    mist: { color: '#404870', mul: 1.2 },
    terrain: { SOIL: { tint: [0.6, 0.8, 1] }, PAVE: { tint: [0.9, 0.95, 0.9] }, LAVA: { tint: [0.8, 0.7, 0.6], glow: 1 }, FIRE: { glow: 0.9 } },
    steps: { perUnit: 3, dither: 0.35 },
    towers: { y: 2.2, distance: 9, mul: 0.4, colors: ['#ffb45c', '#ffd36a', '#7f8cff', '#9fe8ff'], halo: { size: 3.6, y: 1.6, peak: 0.4 }, flame: false },
    actors: { diffuse: 0.35, fill: 0.75, fillColor: '#ffe8c8' },
    props: { diffuse: 0.95, fill: 0.14, fillColor: '#b9bdd6' },
    decor: [
      { atlas: 'props', cell: 3, near: 'tower', at: [[-2.7, 0.9], [2.7, 0.9]], light: { color: '#ff9a3c', distance: 6, intensity: 1.4, y: 1.2 }, halo: { size: 2.6, y: 1.1, peak: 0.5 } },
      { atlas: 'props', cell: [1, 1], shrink: 2, near: 'tomb', share: 0.3, at: [[0.55, 0.3]], flicker: 1.4, halo: { color: '#ffd36a', size: 1.2, y: 0.45, peak: 0.45 } },
      { atlas: 'props', cell: 0, at: [[-30.5, -30.5]], block: 0.8 },
    ],
  };
  if (window.__EG_LOOK_NO_DECOR) delete L.decor;
  window.CONTENT = window.CONTENT || {};
  window.CONTENT.look = Object.assign(L, window.__EG_LOOK_OPTS || {});
  // tag the engine functions the module may replace, the way a content pack may tag one; the replacement must keep the tag
  addEventListener('DOMContentLoaded', () => { if (typeof window.updateTowers === 'function') window.updateTowers.egTag = 'updateTowers'; });
})();
