// KUBO KARTS - Voxel character builder + procedural pose animation.
// Chunky-box construction (true voxel look), part pivots for expressive animation.
import * as THREE from 'three';
import type { CharDef } from '../data/characters';

export interface CharModel {
  group: THREE.Group;
  parts: {
    hips: THREE.Group; torso: THREE.Group; head: THREE.Group;
    armL: THREE.Group; armR: THREE.Group; legL: THREE.Group; legR: THREE.Group;
    eyes: THREE.Mesh; mouth: THREE.Mesh; hat: THREE.Group;
  };
}

const box = (w: number, h: number, d: number, color: string, emissive = 0): THREE.Mesh => {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color: new THREE.Color(color), emissive: new THREE.Color(color).multiplyScalar(emissive) })
  );
  return m;
};

function buildHat(def: CharDef): THREE.Group {
  const g = new THREE.Group();
  const { hat, hatColor, skin, eyes } = def.look;
  const acc = def.look.accent;
  switch (hat) {
    case 'cap': {
      const dome = box(0.46, 0.16, 0.46, hatColor); dome.position.y = 0.21; g.add(dome);
      const brim = box(0.44, 0.05, 0.24, hatColor); brim.position.set(0, 0.15, 0.3); g.add(brim);
      const btn = box(0.08, 0.06, 0.08, acc); btn.position.y = 0.31; g.add(btn);
      break;
    }
    case 'goggles': {
      const band = box(0.48, 0.1, 0.48, '#37474f'); band.position.y = 0.2; g.add(band);
      for (const sx of [-1, 1]) { const lens = box(0.16, 0.12, 0.08, '#8fe3ff', 0.25); lens.position.set(sx * 0.11, 0.2, 0.24); g.add(lens); }
      const strap = box(0.5, 0.06, 0.06, hatColor); strap.position.set(0, 0.2, -0.24); g.add(strap);
      break;
    }
    case 'leaf': {
      const stem = box(0.06, 0.14, 0.06, '#5d4037'); stem.position.y = 0.26; g.add(stem);
      const leaf1 = box(0.2, 0.05, 0.12, hatColor); leaf1.position.set(0.1, 0.34, 0); leaf1.rotation.z = 0.3; g.add(leaf1);
      const leaf2 = box(0.2, 0.05, 0.12, hatColor); leaf2.position.set(-0.1, 0.33, 0); leaf2.rotation.z = -0.3; g.add(leaf2);
      break;
    }
    case 'flame': {
      for (let i = 0; i < 5; i++) {
        const h = 0.14 + Math.random() * 0.16;
        const f = box(0.12, h, 0.12, i % 2 ? '#ff6d00' : '#ffca28', 0.7);
        f.position.set((Math.random() - 0.5) * 0.3, 0.24 + h / 2, (Math.random() - 0.5) * 0.3);
        g.add(f);
      }
      break;
    }
    case 'crownHelm': {
      const helm = box(0.46, 0.2, 0.46, hatColor); helm.position.y = 0.22; g.add(helm);
      for (let i = 0; i < 4; i++) { const spike = box(0.08, 0.12, 0.08, hatColor); spike.position.set(-0.15 + i * 0.1, 0.36, 0); g.add(spike); }
      const rim = box(0.5, 0.05, 0.5, acc); rim.position.y = 0.13; g.add(rim);
      break;
    }
    case 'headphones': {
      const band = box(0.5, 0.06, 0.06, hatColor); band.position.y = 0.3; band.rotation.z = 0; g.add(band);
      for (const sx of [-1, 1]) { const cup = box(0.1, 0.16, 0.16, hatColor); cup.position.set(sx * 0.25, 0.18, 0); g.add(cup); const pad = box(0.04, 0.12, 0.12, acc); pad.position.set(sx * 0.22, 0.18, 0); g.add(pad); }
      break;
    }
    case 'magnet': {
      for (const sx of [-1, 1]) {
        const leg = box(0.09, 0.2, 0.09, hatColor); leg.position.set(sx * 0.13, 0.32, 0); g.add(leg);
        const tip = box(0.11, 0.07, 0.11, '#f2f2f2'); tip.position.set(sx * 0.13, 0.44, 0); g.add(tip);
      }
      const bridge = box(0.35, 0.08, 0.09, hatColor); bridge.position.y = 0.24; g.add(bridge);
      break;
    }
    case 'visor': {
      const crown = box(0.46, 0.14, 0.46, hatColor); crown.position.y = 0.24; g.add(crown);
      const vis = box(0.4, 0.09, 0.1, '#00e5ff', 0.8); vis.position.set(0, 0.17, 0.22); g.add(vis);
      break;
    }
    case 'starHood': {
      const hood = box(0.48, 0.24, 0.48, hatColor); hood.position.y = 0.22; g.add(hood);
      const star = box(0.1, 0.1, 0.05, acc, 0.6); star.position.set(0, 0.3, 0.24); star.rotation.z = Math.PI / 4; g.add(star);
      const trail = box(0.06, 0.3, 0.06, acc, 0.4); trail.position.set(0, 0.4, -0.2); trail.rotation.x = 0.5; g.add(trail);
      break;
    }
    case 'shadowHood': {
      const hood = box(0.5, 0.3, 0.5, hatColor); hood.position.y = 0.22; g.add(hood);
      const shade = box(0.36, 0.16, 0.06, '#000000'); shade.position.set(0, 0.14, 0.23); g.add(shade);
      // glowing eyes come from eyes mesh emissive override below
      break;
    }
  }
  void skin; void eyes;
  return g;
}

