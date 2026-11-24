// Test-only CONTENT.spellkit (kit/spellkit.js): every field set to a value whose effect a test can read back.
// Injected before any page script (Page.addScriptToEvaluateOnNewDocument). window.__EG_SPELLKIT_OPTS (set before this file)
// replaces the whole value, e.g. true or {}.
(function () {
  'use strict';
  // a 4 x 4 white square as an icon (data URL, no file needed)
  const icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAD0lEQVR4nGP4jwYYSBcAAHg8P8FY7imoAAAAAElFTkSuQmCC';
  const K = {
    ember: 2,
    lightDelay: 0.3,
    volt: { water: 1.4, recharge: 2.8, blood: 1.4, steam: 0.7, mud: 0.7, fence: 1, fenceRange: 6, fenceReach: 0.5, fenceDps: 26 },
    chainTone: { freq: 330, rise: 1, sweep: 1, dur: 0.1, wave: 'sine', vol: 0.1, fade: 0.8 },
    assist: true,
    skills: { fire: { name: '測試焰', label: '穿透', icon }, meteor: { label: '一排' } },
  };
  window.CONTENT = window.CONTENT || {};
  window.CONTENT.spellkit = window.__EG_SPELLKIT_OPTS !== undefined ? window.__EG_SPELLKIT_OPTS : K;
  // tag the engine functions the module replaces, the way a content pack may tag one; the replacement must keep the tag
  addEventListener('DOMContentLoaded', () => { for (const n of ['dealDamage', 'applyEl', 'updateProjs', 'chain']) if (typeof window[n] === 'function') window[n].egTag = n; });
})();
