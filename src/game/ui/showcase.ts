// KUBO KARTS - Showcase scene: 3D menu/garage backdrop with rotating podium,
// live car & character preview. Shares the main WebGLRenderer.
import * as THREE from 'three';
import { buildCar, type CarModel } from '../vox/car';
import { buildCharacter, poseAnim, type CharModel } from '../vox/char';
import { makeSkyMaterial, makeVoxelMaterial, G } from '../gfx/materials';
import { themeById } from '../world/themes';
import { getDecoGeo, decoMaterial } from '../world/deco';
import { carById, type CarDef } from '../data/cars';
import { charById, type CharDef } from '../data/characters';
import type { CarCustom } from '../core/save';
import { clamp } from '../core/utils';

export class Showcase {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  group = new THREE.Group();       // rotates with drag
  private carModel: CarModel | null = null;
  private charModel: CharModel | null = null;
  private carHolder = new THREE.Group();
  private charHolder = new THREE.Group();
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private baseThemeId = 'grass';
  private time = 0;
  autoSpin = 0.25;
  private userAngle = 0;
  private dragging = false;
  private lastX = 0;
  private camTarget = new THREE.Vector3(0, 1.0, 0);
  private camDist = 8.6;
  private camHeight = 3.4;
  private focus: 'car' | 'char' | 'both' = 'both';
  private charAnim: 'idle' | 'win' | 'lose' = 'idle';
  // FULL-SCREEN MENU PREVIEW BAND (user: "garage/characters menu must be
  // complete & full-screen"): the menu UI now fills the screen and the 3D
  // subject is shifted into a dedicated transparent band via view offset,
  // so nothing is hidden behind cards anymore.
  private band: { top: number; height: number } | null = null;
  private bgGroup = new THREE.Group();
  private podiumGroup: THREE.Group | null = null;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 400);
    this.scene.add(this.group);
    this.group.add(this.carHolder);
    this.group.add(this.charHolder);
    this.scene.add(this.bgGroup);
  }

  setDragCallbacks(el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => { this.dragging = true; this.lastX = e.clientX; });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      this.lastX = e.clientX;
      this.userAngle += dx * 0.012;
    });
    window.addEventListener('pointerup', () => { this.dragging = false; });
  }

  setTheme(themeId: string) {
    this.baseThemeId = themeId;
    this.rebuildBackdrop();
  }

  setCar(carId: string, custom?: CarCustom) {
    const def: CarDef = carById(carId);
    if (this.carModel) {
      this.carHolder.remove(this.carModel.group);
    }
    this.carModel = buildCar(def, custom, false);
    this.carHolder.add(this.carModel.group);
    this.carHolder.position.set(0, 0.72, 0.4);
    this.carHolder.rotation.y = -Math.PI / 2 - 0.4;
    this.carHolder.scale.setScalar(1.15);
  }

  setChar(charId: string) {
    const def: CharDef = charById(charId);
    if (this.charModel) this.charHolder.remove(this.charModel.group);
    this.charModel = buildCharacter(def);
    this.charHolder.add(this.charModel.group);
    // v3 (user: "اون آدمه که همراه ماشین می‌چرخه… مکانش به انتخاب خودت"):
    // the driver now stands at the car's front corner like a showroom host
    // and performs a looping routine (see menuPose) instead of standing stiff.
    this.charHolder.position.copy(Showcase.HOST_POS);
    this.charHolder.rotation.y = -2.6;
    this.charHolder.scale.setScalar(1.35);
    this.menuT = 0;
  }

  /** host spot on the turntable: front-right corner of the car */
  static HOST_POS = new THREE.Vector3(1.55, 0.72, 2.05);
  private menuT = 0;
  private pose = { tx: 0, ty: 0, hy: 0, hx: 0, hz: 0, rX: 0, rZ: 0, lX: 0, lZ: 0, gL: 0, gR: 0, lift: 0, mouth: 1 };

  /** v3 MENU ROUTINE — 4 acts that blend smoothly into each other:
   *  wave at the camera → lean back arms-crossed → turn & point at the car →
   *  fist-pump hop. Runs only in the main-menu view (focus 'both'). */
  private menuPose(m: CharModel, dt: number) {
    this.menuT += dt;
    const T = this.menuT;
    const ACT = 3.6;
    const act = Math.floor(T / ACT) % 4;
    const at = T % ACT;
    const P = this.pose;
    const tg = { tx: 0, ty: 0, hy: 0, hx: 0, hz: 0, rX: 0, rZ: -0.08, lX: 0, lZ: 0.08, gL: 0, gR: 0, lift: 0, mouth: 1 };
    const breathe = Math.sin(T * 2.2) * 0.02;
    if (act === 0) {            // WAVE
      tg.rX = -2.75; tg.rZ = -0.25 + Math.sin(at * 10) * 0.38;
      tg.hz = 0.12; tg.hx = -0.08; tg.mouth = 1.8; tg.lZ = 0.14;
      tg.gL = 0.12; tg.gR = -0.05;
    } else if (act === 1) {     // LEAN, ARMS CROSSED
      tg.rX = -1.25; tg.rZ = 0.95; tg.lX = -1.15; tg.lZ = -0.95;
      tg.tx = -0.1; tg.hx = Math.sin(at * 2.4) * 0.12 - 0.05; tg.hz = -0.08;
      tg.gL = 0.18; tg.gR = -0.18; tg.mouth = 0.9;
    } else if (act === 2) {     // TURN & POINT AT THE CAR
      const look = at < ACT * 0.6 ? 1 : 0;
      tg.ty = 0.75; tg.rX = -1.55; tg.rZ = -0.05; tg.lZ = 0.12;
      tg.hy = look ? 0.35 : -0.45; tg.hx = -0.05; tg.mouth = 1.4;
      tg.gL = -0.1; tg.gR = 0.12;
    } else {                    // FIST-PUMP HOP
      const hop = Math.abs(Math.sin(at * 5.2));
      tg.lift = hop * 0.22;
      tg.rX = -2.6 + Math.sin(at * 10.4) * 0.45; tg.rZ = -0.3;
      tg.lX = -0.5; tg.lZ = 0.35;
      tg.gL = -hop * 0.5; tg.gR = -hop * 0.5;
      tg.hx = -0.18; tg.mouth = 2;
    }
    const k = Math.min(1, dt * 7);
    for (const key of Object.keys(P) as (keyof typeof P)[]) P[key] += (tg[key] - P[key]) * k;
    const pt = m.parts;
    pt.torso.rotation.set(P.tx, P.ty, 0);
    pt.torso.position.y = 0.02 + breathe;
    pt.head.rotation.set(P.hx, P.hy, P.hz);
    pt.armR.rotation.set(P.rX, 0, P.rZ);
    pt.armL.rotation.set(P.lX, 0, P.lZ);
    pt.legL.rotation.x = P.gL; pt.legR.rotation.x = P.gR;
    const shinL = (pt.legL as unknown as { shin: THREE.Group }).shin;
    const shinR = (pt.legR as unknown as { shin: THREE.Group }).shin;
    if (shinL) shinL.rotation.x = Math.max(0, -P.gL) * 1.2;
    if (shinR) shinR.rotation.x = Math.max(0, -P.gR) * 1.2;
    m.group.position.y = P.lift;
    pt.eyes.scale.y = (T % 4.1) < 0.12 ? 0.15 : 1;   // blink
    pt.mouth.scale.set(1, P.mouth, 1);
    // body always turns to face the camera (host presenting the car) — works
    // at any turntable angle, blended so it never snaps
    const camYaw = Math.atan2(this.camera.position.x - 0, this.camera.position.z - 0);
    const want = camYaw - this.group.rotation.y - 0.15;
    let d = want - this.charHolder.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.charHolder.rotation.y += d * Math.min(1, dt * 4);
    m.group.rotation.y = 0;
  }

  private resetMenuPose(m: CharModel) {
    m.parts.torso.rotation.y = 0;
    m.group.position.y = 0;
  }

  setFocus(f: 'car' | 'char' | 'both') {
    this.focus = f;
    if (f === 'car') {
      // clean beauty shot aimed AT THE CAR ITSELF (aiming at y=1.5 left the
      // car below screen center, which broke the preview band alignment)
      this.camDist = 8.4; this.camHeight = 2.15; this.camTarget.set(0, 0.82, 0.2);
      this.carHolder.scale.setScalar(1.05);
      this.carHolder.position.y = 0.0;
      if (this.podiumGroup) this.podiumGroup.visible = false;
      this.charHolder.visible = false; this.carHolder.visible = true;
    }
    else if (f === 'char') {
      this.camDist = 9.6; this.camHeight = 2.5; this.camTarget.set(1.7, 0.9, -0.9);
      this.charHolder.position.set(1.7, 0.72, -0.9);
      this.charHolder.rotation.y = -2.6;
      if (this.charModel) this.resetMenuPose(this.charModel);
      this.charHolder.scale.setScalar(1.1);   // fits the preview band
      this.carHolder.position.y = 0.72;
      if (this.podiumGroup) this.podiumGroup.visible = true;
      this.charHolder.visible = true; this.carHolder.visible = false;
    }
    else {
      this.camDist = 8.6; this.camHeight = 3.4; this.camTarget.set(0, 1.0, 0);
      this.carHolder.position.y = 0.72;
      this.charHolder.scale.setScalar(1.25);  // host scale next to the car
      this.charHolder.position.copy(Showcase.HOST_POS);
      if (this.podiumGroup) this.podiumGroup.visible = true;
      this.charHolder.visible = true; this.carHolder.visible = true;
    }
  }

  setCharAnim(a: 'idle' | 'win' | 'lose') { this.charAnim = a; }

  /** shift the projection so the focused subject lands inside a screen band
   *  [top..top+height] (fractions). Pass null to reset (centered). */
  setBand(top: number | null, height = 0.3) {
    this.band = top === null ? null : { top, height };
    if (!this.band) this.camera.clearViewOffset();
  }

  private applyBand() {
    if (!this.band) { if (this.camera.view?.enabled) this.camera.clearViewOffset(); return; }
    const w = this.renderer?.domElement.width || window.innerWidth;
    const h = this.renderer?.domElement.height || window.innerHeight;
    // subject currently sits at screen center (0.5); move it to band center.
    // setViewOffset y>0 renders a region LOWER in the virtual image → the
    // subject appears HIGHER on screen.
    const bandCenter = this.band.top + this.band.height / 2;
    const dy = (0.5 - bandCenter) * h;
    this.camera.setViewOffset(w, h, 0, dy, w, h);
  }

  private rebuildBackdrop() {
    // clear
    this.bgGroup.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    const theme = themeById(this.baseThemeId);
    void G.time;
    // sky
    const skyGeo = new THREE.SphereGeometry(180, 16, 10);
    const skyMat = makeSkyMaterial(theme.sky.top, theme.sky.bottom, theme.sky.horizon, !!theme.night);
    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.bgGroup.add(sky);
    this.disposables.push(skyGeo, skyMat);
    // lights
    const hemi = new THREE.HemisphereLight(new THREE.Color(theme.sky.hemiSky), new THREE.Color(theme.sky.hemiGround), 0.95);
    const sun = new THREE.DirectionalLight(new THREE.Color(theme.sky.sun), 1.25);
    sun.position.set(6, 10, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -8; sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8; sun.shadow.camera.bottom = -8;
    const amb = new THREE.AmbientLight(0xffffff, theme.night ? 0.35 : 0.15);
    this.bgGroup.add(hemi, sun, amb);
    this.disposables.push(hemi as unknown as THREE.Material, sun as unknown as THREE.Material, amb as unknown as THREE.Material);
    // podium: voxel cylinder blocks
    const podium = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.ground.accent) });
    this.disposables.push(mat);
    const R = 5;
    const rings = 3;
    for (let ring = 0; ring < rings; ring++) {
      const r = R - ring * 0.9;
      const n = Math.max(10, Math.round(r * 4));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + ring * 0.2;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), ring === 0 ? new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.road.base) }) : mat);
        box.position.set(x, -0.25 - ring * 0.5, z);
        box.receiveShadow = true;
        box.castShadow = true;
        podium.add(box);
      }
    }
    // top disc blocks (checker ring accent)
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.7), new THREE.MeshLambertMaterial({ color: i % 2 ? 0xf2f2f2 : theme.road.curbA }));
      box.position.set(Math.cos(a) * 4.6, 0.11, Math.sin(a) * 4.6);
      podium.add(box);
    }
    this.bgGroup.add(podium);
    this.podiumGroup = podium;
    // decorations: sparse ring behind the podium, small scale for clean composition
    const SAFE_TYPES = ['treeRound', 'treePine', 'bush', 'rock', 'flower', 'cactus', 'snowman', 'iceCrystal', 'glowMushroom', 'lamppost'];
    const decoTypes = theme.decos.map(d => d.type).filter(t2 => SAFE_TYPES.includes(t2)).slice(0, 4);
    if (decoTypes.length < 2) decoTypes.push('treeRound', 'bush');
    decoTypes.forEach((type, i) => {
      const geo = getDecoGeo(type).geometry;
      if (!geo || !geo.attributes.position?.count) return;
      for (let k = 0; k < 3; k++) {
        const a = (i / decoTypes.length) * Math.PI * 2 + k * 2.3 + 0.7;
        const dist = 15 + (k % 2) * 7;
        const m = new THREE.InstancedMesh(geo, decoMaterial, 1);
        const d = new THREE.Object3D();
        d.position.set(Math.cos(a) * dist, -2.0, Math.sin(a) * dist);
        d.scale.setScalar(1.0 + (k % 3) * 0.35);
        d.updateMatrix();
        m.setMatrixAt(0, d.matrix);
        m.instanceMatrix.needsUpdate = true;
        this.bgGroup.add(m);
      }
    });
    // ground
    const groundGeo = new THREE.CircleGeometry(60, 24);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.ground.base) });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.y = -2.2;
    ground.receiveShadow = true;
    this.bgGroup.add(ground);
    this.disposables.push(groundGeo, groundMat);
    // fog
    this.scene.fog = new THREE.Fog(new THREE.Color(theme.fog.color), 26, 120);
    this.renderer?.setClearColor?.(new THREE.Color(theme.fog.color));
  }

  renderer: THREE.WebGLRenderer | null = null;

  update(dt: number) {
    this.time += dt;
    if (!this.dragging) this.userAngle += dt * this.autoSpin;
    this.group.rotation.y = this.userAngle;
    // camera: gentle side drift, fixed clean angle
    const targetPos = new THREE.Vector3(
      this.camDist * 0.62 + Math.sin(this.time * 0.12) * 0.9,
      this.camHeight,
      this.camDist * 0.92
    );
    this.camera.position.lerp(targetPos, Math.min(1, dt * 2));
    this.camera.lookAt(this.camTarget);
    // idle char anim
    if (this.charModel) {
      if (this.focus === 'both' && this.charAnim === 'idle') {
        this.menuPose(this.charModel, dt);
      } else {
        poseAnim(this.charModel, this.charAnim === 'idle' ? 'idle' : this.charAnim, this.time);
        if (this.charAnim === 'idle') {
          this.charModel.group.rotation.y = Math.sin(this.time * 0.5) * 0.2 - 0.4;
        }
      }
    }
    // car slight bounce
    if (this.carModel) {
      this.carModel.group.position.y = Math.sin(this.time * 1.2) * 0.03;
      for (let i = 0; i < this.carModel.wheels.length; i++) {
        this.carModel.wheels[i].rotation.x -= dt * 0.4;
      }
    }
  }

  render(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.applyBand();
    renderer.render(this.scene, this.camera);
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  getDragRotation() { return this.userAngle; }
  clampCam() { clamp(0, 0, 1); }
}
