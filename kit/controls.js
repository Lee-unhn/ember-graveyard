// Touch controls and key remapping for Ember Graveyard (P4).
// Loaded with `defer` after the main script, so it can use the page's globals (keys, KB, lmb, mouse, tryCast, ...).
// Touch mode switches on for touch-only devices, or with ?touch=1 in the address (used by the tests).
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const RESERVED = new Set(['Space', 'Escape', 'KeyP', 'Tab', 'KeyR']); // dialogue, pause, inventory toggle, retry
  const NAMES = { up: '往上', left: '往左', down: '往下', right: '往右', fire: '焰核彈', bolt: '鏈雷', meteor: '星墜', blood: '血環', inv: '行囊' };

  const style = document.createElement('style');
  style.textContent = `
#settings{align-items:flex-start}#settings .card{margin-block:auto}
.keyrows h3{font-size:14px;color:var(--gold);margin:14px 0 4px;letter-spacing:.15em}
.keybtn{min-width:96px}.keybtn.waiting{border-color:var(--gold);color:var(--gold)}
#touchZone{left:0;top:12vh;width:45vw;bottom:0;pointer-events:auto;touch-action:none;z-index:4}
#joyBase,#joyKnob{position:fixed;border-radius:50%;pointer-events:none;z-index:6;display:none}
#joyBase{width:110px;height:110px;margin:-55px 0 0 -55px;border:2px solid rgba(255,210,150,.35);background:rgba(20,16,24,.35)}
#joyKnob{width:48px;height:48px;margin:-24px 0 0 -24px;background:rgba(255,178,122,.55)}
#touchBtns{top:calc(10px + env(safe-area-inset-top,0px));right:calc(12px + env(safe-area-inset-right,0px));display:flex;gap:10px;z-index:6}
#touchBtns button{width:48px;height:48px;border-radius:50%;background:rgba(20,16,24,.7);border:1px solid var(--line);color:var(--ink);font-size:13px}
#rotateHint{left:50%;top:calc(64px + env(safe-area-inset-top,0px));transform:translateX(-50%);background:rgba(20,16,24,.8);border:1px solid var(--line);border-radius:4px;padding:6px 12px;font-size:12px;color:var(--dim)}
body.touch #hint{display:none}
body.touch .sk{min-width:64px;min-height:64px;touch-action:none;user-select:none;-webkit-user-select:none}
body.touch #lab{display:none}`;
  document.head.appendChild(style);

  // ---------------------------------------------------------------- key remapping
  const label = (c) => !c ? '—' : c.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '方向 ').replace(/^Numpad/, '數字鍵 ');
  let waiting = null, touchOn = false;
  const saveKeys = () => { try { localStorage.setItem(EG_KEY('eg-keys'), JSON.stringify(KB)); } catch (e) {} };
  function refreshSkillKeys() {
    for (const s of ['fire', 'bolt', 'meteor', 'blood']) {
      const el = document.querySelector(`.sk[data-s=${s}] .k`); if (!el) continue;
      el.textContent = touchOn ? '' : label(KB[s]) + (s === 'fire' ? ' / 左鍵' : s === 'bolt' ? ' / 右鍵' : '');
    }
  }
  function redrawKeys() {
    for (const b of document.querySelectorAll('.keybtn')) { b.textContent = label(KB[b.dataset.k]); b.classList.remove('waiting'); }
    refreshSkillKeys();
  }
  function buildKeyRows() {
    const panel = $('#settings .panel'); if (!panel || $('#keyRows')) return;
    const box = document.createElement('div'); box.id = 'keyRows'; box.className = 'keyrows';
    box.innerHTML = '<h3>按鍵</h3>' + Object.keys(NAMES).map((n) =>
      `<div class="srow"><span>${NAMES[n]}</span><button class="btn keybtn" type="button" data-k="${n}" aria-label="變更「${NAMES[n]}」的按鍵">${label(KB[n])}</button><span></span></div>`).join('')
      + '<div class="menu-row"><button class="btn" id="kReset" type="button">按鍵恢復預設</button></div>';
    const rows = panel.querySelectorAll('.menu-row'); panel.insertBefore(box, rows[rows.length - 1]);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('.keybtn'); if (!b) return;
      redrawKeys(); waiting = b.dataset.k; b.textContent = '按下新按鍵…'; b.classList.add('waiting');
    });
    $('#kReset').onclick = () => { Object.assign(KB, KB_DEFAULT); saveKeys(); redrawKeys(); };
  }
  // capture phase: while a row waits for a key, the key goes to the row and nowhere else
  addEventListener('keydown', (e) => {
    if (!waiting) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.code === 'Escape') { waiting = null; redrawKeys(); return; }
    if (RESERVED.has(e.code)) { const b = document.querySelector(`.keybtn[data-k=${waiting}]`); if (b) b.textContent = '這個鍵已有用途'; return; }
    for (const n in KB) if (n !== waiting && KB[n] === e.code) KB[n] = KB[waiting]; // taken: swap the two
    KB[waiting] = e.code; waiting = null; saveKeys(); redrawKeys();
  }, true);
  // leaving settings (close button, Esc, title, play) ends a pending wait, so the next key is not bound by accident
  const st = $('#settings'); if (st) new MutationObserver(() => { if (waiting && st.hidden) { waiting = null; redrawKeys(); } }).observe(st, { attributes: true, attributeFilter: ['hidden'] });

  // ---------------------------------------------------------------- touch controls
  const joy = { id: null, x0: 0, y0: 0 };
  function setMove(dx, dy) {
    const r = Math.hypot(dx, dy), k = r < 12 ? 0 : 1, nx = k * dx / r, ny = k * dy / r;
    keys[KB.right] = nx > 0.38; keys[KB.left] = nx < -0.38; keys[KB.down] = ny > 0.38; keys[KB.up] = ny < -0.38;
    const m = Math.min(r, 50), kb = $('#joyKnob'); if (!kb) return; // touch UI not built yet
    kb.style.left = (joy.x0 + (r ? dx / r * m : 0)) + 'px'; kb.style.top = (joy.y0 + (r ? dy / r * m : 0)) + 'px';
  }
  function joyEnd() {
    joy.id = null; for (const n of ['up', 'down', 'left', 'right']) keys[KB[n]] = false;
    if ($('#joyBase')) $('#joyBase').style.display = $('#joyKnob').style.display = 'none';
  }
  // aim assist: the nearest monster in range, else straight ahead of the movement
  const V = THREE.Vector3, tmp = new V();
  function aimAssist() { requestAnimationFrame(aimAssist); aimNow(); }
  // also called right before a tap casts, so the spell never uses last frame's aim
  function aimNow() {
    if (!touchOn || !running || !player.alive) return;
    let best = null, bd = 18;
    for (const e of enemies) if (e.alive) { const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z); if (d < bd) { bd = d; best = e; } }
    if (best) tmp.set(best.pos.x, 0, best.pos.z);
    else {
      const mx = (keys[KB.right] ? 1 : 0) - (keys[KB.left] ? 1 : 0), mz = (keys[KB.down] ? 1 : 0) - (keys[KB.up] ? 1 : 0);
      if (!mx && !mz) return;
      const l = Math.hypot(mx, mz); tmp.set(player.pos.x + mx / l * 6, 0, player.pos.z + mz / l * 6);
    }
    tmp.project(camera); mouse.set(tmp.x, tmp.y);
  }
  function enableTouch() {
    if (touchOn) return; touchOn = true; document.body.classList.add('touch');
    const zone = document.createElement('div'); zone.id = 'touchZone'; zone.className = 'hud'; document.body.appendChild(zone);
    for (const id of ['joyBase', 'joyKnob']) { const d = document.createElement('div'); d.id = id; document.body.appendChild(d); }
    const btns = document.createElement('div'); btns.id = 'touchBtns'; btns.className = 'hud';
    btns.innerHTML = '<button type="button" id="tBag" aria-label="行囊">行囊</button><button type="button" id="tPause" aria-label="暫停">暫停</button>';
    document.body.appendChild(btns);
    const hint = document.createElement('div'); hint.id = 'rotateHint'; hint.className = 'hud'; hint.textContent = '橫放手機，視野比較大'; document.body.appendChild(hint);
    const fitHint = () => { hint.hidden = innerWidth >= innerHeight; }; fitHint(); addEventListener('resize', fitHint);
    $('#tBag').addEventListener('click', () => toggleInv());
    $('#tPause').addEventListener('click', () => togglePause());
    zone.addEventListener('touchstart', (e) => {
      e.preventDefault(); if (joy.id !== null) return; const t = e.changedTouches[0];
      joy.id = t.identifier; joy.x0 = t.clientX; joy.y0 = t.clientY;
      const b = $('#joyBase'), k = $('#joyKnob'); b.style.left = k.style.left = t.clientX + 'px'; b.style.top = k.style.top = t.clientY + 'px';
      b.style.display = k.style.display = 'block'; setMove(0, 0);
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === joy.id) setMove(t.clientX - joy.x0, t.clientY - joy.y0);
    }, { passive: false });
    const endJoy = (e) => { for (const t of e.changedTouches) if (t.identifier === joy.id) joyEnd(); };
    zone.addEventListener('touchend', endJoy); zone.addEventListener('touchcancel', endJoy);
    // skill tiles become buttons: tap to cast, hold the fireball to keep firing
    for (const sk of document.querySelectorAll('.sk')) {
      const s = sk.dataset.s;
      sk.addEventListener('touchstart', (e) => { e.preventDefault(); aimNow(); if (s === 'fire') lmb = true; else tryCast(s); }, { passive: false });
      const up = (e) => { e.preventDefault(); if (s === 'fire') lmb = false; };
      sk.addEventListener('touchend', up, { passive: false }); sk.addEventListener('touchcancel', up, { passive: false });
    }
    // phone defaults on first visit: medium particles, camera a little further back
    let saved = null; try { saved = localStorage.getItem(EG_KEY('eg-settings')); } catch (e) {}
    if (!saved) { SET.particles = 'mid'; SET.fx = 'low'; applySettings(); }   // phones: medium particles, post effects off
    zoom = Math.max(zoom, 1.2);
    const note = $('#introNote');
    if (note) note.textContent = '手機操作：左半邊拖曳移動；點下方技能施放，會自動瞄準最近的怪物；按住焰核彈連發。右上角是行囊與暫停。故事模式約 15 分鐘。';
    const help = $('#help .note');
    if (help && !$('#touchHelp')) { const p = document.createElement('p'); p.className = 'note'; p.id = 'touchHelp'; p.textContent = '觸控：左半邊拖曳移動；點技能施放並自動瞄準最近的怪物；按住焰核彈連發；點對白翻下一句。'; help.after(p); }
    refreshSkillKeys();
  }

  buildKeyRows(); refreshSkillKeys();
  // touch-only = a coarse pointer, no fine pointer, AND real touch points: a machine with no pointing device at all
  // (a headless test runner) must not be mistaken for a phone
  const wantTouch = /[?&]touch=1\b/.test(location.search)
    || (matchMedia('(pointer:coarse)').matches && !matchMedia('(pointer:fine)').matches && (navigator.maxTouchPoints || 0) > 0);
  if (wantTouch) enableTouch();
  requestAnimationFrame(aimAssist);
  window.EGControls = { enableTouch, get touch() { return touchOn; }, setMove, joyEnd, label, aimNow, redrawKeys };
})();
