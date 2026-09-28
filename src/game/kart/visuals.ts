// KUBO KARTS - Kart visual rig: syncs 3D model to physics state.
// Wheel spin/steer, suspension, body lean, drift smoke, boost flames, brake lights,
// frozen ice block, shield bubble, giant scale, character animation.
import * as THREE from 'three';
import { Kart } from './kart';
import { CarModel, buildCar } from '../vox/car';
import { CharModel, buildCharacter, poseAnim, CharAnim } from '../vox/char';
import { charById } from '../data/characters';
import type { CarCustom } from '../core/save';
import { Particles, Debris } from '../gfx/particles';
import { makeShieldBubbleMaterial } from '../gfx/materials';
import { clamp, damp, TAU } from '../core/utils';

// v3.4 shared voxel "scar" blocks (charred metal, cracks, bare steel)
const SCAR_GEO = new THREE.BoxGeometry(1, 1, 1);
const SCAR_MATS = ['#1f1f22', '#3b3530', '#55504a', '#7c828a'].map(c => new THREE.MeshLambertMaterial({ color: c }));

export class KartVisual {
  kart: Kart;
  car: CarModel;
  char: CharModel;
  root: THREE.Group;
  private smokeT = 0;
  private sparkT = 0;
  private giantDustT = 0;
  private lean = 0;
  private suspension = 0;
  private animName: CharAnim = 'sit';
  private animTime = 0;
  private iceBox: THREE.Mesh | null = null;
  private iceGlow: THREE.Mesh | null = null;    // v1.13 inner cold glow of the ice shell
  private shieldMesh: THREE.Mesh | null = null;   // 🛡️ energy dome (shader)
  private shieldRing: THREE.Mesh | null = null;   // equatorial energy ring
  private shieldBeads: THREE.Group | null = null; // orbiting energy nodes
  // 🧲 MAGNET AURA (v1.13, user: "خط‌های بنفش + هاله بنفش که به سمت ماشین
  // کشیده میشه") — rotating halo rings + converging energy lines
  private magnetGroup: THREE.Group | null = null;
  private magnetLines: { line: THREE.Line; ang: number; mat: THREE.LineBasicMaterial }[] = [];
  private magnetRings: THREE.Mesh[] = [];
  private magnetHorse: THREE.Group | null = null;
  private magnetVortex: THREE.Mesh | null = null;
  private magnetArcs: { line: THREE.Line; mat: THREE.LineBasicMaterial; i: number }[] = [];
  private empCage: THREE.Group | null = null;
  private empLoops: THREE.Line[] = [];
  private empJitT = 0;
  private ghostMats: { m: THREE.Material; o: number; t: boolean }[] = [];
  /** per-kart material clones (disposed with the race) */
  ownedMats: THREE.Material[] = [];
  private ghostAmt = 0;          // smoothed 0..1 ghost translucency
  private ghostApplied = false;  // whether body materials are currently ghosted
  private charBaseY = 0;
  private glowLight: THREE.PointLight | null = null;
  private wheelBaseY: number[] = [];
  private prevSpeed = 0;
  private night = false;
  private tmpV = new THREE.Vector3();
  private lastRootPos = new THREE.Vector3();   // teleport guard for interpolation
  /** FIRST-PERSON MODE (v1.8 settings): the local player's own body is hidden
   *  so the head-cam doesn't stare at the inside of a windshield. IMPORTANT:
   *  only the MESHES hide — lights (headlight spot / underglow / boost) stay
   *  alive so night first-person still lights the road. */
  hideBody = false;
  private roadPitch = 0;
  private bodyMeshes: THREE.Mesh[] = [];
  // v3.4 DAMAGE LOOK (user: "انیمیشن صدمه دیدن بهتر، خرابی ماشین‌ها رو نشون
  // بده، کمی مثل ماینکرفت"): Minecraft-style red hurt flash, a body jolt,
  // voxel chunks flying off, charred/cracked blocks stuck on the body that
  // pile up as hearts drop, and hood smoke -> black smoke + embers when low.
  private lastHp = -1;
  private hurtFlash = 0;
  private jolt = 0;
  private joltDir = 1;
  private dmgGroup = new THREE.Group();
  private dmgBox = new THREE.Box3();
  private dmgSmokeT = 0;
  private flashMats: { m: THREE.Material & { color: THREE.Color }; base: THREE.Color }[] = [];
  quality: 'low' | 'medium' | 'high' | 'ultra' = 'high';

