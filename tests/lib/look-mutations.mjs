// defects for the night-look module (kit/look.js); tests/run-all.mjs plants them all at once; tests/look-mutations.mjs plants them one at a time
export const LOOK_MUTATIONS = [
  ['if (window.CONTENT && CONTENT.look) {', 'if (window.CONTENT) {'],                                                     // the demo page loads the look module
  ["if (o.flame !== undefined && typeof o.flame !== 'boolean' && !num(o.flame))", 'if (0)'],                            // a bad flame value passes validation
  ['if (L.clear !== undefined) renderer.setClearColor(col(L.clear));', ''],                                             // the clear colour is ignored
  ['const hq = postOn() ? MUL.high : 1;', 'const hq = 1;'],                                                             // highMul ignored with post effects on
  ['scene.fog.density *= MUL.fog;', 'scene.fog.density *= MUL.fog * (1 + state.frames * 1e-4);'],                       // the fog multiplier compounds frame after frame
  ['if ( uLookK <= 0.0 ) return L;', 'return L;'],                                                                      // no light steps
  ['base += PI * directionalLights[ i ].color', 'base += 0.0 * directionalLights[ i ].color'],                         // moonlight stepped too
  ['( egBayer( gl_FragCoord.xy ) - 0.5 ) * uLookW', '0.0 * uLookW'],                                                    // no dither between steps
  ["mat.customProgramCacheKey = () => 'egLook:' + name + (cells ? ':cell' : '');", ''],                                // terrain and ground share one program (no cell tint)
  ['const k = ((GN - 1 - Math.floor(i / GN)) * GN + (i % GN)) * 4;', 'const k = i * 4;'],                              // cell texture mirrored
  ['if (seen[i] === t) continue;', ''],                                                                                 // the whole cell texture re-sent every frame
  ['* egCell.a * uLookCell * egL * egL * 1.6;', '* egCell.a * uLookCell * egL * egL * 0.0;'],                           // tiles never glow
  ['if (outer) ground.material.color.setRGB', 'if (0) ground.material.color.setRGB'],                                   // the ground beyond the fence untinted
  ['mat.emissiveMap = mat.map; mat.needsUpdate = true; mat.userData.egLookTuned = true;', 'mat.needsUpdate = true; mat.userData.egLookTuned = true;'], // fill light lights the whole quad
  ['if (TW.distance !== undefined) { Tw.light.distance = TW.distance; Tw.light.decay = 2; }', ''],                     // tower light reach unchanged
  ['if (y === false) { o.s0 = o.s1 = 0; o.a0 = o.a1 = 0; } else o.y = y;', 'if (y === false) return null; else o.y = y;'], // "flame off" skips emit: the random sequence shifts
  ['const ut = towers0 = window.updateTowers, y = TW.flame;', 'const ut = towers0 = window.updateTowers, y = TW.flame === false ? false : 3.8;'], // the flame height is ignored
  ['k = o.lit ? 0.92 + 0.08', 'k = 1 ? 0.92 + 0.08'],                                                                   // halo on unlit towers
  ['Math.floor(v * K + 0.5 + ((BAYER', '(v * K + 0 * ((BAYER'],                                                         // smooth halo
  ['if (o && share < 1 && !(h2(', 'if (o && share < 0 && !(h2('],                                                     // decoration beside every tomb
  ["const up = (o) => !o || !o.state || o.state === 'up';", 'const up = (o) => true;'],                               // decoration stays when its tomb falls
  ['I.light.intensity = show ? I.i0 * wob(t * I.rate, I.seed) : 0;', 'I.light.intensity = show ? I.i0 * (0.9 + Math.random() * 0.2) : 0;'], // flicker draws random numbers
  ['(flashOff() ? 0.3 : 1)', '(1)'],                                                                                    // reduced flashing ignored
  ["if (d.block > 0 && (!d.near || d.near === 'tower')) obstacles.push", 'if (0) obstacles.push'],                    // block ignored
  ['const cv = cellCanvas(im, meta, d.cell, d.shrink);', 'const cv = cellCanvas(im, meta, d.cell, 1);'],               // shrink ignored
  ['m.position.set(snapV.x, y, snapV.z); m.quaternion.copy(camera.quaternion);', 'm.position.set(snapV.x, y, snapV.z);'], // decorations do not face the camera
  ['s.m.material.opacity = s.L.a * pick(L.mist.mul, 1);', 's.m.material.opacity = s.L.a;'],                           // mist multiplier ignored
  ['if (towersLit && MUL.tower !== 1) for', 'if (0) for'],                                                              // tower light multiplier ignored
  ['    }, ut);', '    }, {});'],
  ['    try { frame(dt); } catch (e)', '    try { 0; } catch (e)'],                                                    // visuals() no longer runs the look frame                                                                                       // the wrapped updateTowers loses its own properties
];
