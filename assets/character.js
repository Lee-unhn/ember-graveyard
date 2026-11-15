// Skinned mage for Ember Graveyard (P3b).
// Model and animations: Universal Animation Library by Quaternius, CC0 1.0 (see NOTICE.md), slimmed by scripts/slim_glb.py
// into assets/mage-model.js. If the loader or the model is missing (offline, blocked CDN), the page keeps its
// procedural block mage: EGChar.attach() simply never marks the player as skinned.
(function () {
  'use strict';
  const S = { ready: false, failed: false, mixer: null, actions: {}, cur: null, bones: {}, root: null, P: null, lastCast: null };

  function b64ToBuffer(b64) {
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }

  // Swap the model's flat PBR colours for the game's Lambert look (r128 needs skinning:true on custom materials).
  function restyle(root, THREE) {
    const robe = new THREE.MeshLambertMaterial({ color: 0x3b2350, skinning: true });
    const trim = new THREE.MeshLambertMaterial({ color: 0x8a6a3a, skinning: true });
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.material = /Joint/i.test(o.material.name) ? trim : robe;
      o.frustumCulled = false; // skinned bounds do not follow the animation
    });
  }

  function attach(P, THREE) {
    if (!window.MAGE_GLB || !THREE.GLTFLoader) { S.failed = true; return; }
    S.P = P;
    try {
      new THREE.GLTFLoader().parse(b64ToBuffer(window.MAGE_GLB), '', (gltf) => {
        const root = gltf.scene; restyle(root, THREE);
        root.scale.setScalar(0.86);
        root.traverse((o) => { if (o.isBone) S.bones[o.name] = o; });
        S.mixer = new THREE.AnimationMixer(root);
        for (const clip of gltf.animations) S.actions[clip.name] = S.mixer.clipAction(clip);
        for (const n of ['cast', 'castUp', 'hit', 'death']) { const a = S.actions[n]; a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
        // hide the procedural body and arms, keep hat, brim and staff (they follow the bones each frame)
        for (const o of P.g.children) if (o !== P.hatGroup) o.visible = false;
        P.g.add(root); S.root = root;
        P.staffGroup.parent && P.staffGroup.parent.remove(P.staffGroup); P.g.add(P.staffGroup);
        // the staff was posed for the old swinging arm; in the hand it stands upright, tilted a little forward
        const staff = P.staffGroup.children[0]; staff.position.set(0, 0.15, 0.05); staff.rotation.set(0.22, 0, 0);
        P.staffGroup.position.set(0, 0, 0); P.staffGroup.rotation.set(0, 0, 0);
        P.skinned = true; S.ready = true; play('idle', 0);
      }, () => { S.failed = true; });
    } catch (e) { S.failed = true; }
  }

  function play(name, fade = 0.15, timeScale = 1) {
    const next = S.actions[name]; if (!next) return;
    next.timeScale = timeScale;
    if (S.cur === next) return;
    next.reset().play();
    if (S.cur && fade > 0) S.cur.crossFadeTo(next, fade, false); else if (S.cur) S.cur.stop();
    S.cur = next;
  }

  const tmp = { v: null };
  // Called once per frame after the game has moved the player group.
  function update(dt, player, THREE) {
    if (!S.ready) return;
    const c = player.cast;
    if (!player.alive) play('death', 0.1);
    else if (c) {
      // one clip per spell family; scale playback so the release lines up with the game's own cast timing
      const name = c.id === 'blood' ? 'channel' : c.id === 'meteor' && c.t / c.dur < 0.55 ? 'castUp' : 'cast';
      play(name, 0.08, name === 'channel' ? 1 : S.actions[name].getClip().duration / Math.max(0.15, c.dur));
      if (S.lastCast !== c) { S.lastCast = c; if (S.cur === S.actions[name]) S.cur.reset().play(); }
    } else if (player.hurtT > 0.15) play('hit', 0.05);
    else if (player.moving) play('run', 0.15, Math.max(0.6, player.speedK || 1));
    else if (!S.cur || S.cur === S.actions.run || !S.cur.isRunning()) play('idle', 0.2);
    S.mixer.update(dt);
    // hat on the head bone, staff in the right hand: copy bone world positions into the player group's space
    const P = S.P; tmp.v = tmp.v || new THREE.Vector3();
    P.g.updateMatrixWorld(true);
    const head = S.bones.Head, hand = S.bones.hand_r;
    if (head) { head.getWorldPosition(tmp.v); P.g.worldToLocal(tmp.v); P.hatGroup.position.set(tmp.v.x, tmp.v.y - 1.56 + 0.1, tmp.v.z); }
    if (hand) { hand.getWorldPosition(tmp.v); P.g.worldToLocal(tmp.v); P.staffGroup.position.copy(tmp.v); }
  }

  window.EGChar = { attach, update, state: S };
})();