  constructor(kart: Kart, custom: CarCustom | undefined, glowLight: boolean) {
    this.kart = kart;
    this.car = buildCar(kart.def, custom, glowLight);
    this.char = buildCharacter(kart.charDef ? charById(kart.charDef.id) : charById('bolt'));
    this.root = new THREE.Group();
    this.root.add(this.car.group);
    this.root.add(this.char.group);
    // seat the character INSIDE the cabin (visible through the glass) and scale
    // them to this specific car — user request: "character designed per car size"
    const charScale = this.car.charScale;
    this.char.group.scale.setScalar(charScale);
    this.char.group.position.set(0, this.car.seatY - 0.26 * charScale, this.car.seatZ + 0.05);
    this.char.group.rotation.y = 0;
    poseAnim(this.char, 'sit', 0);
    this.root.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; this.bodyMeshes.push(o); } });
    // BUGFIX (v1.11): the FP hideBody path restores `bodyMeshes.visible=true`
    // every frame — that restore ALSO re-enabled the headlight BEAM cones in
    // broad daylight (they are meshes under the root). FX meshes (beams,
    // shield tint, ghost shell, ice cube, flames) manage their own visibility
    // and must never be force-restored here.
    const fxForeign = new Set<THREE.Object3D>([
      ...this.car.headlightGlows,
      this.car.ghostShell ?? null, this.shieldMesh, this.shieldRing, this.shieldBeads, this.iceBox,
      ...this.car.flames,
    ].filter(Boolean) as THREE.Object3D[]);
    this.bodyMeshes = this.bodyMeshes.filter(m => !fxForeign.has(m));
    for (const wg of this.car.wheelGroups) this.wheelBaseY.push(wg.position.y);
    this.charBaseY = this.char.group.position.y;
    // 👻 GHOST MATERIAL REGISTRY (v1.12): every material on the car + driver —
    // when the ghost is live they ALL go translucent (the car itself becomes
    // the ghost), restored when the power ends.
    // v3.1 BUGFIX (user: "وقتی برای اولین بار مسابقه میدی و تمومش میکنی بعد
    // ماشین شفافیتش میاد پایین"): the car/driver materials are MODULE-LEVEL
    // singletons shared by EVERY car in the game (race karts + the menu
    // showcase). The ghost fade wrote opacity straight into those shared
    // materials, so (a) one ghosted bot made every kart translucent and
    // (b) a race that ended while anyone was ghosted left the shared
    // materials see-through forever: the garage car came back transparent.
    // Fix: every kart ghosts its OWN private clones; shared materials are
    // never touched. Materials owned by the model (lens/underglow/shell refs)
    // are per-car already and stay as they are.
    {
      const owned = new Set<THREE.Material>();
      const collect = (obj: object) => {
        for (const v of Object.values(obj)) {
          if (v instanceof THREE.Material) owned.add(v);
          else if (Array.isArray(v)) for (const x of v) if (x instanceof THREE.Material) owned.add(x);
        }
      };
      collect(this.car); collect(this.char);
      const clones = new Map<THREE.Material, THREE.Material>();
      const priv = (m: THREE.Material): THREE.Material => {
        if (owned.has(m)) return m;
        let c = clones.get(m);
        if (!c) {
          c = m.clone();
          // onBeforeCompile (car-paint shader) is NOT copied by clone()
          c.onBeforeCompile = m.onBeforeCompile;
          c.customProgramCacheKey = m.customProgramCacheKey;
          // baseline from the pristine defaults, never from a live fade
          if (m.userData.__baseOpacity === undefined) { m.userData.__baseOpacity = m.opacity; m.userData.__baseTransparent = m.transparent; }
          c.opacity = m.userData.__baseOpacity as number;
          c.transparent = m.userData.__baseTransparent as boolean;
          clones.set(m, c);
          this.ownedMats.push(c);
        }
        return c;
      };
      const seen = new Set<THREE.Material>();
      this.root.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
        if (fxForeign.has(mesh)) return;
        const mat = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mesh.material = mat.map(m => (m ? priv(m) : m));
        else if (mat) mesh.material = priv(mat);
        const mm = mesh.material as THREE.Material | THREE.Material[];
        for (const m of Array.isArray(mm) ? mm : [mm]) {
          if (!m || seen.has(m) || !('opacity' in m)) continue;
          seen.add(m);
          this.ghostMats.push({ m, o: m.opacity, t: m.transparent });
        }
      });
    }
    // v3.4 damage rig: hurt-flash targets (private clones only) + body bounds
    const liveMats = new Set<THREE.Material>([...this.car.brakeMats, ...this.car.reverseMats, ...this.car.headlightMats,
      ...(this.car.underglowMat ? [this.car.underglowMat] : []), ...(this.car.ghostShellMat ? [this.car.ghostShellMat] : [])]);
    for (const g of this.ghostMats) {
      const m = g.m as THREE.Material & { color?: THREE.Color };
      if (liveMats.has(m) || m.transparent) continue;   // lights/glass manage themselves
      if (m.color instanceof THREE.Color) this.flashMats.push({ m: m as THREE.Material & { color: THREE.Color }, base: m.color.clone() });
    }
    this.root.updateMatrixWorld(true);
    this.dmgBox.setFromObject(this.car.bodyRoot);
    this.dmgBox.applyMatrix4(this.car.bodyRoot.matrixWorld.clone().invert());
    if (this.dmgBox.isEmpty()) this.dmgBox.set(new THREE.Vector3(-0.7, 0.2, -1.2), new THREE.Vector3(0.7, 1.0, 1.2));
    this.car.bodyRoot.add(this.dmgGroup);
    // 🛡️ ENERGY SHIELD BUBBLE (v1.12, user: "قدرت سپر اون دایره آبی نگه داشته
    // بشه + شیدر و تکسچر خفن"): the classic blue dome is back — fresnel rim,
    // crawling hex lattice, rising waves, equator ring + orbiting energy beads.
    const shieldGeo = new THREE.SphereGeometry(1.95, 36, 22);
    this.shieldMesh = new THREE.Mesh(shieldGeo, makeShieldBubbleMaterial());
    this.shieldMesh.position.y = 0.72;
    this.shieldMesh.scale.set(1.02, 0.86, 1.14);   // hugs the kart silhouette
    this.shieldMesh.renderOrder = 5;
    this.shieldMesh.visible = false;
    this.root.add(this.shieldMesh);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x7cd4ff, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.shieldRing = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.035, 8, 48), ringMat);
    this.shieldRing.position.y = 0.72;
    this.shieldRing.rotation.x = Math.PI / 2;       // lie flat around the car
    this.shieldRing.scale.set(1.02, 1.14, 1);       // match the dome footprint
    this.shieldRing.visible = false;
    this.root.add(this.shieldRing);
    // 6 energy nodes orbiting on the ring — the dome reads ALIVE
    this.shieldBeads = new THREE.Group();
    this.shieldBeads.position.y = 0.72;
    const beadGeo = new THREE.SphereGeometry(0.07, 8, 8);
    const beadMat = new THREE.MeshBasicMaterial({
      color: 0xbfe9ff, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (let i = 0; i < 6; i++) {
      const bead = new THREE.Mesh(beadGeo, beadMat);
      const a = (i / 6) * Math.PI * 2;
      bead.position.set(Math.cos(a) * 2.0, 0, Math.sin(a) * 2.0);
      this.shieldBeads.add(bead);
    }
    this.shieldBeads.visible = false;
    this.root.add(this.shieldBeads);
    // v1.13 ICE SHELL (user: "یه ماشین کامل یخ میزنه و نمیتونه حرکت کنه و شبیه
    // یه مجسمه یخی گرد و نرم باشه نه مربعی"): the old BoxGeometry cube is GONE.
    // The car is sealed inside an ORGANIC rounded ice sculpture — a noise-
    // displaced sphere hugged to the kart silhouette + an inner cold glow.
    {
      const geo = new THREE.SphereGeometry(1.5, 24, 18);
      // organic lumps: displace every vertex with a smooth pseudo-noise so the
      // shell reads as hand-carved ice, not a math-perfect ball
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const n = Math.sin(v.x * 2.1 + 1.7) * Math.cos(v.y * 1.9 - 0.6) * Math.sin(v.z * 2.3 + 3.1);
        v.multiplyScalar(1 + n * 0.055);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      const mat = new THREE.MeshPhongMaterial({
        color: 0xbfe9ff, transparent: true, opacity: 0.5,
        emissive: 0x14405e, shininess: 130, specular: 0x9fe0ff,
      });
      this.iceBox = new THREE.Mesh(geo, mat);
      this.iceBox.scale.set(1.16, 1.02, 1.52);   // hugs the kart silhouette
      this.iceBox.position.y = 0.95;
      this.iceBox.visible = false;
      this.iceBox.renderOrder = 4;
      this.root.add(this.iceBox);
      const glowGeo = new THREE.SphereGeometry(1.32, 18, 12);
      const glowMat = new THREE.MeshBasicMaterial({ color: 0x66d9ff, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false });
      this.iceGlow = new THREE.Mesh(glowGeo, glowMat);
      this.iceGlow.scale.copy(this.iceBox.scale);
      this.iceGlow.position.y = 0.95;
      this.iceGlow.visible = false;
      this.root.add(this.iceGlow);
    }
    // 🧲 MAGNET AURA (v1.13): two purple halo rings + 10 energy lines that
    // constantly get PULLED from the air into the car while the magnet is live
    {
      const g = new THREE.Group();
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
      const ring1 = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.045, 8, 42), ringMat);
      ring1.rotation.x = Math.PI / 2;
      ring1.position.y = 0.32;
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.035, 8, 36), ringMat);
      ring2.rotation.x = Math.PI / 2 - 0.5;
      ring2.position.y = 0.75;
      g.add(ring1, ring2);
      this.magnetRings.push(ring1, ring2);
      for (let i = 0; i < 10; i++) {
        const lm = new THREE.LineBasicMaterial({ color: i % 2 ? 0x7fd4ff : 0xff7a7a, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
        const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const line = new THREE.Line(lg, lm);
        g.add(line);
        this.magnetLines.push({ line, ang: (i / 10) * Math.PI * 2, mat: lm });
      }
      // v3.1 (user: "قدرت آهنربا رو بهتر کن و انیمیشن خفن‌تر"): a chunky
      // 3D HORSESHOE MAGNET hovers above the car (red body, steel poles),
      // bobbing and swinging, with blue/red field arcs looping between its
      // poles + a spinning spiral vortex on the ground under the car.
      {
        const hs = new THREE.Group();
        const red = new THREE.MeshPhongMaterial({ color: 0xe8342c, emissive: 0x5a0a06, shininess: 70, specular: 0xffb0a0 });
        const steel = new THREE.MeshPhongMaterial({ color: 0xe6ebf2, emissive: 0x30343a, shininess: 110, specular: 0xffffff });
        const arch = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.15, 10, 22, Math.PI), red);
        arch.position.y = 0.25;
        const legGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.36, 12);
        const legL = new THREE.Mesh(legGeo, red); legL.position.set(-0.42, 0.07, 0);
        const legR = new THREE.Mesh(legGeo, red); legR.position.set(0.42, 0.07, 0);
        const tipGeo = new THREE.CylinderGeometry(0.155, 0.155, 0.2, 12);
        const tipL = new THREE.Mesh(tipGeo, steel); tipL.position.set(-0.42, -0.2, 0);
        const tipR = new THREE.Mesh(tipGeo, steel); tipR.position.set(0.42, -0.2, 0);
        hs.add(arch, legL, legR, tipL, tipR);
        // field arcs: half-ellipses below the poles, pulsing outward
        for (let i = 0; i < 3; i++) {
          const pts: THREE.Vector3[] = [];
          for (let j = 0; j <= 20; j++) {
            const a = Math.PI + (j / 20) * Math.PI;
            pts.push(new THREE.Vector3(Math.cos(a) * 0.42, -0.3 + Math.sin(a) * (0.25 + i * 0.18), 0));
          }
          const lm = new THREE.LineBasicMaterial({ color: i % 2 ? 0xff6b6b : 0x7fd4ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
          const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lm);
          hs.add(ln);
          this.magnetArcs.push({ line: ln, mat: lm, i });
        }
        hs.position.y = 2.35;
        hs.scale.setScalar(1.15);
        // v3.3: horseshoe above the car removed (user request)
        void hs;
        this.magnetHorse = null;
        // ground vortex
        const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
        const c = cv.getContext('2d')!;
        c.translate(S / 2, S / 2);
        for (let arm = 0; arm < 3; arm++) {
          c.beginPath();
          for (let j = 0; j <= 40; j++) {
            const u = j / 40, a = arm * (Math.PI * 2 / 3) + u * Math.PI * 1.8, r = 6 + u * (S * 0.46 - 6);
            if (j === 0) c.moveTo(Math.cos(a) * r, Math.sin(a) * r); else c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          c.strokeStyle = arm === 1 ? 'rgba(127,212,255,0.9)' : 'rgba(255,90,90,0.9)'; c.lineWidth = 5; c.lineCap = 'round'; c.stroke();
        }
        const vt = new THREE.CanvasTexture(cv);
        const vm = new THREE.MeshBasicMaterial({ map: vt, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
        const vortex = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 5.2), vm);
        vortex.rotation.x = -Math.PI / 2;
        vortex.position.y = 0.08;
        g.add(vortex);
        this.magnetVortex = vortex;
      }
      g.visible = false;
      this.magnetGroup = g;
      this.root.add(g);
    }
    // 💥 EMP ELECTRIC CAGE (v3.1): 3 jagged violet loops that crackle around a
    // stalled car (re-jittered ~20×/s) so a dead engine READS instantly
    {
      const cg = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const pts = Array.from({ length: 25 }, () => new THREE.Vector3());
        const lm = new THREE.LineBasicMaterial({ color: i === 0 ? 0xffffff : 0xc77dff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
        const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lm);
        cg.add(ln);
        this.empLoops.push(ln);
      }
      cg.visible = false;
      this.empCage = cg;
      this.root.add(cg);
    }
  }

  /** NIGHT MODE (user: "اگه شب هست چراغ‌های جلوی ماشین روشن بشه"): lenses glow,
   *  additive beams appear, taillights become dim running lights; the LOCAL
   *  player additionally gets a real SpotLight lighting the road ahead.
   *  UNDERGLOW (user: "نور زیر ماشین نباید داخل روز باشه — فقط شب"): the neon
   *  under-glow now also belongs to night only — day keeps it fully off.
   *  v1.12: the map's night flag and the user's HEADLIGHT TOGGLE are separate
   *  states — applyLights() combines them (toggle only kills the HEADLIGHTS;
   *  the underglow stays automatic). */
  setNight(on: boolean) {
    this.mapNight = on;
    this.applyLights();
  }

  /** v1.12 HEADLIGHT TOGGLE (user: "دکمه خاموش/روشن برای چراغ جلوی ماشین") */
  setLightsOn(on: boolean) {
    this.lightsOn = on;
    this.applyLights();
  }

  toggleLights(): boolean {
    this.setLightsOn(!this.lightsOn);
    return this.lightsOn;
  }

  private mapNight = false;
  private lightsOn = true;
  /** v3.8 PERF: which REAL lights this kart may own. Adding a light to the
   *  scene mid-race forces three.js to recompile EVERY material (a 0.5–2 s
   *  freeze on phones — the first tunnel or the first night lap). The race
   *  now decides up-front and calls prepareLights() during loading. */
  private allowSpot = false;
  private allowGlow = false;
  prepareLights(spot: boolean, glow: boolean) {
    const car = this.car;
    this.allowSpot = spot;
    this.allowGlow = glow && !!car.underglowMat && !!car.underglow;
    if (this.allowSpot && car.headlightSpot === null) {
      const sp = new THREE.SpotLight(0xffeec2, 0, 32, 0.62, 0.5, 1.4);
      sp.position.set(0, 0.5, 1.6);
      sp.target.position.set(0, -0.4, 14);
      car.group.add(sp, sp.target);
      car.headlightSpot = sp;
    }
    if (this.allowGlow && !this.glowLight && car.underglowMat) {
      this.glowLight = new THREE.PointLight(car.underglowMat.color, 0, 8.5, 1.6);
      this.glowLight.position.set(0, 0.35, 0);
      car.group.add(this.glowLight);
    }
  }

  private applyLights() {
    const on = this.mapNight && this.lightsOn;
    this.night = this.mapNight;   // brake-light running lamps + underglow follow the MAP's night, not the toggle
    const car = this.car;
    for (const g of car.headlightGlows) g.visible = on;
    if (on) {
      for (const lm of car.headlightMats) { lm.emissive.setHex(0xfff2b8); lm.emissiveIntensity = 1.6; }
      for (const bm of car.brakeMats) if (bm.emissive.getHex() === 0) { bm.emissive.setHex(0x551512); bm.emissiveIntensity = 0.6; }
      // real light only for the player (perf: 1 spotlight total on mobile).
      // §6: low beam must clearly LIGHT THE ROAD — stronger throw + wider reach.
      // v3.8: never CREATE a light here (see prepareLights)
      if (car.headlightSpot) car.headlightSpot.intensity = 85;
    } else {
      for (const lm of car.headlightMats) { lm.emissive.setHex(0x000000); lm.emissiveIntensity = 0; }
      if (car.headlightSpot) car.headlightSpot.intensity = 0;
    }
    // underglow: day = OFF (plane hidden), night = breathing neon + a REAL
    // colored light on the ground (user: "چراغ زیر ماشین داخل شب کار نمیکنه" —
    // the glow must actually LIGHT the ground around the car, not just be a
    // decal). Light only for the local player (perf: 1 point light on mobile).
    if (car.underglowMat) {
      car.underglowMat.opacity = on ? 0.8 : 0;
      if (car.underglow) car.underglow.visible = on;
      if (this.glowLight) {
        this.glowLight.color.copy(car.underglowMat.color);
        this.glowLight.intensity = on ? 2.6 : 0;
      }
    }
  }

  /** v1.12: are the headlights currently lit? (HUD toggle reflects this) */
  get lightsActive(): boolean { return this.mapNight && this.lightsOn; }

  /** per render frame. alpha = fraction between the last two fixed physics
   *  steps (from the game loop) — used to interpolate the kart's visual
   *  position/heading so motion is BUTTER-SMOOTH on 120Hz displays instead of
   *  stepping twice per frame (user v1.9: "ماشین حالت گیلیچی داره، نرم باشه و
   *  هیچ دیلی نداشته باشه"). */
  render(dt: number, particles: Particles | null, debris: Debris | null, time: number, alpha = 1) {
    const k = this.kart;
    // --- render interpolation (with teleport/respawn snap guard) ---
    let ix: number, iy: number, iz: number, ih: number;
    if (alpha >= 1 || k.prevPos.distanceToSquared(k.pos) > 900) {
      ix = k.pos.x; iy = k.pos.y; iz = k.pos.z; ih = k.heading;
    } else {
      ix = k.prevPos.x + (k.pos.x - k.prevPos.x) * alpha;
      iy = k.prevPos.y + (k.pos.y - k.prevPos.y) * alpha;
      iz = k.prevPos.z + (k.pos.z - k.prevPos.z) * alpha;
      let dh = k.heading - k.prevHeading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      ih = k.prevHeading + dh * alpha;
    }
    this.tmpV.set(ix, iy, iz);
    this.root.position.copy(this.tmpV);
    this.lastRootPos.copy(this.tmpV);
    // visual heading (smoothed spin for spin-out)
    const spinExtra = k.spunT > 0 ? k.spinAnim : 0;
    this.root.rotation.y = ih + spinExtra;
    // v2.1: the whole car + driver pitch WITH the road on climbs / descents
    // (Mega Ramp descents used to look like the kart slid down flat)
    this.root.rotation.order = 'YXZ';
    const wantPitch = -Math.atan((k as unknown as { roadSlope?: number }).roadSlope ?? 0);
    this.roadPitch = damp(this.roadPitch, k.grounded ? wantPitch : this.roadPitch * 0.98, 8, dt);
    this.root.rotation.x = this.roadPitch;
    // visibility: hidden mid fall-respawn, blinks during post-respawn invul.
    // FP: meshes hide individually so REAL LIGHTS keep illuminating the road.
    if (this.hideBody) {
      this.root.visible = true;
      for (const m of this.bodyMeshes) m.visible = false;
    } else {
      for (const m of this.bodyMeshes) m.visible = true;
      const fallHidden = k.respawnCooldown > 0.3 && k.invulT > 1.4 && k.fx === 'fall';
      this.root.visible = fallHidden ? false
        : k.invulT > 0 ? (Math.floor(time * 14) % 2 === 0 || k.invulT < 0.4) : true;
    }

    // body lean into turns / drift (SOFT RIDE pass — user: "تکون‌ها کمتر و
    // واقعی‌تر، ماشین نرم روان حرکت کنه": every visual oscillation is damped
    // and capped so the car glides instead of twitching)
    const speedFrac = clamp(Math.abs(k.speed) / k.T.maxSpeed, 0, 1);
    const targetLean = k.drifting ? k.driftDir * 0.2 : -clamp(k.slide * 0.035, -0.14, 0.14);
    this.lean = damp(this.lean, targetLean, 6, dt);
    // v1.20 SUSPENSION: body pitch/roll/heave come from the physics spring-
    // damper (brake → nose dive, throttle → squat, corners → roll, landing →
    // compression + rebound). Drift lean is layered on top.
    const S = k.susp;
    this.car.bodyRoot.rotation.z = this.lean * 0.6 + (S ? S.roll : 0);
    this.car.bodyRoot.rotation.x = S ? S.pitch : (k.grounded ? clamp((this.prevSpeed - k.speed) * 0.004, -0.03, 0.038) : -0.045);
    this.prevSpeed = k.speed;
    this.updateDamage(dt, particles, debris);

    // suspension: gentle engine rumble (anti-vibration pass — the old 40Hz
    // sin + heavy damping sampled at render rate made the whole car shudder)
    const vib = (k.boostT > 0 ? 0.006 : 0.0018) * speedFrac;
    this.suspension = damp(this.suspension, Math.sin(time * 15) * vib, 9, dt);
    // 👻 GHOST SQUAT (v1.12, user: "حالتش میاد پایین"): the car crouches on its
    // suspension while phased out — spectral + low. (The shield no longer
    // squats: it's a bubble AROUND the car again.)
    const squat = -0.055 * this.ghostAmt;
    const heave = S ? S.heave : 0;
    this.car.bodyRoot.position.y = 0.02 + this.suspension + heave + (k.hopT > 0 ? 0.05 : 0) + squat;

    // wheels
    const spinSpeed = k.speed / 0.28;
    for (let i = 0; i < this.car.wheels.length; i++) {
      this.car.wheels[i].rotation.x -= spinSpeed * dt;
      const isFront = (this.car.wheelGroups[i] as unknown as { isFront: boolean }).isFront;
      if (isFront) {
        const steerAng = k.drifting ? k.driftDir * 0.38 : -k.slide * 0.016;
        this.car.wheelGroups[i].rotation.y = damp(this.car.wheelGroups[i].rotation.y, steerAng, 10, dt);
      }
      // suspension per-wheel (softer: only follow the smoothed body motion)
      // per-wheel travel: wheels stay planted while the body moves over them
      // (front wheels feel the pitch, left/right feel the roll); droop in air
      const base = this.wheelBaseY[i];
      const wg = this.car.wheelGroups[i];
      const side = wg.position.x >= 0 ? 1 : -1;
      const travel = S ? clamp(-S.heave * 0.6 + (isFront ? -S.pitch : S.pitch) * 0.5 + side * S.roll * 0.35, -0.06, 0.06) : 0;
      wg.position.y = base + (k.grounded ? this.suspension * (i < 2 ? 1.0 : 0.7) + travel : -0.05);
    }

    // exhaust flames (boost)
    const flameOn = k.boostT > 0;
    for (const f of this.car.flames) {
      f.visible = flameOn;
      if (flameOn) {
        f.rotation.z += dt * 20;
        f.scale.setScalar(0.8 + Math.random() * 0.5);
      }
    }
    if (this.car.boostFx) {
      this.car.boostFx.intensity = flameOn ? 2.2 : 0;
    }

    // BRAKE LIGHTS (user: "وقتی ترمز میکنم چراغ‌های عقب ماشین روشن بشه"): any
    // brake press while moving lights them — including mid-drift and reversing.
    // At night they idle as dim running lights (real-car look).
    const braking = (k as unknown as { _braking?: boolean })._braking === true;
    for (const bm of this.car.brakeMats) {
      if (braking) {
        bm.emissive.setHex(0xff2412);
        bm.emissiveIntensity = 2.4;
      } else if (this.night) {
        bm.emissive.setHex(0x551512);
        bm.emissiveIntensity = 0.6;
      } else {
        bm.emissive.setHex(0x330a06);
        bm.emissiveIntensity = 0.4;
      }
    }

    // UNDERGLOW pulse (user custom feature): NIGHT ONLY ("فقط شب باید باشه").
    // In daylight the plane is hidden entirely (visible=false + opacity 0 —
    // double guarantee it can never bleed through in daytime); at night it
    // breathes with speed, in the color the user picked in the garage, and the
    // POINT LIGHT under the local player's car actually illuminates the road.
    // v1.9: brighter floor (“کامل دیده بشه”) — every car now has a glow (the
    // default color applies when none was picked).
    if (this.car.underglowMat) {
      if (this.car.underglow) this.car.underglow.visible = this.night;
      this.car.underglowMat.opacity = this.night
        ? 0.92 + Math.sin(time * 3.1) * 0.1 + speedFrac * 0.14
        : 0;
      if (this.glowLight) {
        this.glowLight.intensity = this.night
          ? 3.3 + Math.sin(time * 3.1) * 0.6 + speedFrac * 1.2
          : 0;
      }
    }

    // 👻 GHOST PHASE (v1.12 REWORK, user: "وقتی قدرت روح میگیره به جای سپر
    // سفید، خود ماشین شفاف بشه، کمی سفید و پایین — مثل روح"): NO shell around
    // the car — the CAR ITSELF phases: every body material (car + driver)
    // turns translucent with a gentle spectral flicker, a faint whitish shell
    // adds the ghost tint, and the body crouches low. Restored on expiry.
    {
      const ghostOn = k.ghostT > 0;
      this.ghostAmt = damp(this.ghostAmt, ghostOn ? 1 : 0, 9, dt);
      const ga = this.ghostAmt;
      if (ga > 0.004) {
        this.ghostApplied = true;
        const fade = ghostOn ? Math.min(1, k.ghostT / 0.6) : 1; // fade back IN over the last 0.6s
        const flicker = 0.94 + 0.06 * Math.sin(time * 11.0);     // spectral wobble
        const op = (1 - 0.62 * ga * fade) * flicker;
        for (const gm of this.ghostMats) {
          gm.m.transparent = true;
          gm.m.opacity = gm.o * op;
        }
      } else if (this.ghostApplied) {
        this.ghostApplied = false;
        for (const gm of this.ghostMats) {
          gm.m.opacity = gm.o;
          gm.m.transparent = gm.t;
        }
      }
      // whitish spectral tint over the translucent body
      if (this.car.ghostShell && this.car.ghostShellMat) {
        const show = ga > 0.01;
        this.car.ghostShell.visible = show;
        if (show) {
          const fade = ghostOn ? Math.min(1, k.ghostT / 0.6) : 1;
          this.car.ghostShellMat.opacity = (0.20 + Math.sin(time * 6.5) * 0.045) * ga * fade;
        }
      }
      // driver sinks with the cabin
      this.char.group.position.y = this.charBaseY - 0.055 * ga;
    }

    // REVERSE LIGHTS (§8: "وقتی عقب میاد چراغ ماشین روشن بشه"): bright white
    // lenses automatically while the kart moves backwards — like a real car —
    // and off the moment forward motion resumes. Works for every kart.
    const reversing = k.speed < -0.5;
    for (const rm of this.car.reverseMats) {
      rm.emissive.setHex(reversing ? 0xeaf6ff : 0x000000);
      rm.emissiveIntensity = reversing ? 2.1 : 0;
    }

    // 🛡️ SHIELD BUBBLE (v1.12, user: "اون دایره آبی نگه داشته بشه + شیدر و
    // تکسچر خفن و پرجزئیات"): shader dome (fresnel rim + hex lattice + waves),
    // equator ring, and 6 orbiting energy beads. Fades in fast, out over the
    // last 0.6s of the power.
    if (this.shieldMesh && this.shieldRing && this.shieldBeads) {
      const on = k.shieldT > 0;
      this.shieldMesh.visible = on;
      this.shieldRing.visible = on;
      this.shieldBeads.visible = on;
      if (on) {
        const fade = Math.min(1, k.shieldT / 0.6);
        const uni = (this.shieldMesh.material as THREE.ShaderMaterial).uniforms;
        uni.uOpacity.value = fade;
        (this.shieldRing.material as THREE.MeshBasicMaterial).opacity = 0.5 * fade;
        // beads orbit + bob; ring breathes gently
        this.shieldBeads.rotation.y += dt * 2.1;
        for (let i = 0; i < this.shieldBeads.children.length; i++) {
          const bead = this.shieldBeads.children[i];
          bead.position.y = Math.sin(time * 3.0 + i * 1.05) * 0.16;
        }
        const ringPulse = 1 + Math.sin(time * 4.2) * 0.018;
        this.shieldRing.scale.set(1.02 * ringPulse, 1.14 * ringPulse, 1);
      }
    }
    // ❄️ ICE STATUE (v1.13 organic shell) + 🧲 MAGNET AURA + 💥 STALL SPARKS
    {
      const frozen = k.frozenT > 0;
      if (this.iceBox) {
        this.iceBox.visible = frozen;
        if (frozen) {
          const fade = Math.min(1, k.frozenT / 0.5);
          (this.iceBox.material as THREE.MeshPhongMaterial).opacity = 0.46 * fade;
          // statue shimmer: slow icy wobble + glinting rotation
          this.iceBox.rotation.y += dt * 0.35;
          this.iceBox.rotation.z = Math.sin(time * 2.2) * 0.02;
        }
      }
      if (this.iceGlow) {
        this.iceGlow.visible = frozen;
        if (frozen) {
          (this.iceGlow.material as THREE.MeshBasicMaterial).opacity = (0.12 + Math.sin(time * 5.5) * 0.05) * Math.min(1, k.frozenT / 0.5);
        }
      }
      // magnet: rings spin, energy lines PULLED from the air into the car
      if (this.magnetGroup) {
        const on = k.magnetT > 0;
        this.magnetGroup.visible = on;
        if (on) {
          const fade = Math.min(1, k.magnetT / 0.6);
          const pull = (performance.now() / 1000);
          this.magnetRings[0].rotation.z += dt * 1.6;
          this.magnetRings[1].rotation.z -= dt * 2.2;
          for (const r of this.magnetRings) {
            const m = r.material as THREE.MeshBasicMaterial;
            m.opacity = (0.4 + Math.sin(time * 4.5) * 0.18) * fade;
          }
          for (const ml of this.magnetLines) {
            // outer end orbits slowly; inner end breathes toward the chassis —
            // the whole line visually STREAMS inward (the pull)
            const outerR = 3.1 + Math.sin(pull * 1.3 + ml.ang * 3) * 0.5;
            const innerR = 0.85 + ((pull * 2.2 + ml.ang) % 1) * 0.9;   // sliding toward the car
            const ox = Math.cos(ml.ang + pull * 0.8) * outerR;
            const oz = Math.sin(ml.ang + pull * 0.8) * outerR;
            const ix = Math.cos(ml.ang + pull * 0.8) * innerR;
            const iz = Math.sin(ml.ang + pull * 0.8) * innerR;
            const y1 = 0.5 + Math.sin(pull * 2 + ml.ang * 2) * 0.45;
            const pa = ml.line.geometry.attributes.position as THREE.BufferAttribute;
            pa.setXYZ(0, ox, y1 + 0.5, oz);
            pa.setXYZ(1, ix, 0.45, iz);
            pa.needsUpdate = true;
            ml.mat.opacity = (0.35 + 0.45 * (1 - innerR / 1.75)) * fade;
          }
          if (this.magnetHorse) {
            const h = this.magnetHorse;
            const pop = Math.min(1, (9 - k.magnetT) / 0.35);          // drops in with a bounce
            const bounce = pop < 1 ? Math.sin(pop * Math.PI) * 0.35 : 0;
            h.position.y = 2.35 + Math.sin(time * 3.2) * 0.12 + bounce;
            h.rotation.y = Math.sin(time * 1.4) * 0.6;
            h.rotation.z = Math.sin(time * 2.3) * 0.12;
            h.scale.setScalar(1.15 * Math.min(1, pop * 1.2) * (fade < 1 ? fade : 1));
            for (const a of this.magnetArcs) {
              const ph = (time * 1.8 + a.i * 0.33) % 1;
              a.line.scale.set(1, 0.7 + ph * 0.9, 1);
              a.mat.opacity = (1 - ph) * 0.9 * fade;
            }
          }
          if (this.magnetVortex) {
            this.magnetVortex.rotation.z -= dt * 3.5;
            (this.magnetVortex.material as THREE.MeshBasicMaterial).opacity = (0.45 + Math.sin(time * 5) * 0.12) * fade;
          }
        }
      }
      // 💥 EMP cage
      if (this.empCage) {
        const on = k.stallT > 0;
        this.empCage.visible = on;
        if (on) {
          this.empJitT -= dt;
          if (this.empJitT <= 0) {
            this.empJitT = 0.05;
            for (let li = 0; li < this.empLoops.length; li++) {
              const ln = this.empLoops[li];
              const pa = ln.geometry.attributes.position as THREE.BufferAttribute;
              const y0 = 0.35 + li * 0.38, tilt = (li - 1) * 0.35;
              for (let j = 0; j < pa.count; j++) {
                const a = (j / (pa.count - 1)) * Math.PI * 2;
                const r = 1.25 + (Math.random() - 0.5) * 0.35;
                pa.setXYZ(j, Math.cos(a) * r, y0 + Math.sin(a) * tilt + (Math.random() - 0.5) * 0.22, Math.sin(a) * r * 1.3);
              }
              pa.needsUpdate = true;
              (ln.material as THREE.LineBasicMaterial).opacity = 0.55 + Math.random() * 0.45;
            }
          }
        }
      }
      // 💥 EMP STALL: the dead engine crackles purple while it is powered down
      if (k.stallT > 0 && particles && this.quality !== 'low' && Math.random() < dt * 14) {
        particles.spawn({
          count: 2, pos: k.pos.clone().add(new THREE.Vector3(0, 0.9, 0)), spread: 0.35,
          vel: new THREE.Vector3((Math.random() - 0.5) * 2, 1.2, (Math.random() - 0.5) * 2),
          life: 0.3, size: 0.2, sizeEnd: 0.03,
          color: Math.random() < 0.5 ? '#c77dff' : '#e6c8ff', alpha: 1, gravity: 4,
        });
      }
    }

    // giant mode scale
    const targetScale = k.giantT > 0 ? 1.6 : 1;
    const s = damp(this.root.scale.x, targetScale, 6, dt);
    this.root.scale.setScalar(s);

    // character animation
    this.animTime += dt;
    let anim: CharAnim = 'sit';
    if (k.finished) anim = 'win';
    else if (k.spunT > 0 || k.frozenT > 0) anim = 'lose';
    else if (k.boostT > 0) anim = 'boost';
    else if (k.drifting) anim = 'drift';
    else if (speedFrac > 0.05) anim = 'drive';
    if (anim !== this.animName) { this.animName = anim; }
    poseAnim(this.char, anim, this.animTime, this.lean * 2.2, speedFrac);

    // --- particles ---
    if (particles && this.quality !== 'low') {
      // GIANT mode: dust kicks at every stomp stride (better item fx pass)
      if (k.giantT > 0 && k.grounded && speedFrac > 0.35) {
        this.giantDustT -= dt;
        if (this.giantDustT <= 0) {
          this.giantDustT = 0.09;
          for (const wp of [this.wheelWorldPos(2), this.wheelWorldPos(3)]) {
            particles.spawn({
              count: 3, pos: wp, spread: 0.4,
              vel: new THREE.Vector3((Math.random() - 0.5) * 2, 1.5 + Math.random(), (Math.random() - 0.5) * 2),
              velSpread: 1.5, life: 0.45, size: 0.5, sizeEnd: 1.2,
              color: '#9ccf74', colorEnd: '#c8e6b0', alpha: 0.5, gravity: 2, drag: 1.2,
            });
          }
        }
      }
      // drift smoke at rear wheels
      if ((k.drifting && k.grounded && speedFrac > 0.4) || (!k.surfaceRoad && speedFrac > 0.5 && k.grounded)) {
        this.smokeT -= dt;
        if (this.smokeT <= 0) {
          this.smokeT = 0.03;
          const rearL = this.wheelWorldPos(2), rearR = this.wheelWorldPos(3);
          const smokeC = k.driftTier === 2 ? '#ffb74d' : k.driftTier === 1 ? '#8fe3ff' : (!k.surfaceRoad ? '#c2a05e' : '#e8e8e8');
          for (const wp of [rearL, rearR]) {
            particles.spawn({
              count: 2, pos: wp, spread: 0.25,
              vel: new THREE.Vector3((Math.random() - 0.5) * 2, 1.2 + Math.random(), (Math.random() - 0.5) * 2),
              velSpread: 1.2, life: 0.5, size: 0.5, sizeEnd: 1.1,
              color: smokeC, colorEnd: smokeC, alpha: 0.55, gravity: -1.2, drag: 1.5,
            });
          }
        }
        // charge sparks
        if (k.driftTier > 0) {
          this.sparkT -= dt;
          if (this.sparkT <= 0) {
            this.sparkT = 0.06;
            for (const wp of [this.wheelWorldPos(2), this.wheelWorldPos(3)]) {
              particles.spawn({
                count: 2, pos: wp, spread: 0.2,
                vel: new THREE.Vector3((Math.random() - 0.5) * 3, 0.5 + Math.random() * 2, (Math.random() - 0.5) * 3),
                life: 0.3, size: 0.16, sizeEnd: 0.03,
                color: k.driftTier === 2 ? '#ff9a3d' : '#5ad0ff', alpha: 1, gravity: 6,
              });
            }
          }
        }
      }
      // boost trail
      if (k.boostT > 0) {
        particles.spawn({
          count: 3, pos: this.wheelWorldPos(-1).add(new THREE.Vector3(0, 0.35, 0)), spread: 0.3,
          vel: new THREE.Vector3(0, 0.5, 0), velSpread: 1.5,
          life: 0.35, size: 0.4, sizeEnd: 0.05,
          color: '#ffd54f', alpha: 0.8, gravity: 0,
        });
      }
      // landing dust
      if (k.fx === 'land' && debris) {
        particles.spawn({
          count: 8, pos: k.pos.clone(), spread: 0.8,
          vel: new THREE.Vector3(0, 1, 0), velSpread: 3,
          life: 0.4, size: 0.4, sizeEnd: 0.9, color: '#cfc8b8', alpha: 0.5, gravity: 3,
        });
      }
    }
  }

  /** v3.4 Minecraft-style damage: flash, jolt, voxel chunks, scars, smoke */
  private updateDamage(dt: number, particles: Particles | null, debris: Debris | null) {
    const k = this.kart;
    if (this.lastHp < 0) this.lastHp = k.hp;
    if (k.hp < this.lastHp) {
      const lost = this.lastHp - k.hp;
      this.hurtFlash = 0.32;
      this.jolt = Math.min(1, 0.45 + lost * 0.2);
      this.joltDir = (k.id + Math.floor(k.trackPos)) % 2 ? 1 : -1;
      const c = this.root.position.clone(); c.y += 0.8;
      if (debris) {
        debris.burst(c, 4 + lost * 4, k.def.bodyColor, 5 + lost * 1.5, 0.2);
        debris.burst(c, 2 + lost * 2, '#3a3f45', 5, 0.16);
        if (k.hp <= 0) {                                   // WRECKED: the car bursts into blocks
          debris.burst(c, 22, k.def.bodyColor, 9, 0.26);
          debris.burst(c, 10, '#2a2a2a', 8, 0.2);
          debris.burst(c, 6, k.def.accentColor, 7, 0.18);
        }
      }
      if (particles) particles.spawn({ count: 6 + lost * 3, pos: c, spread: 0.5, vel: new THREE.Vector3(0, 2, 0), velSpread: 5,
        life: 0.3, size: 0.16, sizeEnd: 0.03, color: '#ffe08a', alpha: 1, gravity: 9 });
      for (let i = 0; i < lost * 2; i++) this.addScar();
    } else if (k.hp > this.lastHp) {
      // healed / repaired: scars fall off (full heal = brand new car)
      const keep = k.hp >= k.maxHp ? 0 : Math.round(this.dmgGroup.children.length * (1 - (k.hp - this.lastHp) / Math.max(1, k.maxHp - this.lastHp)));
      while (this.dmgGroup.children.length > keep) this.dmgGroup.remove(this.dmgGroup.children[this.dmgGroup.children.length - 1]);
    }
    this.lastHp = k.hp;
    this.dmgGroup.visible = !this.hideBody;
    // red hurt flash (Minecraft): tint every private body material red
    if (this.hurtFlash > 0 || this.flashMats.length && this.flashMats[0].m.color.r !== this.flashMats[0].base.r) {
      this.hurtFlash = Math.max(0, this.hurtFlash - dt);
      const f = this.hurtFlash > 0 ? (Math.floor(this.hurtFlash * 22) % 2 === 0 ? 1 : 0.55) * Math.min(1, this.hurtFlash / 0.12) : 0;
      for (const fm of this.flashMats) {
        fm.m.color.setRGB(fm.base.r + (1 - fm.base.r) * f * 0.6, fm.base.g * (1 - f * 0.65), fm.base.b * (1 - f * 0.65));
      }
    }
    // body jolt: a quick decaying wobble on the chassis
    if (this.jolt > 0.001) {
      this.jolt = Math.max(0, this.jolt - dt * 2.6);
      const w = Math.sin(this.jolt * 38) * this.jolt;
      this.car.bodyRoot.rotation.z += w * 0.16 * this.joltDir;
      this.car.bodyRoot.rotation.x += w * 0.06;
    }
    // persistent damage smoke from the hood
    const ratio = k.maxHp > 0 ? k.hp / k.maxHp : 1;
    if (particles && ratio <= 0.5 && !this.hideBody && this.root.visible && k.breakdownT <= 0) {
      this.dmgSmokeT -= dt;
      if (this.dmgSmokeT <= 0) {
        const bad = ratio <= 0.34;
        this.dmgSmokeT = bad ? 0.06 : 0.14;
        const hood = new THREE.Vector3(0, this.dmgBox.max.y - 0.05, this.dmgBox.max.z * 0.55);
        this.car.bodyRoot.localToWorld(hood);
        particles.spawn({ count: 1, pos: hood, spread: 0.15, vel: new THREE.Vector3(0, 1.4, 0), velSpread: 0.5,
          life: bad ? 0.9 : 0.7, size: bad ? 0.32 : 0.24, sizeEnd: bad ? 1.0 : 0.7,
          color: bad ? '#26282b' : '#8a8f96', alpha: bad ? 0.6 : 0.45, gravity: -1.3 });
        if (bad && Math.random() < 0.35) {
          particles.spawn({ count: 1, pos: hood, spread: 0.1, vel: new THREE.Vector3(0, 1.8, 0), velSpread: 1.2,
            life: 0.35, size: 0.14, sizeEnd: 0.02, color: Math.random() < 0.5 ? '#ff7a1a' : '#ffc23d', alpha: 1, gravity: -0.5 });
        }
      }
    }
  }

  /** stick one charred / cracked voxel block on the body surface */
  private addScar() {
    if (this.dmgGroup.children.length >= 16) return;
    const b = this.dmgBox;
    const r = Math.random();
    const sz = 0.1 + Math.random() * 0.1;
    const m = new THREE.Mesh(SCAR_GEO, SCAR_MATS[Math.floor(Math.random() * SCAR_MATS.length)]);
    const lx = b.min.x + (b.max.x - b.min.x) * (0.15 + Math.random() * 0.7);
    const lz = b.min.z + (b.max.z - b.min.z) * (0.1 + Math.random() * 0.8);
    const ly = b.min.y + (b.max.y - b.min.y) * (0.35 + Math.random() * 0.5);
    if (r < 0.4) m.position.set(lx, b.max.y - sz * 0.25, lz);                          // roof / hood
    else if (r < 0.8) m.position.set(Math.random() < 0.5 ? b.min.x + sz * 0.25 : b.max.x - sz * 0.25, ly, lz);  // doors
    else m.position.set(lx, ly, Math.random() < 0.5 ? b.min.z + sz * 0.25 : b.max.z - sz * 0.25);         // bumpers
    m.scale.set(sz * (1 + Math.random()), sz, sz * (1 + Math.random()));
    m.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * 0.6, (Math.random() - 0.5) * 0.3);
    this.dmgGroup.add(m);
  }

  private wheelWorldPos(idx: number): THREE.Vector3 {
    const v = new THREE.Vector3();
    if (idx === -1) { // rear center
      v.set(0, 0.2, -1.1);
    } else {
      const wg = this.car.wheelGroups[idx];
      wg.getWorldPosition(v);
    }
    return v;
  }

  /** interpolated world position for the camera to follow (smooth ride) */
  interpPos(out: THREE.Vector3): THREE.Vector3 { return out.copy(this.lastRootPos); }
}

// wheel index helper used by engine spin sound
export function engineSpin(kart: Kart): number { return kart.engineRatio; }
void TAU;
