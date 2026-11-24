// defects for the per-cast record (kit/core.js, combat.js, world.js, systems.js, ui.js), the chain-tone hook, the burnt-tree reset,
// the terrain actions and spell extensions (kit/spellkit.js) and sprite poses (kit/sprites.js).
// tests/run-all.mjs plants them all at once; tests/spellkit-mutations.mjs plants them one at a time.
// The third field names the unit pages that must notice ('spellkit' = node tests/unit.mjs --spellkit-only, 'sprites' = --sprites-only).
export const SPELLKIT_MUTATIONS = [
  // the per-cast record in the engine
  ['const k=egCur;if(k)amt*=k.mul;', 'const k=egCur;', 'spellkit'],                                                                        // the locked factor is ignored
  ["amount:amt,cast:k})", 'amount:amt,cast:null})', 'spellkit'],                                                                            // hits lose their record
  ['function after(t,fn){timers.push({t,fn,c:egCur})}', 'function after(t,fn){timers.push({t,fn})}', 'spellkit'],                           // timers drop the cast (meteors, hops)
  ['egCur=T.c;f();egCur=null', 'f();', 'spellkit'],                                                                                         // the timer loop does not restore it
  ['booms.push({i,t:delay,c:egCur})', 'booms.push({i,t:delay})', 'spellkit'],                                                              // wisp blasts lose the cast
  ['function crush(p){egCur=p.c;', 'function crush(p){', 'spellkit'],                                                                      // falling props lose the cast
  ['function breakProp(p,src){p.hp=0;p.c=egCur;', 'function breakProp(p,src){p.hp=0;', 'spellkit'],                                          // a broken tomb forgets who broke it
  ["p.t=6;p.src=null;p.c=egCur}", 'p.t=6;p.src=null}', 'spellkit'],                                                                         // a tree set on fire forgets who lit it
  ['meteors.splice(i,1);m.dead=true;egCur=m.c;', 'meteors.splice(i,1);m.dead=true;', 'spellkit'],                                           // meteor impacts lose the cast
  ["else aoe(hit.pos,1.6,14*spellMul(),'bolt',hit,'boltSplash')}}\n      egCur=null}", "else aoe(hit.pos,1.6,14*spellMul(),'bolt',hit,'boltSplash')}}\n      }", 'spellkit'], // the record outlives the impact
  ['function releaseCast(c){egCur=c.k;', 'function releaseCast(c){', 'spellkit'],                                                           // released spells carry no record
  ['egCur=player.cast.k;startBlood();egCur=null;', 'startBlood();', 'spellkit'],                                                            // blood rites carry no record
  ['b.tick=.5;egCur=b.c;aoe(', 'b.tick=.5;aoe(', 'spellkit'],                                                                              // burning ground loses the cast
  ["if(p.kind==='tree'){p.mat.color.setHex(0x2a211b);p.acc={}}", "if(p.kind==='tree'){p.mat.color.setHex(0x2a211b)}", 'spellkit'],          // a reset tree keeps its emission fractions
  ['el.classList.add(\'pop\');egChainTone(chainN)}}', "el.classList.add('pop');tone(440,660,.14,'triangle',.12)}}", 'spellkit'],            // the chain tone bypasses the hook
  ['const f=440*Math.pow(1.06,Math.min(n,20));', 'const f=440*Math.pow(1.06,Math.min(n,30));', 'spellkit'],                                  // the engine's own tone changes
  ["(typeof v==='string'?(EG_ENUM[k]||[]).includes(v):", "(typeof v==='string'?['scatter','arc'].includes(v):", 'spellkit'],                 // new string values refused
  ['castInfo:()=>player.cast&&player.cast.k||null,', 'castInfo:()=>null,', 'spellkit'],                                                     // no way to lock a factor
  ['if (window.CONTENT && CONTENT.spellkit) {', 'if (window.CONTENT) {', 'spellkit'],                                                       // the demo page loads the module
  // terrain elements and actions
  ['if (TM[i] <= 0 && (TT[i] === TER.FIRE && t === TER.ASH || TT[i] === TER.SHOCK && t === TER.WATER)) { t = b.t; tm = b.tm; }', '', 'spellkit'], // cells never come back
  ['else if (t === TER.PAVE || t === TER.CRATER) { setT(i, TER.FIRE, flare()); keepBack(i, t, 0); }', 'else if (t === TER.PAVE || t === TER.CRATER) setT(i, TER.FIRE, flare());', 'spellkit'], // paving burns to ash
  ['if (t === TER.WISP) queueBoom(i, CFG.lightDelay);', 'if (t === TER.WISP) queueBoom(i);', 'spellkit'],                                   // light blows wisps at once
  ['else if (t === TER.BLOOD) setT(i, TER.SOIL); }', '}', 'spellkit'],                                                                     // light does not dry blood
  ['if (kind !== TER.WATER) keepBack(c, kind, rem);', '', 'spellkit'],                                                                     // charged blood turns into water
  [": V.recharge); }", ': V.water); }', 'spellkit'],                                                                                          // recharging gives no longer current
  ['to: TNAME[TT[i]], cast: egCur });', 'to: TNAME[from], cast: egCur });', 'spellkit'],                                                     // terrainHit reports the old type
  ["if (q.state !== 'up') break;", '', 'spellkit'],                                                                                         // current jumps a broken fence segment
  ['Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < CFG.volt.fenceReach + e.radius + SEG / 2', 'Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < CFG.volt.fenceReach', 'spellkit'], // fences barely hurt
  // monster states
  ['if (e.alive) { e.pos.x = held[k + 1]; e.pos.z = held[k + 2]; }', '', 'spellkit'],                                                       // root does not hold
  ['if (e.sk.stun > 0) e.atk = Math.max(e.atk, dt + 1e-3);', '', 'spellkit'],                                                              // stun does not stop attacks
  ['if (!grounded(e)) return f0.apply(this, arguments);', 'return f0.apply(this, arguments);', 'spellkit'],                                 // grounded floaters ignore the ground
  ['if (was && !e.alive && e.type !== \'lord\' && e.skTerr && !isTerrainKind(e.lastKind)) state.assists++;', "if (was && !e.alive && e.type !== 'lord' && e.skTerr) state.assists++;", 'spellkit'], // terrain kills counted as assists
  ['const at = tab.rows[2]; if (at) at.after(row);', 'const at = tab.rows[4]; if (at) at.after(row);', 'spellkit'],                         // the assist row in the wrong place
  ['o.vol * Math.pow(o.fade, Math.max(0, n - 2))', 'o.vol', 'spellkit'],                                                                    // the tone does not fade
  // spell parameters
  ['if (S.pierce) {', 'if (0) {', 'spellkit'],                                                                                              // no piercing
  ['p.life = Math.min(d, F.maxRange) / F.speed;', 'p.life = F.maxRange / F.speed;', 'spellkit'],                                           // flies past the aim point
  ['if (Math.floor(oz + GH) !== Math.floor(p.pos.z + GH)) p.vel.z *= -1;', '', 'spellkit'],                                                 // no bounce on z
  ['< F.seedRadius + e.radius * 0.5) { go = true; break; }', '< 0) { go = true; break; }', 'spellkit'],                                      // seeds ignore monsters
  ["if (F.elem === 'fire') terrainBlast(p.pos, 1.6, 'fire'); else area(p.pos.x, p.pos.z, 1.6, F.elem);", "terrainBlast(p.pos, 1.6, 'fire');", 'spellkit'], // the blast element is ignored
  ['for (let k = 0; k < n; k++) { const a = a0 + (k - (n - 1) / 2) * F.sweepSpread', 'for (let k = 0; k < 1; k++) { const a = a0 + (k - (n - 1) / 2) * F.sweepSpread', 'spellkit'], // one sweep only
  ['if (B.fromSky > 0) return skyStrike(B);', '', 'spellkit'],                                                                              // no strike from the sky
  ["if (best) { dealDamage(best, B.damage * spellMul(), 'bolt', 'bolt'); if (tierOf('bolt')) chain(", "if (best) { dealDamage(best, B.damage * spellMul(), 'bolt', 'bolt'); if (0) chain(", 'spellkit'], // the strike does not chain
  ['if (B.waterNet) {', 'if (0) {', 'spellkit'],                                                                                            // no hops along water
  ['if (B.hopDelay > 0) after(B.hopDelay, go); else go();', 'after(B.hopDelay, go);', 'spellkit'],                                        // zero delay still waits a frame
  ['if (B.path) path(', 'if (0) path(', 'spellkit'],                                                                                        // no path between hops
  ['pz + Math.sin(ang) * (M.lineStart + i * M.lineGap)', 'pz + Math.sin(ang) * (M.lineStart + i * 2)', 'spellkit'],                         // line gap ignored
  ['T0.z + Math.sin(ang - Math.PI / 2 - i / M.drops * TAU) * M.ringRadius', 'T0.z + Math.sin(ang - Math.PI / 2 - i / M.drops * TAU) * 2', 'spellkit'], // ring radius ignored
  ["if (M.elem === 'meteor' && !M.quench) f0.apply(this, arguments);", 'if (!M.quench) f0.apply(this, arguments);', 'spellkit'],                                          // meteors steam water anyway
  ['if (M.quench) quench(pos, r + 1);', '', 'spellkit'],                                                                                     // no quench
  ['if (last && M.plow > 0) plow(', 'if (0) plow(', 'spellkit'],                                                                            // no furrow
  ['index = k.skLanded++;', 'index = 0; k.skLanded++;', 'spellkit'],                                                                        // land events lose their order
  ["path([[a.x, a.z], [b.x, b.z]], 'volt', 1); spellEv('arc'", "spellEv('arc'", 'spellkit'],                                                 // arcs between drops change nothing
  ['if (X && X.focus) { const a = o.skAim || chest,', 'if (0) { const a = o.skAim || chest,', 'spellkit'],                                   // blood bolts do not focus
  ['if (n) { b.target = n; b.end = null; }', '', 'spellkit'],                                                                               // focused bolts do not retarget
  ['if (X && X.crawl > 0) { const ox = b.pos.x', 'if (0) { const ox = b.pos.x', 'spellkit'],                                // bolts fly instead of crawling
  ["terrainBlast(new V3(b.pos.x, 0, b.pos.z), 1.2, X ? X.elem : 'blood');", "terrainBlast(new V3(b.pos.x, 0, b.pos.z), 1.2, 'blood');", 'spellkit'], // landing element ignored
  ['if (R.fireWall > 0) { ring(', 'if (0) { ring(', 'spellkit'],                                                                            // no fire wall
  // glow, skill bar, clean-up, validation
  ['g.mat.opacity = Math.min(1, g.s * k) * (egFlashOff ? 0.3 : 1);', 'g.mat.opacity = Math.min(1, g.s * k);', 'spellkit'],                   // glow ignores reduced flashing
  ["wrap('refreshSkillLabels', (f0) => function () { const r = f0.apply(this, arguments); labels(); return r; });", '', 'spellkit'],       // the engine relabel wipes the pack label
  ["if (nEl) nEl.textContent = typeof cur.name === 'string' ? cur.name : base[id].name;", "if (nEl && typeof cur.name === 'string') nEl.textContent = cur.name;", 'spellkit'], // null does not restore the name
  ['for (const p of skProjs.splice(0)) p.dead = true;', '', 'spellkit'],                                                                   // clearEffects leaves special projectiles
  ["pos(v.ember, C + '.ember');", '', 'spellkit'],                                                                                          // a bad ember time passes validation
  // sprite poses
  ["s.pose && C.an['pose:' + s.pose] ? 'pose:' + s.pose :", '', 'sprites'],                                                                // poses never shown
  ['x.egPose && x.egPose.until > time ? x.egPose.name', 'x.egPose ? x.egPose.name', 'sprites'],                                             // poses never run out
];
