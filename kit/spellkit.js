// Terrain actions and spell extensions (optional engine module). A content pack that sets CONTENT.spellkit gets:
//   - three more terrain elements: 'ember' (a short fire on ground that does not burn: soil and ash burn to ash, paving
//     and craters come back), 'light' (wisp graves blow after a short delay, blood marsh dries to soil) and 'volt'
//     (connected water, blood marsh, steam and mud carry current for a while and then return to what they were);
//   - terrain actions for extension scripts (EG.terrain: area, path, ring, sweep, strike) and fences that carry current;
//   - more spell parameters (see kit/CONTENT-API.md): fireballs that pierce, fly to the aim point, bounce off water,
//     wait as seeds, leave a trail or sweep fire on landing; bolts that strike from the sky, hop along water or leave a
//     path; meteors in a line or a ring, that conduct, quench or plough; blood rites that focus, crawl along the ground
//     or raise a wall;
//   - monster states (EG.status: root, stun, ground), events (spell, status, terrainHit, terrainChange),
//     self-glow for props (EG.glow), skill-bar names and icons (EG.setSkill), a "terrain assist" count, the chain tone.
// kit/character.js loads this file only when CONTENT.spellkit exists, so a page without it never runs it.
// With every new spell parameter at its default the four spells behave exactly as without this module (same damage,
// same terrain, same random draws): the new code paths only run for the parameters that ask for them.
//   EGSpellkit.state         on, problems, counts, last error
//   EGSpellkit.validate(v)   problems in a CONTENT.spellkit value ([] = usable)
(function () {
  'use strict';
  const T = THREE, K = window.CONTENT && CONTENT.spellkit;
  const state = { on: false, problems: [], assists: 0, act0: 0, wraps: [], fence: 0, glows: 0, sweeps: 0, strikes: 0, special: 0, back: 0, err: '' };
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v), num = (v) => typeof v === 'number' && isFinite(v);
  const warn = (m) => { if (typeof cwarn === 'function') cwarn(m); else console.warn('[content] ' + m); };
  const ELEMS = ['fire', 'bolt', 'meteor', 'crater', 'blood', 'ember', 'light', 'volt'], STATES = ['root', 'stun', 'ground'], SKILLS = ['fire', 'bolt', 'meteor', 'blood'];
  const WAVES = ['sine', 'square', 'sawtooth', 'triangle'];
  const VOLT = ['water', 'recharge', 'blood', 'steam', 'mud', 'fence', 'fenceRange', 'fenceReach', 'fenceDps'];
  const TONE = ['freq', 'rise', 'max', 'sweep', 'dur', 'wave', 'vol', 'fade'];

  // ---------------------------------------------------------------- validation (wrong types switch the whole module off; unknown keys only warn)
  function validate(v) {
    const bad = [], C = 'CONTENT.spellkit', W = (w, m) => bad.push(w + ' 要是' + m);
    const keys = (o, known, w) => { for (const k of Object.keys(o)) if (!known.includes(k)) warn(w + '.' + k + ' 不是可用的欄位，略過'); };
    const obj = (x, w) => { if (x === undefined) return false; if (!isObj(x)) { W(w, '物件'); return false; } return true; };
    const nn = (x, w) => { if (x !== undefined && !(num(x) && x >= 0)) W(w, '0 以上的數字'); };
    const pos = (x, w) => { if (x !== undefined && !(num(x) && x > 0)) W(w, '大於 0 的數字'); };
    if (v === true) return [];
    if (!isObj(v)) return [C + ' 要是物件（或 true）'];
    keys(v, ['ember', 'lightDelay', 'volt', 'chainTone', 'assist', 'skills'], C);
    pos(v.ember, C + '.ember'); nn(v.lightDelay, C + '.lightDelay');
    if (obj(v.volt, C + '.volt')) { keys(v.volt, VOLT, C + '.volt'); for (const k of VOLT) nn(v.volt[k], C + '.volt.' + k); }
    if (v.chainTone !== undefined && v.chainTone !== false) {
      const w = C + '.chainTone';
      if (obj(v.chainTone, w)) { const o = v.chainTone; keys(o, TONE, w);
        for (const k of ['freq', 'rise', 'sweep', 'dur']) pos(o[k], w + '.' + k); nn(o.vol, w + '.vol'); nn(o.fade, w + '.fade');
        if (o.max !== undefined && !(Number.isInteger(o.max) && o.max >= 0)) W(w + '.max', ' 0 以上的整數');
        if (o.wave !== undefined && !WAVES.includes(o.wave)) W(w + '.wave', WAVES.join('、') + ' 其中之一'); }
    }
    if (v.assist !== undefined && typeof v.assist !== 'boolean') W(C + '.assist', ' true 或 false');
    if (obj(v.skills, C + '.skills')) for (const [id, s] of Object.entries(v.skills)) { const w = C + '.skills.' + id;
      if (!SKILLS.includes(id)) { warn(w + ' 不是招式（' + SKILLS.join('、') + '），略過'); continue; }
      if (!obj(s, w)) continue; keys(s, ['name', 'label', 'icon'], w);
      for (const k of ['name', 'label', 'icon']) if (s[k] !== undefined && s[k] !== null && typeof s[k] !== 'string') W(w + '.' + k, '字串（null＝回到引擎原本的）'); }
    return bad;
  }
  if (!K) { window.EGSpellkit = { state, validate }; return; }
  state.problems = validate(K);
  if (state.problems.length) { for (const p of state.problems) warn(p + '（整個 CONTENT.spellkit 不生效）'); window.EGSpellkit = { state, validate }; return; }

  const S0 = isObj(K) ? K : {};
  const CFG = { ember: S0.ember ?? 2, lightDelay: S0.lightDelay ?? 0.3, assist: S0.assist === true,
    volt: Object.assign({ water: 1.4, recharge: 2.8, blood: 1.4, steam: 0.7, mud: 0.7, fence: 1, fenceRange: 6, fenceReach: 0.5, fenceDps: 26 }, isObj(S0.volt) ? S0.volt : {}) };
  const W = window, TNAME = Object.keys(TER).reduce((a, k) => (a[TER[k]] = k, a), []);
  const has = (n) => !!(EG_EV[n] && EG_EV[n].length);
  const wrap = (name, make) => { const f0 = W[name]; const f = make(f0); Object.assign(f, f0); W[name] = f; state.wraps.push(name); return f0; };

  // ---------------------------------------------------------------- events
  for (const n of ['spell', 'status', 'terrainHit', 'terrainChange']) { if (!EG_EVENTS.includes(n)) EG_EVENTS.push(n); if (!EG.events.includes(n)) EG.events.push(n); }
  const spellEv = (type, o) => { if (has('spell')) egEmit('spell', Object.assign({ type, cast: egCur }, o)); };

  // ---------------------------------------------------------------- spell parameters (registered next to the engine's own; defaults keep the old behaviour)
  const MORE = {
    fire: { pierce: false, toAim: false, maxRange: 17, reflect: 0, seed: 0, seedRadius: 1.5, elem: 'fire', trail: '', trailWidth: 1, sweeps: 0, sweepLength: 3, sweepTime: 0.6, sweepSpread: 0.7, sweepElem: 'ember' },
    bolt: { fromSky: 0, skyRange: 16, pickRadius: 2, strikeRadius: 1.5, strikeElem: 'volt', hitElem: 'bolt', hopElem: 'bolt', path: '', pathWidth: 1, waterNet: false, arcs: true },
    meteor: { lineStart: 3, lineGap: 1.6, ringRadius: 3.5, elem: 'meteor', quench: false, plow: 0, arcBolt: 0 },
    blood: { focus: false, crawl: 0, crawlElem: '', elem: 'blood', fireWall: 0, wallElem: 'ember' },
  };
  for (const [id, o] of Object.entries(MORE)) for (const [k, v] of Object.entries(o)) { if (!(k in SPELL_DEF[id])) SPELL_DEF[id][k] = v; if (!(k in SPELLS[id])) SPELLS[id][k] = v; }
  EG_ENUM.pattern = ['scatter', 'arc', 'line', 'ring'];
  for (const k of ['elem', 'hitElem', 'hopElem', 'strikeElem', 'sweepElem', 'wallElem']) EG_ENUM[k] = ELEMS.slice();
  for (const k of ['trail', 'path', 'crawlElem']) EG_ENUM[k] = ['', ...ELEMS];

  // ---------------------------------------------------------------- terrain: cells that come back (ember on paving, current in blood marsh ...)
  // back: cell -> { t, tm } = what the cell returns to when its fire or current runs out (the automaton's own expiry)
  const back = new Map();
  let emberSecs = 0;   // > 0 while an action overrides the ember duration
  wrap('setT', (f0) => function (i, t, tm) {
    if (i >= 0 && back.size) { const b = back.get(i);
      if (b && t !== TT[i]) { back.delete(i); if (TM[i] <= 0 && (TT[i] === TER.FIRE && t === TER.ASH || TT[i] === TER.SHOCK && t === TER.WATER)) { t = b.t; tm = b.tm; } } }
    const from = i >= 0 ? TT[i] : -1;
    f0(i, t, tm);
    if (i >= 0 && from !== t && has('terrainChange')) { const c = cellCenter(i); egEmit('terrainChange', { cell: i, x: c.x, z: c.z, from: TNAME[from], to: TNAME[t], cast: egCur }); }
  });
  const keepBack = (i, t, tm) => { back.set(i, { t, tm }); state.back = back.size; };
  const flare = () => emberSecs > 0 ? emberSecs : CFG.ember;
  function ember(i) { const t = TT[i];
    if (t === TER.GRASS) setT(i, TER.FIRE, rand(3, 5)); else if (t === TER.BONE) setT(i, TER.FIRE, rand(6, 8));
    else if (t === TER.WATER || t === TER.SHOCK) setT(i, TER.STEAM, rand(2, 3)); else if (t === TER.MUD) setT(i, TER.SOIL);
    else if (t === TER.WISP) queueBoom(i);
    else if (t === TER.SOIL || t === TER.ASH) setT(i, TER.FIRE, flare());
    else if (t === TER.PAVE || t === TER.CRATER) { setT(i, TER.FIRE, flare()); keepBack(i, t, 0); }
    else if (t === TER.BLOOD) setT(i, TER.ASH);
    else if (t === TER.FIRE) TM[i] = Math.max(TM[i], flare());
    else if (t === TER.LAVA) TM[i] = Math.min(28, TM[i] + 5);
    else if (t === TER.OBSID) { if (--THP[i] <= 0) setT(i, TER.CRATER); }
    else if (t === TER.STEAM) TM[i] = Math.max(0.01, TM[i] - 1); }
  function light(i) { const t = TT[i]; if (t === TER.WISP) queueBoom(i, CFG.lightDelay); else if (t === TER.BLOOD) setT(i, TER.SOIL); }
  // current through every connected cell of the same kind (at most 140, like the engine's water); blood, steam and mud come back afterwards
  function flood(i, kind, secs) {
    const q = [i], seen = new Set(); let n = 0;
    const ok = (c) => { const t = TT[c], b = back.get(c); return kind === TER.WATER ? t === TER.WATER || t === TER.SHOCK && !b : t === kind || t === TER.SHOCK && b && b.t === kind; };
    while (q.length && n < 140) { const c = q.shift(); if (seen.has(c)) continue; seen.add(c); if (!ok(c)) continue;
      if (TT[c] === TER.SHOCK) TM[c] = Math.max(TM[c], secs); else { const rem = TM[c]; setT(c, TER.SHOCK, secs); if (kind !== TER.WATER) keepBack(c, kind, rem); }
      n++; const gx = c % GN, gz = Math.floor(c / GN); if (gx > 0) q.push(c - 1); if (gx < GN - 1) q.push(c + 1); if (gz > 0) q.push(c - GN); if (gz < GN - 1) q.push(c + GN); }
    return n; }
  function volt(i) { const t = TT[i], V = CFG.volt;
    if (t === TER.WATER) flood(i, TER.WATER, V.water);
    else if (t === TER.SHOCK) { const b = back.get(i); if (b && b.t === TER.MUD) TM[i] = Math.max(TM[i], V.mud); else flood(i, b ? b.t : TER.WATER, b ? V[b.t === TER.BLOOD ? 'blood' : 'steam'] : V.recharge); }
    else if (t === TER.BLOOD) flood(i, TER.BLOOD, V.blood);
    else if (t === TER.STEAM) flood(i, TER.STEAM, V.steam);
    else if (t === TER.MUD) { setT(i, TER.SHOCK, V.mud); keepBack(i, TER.MUD, 0); }
    else if (t === TER.GRASS || t === TER.BONE) { if (Math.random() < 0.3) setT(i, TER.FIRE, t === TER.BONE ? 7 : 3); }
    else if (t === TER.WISP) queueBoom(i);
    else if (t === TER.OBSID) { if (--THP[i] <= 0) setT(i, TER.CRATER); } }
  wrap('applyEl', (f0) => function (i, el) {
    if (i < 0) return; const from = TT[i];
    if (el === 'ember') ember(i); else if (el === 'light') light(i); else if (el === 'volt') volt(i); else f0(i, el);
    if (has('terrainHit')) { const c = cellCenter(i); egEmit('terrainHit', { cell: i, x: c.x, z: c.z, el, from: TNAME[from], to: TNAME[TT[i]], cast: egCur }); }
  });
  wrap('resetTerrain', (f0) => function () { back.clear(); fenceT.fill(0); state.back = 0; return f0.apply(this, arguments); });

  // ---------------------------------------------------------------- fences that carry current
  const fenceT = new Float32Array(FENCE_N), fences = props.filter((p) => p.kind === 'fence'), SEG = 2 * Math.PI * 44 / FENCE_N;
  function chargeFence(x, z, r) {
    if (Math.hypot(x, z) + r < 43) return 0; let n = 0; const reach = Math.round(CFG.volt.fenceRange / SEG);
    for (const p of fences) { if (p.state !== 'up' || Math.hypot(p.x - x, p.z - z) > r + 0.5) continue;
      for (const s of [1, -1]) for (let k = s > 0 ? 0 : 1; k <= reach; k++) { const q = fences[((p.idx + s * k) % FENCE_N + FENCE_N) % FENCE_N]; if (q.state !== 'up') break; if (!(fenceT[q.idx] > 0)) n++; fenceT[q.idx] = Math.max(fenceT[q.idx], CFG.volt.fence); } }
    if (n) glowFence(); return n; }
  function tickFence(dt) {
    let any = 0;
    for (const p of fences) { if (!(fenceT[p.idx] > 0)) continue; fenceT[p.idx] = p.state === 'up' ? Math.max(0, fenceT[p.idx] - dt) : 0; if (!fenceT[p.idx]) continue; any++;
      for (const e of enemies) { if (!e.alive || e.T.float && !grounded(e) || e.type === 'lord') continue;
        if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < CFG.volt.fenceReach + e.radius + SEG / 2) { e.skF = (e.skF || 0) + CFG.volt.fenceDps * dt; if (e.skF >= 6 || e.skF >= e.hp) { const a = e.skF; e.skF = 0; dealDamage(e, a, 'terrain'); } } } }
    state.fence = any; if (any || fenceT2.some((v) => v > 0) || fenceGlow && fenceGlow.posts.visible) glowFence(); }

  // ---------------------------------------------------------------- terrain actions (EG.terrain)
  const V = (x, z) => new V3(x, 0, z);
  const withSecs = (secs, fn) => { const s0 = emberSecs; if (num(secs) && secs > 0) emberSecs = secs; try { return fn(); } finally { emberSecs = s0; } };
  function cells(list, el, secs) { withSecs(secs, () => { for (const i of list) applyEl(i, el); }); return list.length; }
  function area(x, z, r, el, secs) { const l = []; cellsIn(V(x, z), r, (i) => l.push(i)); const n = cells(l, el, secs); if (el === 'volt') chargeFence(x, z, r); return n; }
  // the cells whose centre lies within half the width of a segment (a line along a cell edge takes both sides)
  function segCells(ax, az, bx, bz, w, out) { const r = Math.max(0.5, w / 2) + 1e-6, x0 = Math.floor(Math.min(ax, bx) - r + GH), x1 = Math.floor(Math.max(ax, bx) + r + GH), z0 = Math.floor(Math.min(az, bz) - r + GH), z1 = Math.floor(Math.max(az, bz) + r + GH);
    for (let gz = Math.max(0, z0); gz <= Math.min(GN - 1, z1); gz++) for (let gx = Math.max(0, x0); gx <= Math.min(GN - 1, x1); gx++) { const cx = gx - GH + 0.5, cz = gz - GH + 0.5;
      if ((ax === bx && az === bz ? Math.hypot(cx - ax, cz - az) : distSeg(cx, cz, ax, az, bx, bz)) <= r) out.push(gz * GN + gx); }
    return out; }
  function pathCells(pts, w) { const set = new Set(); for (let k = 0; k + 1 < pts.length; k++) for (const i of segCells(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], w, [])) set.add(i); return [...set]; }
  const fresh = (seen, list) => list.filter((j) => !seen.has(j) && seen.add(j));
  function path(pts, el, w = 1, secs) { const l = pathCells(pts, w), n = cells(l, el, secs);
    if (el === 'volt') for (const [x, z] of pts) chargeFence(x, z, w / 2); return n; }
  function ring(x, z, r, el, w = 1, secs) { const pts = [], n = Math.max(12, Math.ceil(TAU * r / 0.4)); for (let k = 0; k <= n; k++) pts.push([x + Math.cos(k / n * TAU) * r, z + Math.sin(k / n * TAU) * r]); return path(pts, el, w, secs); }
  // a lightning strike on the ground: current in water, blood marsh, steam and mud, a short fire on soil and ash, trees catch fire, fences carry current
  function strike(x, z, r) { let n = 0; withSecs(0, () => cellsIn(V(x, z), r, (i) => { n++; const t = TT[i]; applyEl(i, t === TER.SOIL || t === TER.ASH ? 'ember' : 'volt'); }));
    for (const p of props) if (p.kind === 'tree' && p.state === 'up' && Math.hypot(p.x - x, p.z - z) < r + 0.5) igniteTree(p);
    chargeFence(x, z, r); return n; }
  // a moving head (sweeping fire, a rope of flame, a line of light) that applies its element to each cell it passes
  const sweeps = [];
  function sweep(x0, z0, x1, z1, el, secs = 0.6, w = 0.9, fx = 'fire', ember) {
    sweeps.push({ x0, z0, x1, z1, el, secs: Math.max(1e-3, secs), w, fx, ember, t: 0, px: x0, pz: z0, seen: new Set(), c: egCur, acc: {} }); state.sweeps = sweeps.length; return true; }
  function tickSweeps(dt) {
    for (let i = sweeps.length - 1; i >= 0; i--) { const s = sweeps[i]; s.t += dt; const k = Math.min(1, s.t / s.secs), x = s.x0 + (s.x1 - s.x0) * k, z = s.z0 + (s.z1 - s.z0) * k;
      const l = fresh(s.seen, segCells(s.px, s.pz, x, z, s.w, [])); s.px = x; s.pz = z;
      egCur = s.c; cells(l, s.el, s.ember); if (s.el === 'volt') chargeFence(x, z, s.w / 2); egCur = null;
      if (s.fx) rate(s.acc, 'p', 50, dt, () => sweepFx(s.fx, x, z));
      if (k >= 1) sweeps.splice(i, 1); }
    state.sweeps = sweeps.length; }
  function sweepFx(fx, x, z) {
    if (fx === 'volt') { const a = V(x, z); a.y = 0.05; bolt(a, a.clone().add(new V3(rand(-0.6, 0.6), rand(0.1, 0.5), rand(-0.6, 0.6))), 0.12, 0.08, false); return; }
    const c = fx === 'light' ? [1, 1, 0.9] : fx === 'blood' ? [1, 0.15, 0.22] : [1, 0.8, 0.6];
    ADD.emit({ x: x + rand(-0.3, 0.3), y: 0.2, z: z + rand(-0.3, 0.3), vx: rand(-0.3, 0.3), vy: rand(0.8, 1.8), vz: rand(-0.3, 0.3), kind: fx === 'fire' ? 0 : 3, fm: fx === 'fire' ? 0 : 2, frame: 0, fps: 24, life: rand(0.35, 0.6), s0: fx === 'fire' ? rand(0.5, 0.8) : 0.3, s1: 0.1, r: c[0], g: c[1], b: c[2], a0: 0.95, a1: 0 }); }

  // ---------------------------------------------------------------- monster states: root (cannot move), stun (cannot attack), ground (a floating monster walks: ground terrain and falling props hurt it)
  const grounded = (e) => !!(e.sk && e.sk.ground > 0 && e.T.float && e.type !== 'lord');
  function status(e, kind, secs) {
    if (!e || !e.alive || !STATES.includes(kind) || !(num(secs) && secs >= 0)) { egW('status: needs a living monster, root/stun/ground and seconds'); return false; }
    const s = e.sk || (e.sk = { root: 0, stun: 0, ground: 0 }); s[kind] = Math.max(s[kind], secs);
    if (has('status')) egEmit('status', { target: e, kind, secs: s[kind] }); return true; }
  function tickStates(dt) { for (const e of enemies) if (e.sk) for (const k of STATES) if (e.sk[k] > 0) e.sk[k] = Math.max(0, e.sk[k] - dt); }
  wrap('updateEnemies', (f0) => function (dt) {
    const held = [];
    for (const e of enemies) if (e.alive && e.sk) { if (e.sk.stun > 0) e.atk = Math.max(e.atk, dt + 1e-3); if (e.sk.root > 0) held.push(e, e.pos.x, e.pos.z); }
    f0.apply(this, arguments);
    for (let k = 0; k < held.length; k += 3) { const e = held[k]; if (e.alive) { e.pos.x = held[k + 1]; e.pos.z = held[k + 2]; } }
    for (const e of enemies) if (e.alive && grounded(e)) e.g.position.y = 0;
  });
  wrap('terrainEffects', (f0) => function (e, dt) {
    if (!grounded(e)) return f0.apply(this, arguments);
    const tp = TP[tileAt(e.pos.x, e.pos.z)];
    if (tp.ed) { e.tacc = (e.tacc || 0) + tp.ed * dt; if (e.tacc >= 6 || e.tacc >= e.hp) { const a = e.tacc; e.tacc = 0; dealDamage(e, a, 'terrain'); } }
    return tp.em || 1;
  });
  wrap('crush', (f0) => function (p) {
    const r = f0.apply(this, arguments);
    egCur = p.c; for (const e of enemies) { if (!e.alive || !grounded(e)) continue; const rx = e.pos.x - p.x, rz = e.pos.z - p.z, along = rx * p.dir.x + rz * p.dir.z, side = Math.abs(rx * p.dir.z - rz * p.dir.x);
      if (along > -0.2 && along < p.len + 0.3 && side < 0.55 + e.radius) dealDamage(e, 80, 'crush'); } egCur = null;
    return r;
  });

  // ---------------------------------------------------------------- terrain assist: monsters that took terrain damage and were then finished by a spell (terrain kills keep their meaning)
  wrap('dealDamage', (f0) => function (e, amt, kind) {
    const was = e && e.alive; if (was && isTerrainKind(kind)) e.skTerr = 1;
    const r = f0.apply(this, arguments);
    if (was && !e.alive && e.type !== 'lord' && e.skTerr && !isTerrainKind(e.lastKind)) state.assists++;
    return r;
  });
  EG.on('actStart', () => { state.act0 = state.assists; });
  EG.on('newGame', () => { state.assists = state.act0 = 0; });
  if (CFG.assist) wrap('showResult', (f0) => function () {
    const r = f0.apply(this, arguments);
    const tab = $('#rTab'), row = document.createElement('tr'); row.className = 'egAssist';
    row.innerHTML = '<td>地形助攻</td><td>' + (state.assists - state.act0) + ' 隻</td>';
    const at = tab.rows[2]; if (at) at.after(row); else tab.appendChild(row);
    return r;
  });

  // ---------------------------------------------------------------- chain tone (the rising tone of "terrain chain ×N")
  if (S0.chainTone === false) W.egChainTone = function () {};
  else if (isObj(S0.chainTone)) { const o = Object.assign({ freq: 440, rise: 1.06, max: 20, sweep: 1.5, dur: 0.14, wave: 'triangle', vol: 0.12, fade: 1 }, S0.chainTone);
    W.egChainTone = function (n) { const f = o.freq * Math.pow(o.rise, Math.min(n, o.max)); tone(f, f * o.sweep, o.dur, o.wave, o.vol * Math.pow(o.fade, Math.max(0, n - 2))); }; }

  // ---------------------------------------------------------------- the aim point of the cast being released (projectiles only get origin and direction)
  let aim = null;
  wrap('releaseCast', (f0) => function (c) { aim = c && c.target ? c.target.clone() : null; try { return f0.apply(this, arguments); } finally { aim = null; } });
  const toArena = (q) => { const R = Math.hypot(q.x, q.z); if (R > 42.5) { q.x *= 42.5 / R; q.z *= 42.5 / R; } return q; };

  // ---------------------------------------------------------------- fireballs and orbs that need more than the engine's flight (kept apart from projs)
  const skProjs = [], MIRROR = (t) => t === TER.WATER || t === TER.SHOCK || t === TER.OBSID;
  const fireSpecial = (F) => F.pierce || F.toAim || F.reflect > 0 || F.seed > 0 || F.trail !== '' || F.elem !== 'fire' || F.sweeps > 0;
  const adopt = (p, o) => { const i = projs.lastIndexOf(p); if (i >= 0) projs.splice(i, 1); p.sk = Object.assign({ passed: new Set(), seen: new Set(), cell: cellOf(p.pos.x, p.pos.z) }, o); skProjs.push(p); state.special = skProjs.length; return p; };
  wrap('spawnFireball', (f0) => function (origin, dir) {
    const r = f0.apply(this, arguments), F = spellP('fire'); if (!fireSpecial(F)) return r;
    const p = projs[projs.length - 1]; if (!p || p.kind !== 'fire') return r;
    adopt(p, { pierce: F.pierce, refl: F.reflect, seed: F.seed, trail: F.trail, sweeps: F.sweeps });
    if (F.toAim || F.seed > 0) { const d = aim ? Math.hypot(aim.x - origin.x, aim.z - origin.z) : F.maxRange; p.life = Math.min(d, F.maxRange) / F.speed; }
    return r;
  });
  wrap('spawnOrb', (f0) => function (origin, dir) {
    const B = spellP('bolt');
    if (B.fromSky > 0) return skyStrike(B);
    const r = f0.apply(this, arguments); if (B.hitElem === 'bolt') return r;
    const p = projs[projs.length - 1]; if (p && p.kind === 'bolt') adopt(p, {}); return r;
  });
  function detonate(p, i) {
    skProjs.splice(i, 1); state.special = skProjs.length; p.dead = true; egCur = p.c;
    if (p.kind === 'fire') { const F = spellP('fire'); explode(p.pos, 1); aoe(p.pos, F.radius, F.damage * fireMul(), 'fire', 0, 'fire');
      if (F.elem === 'fire') terrainBlast(p.pos, 1.6, 'fire'); else area(p.pos.x, p.pos.z, 1.6, F.elem);
      damageProps(p.pos, 1.8, 1, 'fire');
      if (p.sk.sweeps > 0) { let dx = p.vel.x, dz = p.vel.z; if (Math.hypot(dx, dz) < 1e-6) { dx = p.pos.x - player.pos.x; dz = p.pos.z - player.pos.z; } const a0 = Math.atan2(dz, dx), n = p.sk.sweeps;
        for (let k = 0; k < n; k++) { const a = a0 + (k - (n - 1) / 2) * F.sweepSpread, e = toArena(V(p.pos.x + Math.cos(a) * F.sweepLength, p.pos.z + Math.sin(a) * F.sweepLength));
          sweep(p.pos.x, p.pos.z, e.x, e.z, F.sweepElem, F.sweepTime, 0.9, 'fire'); } }
      spellEv('explode', { spell: 'fire', x: p.pos.x, z: p.pos.z, seed: !!p.sk.seeded }); }
    else { const B = spellP('bolt'), hit = p.sk.hit; zapBurst(p.pos); sfx.zap(); terrainBlast(p.pos, 0.9, B.hitElem);
      if (hit) { dealDamage(hit, B.damage * spellMul(), 'bolt', 'bolt'); if (tierOf('bolt')) chain(hit, new Set([hit]), B.bounces, B.damage * spellMul() * B.firstHop); else aoe(hit.pos, 1.6, 14 * spellMul(), 'bolt', hit, 'boltSplash'); }
      spellEv('explode', { spell: 'bolt', x: p.pos.x, z: p.pos.z, target: hit || null }); }
    egCur = null; }
  function updSk(dt) {
    for (let i = skProjs.length - 1; i >= 0; i--) { const p = skProjs[i], S = p.sk;
      if (S.seeded) { const F = spellP('fire'); S.wait -= dt; let go = S.wait <= 0;
        if (!go) for (const e of enemies) if (e.alive && Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) < F.seedRadius + e.radius * 0.5) { go = true; break; }
        if (go) detonate(p, i); continue; }
      const ox = p.pos.x, oz = p.pos.z; p.pos.addScaledVector(p.vel, dt); p.life -= dt;
      if (p.kind === 'fire') { egHome(p, dt); fireTrail(p, dt); }
      else { const B = spellP('bolt');
        rate(p.acc, 'arc', 16, dt, () => bolt(p.pos, p.pos.clone().add(randUnit().multiplyScalar(rand(0.6, 1.2))), 0.16, 0.08, false));
        rate(p.acc, 'gnd', 7, dt, () => { const a = rand(0, TAU), r = rand(0.6, 1.8), g = new V3(p.pos.x + Math.cos(a) * r, 0.05, p.pos.z + Math.sin(a) * r); bolt(p.pos, g, 0.22, 0.12, false); egCur = p.c; applyEl(cellOf(g.x, g.z), B.hitElem); egCur = null; }); }
      if (S.refl > 0) { const c0 = cellOf(ox, oz), c1 = cellOf(p.pos.x, p.pos.z);
        if (c1 >= 0 && c1 !== c0 && MIRROR(TT[c1]) && !(c0 >= 0 && MIRROR(TT[c0]))) {
          if (Math.floor(ox + GH) !== Math.floor(p.pos.x + GH)) p.vel.x *= -1; if (Math.floor(oz + GH) !== Math.floor(p.pos.z + GH)) p.vel.z *= -1;
          p.pos.x = ox; p.pos.z = oz; S.refl--; spellEv('reflect', { spell: p.kind, x: ox, z: oz, cell: c1 }); } }
      if (S.trail) { const l = fresh(S.seen, segCells(ox, oz, p.pos.x, p.pos.z, spellP('fire').trailWidth, [])); if (l.length) { egCur = p.c; cells(l, S.trail); egCur = null; } }
      let hit = null;
      for (const e of enemies) { if (!e.alive || Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) >= e.radius + 0.45) continue;
        if (S.pierce) { if (!S.passed.has(e)) { S.passed.add(e); egCur = p.c; spellEv('pass', { spell: p.kind, x: p.pos.x, z: p.pos.z, target: e }); egCur = null; } } else { hit = e; break; } }
      const out = Math.hypot(p.pos.x, p.pos.z) > 44;
      if (hit || p.life <= 0 || out) {
        if (!hit && !out && S.seed > 0) { S.seeded = true; S.wait = S.seed; p.vel.set(0, 0, 0); p.pos.y = 0.35; egCur = p.c; spellEv('seed', { spell: 'fire', x: p.pos.x, z: p.pos.z, wait: S.seed }); egCur = null; continue; }
        S.hit = hit; detonate(p, i); } }
  }
  wrap('updateProjs', (f0) => function (dt) { f0.apply(this, arguments); updSk(dt); });

  // ---------------------------------------------------------------- bolts: from the sky, hops along water, a path on the ground
  const strikes = [];
  function skyStrike(B) {
    let q = aim ? aim.clone() : V(player.pos.x + Math.sin(player.face) * 6, player.pos.z + Math.cos(player.face) * 6);
    const dx = q.x - player.pos.x, dz = q.z - player.pos.z, d = Math.hypot(dx, dz); if (d > B.skyRange) { q.x = player.pos.x + dx / d * B.skyRange; q.z = player.pos.z + dz / d * B.skyRange; } toArena(q);
    const ring = new T.Mesh(ringGeo, new T.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(q.x, 0.06, q.z); ring.scale.setScalar(B.pickRadius); ring.userData.egSpellkit = 'warn'; scene.add(ring);
    strikes.push({ x: q.x, z: q.z, t: 0, delay: B.fromSky, ring, c: egCur }); state.strikes = strikes.length;
    spellEv('warn', { spell: 'bolt', x: q.x, z: q.z, delay: B.fromSky });
  }
  function tickStrikes(dt) {
    for (let i = strikes.length - 1; i >= 0; i--) { const s = strikes[i]; s.t += dt; s.ring.material.opacity = 0.25 + 0.55 * Math.min(1, s.t / s.delay);
      if (s.t < s.delay) continue;
      strikes.splice(i, 1); scene.remove(s.ring); s.ring.material.dispose(); egCur = s.c;
      const B = spellP('bolt'); let best = null, bd = B.pickRadius;
      for (const e of enemies) { if (!e.alive) continue; const d = Math.hypot(e.pos.x - s.x, e.pos.z - s.z) - e.radius * 0.5; if (d < bd) { bd = d; best = e; } }
      const at = best ? V(best.pos.x, best.pos.z) : V(s.x, s.z), top = at.clone(); top.y = 14; at.y = best ? 1 : 0.05;
      bolt(top, at, 0.4, 0.3, true); zapBurst(at); sfx.zap(); shake(0.12);
      if (B.strikeElem === 'volt') strike(s.x, s.z, B.strikeRadius); else area(s.x, s.z, B.strikeRadius, B.strikeElem);
      if (best) { dealDamage(best, B.damage * spellMul(), 'bolt', 'bolt'); if (tierOf('bolt')) chain(best, new Set([best]), B.bounces, B.damage * spellMul() * B.firstHop); else aoe(best.pos, 1.6, 14 * spellMul(), 'bolt', best, 'boltSplash'); }
      spellEv('strike', { spell: 'bolt', x: s.x, z: s.z, target: best });
      egCur = null; }
    state.strikes = strikes.length; }
  // the connected water (and charged water) under a monster, or null
  function waterUnder(e) { const i = cellOf(e.pos.x, e.pos.z); if (i < 0 || TT[i] !== TER.WATER && TT[i] !== TER.SHOCK) return null;
    const set = new Set(), q = [i]; while (q.length && set.size < 3000) { const c = q.pop(); if (set.has(c) || TT[c] !== TER.WATER && TT[c] !== TER.SHOCK) continue; set.add(c);
      const gx = c % GN, gz = Math.floor(c / GN); if (gx > 0) q.push(c - 1); if (gx < GN - 1) q.push(c + 1); if (gz > 0) q.push(c - GN); if (gz < GN - 1) q.push(c + GN); }
    return set; }
  wrap('chain', () => function chainK(from, hitSet, n, dmg) {
    if (n <= 0) return; const B = spellP('bolt');
    const go = () => {
      let best = null, bd = B.range;
      for (const e of enemies) { if (!e.alive || hitSet.has(e)) continue; const d = Math.hypot(e.pos.x - from.pos.x, e.pos.z - from.pos.z); if (d < bd) { bd = d; best = e; } }
      if (B.waterNet) { const wset = waterUnder(from); if (wset) for (const e of enemies) { if (!e.alive || hitSet.has(e) || !wset.has(cellOf(e.pos.x, e.pos.z))) continue; const d = Math.hypot(e.pos.x - from.pos.x, e.pos.z - from.pos.z); if (!best || d < bd) { bd = d; best = e; } } }
      if (!best) return; const a = new V3(from.pos.x, 1, from.pos.z), b = new V3(best.pos.x, 1, best.pos.z);
      if (B.arcs) { bolt(a, b, 0.32, 0.16, true); zapBurst(b); sfx.zap(); }
      hitSet.add(best); applyEl(cellOf(best.pos.x, best.pos.z), B.hopElem); if (B.path) path([[a.x, a.z], [b.x, b.z]], B.path, B.pathWidth);
      dealDamage(best, dmg, 'bolt', 'boltChain'); spellEv('hop', { spell: 'bolt', x: b.x, z: b.z, from, target: best });
      W.chain(best, hitSet, n - 1, dmg * B.decay);
    };
    if (B.hopDelay > 0) after(B.hopDelay, go); else go();
  });

  // ---------------------------------------------------------------- meteors: line and ring, current, quench, plough, arcs between drops, a 'land' event per drop
  wrap('castMeteor', (f0) => function (T0) {
    const M = spellP('meteor'), up = tierOf('meteor');
    if (egCur) Object.assign(egCur, { skAim: T0.clone(), skDrops: up ? M.drops : 1, skLanded: 0, skFirst: null, skPrev: null });
    if (!up || M.pattern !== 'line' && M.pattern !== 'ring') return f0.apply(this, arguments);
    const px = player.pos.x, pz = player.pos.z, ang = Math.atan2(T0.z - pz, T0.x - px);
    for (let i = 0; i < M.drops; i++) { rand(0, TAU); if (i) Math.random();   // the same draws as the scatter pattern, so later random numbers line up
      const q = M.pattern === 'line' ? V(px + Math.cos(ang) * (M.lineStart + i * M.lineGap), pz + Math.sin(ang) * (M.lineStart + i * M.lineGap))
        : V(T0.x + Math.cos(ang - Math.PI / 2 - i / M.drops * TAU) * M.ringRadius, T0.z + Math.sin(ang - Math.PI / 2 - i / M.drops * TAU) * M.ringRadius);
      dropMeteor(toArena(q), rand(M.sizeMin, M.sizeMax), i * M.interval); }
  });
  wrap('meteorTerrain', (f0) => function (pos, r) {
    const M = spellP('meteor');
    const wet = (t) => t === TER.WATER || t === TER.SHOCK;
    if (M.elem === 'meteor' && !M.quench) f0.apply(this, arguments);
    else cellsIn(pos, r, (i, d) => { const t = TT[i]; if (wet(t)) { if (M.elem === 'volt') applyEl(i, 'volt'); else if (!M.quench) applyEl(i, M.elem === 'meteor' ? (d < r * 0.45 ? 'meteor' : 'crater') : M.elem); return; }
      applyEl(i, M.elem === 'meteor' || M.elem === 'volt' ? (d < r * 0.45 ? 'meteor' : 'crater') : M.elem); });
    if (M.quench) quench(pos, r + 1);
    const k = egCur; let index = -1, last = false;
    if (k && k.skDrops) { index = k.skLanded++; last = k.skLanded >= k.skDrops;
      if (M.arcBolt > 0 && k.skPrev) { const a = k.skPrev, b = V(pos.x, pos.z); a.y = b.y = 0.05; bolt(a, b, 0.22, M.arcBolt, false); path([[a.x, a.z], [b.x, b.z]], 'volt', 1); spellEv('arc', { spell: 'meteor', x: b.x, z: b.z, from: { x: a.x, z: a.z } }); }
      if (!k.skFirst) k.skFirst = V(pos.x, pos.z); k.skPrev = V(pos.x, pos.z);
      if (last && M.plow > 0) plow(k.skFirst, V(pos.x, pos.z), M.plow); }
    spellEv('land', { spell: 'meteor', x: pos.x, z: pos.z, index, count: k && k.skDrops || 1, last: k ? last : true, aim: k && k.skAim ? { x: k.skAim.x, z: k.skAim.z } : null });
  });
  // lava next to water turns into an obsidian wall at once and the water into steam
  function quench(pos, r) { const ns = [-1, 1, -GN, GN]; let n = 0;
    cellsIn(pos, r, (i) => { if (TT[i] !== TER.LAVA) return; const gx = i % GN; let wet = false;
      for (const d of ns) { const j = i + d; if (j < 0 || j >= GN * GN || (d === -1 && gx === 0) || (d === 1 && gx === GN - 1)) continue; if (TT[j] === TER.WATER || TT[j] === TER.SHOCK) { wet = true; setT(j, TER.STEAM, 3); } }
      if (wet) { setT(i, TER.OBSID); n++; } });
    return n; }
  // a crater furrow beyond the last drop, along the line from the first drop to the last; the engine's lava flows into craters
  function plow(a, b, len) { let dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz); if (d < 0.1) { dx = b.x - player.pos.x; dz = b.z - player.pos.z; d = Math.hypot(dx, dz) || 1; }
    const e = toArena(V(b.x + dx / d * (len + 1), b.z + dz / d * (len + 1)));
    for (const i of pathCells([[b.x + dx / d, b.z + dz / d], [e.x, e.z]], 1)) { const t = TT[i]; if (t === TER.WISP) queueBoom(i); else if (isGround(t) || t === TER.PAVE) setT(i, TER.CRATER); } }

  // ---------------------------------------------------------------- blood rites: a wall of fire on the circle, one target for every bolt, bolts that crawl on the ground, another element where they land
  wrap('startBlood', (f0) => function () {
    const r = f0.apply(this, arguments), o = rites[rites.length - 1], R = spellP('blood'); if (!o) return r;
    o.skAim = player.cast && player.cast.target ? player.cast.target.clone() : null;
    if (R.focus || R.crawl > 0 || R.elem !== 'blood' || R.crawlElem) o.sk = { focus: R.focus, crawl: R.crawl, elem: R.elem, crawlElem: R.crawlElem };
    if (R.fireWall > 0) { ring(o.c.x, o.c.z, R.fireWall, R.wallElem, 1, R.duration); spellEv('wall', { spell: 'blood', x: o.c.x, z: o.c.z, radius: R.fireWall }); }
    return r;
  });
  const nearest = (x, z, r, skip) => { let b = null, bd = r; for (const e of enemies) { if (!e.alive || e === skip) continue; const d = Math.hypot(e.pos.x - x, e.pos.z - z); if (d < bd) { bd = d; b = e; } } return b; };
  // a copy of the engine's updateRites with the branches above; it only runs while a rite asks for one of them
  function updRites(dt) {
    for (let i = rites.length - 1; i >= 0; i--) { const o = rites[i], X = o.sk; o.t += dt * o.cs; const ts = o.t, R = spellP('blood'), q = R.duration / 2.4;
      const op = ss(0.12, 0.4, ts) * (1 - ss(1.9 * q, 2.4 * q, ts)); setOpacity(o.mesh.material, op); o.mesh.scale.setScalar(0.01 + 3.4 * ss(0.1, 0.5, ts)); o.mesh.rotation.z += dt * 0.7;
      if (o.light && o.light.owner === o) o.light.i0 = 2.6 * op + 0.01;
      if (ts > 0.2 && ts < 1.8 * q) rate(o.acc, 'r', 45, dt, () => { const a = rand(0, TAU), r = rand(1.3, 1.7); ADD.emit({ x: o.c.x + Math.cos(a) * r, y: 0.1, z: o.c.z + Math.sin(a) * r, vy: rand(0.8, 2), kind: 3, fm: 2, frame: 0, life: rand(0.5, 0.9), s0: 0.22, s1: 0.05, r: 1, g: 0.15, b: 0.22, a0: 0.9, a1: 0 }); });
      if (ts >= 0.55 && !o.bolts.length) {
        const chest = new V3(player.pos.x, 1.4 + player.float, player.pos.z);
        let targets;
        if (X && X.focus) { const a = o.skAim || chest, t = nearest(a.x, a.z, R.seek); targets = t ? [t] : []; }
        else targets = enemies.filter((e) => e.alive && e.pos.distanceTo(chest) < R.seek).sort((a, b) => a.pos.distanceTo(chest) - b.pos.distanceTo(chest)).slice(0, R.bolts);
        for (let k = 0; k < R.bolts; k++) { const b = { ang: k / R.bolts * TAU, state: 0, pos: chest.clone(), dead: false, acc: {}, launchAt: 0.95 + k * R.interval, target: targets.length ? targets[k % targets.length] : null, t: 0 };
          ADD.emit({ follow: b, kind: 0, life: 1e9, s0: 0.6, rs: 4, fm: 0, fps: 30, r: 1, g: 0.28, b: 0.33, a0: 1, a1: 1 });
          ADD.emit({ follow: b, kind: 3, fm: 2, frame: 0, life: 1e9, s0: 1.4, r: 1, g: 0.1, b: 0.15, a0: 0.55, a1: 0.55 }); o.bolts.push(b); } }
      for (const b of o.bolts) { if (b.dead) continue;
        if (X && X.focus && b.target && !b.target.alive) { const n = nearest(b.target.pos.x, b.target.pos.z, R.seek); if (n) { b.target = n; b.end = null; } }
        if (b.state === 0) { b.ang += dt * 7; const chest = new V3(player.pos.x, 1.4 + player.float, player.pos.z);
          b.pos.set(chest.x + Math.cos(b.ang) * 1.15, chest.y + Math.sin(b.ang * 2) * 0.18, chest.z + Math.sin(b.ang) * 1.15);
          if (ts >= b.launchAt) { b.state = 1; b.from = b.pos.clone(); const out = b.from.clone().sub(chest).setY(0).normalize();
            b.ctrl = b.from.clone().addScaledVector(out, 3).add(new V3(0, 2.2, 0));
            if (!b.target) { const a = player.face + rand(-0.8, 0.8), r = rand(6, 9); b.end = new V3(player.pos.x + Math.sin(a) * r, 0.8, player.pos.z + Math.cos(a) * r); } sfx.whoosh();
            if (X && X.crawl > 0) { b.pos.y = 0.35; b.seen = new Set(); } } }
        else {
          const end = b.target && b.target.alive ? new V3(b.target.pos.x, 0.9, b.target.pos.z) : (b.end || (b.end = new V3(b.target.pos.x, 0.9, b.target.pos.z)));
          let t;
          if (X && X.crawl > 0) { const ox = b.pos.x, oz = b.pos.z, dx = end.x - b.pos.x, dz = end.z - b.pos.z, d = Math.hypot(dx, dz), st = X.crawl * dt;
            if (d <= st || d < 0.35) { b.pos.x = end.x; b.pos.z = end.z; t = 1; } else { b.pos.x += dx / d * st; b.pos.z += dz / d * st; t = 0; }
            b.pos.y = 0.35;
            if (X.crawlElem) { const l = fresh(b.seen, segCells(ox, oz, b.pos.x, b.pos.z, 0.9, [])); egCur = o.k; cells(l, X.crawlElem); if (X.crawlElem === 'volt') chargeFence(b.pos.x, b.pos.z, 0.45); egCur = null; }
            rate(b.acc, 't', 90, dt, () => ADD.emit({ x: b.pos.x + rand(-0.06, 0.06), y: 0.2, z: b.pos.z + rand(-0.06, 0.06), kind: 0, fm: 0, fps: 30, life: rand(0.12, 0.18), s0: 0.4, s1: 0.05, r: 1, g: 0.2, b: 0.26, a0: 1, a1: 0.3 })); }
          else { b.t += dt / 0.48; t = Math.min(1, b.t); const u = 1 - t;
            b.pos.set(u * u * b.from.x + 2 * u * t * b.ctrl.x + t * t * end.x, u * u * b.from.y + 2 * u * t * b.ctrl.y + t * t * end.y, u * u * b.from.z + 2 * u * t * b.ctrl.z + t * t * end.z);
            rate(b.acc, 't', 140, dt, () => ADD.emit({ x: b.pos.x + rand(-0.06, 0.06), y: b.pos.y, z: b.pos.z + rand(-0.06, 0.06), kind: 0, fm: 0, fps: 30, life: rand(0.12, 0.18), s0: 0.48, s1: 0.05, r: 1, g: 0.2, b: 0.26, a0: 1, a1: 0.3 })); }
          if (t >= 1) { b.dead = true; egCur = o.k; explode(b.pos, 0.5, [1, 0.25, 0.32], false); sfx.boom(0.45);
            terrainBlast(new V3(b.pos.x, 0, b.pos.z), 1.2, X ? X.elem : 'blood');
            if (b.target && b.target.alive) dealDamage(b.target, R.damage * spellMul(), 'blood', 'blood'); else aoe(b.pos, 1.3, 18 * spellMul(), 'blood', 0, 'blood');
            spellEv('land', { spell: 'blood', x: b.pos.x, z: b.pos.z, target: b.target && b.target.alive ? b.target : null }); egCur = null; } } }
      if (ts > 2.45 * q && o.bolts.every((b) => b.dead)) { o.dead = true; scene.remove(o.mesh); egFree(o.mesh); rites.splice(i, 1); } }
  }
  wrap('updateRites', (f0) => function (dt) { if (rites.some((o) => o.sk)) return updRites(dt); return f0.apply(this, arguments); });

  // ---------------------------------------------------------------- self-glow for props (EG.glow): an additive copy over the prop (3D or pixel sprite), fences per segment
  const glows = new Map(); let fenceGlow = null;
  const colOf = (c) => new T.Color(typeof c === 'string' || num(c) ? c : 0xffffff);
  function glow(p, o = {}) {
    if (!p || !props.includes(p)) { egW('glow: not a prop'); return false; }
    if (p.kind === 'fence') { fenceT2[p.idx] = Math.max(fenceT2[p.idx], num(o.secs) ? o.secs : 0.5); fenceCol[p.idx] = colOf(o.color).multiplyScalar(num(o.strength) ? o.strength : 1); glowFence(); return true; }
    let g = glows.get(p);
    if (!g) { const rec = window.EGSprites && EGSprites.state && EGSprites.state.active && (EGSprites.propRecs || []).find((r) => r.p === p);
      const mat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, fog: false });
      let m;
      if (rec) { mat.map = rec.m.material.map; mat.alphaTest = 0.02; m = new T.Mesh(rec.m.geometry, mat); m.renderOrder = (rec.m.renderOrder || 0) + 1; }
      else if (p.g) { m = p.g.clone(); m.traverse((c) => { if (c.isMesh) c.material = mat; }); }
      else return false;
      m.userData.egSpellkit = 'glow'; scene.add(m); g = { m, mat, rec, t: 0, life: 0, col: new T.Color(), s: 1 }; glows.set(p, g); }
    g.col = colOf(o.color); g.s = num(o.strength) ? o.strength : 1; g.life = num(o.secs) ? o.secs : 0.5; g.t = 0; state.glows = glows.size; return true;
  }
  function tickGlows(dt) {
    for (const [p, g] of glows) { g.t += dt; const k = g.life > 0 ? Math.max(0, 1 - g.t / g.life) : 0;
      if (k <= 0) { scene.remove(g.m); g.mat.dispose(); glows.delete(p); continue; }
      g.mat.color.copy(g.col); g.mat.opacity = Math.min(1, g.s * k) * (egFlashOff ? 0.3 : 1);
      if (g.rec) { g.m.position.copy(g.rec.m.position); g.m.quaternion.copy(g.rec.m.quaternion); g.m.visible = g.rec.m.visible; }
      else { g.m.position.copy(p.g.position); g.m.quaternion.copy(p.g.quaternion); g.m.scale.copy(p.g.scale).multiplyScalar(1.03); g.m.visible = p.state !== 'broken'; } }
    for (let i = 0; i < FENCE_N; i++) if (fenceT2[i] > 0) fenceT2[i] = Math.max(0, fenceT2[i] - dt);
    state.glows = glows.size; }
  const fenceT2 = new Float32Array(FENCE_N), fenceCol = Array.from({ length: FENCE_N }, () => new T.Color(0x9fdcff)), _c = new T.Color(), _m = new T.Matrix4();
  // fence segments light up while they carry current (blue) or were asked to glow (their own colour); one additive copy of the posts and rails
  function glowFence() {
    if (!fenceGlow) { const mat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false, fog: false });
      const posts = new T.InstancedMesh(fencePosts.geometry, mat, FENCE_N), rails = new T.InstancedMesh(fenceRails.geometry, mat, FENCE_N * 2);
      for (const m of [posts, rails]) { m.instanceMatrix.setUsage(T.DynamicDrawUsage); m.userData.egSpellkit = 'fence'; m.frustumCulled = false; scene.add(m); }
      fenceGlow = { posts, rails, mat }; }
    const { posts, rails } = fenceGlow; let lit = 0;
    for (let i = 0; i < FENCE_N; i++) { const v = fenceT[i] > 0 ? Math.min(1, fenceT[i] / 0.3) : 0, w = fenceT2[i] > 0 ? Math.min(1, fenceT2[i] / 0.3) : 0, k = Math.max(v, w);
      if (k > 0) lit++;
      _c.set(0); if (v) _c.setRGB(0.35, 0.75, 1).multiplyScalar(v * (egFlashOff ? 0.3 : 1)); if (w) _c.add(fenceCol[i].clone().multiplyScalar(w * (egFlashOff ? 0.3 : 1)));
      fencePosts.getMatrixAt(i, _m); posts.setMatrixAt(i, _m); posts.setColorAt(i, _c);
      for (let r = 0; r < 2; r++) { fenceRails.getMatrixAt(i * 2 + r, _m); rails.setMatrixAt(i * 2 + r, _m); rails.setColorAt(i * 2 + r, _c); } }
    for (const m of [posts, rails]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.visible = lit > 0; }
  }
  // a crackle along charged fences (particles only when the player's settings allow effects)
  function fenceSparks(dt) { if (!state.fence) return; rate(fenceSparkAcc, 'p', Math.min(30, state.fence * 2), dt, () => { const on = fences.filter((p) => fenceT[p.idx] > 0); if (!on.length) return; const p = on[Math.floor(Math.random() * on.length)];
    const a = new V3(p.x, rand(0.3, 1.4), p.z); bolt(a, a.clone().add(new V3(rand(-0.5, 0.5), rand(-0.3, 0.3), rand(-0.5, 0.5))), 0.1, 0.08, false); }); }
  const fenceSparkAcc = {};

  // ---------------------------------------------------------------- skill bar: names, icons and the small label under each spell
  const skills = {}, base = {};
  function setSkill(id, o) {
    if (!SKILLS.includes(id) || !isObj(o)) { egW('setSkill: unknown spell or not an object: ' + id); return false; }
    const el = document.querySelector('.sk[data-s="' + id + '"]'); if (!el) return false; let all = true;
    const cur = skills[id] || (skills[id] = {}), nEl = el.querySelector('.n');
    if (!base[id]) base[id] = { name: nEl ? nEl.textContent : '' };
    for (const k of Object.keys(o)) { const v = o[k]; if (!['name', 'label', 'icon'].includes(k) || v !== null && typeof v !== 'string') { egW('setSkill: ' + id + '.' + k + ' ignored (name, label or icon: a string or null)'); all = false; continue; } cur[k] = v; }
    if (nEl) nEl.textContent = typeof cur.name === 'string' ? cur.name : base[id].name;
    let img = el.querySelector('img.egIcon');
    if (typeof cur.icon === 'string' && cur.icon) { if (!img) { img = document.createElement('img'); img.className = 'egIcon'; img.alt = ''; img.draggable = false;
        img.style.cssText = 'position:absolute;top:3px;right:3px;width:18px;height:18px;image-rendering:pixelated;pointer-events:none'; el.insertBefore(img, nEl || el.firstChild); }
      if (img.getAttribute('src') !== cur.icon) img.src = cur.icon; }
    else if (img) img.remove();
    labels(); return all;
  }
  function labels() { for (const id of SKILLS) { const L = skills[id] && skills[id].label; if (typeof L !== 'string') continue; const m = document.querySelector('.sk[data-s="' + id + '"] .m'); if (m) m.textContent = L; } }
  wrap('refreshSkillLabels', (f0) => function () { const r = f0.apply(this, arguments); labels(); return r; });

  // ---------------------------------------------------------------- per-frame work and clean-up
  function tick(dt) { try { tickStates(dt); tickSweeps(dt); tickStrikes(dt); tickFence(dt); fenceSparks(dt); tickGlows(dt); } catch (e) { state.err = 'frame: ' + (e && e.message); } }
  wrap('updateTerrain', (f0) => function (dt) { const r = f0.apply(this, arguments); tick(dt); return r; });
  function clearAll() {
    for (const p of skProjs.splice(0)) p.dead = true; sweeps.length = 0;
    for (const s of strikes.splice(0)) { scene.remove(s.ring); s.ring.material.dispose(); }
    for (const [, g] of glows) { scene.remove(g.m); g.mat.dispose(); } glows.clear(); fenceT.fill(0); fenceT2.fill(0); if (fenceGlow) glowFence();
    for (const e of enemies) if (e.sk) e.sk.root = e.sk.stun = e.sk.ground = 0;
    for (const k in fenceSparkAcc) delete fenceSparkAcc[k];
    state.special = state.sweeps = state.strikes = state.glows = state.fence = 0; }
  const ce = EG.clearEffects; EG.clearEffects = function () { const r = ce.apply(EG, arguments); clearAll(); return r; }; Object.assign(EG.clearEffects, ce);

  // ---------------------------------------------------------------- the extension-script interface
  const cellInfo = (x, z) => { const i = cellOf(x, z); return i < 0 ? null : { cell: i, type: TNAME[TT[i]], timer: TM[i], returnsTo: back.has(i) ? TNAME[back.get(i).t] : null }; };
  const elOk = (el, w) => { if (ELEMS.includes(el)) return true; egW(w + ': unknown element ' + el + ' (' + ELEMS.join(', ') + ')'); return false; };
  EG.terrain = {
    elements: ELEMS.slice(),
    area: (x, z, r, el, secs) => num(x) && num(z) && num(r) && elOk(el, 'terrain.area') ? area(x, z, r, el, secs) : 0,
    path: (pts, el, w = 1, secs) => Array.isArray(pts) && pts.length > 1 && pts.every((p) => Array.isArray(p) && num(p[0]) && num(p[1])) && elOk(el, 'terrain.path') ? path(pts, el, w, secs) : 0,
    ring: (x, z, r, el, w = 1, secs) => num(x) && num(z) && num(r) && r > 0 && elOk(el, 'terrain.ring') ? ring(x, z, r, el, w, secs) : 0,
    sweep: (x0, z0, x1, z1, el, secs = 0.6, w = 0.9, fx = 'fire', ember) => [x0, z0, x1, z1].every(num) && elOk(el, 'terrain.sweep') ? sweep(x0, z0, x1, z1, el, secs, w, fx, ember) : false,
    strike: (x, z, r = 1.5) => num(x) && num(z) ? strike(x, z, r) : 0,
    quench: (x, z, r = 2) => quench(V(x, z), r),
    fence: (x, z, r = 1) => chargeFence(x, z, r),
    cellAt: cellInfo,
  };
  EG.status = status;
  EG.statusOf = (e) => e && e.sk ? { root: e.sk.root, stun: e.sk.stun, ground: e.sk.ground } : { root: 0, stun: 0, ground: 0 };
  EG.glow = glow;
  EG.propsNear = (x, z, r, kind) => props.filter((p) => (!kind || p.kind === kind) && Math.hypot(p.x - x, p.z - z) <= r);
  EG.setSkill = setSkill;
  EG.terrainAssists = () => state.assists;
  if (isObj(S0.skills)) for (const [id, s] of Object.entries(S0.skills)) if (SKILLS.includes(id) && isObj(s)) setSkill(id, s);
  state.on = true;
  window.EGSpellkit = { state, validate, CFG, skProjs, sweeps, strikes, glows, back, fenceT, debug: { quench, plow, flood, chargeFence, waterUnder, glowFence, tick } };
})();