export function buildCharacter(def: CharDef): CharModel {
  const group = new THREE.Group();
  const { skin, shirt, pants, accent, eyes: eyeC, height, bulk, emblem } = def.look;
  const glowEyes = def.look.hat === 'shadowHood';

  const hips = new THREE.Group(); hips.position.y = 0.42 * height; group.add(hips);
  const legL = new THREE.Group(); legL.position.set(-0.11 * bulk, 0, 0); hips.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.11 * bulk, 0, 0); hips.add(legR);
  for (const [leg, side] of [[legL, -1], [legR, 1]] as [THREE.Group, number][]) {
    const thigh = box(0.16 * bulk, 0.22, 0.17 * bulk, pants); thigh.position.y = -0.11; leg.add(thigh);
    const shin = new THREE.Group(); shin.position.y = -0.22; leg.add(shin);
    const shinBox = box(0.14 * bulk, 0.2, 0.15 * bulk, pants); shinBox.position.y = -0.1; shin.add(shinBox);
    const shoe = box(0.16 * bulk, 0.09, 0.24, accent); shoe.position.set(0, -0.22, 0.04); shin.add(shoe);
    (leg as unknown as { shin: THREE.Group }).shin = shin;
    void side;
  }

  const torso = new THREE.Group(); torso.position.y = 0.02; hips.add(torso);
  const chest = box(0.48 * bulk, 0.4, 0.26 * bulk, shirt); chest.position.y = 0.2; torso.add(chest);
  const belt = box(0.5 * bulk, 0.07, 0.28 * bulk, pants); belt.position.y = 0.03; torso.add(belt);
  const emb = box(0.12, 0.12, 0.04, emblem, 0.35); emb.position.set(0, 0.24, 0.13 * bulk + 0.02); torso.add(emb);

  const armL = new THREE.Group(); armL.position.set(-0.3 * bulk, 0.36, 0); torso.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.3 * bulk, 0.36, 0); torso.add(armR);
  for (const arm of [armL, armR]) {
    const upper = box(0.13, 0.2, 0.14, shirt); upper.position.y = -0.1; arm.add(upper);
    const fore = box(0.12, 0.18, 0.13, skin); fore.position.y = -0.28; arm.add(fore);
    const glove = box(0.14, 0.09, 0.15, accent); glove.position.y = -0.4; arm.add(glove);
  }

  const head = new THREE.Group(); head.position.y = 0.44; torso.add(head);
  const skull = box(0.42, 0.38, 0.4, skin); skull.position.y = 0.19; head.add(skull);
  const neck = box(0.14, 0.08, 0.14, skin); neck.position.y = -0.02; head.add(neck);
  const eyes = box(0.3, 0.075, 0.03, glowEyes ? '#00e676' : eyeC, glowEyes ? 1.2 : 0);
  eyes.position.set(0, 0.22, 0.21); head.add(eyes);
  // separate pupils for expression (scale trick): use one strip + dark
  const eyeWhite = box(0.31, 0.09, 0.02, glowEyes ? '#00e676' : '#ffffff', glowEyes ? 1.2 : 0);
  eyeWhite.position.set(0, 0.22, 0.205); head.add(eyeWhite);
  const mouth = box(0.1, 0.05, 0.03, glowEyes ? '#00e676' : '#7a3b2e', glowEyes ? 0.8 : 0);
  mouth.position.set(0, 0.1, 0.21); head.add(mouth);
  // ears
  for (const sx of [-1, 1]) { const ear = box(0.05, 0.1, 0.1, skin); ear.position.set(sx * 0.22, 0.2, 0); head.add(ear); }
  const hat = buildHat(def); head.add(hat);

  group.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; } });

  return { group, parts: { hips, torso, head, armL, armR, legL, legR, eyes, mouth, hat } };
}

// ---------- Procedural poses / animation ----------
export type CharAnim = 'idle' | 'drive' | 'drift' | 'boost' | 'win' | 'lose' | 'sit';

