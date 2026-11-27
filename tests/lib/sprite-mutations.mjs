// defects for the pixel-sprite module; tests/run-all.mjs plants them all at once; tests/sprite-mutations.mjs plants them one at a time
export const SPRITE_MUTATIONS = [
  ['an.side ? [an.side, an.mirror]', 'an.side ? [an.side, false]'],                                         // facing left is not mirrored
  ['y1 = ay * h, y0 = (ay - 1) * h', 'y1 = h, y0 = 0'],                                                     // the anchor is ignored: feet float one row up
  ['pickSet(G.byT[TT[i]], G.H1[i], G.H2[i], time)', 'pickSet(G.byT[TT[i]], Math.random(), G.H2[i], time)'],  // ground variants flicker
  ['if (done) { free(f.m); fxList.splice(i, 1); continue; }', 'if (done && 0) { free(f.m); fxList.splice(i, 1); continue; }'], // effects never end
  ['Math.max(1, Math.round(innerHeight * dpr / ROWS))', 'Math.max(1, innerHeight * dpr / ROWS)'],          // scale not a whole number
  ['keep.copy(camera.position); snap(camera.position);', 'keep.copy(camera.position);'],                   // camera off the pixel lattice: shimmer
  ['Object.assign(o, { alphaTest: .5 })', 'Object.assign(o, { alphaTest: .5, depthTest: false })'],         // sprites drawn over what is in front
  ['if (window.CONTENT && CONTENT.sprites) {', 'if (window.CONTENT) {'],                                    // the demo page loads the sprite module
  ['tilt = U.value; U.value = 0;', 'tilt = U.value;'],                                                      // tilt-shift stays on in low resolution
  ['else R.g.visible = false;', 'else 0;'],                                                                 // 3D props drawn under the prop sprites
  ['else { releaseRec(R); mons.delete(e); }', 'else { mons.delete(e); }'],                                  // dead monsters' quads stay in the scene
  ["if (a.idle === undefined) W(w + '.idle'", "if (0) W(w + '.idle'"],                                       // a character without idle passes validation
  ['p = snap(v3.set(s.x, 0, s.z))', 'p = v3.set(s.x, 0, s.z)'],                                             // characters off the pixel lattice
  ['if (s.hurt && C.an.hurt) R.hurt = dur(C.an.hurt, R.dir);', ''],                                         // hits never show the hurt cells
  ['window[name] = Object.assign(w, o);', 'window[name] = w;'],                                            // wrapped engine functions lose their own properties
  ['k(burns,o=>r(o.decal,1))', 'k(burns,o=>r(o.decal))'], // restart (clearWorld -> egRun -> clearEffects) frees only the material: the burning ground's geometry stays on the GPU (DEVLOG #149)
  // the orb flipbook follows projs' last entry again: null when kit/spellkit.js took the orb or made none, a fireball when one is flying (DEVLOG #150)
  ["let r; const p = pushed('bolt', () => { r = quiet(has('orb'), () => o.apply(null, a)); }); if (p) spawn('orb', { follow: p }); return r;", "quiet(has('orb'), () => o.apply(null, a)); spawn('orb', { follow: projs[projs.length - 1] });"],
];
