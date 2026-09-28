// KUBO KARTS - Weather FX (v1.8 bonus idea: "افکت باران/برف برای مراحل شب"):
// a lightweight GPU points cloud that follows the player — streaky rain for
// night city/jungle skies, drifting flakes for snow themes. Zero textures.
import * as THREE from 'three';

export type WeatherKind = 'none' | 'rain' | 'snow';

export class WeatherFX {
  kind: WeatherKind = 'none';
  private points: THREE.Points | null = null;
  private mat: THREE.PointsMaterial | null = null;
  private geo: THREE.BufferGeometry | null = null;
  private vel: Float32Array | null = null;
  private count = 0;
  private area = 44;          // box around the camera
  private topY = 16;          // spawn height above the player

  /** pick weather automatically from theme + night flag */
  static kindFor(themeId: string, night: boolean): WeatherKind {
    if (themeId === 'snow') return 'snow';
    if (night && (themeId === 'city' || themeId === 'jungle' || themeId === 'ruins')) return 'rain';
    return 'none';
  }

  spawn(scene: THREE.Scene, kind: WeatherKind, density = 1) {
    this.dispose();
    this.kind = kind;
    if (kind === 'none') return;
    const base = kind === 'rain' ? 620 : 420;
    this.count = Math.max(120, Math.round(base * density));
    const pos = new Float32Array(this.count * 3);
    this.vel = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * this.area;
      pos[i * 3 + 1] = Math.random() * this.topY;
      pos[i * 3 + 2] = (Math.random() - 0.5) * this.area;
      this.vel[i] = kind === 'rain' ? 21 + Math.random() * 9 : 1.5 + Math.random() * 1.1;
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.mat = new THREE.PointsMaterial({
      color: kind === 'rain' ? 0x9fc8ee : 0xffffff,
      size: kind === 'rain' ? 0.11 : 0.2,
      transparent: true,
      opacity: kind === 'rain' ? 0.55 : 0.85,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /** per render frame: fall + wrap around the player */
  update(dt: number, playerPos: THREE.Vector3, time: number) {
    if (!this.points || !this.geo || !this.vel) return;
    const attr = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const half = this.area / 2;
    const rain = this.kind === 'rain';
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      arr[j + 1] -= this.vel[i] * dt;
      if (rain) {
        arr[j] += dt * 2.6; // wind slant
      } else {
        // snow: gentle sway
        arr[j] += Math.sin(time * 1.3 + i) * dt * 0.7;
        arr[j + 2] += Math.cos(time * 0.9 + i * 1.7) * dt * 0.6;
      }
      // wrap vertically → respawn on top
      if (arr[j + 1] < -2) {
        arr[j + 1] = this.topY * (0.85 + Math.random() * 0.15);
        arr[j] = (Math.random() - 0.5) * this.area;
        arr[j + 2] = (Math.random() - 0.5) * this.area;
      }
      // keep the cloud box centered on the player
      if (arr[j] - playerPos.x > half) arr[j] -= this.area;
      else if (arr[j] - playerPos.x < -half) arr[j] += this.area;
      if (arr[j + 2] - playerPos.z > half) arr[j + 2] -= this.area;
      else if (arr[j + 2] - playerPos.z < -half) arr[j + 2] += this.area;
    }
    attr.needsUpdate = true;
  }

  dispose() {
    if (this.points && this.points.parent) this.points.parent.remove(this.points);
    this.geo?.dispose();
    this.mat?.dispose();
    this.points = null; this.geo = null; this.mat = null; this.vel = null;
  }
}