export interface PoseTargets {
  torsoRotX: number; torsoRotZ: number; torsoPosY: number;
  headRotX: number; headRotZ: number; headRotY: number;
  armRotX: number; armRotZ: number; armLRotZ: number;
  legRotX: number; shinRotX: number;
  eyesScaleY: number; mouthScaleY: number; mouthScaleX: number;
}

const _t: PoseTargets = {
  torsoRotX: 0, torsoRotZ: 0, torsoPosY: 0, headRotX: 0, headRotZ: 0, headRotY: 0,
  armRotX: 0, armRotZ: 0, armLRotZ: 0, legRotX: 0, shinRotX: 0,
  eyesScaleY: 1, mouthScaleY: 1, mouthScaleX: 1,
};

export function poseAnim(m: CharModel, anim: CharAnim, time: number, lean = 0, intensity = 0) {
  const P = m.parts;
  const t = _t;
  // base reset
  t.torsoRotX = 0; t.torsoRotZ = 0; t.torsoPosY = 0;
  t.headRotX = 0; t.headRotZ = 0; t.headRotY = 0;
  t.armRotX = 0; t.armRotZ = 0; t.armLRotZ = 0;
  t.legRotX = 0; t.shinRotX = 0;
  t.eyesScaleY = 1; t.mouthScaleY = 1; t.mouthScaleX = 1;

  switch (anim) {
    case 'idle': {
      const b = Math.sin(time * 2.2) * 0.03;
      t.torsoPosY = b; t.headRotZ = Math.sin(time * 1.7) * 0.06;
      t.armRotZ = 0.1 + Math.sin(time * 2.2) * 0.05; t.armLRotZ = -t.armRotZ;
      break;
    }
    case 'sit': case 'drive': {
      t.legRotX = -1.35; t.shinRotX = 1.3;
      t.armRotX = -1.15; t.armLRotZ = 0.15; t.armRotZ = -0.15;
      t.torsoRotX = 0.12;
      if (anim === 'drive') {
        t.torsoRotZ = lean * 0.35; t.headRotZ = -lean * 0.3;
        t.headRotX = -0.08 - intensity * 0.1;
        const bounce = Math.sin(time * 14) * 0.02 * intensity;
        t.torsoPosY = bounce;
      }
      break;
    }
    case 'drift': {
      t.legRotX = -1.35; t.shinRotX = 1.3;
      t.armRotX = -1.3; t.armRotZ = -0.35 - lean * 0.3; t.armLRotZ = 0.35 + lean * 0.3;
      t.torsoRotZ = lean * 0.5; t.headRotZ = -lean * 0.4;
      t.eyesScaleY = 0.55; // focused
      t.mouthScaleX = 1.5;
      break;
    }
    case 'boost': {
      t.legRotX = -1.4; t.shinRotX = 1.4;
      t.armRotX = -0.4; t.armRotZ = -0.9; t.armLRotZ = 0.9;
      t.torsoRotX = -0.15; t.headRotX = 0.2;
      t.mouthScaleY = 1.6; t.mouthScaleX = 1.3;
      break;
    }
    case 'win': {
      const jump = Math.abs(Math.sin(time * 5)) * 0.3;
      t.torsoPosY = jump;
      t.armRotX = -2.6 + Math.sin(time * 10) * 0.3; t.armRotZ = -0.5; t.armLRotZ = 0.5;
      t.headRotX = -0.2;
      t.mouthScaleY = 2; t.mouthScaleX = 1.4;
      break;
    }
    case 'lose': {
      t.torsoRotX = 0.45; t.headRotX = 0.5;
      t.armRotX = 0.3; t.armRotZ = -0.1; t.armLRotZ = 0.1;
      t.eyesScaleY = 0.3;
      t.mouthScaleY = 0.6; t.mouthScaleX = 1.6;
      break;
    }
  }
  // apply with snap (caller may lerp)
  P.torso.rotation.x = t.torsoRotX; P.torso.rotation.z = t.torsoRotZ;
  P.torso.position.y = 0.02 + t.torsoPosY;
  P.head.rotation.x = t.headRotX; P.head.rotation.z = t.headRotZ; P.head.rotation.y = t.headRotY;
  P.armR.rotation.x = t.armRotX; P.armR.rotation.z = t.armRotZ;
  P.armL.rotation.x = t.armRotX; P.armL.rotation.z = t.armLRotZ;
  P.legL.rotation.x = t.legRotX; P.legR.rotation.x = t.legRotX;
  const shinL = (P.legL as unknown as { shin: THREE.Group }).shin;
  const shinR = (P.legR as unknown as { shin: THREE.Group }).shin;
  if (shinL) shinL.rotation.x = t.shinRotX;
  if (shinR) shinR.rotation.x = t.shinRotX;
  P.eyes.scale.y = t.eyesScaleY;
  P.mouth.scale.y = t.mouthScaleY; P.mouth.scale.x = t.mouthScaleX;
}
