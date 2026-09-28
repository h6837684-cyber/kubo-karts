// KUBO KARTS - Shared materials & custom shaders (water, lava, item box, sky, flames)
import * as THREE from 'three';
import { worldDetailTexture } from './textures';

export const G = {
  time: { value: 0 },
  fogColor: { value: new THREE.Color(0x9ed4f5) },
  fogNear: { value: 60 },
  fogFar: { value: 240 },
  sunDir: { value: new THREE.Vector3(0.5, 1, 0.3).normalize() },
};

export function makeVoxelMaterial(shiny = false): THREE.Material {
  const m = shiny
    ? new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 46, specular: 0x3a3a3a })
    : new THREE.MeshLambertMaterial({ vertexColors: true });
  m.fog = true;
  return m;
}

/**
 * CAR PAINT SHADER (v1.10, user: "میخوام روی ماشین‌ها شیدر بزار و تکسچر بهتری
 * داشته باشن") — the kart BODY material, upgraded from flat Phong to a real
 * automotive-paint look, fully procedural (no UVs needed — voxel cars have
 * none):
 *  - PANEL-SEAM TEXTURE: body-panel lines computed from LOCAL position (a
 *    ~0.45m grid with per-face darkening) — the paint reads as real sheet
 *    metal instead of one solid blob
 *  - MICRO-NOISE TEXTURE: the shared world-detail canvas sampled on the
 *    dominant plane adds fine "orange-peel" paint grain
 *  - FRESNEL RIM: view-angle edge light (that wet-paint sheen at glancing
 *    angles)
 *  - FAKE ENV-MAP REFLECTION: sky/ground gradient sampled along the reflected
 *    ray — the body visibly picks up the sky, like clearcoat
 *  - SUN GLINT: tight Blinn specular that sweeps across panels as you turn
 */
let _paintDetailTex: THREE.Texture | null = null;
export function makeCarPaintMaterial(): THREE.Material {
  if (!_paintDetailTex) _paintDetailTex = worldDetailTexture();
  const m = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 72, specular: 0x555a60 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: _paintDetailTex };
    // same Vector3 object the scenes mutate — stays in sync automatically
    shader.uniforms.uSunDir = { value: G.sunDir.value };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm; varying vec3 vLocal; varying vec3 vViewW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;\nvWPos = (modelMatrix * vec4(position,1.0)).xyz;\nvWNorm = normalize(mat3(modelMatrix) * normal);\nvViewW = normalize(cameraPosition - vWPos);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm; varying vec3 vLocal; varying vec3 vViewW;\nuniform sampler2D uDetail; uniform vec3 uSunDir;')
      .replace('#include <dithering_fragment>', `
        vec3 N = normalize(vWNorm);
        vec3 V = normalize(vViewW);
        // ---- body panel seams (0.45m grid on the dominant local plane) ----
        vec3 lan = abs(vLocal);
        vec2 pp = lan.y > max(lan.x, lan.z) ? vLocal.xz : (lan.x > lan.z ? vLocal.zy : vLocal.xy);
        vec2 pf = fract(pp / 0.45);
        float seam = (pf.x < 0.045 || pf.y < 0.045) ? 0.87 : 1.0;
        // ---- fine paint grain (micro-noise) ----
        vec3 det = texture2D(uDetail, pp * 0.6).rgb;
        vec3 col = gl_FragColor.rgb;
        col *= mix(vec3(1.0), det, 0.14) * seam;
        // ---- fresnel rim + fake env reflection (clearcoat feel) ----
        float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.6);
        vec3 R = reflect(-V, N);
        float up = clamp(R.y * 0.6 + 0.5, 0.0, 1.0);
        vec3 env = mix(vec3(0.14, 0.16, 0.20), vec3(0.82, 0.90, 1.05), up);
        col += env * fres * 0.42;
        // ---- sun glint sweeping over panels ----
        vec3 H = normalize(normalize(uSunDir) + V);
        float glint = pow(max(dot(N, H), 0.0), 70.0);
        col += vec3(1.0, 0.97, 0.9) * glint * 0.55;
        gl_FragColor.rgb = col;
        #include <dithering_fragment>`);
  };
  (m as unknown as { fog: boolean }).fog = true;
  return m;
}

/**
 * Injects a cheap world-space detail pass into a standard material:
 *  - blocky noise texture, triplanar-selected by dominant normal axis (1 fetch)
 *  - 1m voxel "block seam" darkening on the dominant plane
 * Gives terrain/props a textured, tactile Minecraft-like read at zero draw cost.
 */
export function injectWorldDetail(mat: THREE.Material, strength = 0.5, blockSize = 1.0, texScale = 0.55): THREE.Material {
  const tex = worldDetailTexture();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: tex };
    shader.uniforms.uDetailScale = { value: texScale };
    shader.uniforms.uBlockSize = { value: blockSize };
    shader.uniforms.uDetailStrength = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz; vWNorm = normalize(mat3(modelMatrix) * normal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm;\nuniform sampler2D uDetail; uniform float uDetailScale; uniform float uBlockSize; uniform float uDetailStrength;')
      .replace('#include <dithering_fragment>', `
        vec2 duv = abs(vWNorm.y) > 0.5 ? vWPos.xz : (abs(vWNorm.x) > 0.5 ? vWPos.zy : vWPos.xy);
        vec3 det = texture2D(uDetail, duv * uDetailScale).rgb;
        vec2 bp = abs(vWNorm.y) > 0.5 ? vWPos.xz : (abs(vWNorm.x) > 0.5 ? vWPos.zy : vWPos.xy);
        vec2 f = fract(bp / uBlockSize);
        float seam = (f.x < 0.055 || f.y < 0.055) ? 0.86 : 1.0;
        gl_FragColor.rgb *= mix(vec3(1.0), det * seam, uDetailStrength);
        #include <dithering_fragment>`);
  };
  (mat as unknown as { fog: boolean }).fog = true;
  return mat;
}

/** voxel material with world-space detail texture (terrain, props, stone) */
export function makeDetailedVoxelMaterial(strength = 0.5, blockSize = 1.0): THREE.Material {
  return injectWorldDetail(new THREE.MeshLambertMaterial({ vertexColors: true }), strength, blockSize);
}

/** material honoring baked emissiveStrength attribute (Lambert + additive emissive) */
export function makeEmissiveVoxelMaterial(): THREE.Material {
  const base = new THREE.MeshLambertMaterial({ vertexColors: true });
  base.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float emissiveStrength;\nvarying float vEmi;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmi = emissiveStrength;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vEmi;')
      .replace('#include <dithering_fragment>',
        'gl_FragColor.rgb += gl_FragColor.rgb * vEmi * 1.6;\n#include <dithering_fragment>');
  };
  base.fog = true;
  return base;
}

/** Animated water surface (waves + fresnel + sparkle highlights) */
export function makeWaterMaterial(deep: string = '#1565a8', shallow: string = '#59c4e8'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: G.time, fogColor: G.fogColor, fogNear: G.fogNear, fogFar: G.fogFar,
      deep: { value: new THREE.Color(deep) }, shallow: { value: new THREE.Color(shallow) },
    },
    vertexShader: `
      uniform float time;
      varying vec3 vPos; varying vec3 vNorm; varying float vFog;
      uniform float fogNear; uniform float fogFar;
      void main(){
        vec3 p = position;
        p.y += sin(p.x*0.35 + time*1.6)*0.22 + sin(p.z*0.5 + time*2.1)*0.18;
        vPos = p; vNorm = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(p,1.0);
        vFog = smoothstep(fogNear, fogFar, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 deep; uniform vec3 shallow; uniform float time;
      uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;
      varying vec3 vPos; varying vec3 vNorm; varying float vFog;
      void main(){
        float fres = pow(1.0 - abs(vNorm.y), 1.5);
        vec3 c = mix(deep, shallow, clamp(fres*1.4 + 0.25, 0.0, 1.0));
        // moving highlight stripes
        float h = sin(vPos.x*0.9 + time*2.0) * sin(vPos.z*0.7 - time*1.5);
        c += smoothstep(0.86, 1.0, h) * 0.35;
        // sparkle glints (blocky sun glitter)
        vec2 gp = floor(vPos.xz * 1.4);
        float gl = step(0.965, fract(sin(dot(gp, vec2(127.1, 311.7)) + time*0.8) * 43758.5453));
        c += gl * 0.5 * (0.35 + fres);
        c = mix(c, fogColor, vFog);
        gl_FragColor = vec4(c, 0.94);
      }`,
    transparent: true,
  });
}

/** Animated lava */
export function makeLavaMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { time: G.time, fogColor: G.fogColor, fogNear: G.fogNear, fogFar: G.fogFar },
    vertexShader: `
      varying vec3 vPos; varying float vFog;
      uniform float fogNear; uniform float fogFar;
      void main(){
        vPos = position;
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        vFog = smoothstep(fogNear, fogFar, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float time; uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;
      varying vec3 vPos; varying float vFog;
      float n2(vec2 p){ return sin(p.x)*sin(p.y); }
      void main(){
        vec2 p = vPos.xz*0.25;
        float f = n2(p + time*0.4) + n2(p*2.3 - time*0.7)*0.5 + n2(p*5.0 + time)*0.25;
        f = f*0.5+0.5;
        vec3 c = mix(vec3(0.55,0.05,0.0), vec3(1.0,0.42,0.05), f);
        c += smoothstep(0.78,0.95,f) * vec3(1.0,0.8,0.2);
        gl_FragColor = vec4(mix(c*1.35, fogColor, vFog), 1.0);
      }`,
  });
}

/** Canvas texture: glowing "?" decal used on every face of the item box */
let _qTex: THREE.Texture | null = null;
export function makeQuestionTexture(): THREE.Texture {
  // shared singleton: every box material references the same texture
  // (a fresh 256px canvas per box would leak GPU memory across races)
  if (_qTex) return _qTex;
  const s = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, s, s);
  // soft radial glow behind the glyph
  const g = ctx.createRadialGradient(s / 2, s / 2, 20, s / 2, s / 2, s * 0.52);
  g.addColorStop(0, 'rgba(255,240,170,0.85)');
  g.addColorStop(0.55, 'rgba(255,200,80,0.28)');
  g.addColorStop(1, 'rgba(255,180,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  // bold question mark with dark outline (voxel-crisp)
  ctx.font = '900 168px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(120,70,0,0.95)';
  ctx.lineWidth = 26;
  ctx.strokeText('?', s / 2, s / 2 + 8);
  const grad = ctx.createLinearGradient(0, s * 0.18, 0, s * 0.82);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.55, '#ffffff');
  grad.addColorStop(1, '#f1f4ff');
  ctx.fillStyle = grad;
  ctx.fillText('?', s / 2, s / 2 + 8);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 2;
  _qTex = tex;
  return tex;
}

/**
 * REALISTIC ITEM BOX v3 (user: "باکس‌های داخل جاده واقعی‌تر بشن و شیدر و
 * تکسچر داشته باشن") — a proper premium prize-box, not a flat glow cube:
 *  - canvas TEXTURE per face: brushed-metal frame, glossy glass pane,
 *    corner rivets, subtle scratches (reads as a real physical object)
 *  - fake ENVIRONMENT REFLECTION from the sky gradient + SUN specular glint
 *    that slides across the glass as the box spins
 *  - fresnel edge glow, interior depth (backfaces darker = see-through glass)
 *  - glowing "?" decal with pulse, uGhost=1 → faint waiting-to-respawn state
 */
let _boxFaceTex: THREE.Texture | null = null;
function boxFaceTexture(): THREE.Texture {
  if (_boxFaceTex) return _boxFaceTex;
  const s = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const c = cv.getContext('2d')!;
  // --- metal frame band around the pane ---
  const grd = c.createLinearGradient(0, 0, s, s);
  grd.addColorStop(0, '#f5b400'); grd.addColorStop(0.25, '#ffe45c');
  grd.addColorStop(0.5, '#e8a200'); grd.addColorStop(0.75, '#ffd83a');
  grd.addColorStop(1, '#d99400');
  c.fillStyle = grd;
  c.fillRect(0, 0, s, s);
  // brushed metal micro-scratches on the frame
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * s, b = Math.random() * s;
    c.strokeStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.08})`;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(a, b);
    c.lineTo(a + (Math.random() - 0.5) * 26, b + (Math.random() - 0.5) * 6);
    c.stroke();
  }
  // --- inner glass pane ---
  const pane = 34;
  const g2 = c.createLinearGradient(pane, pane, s - pane, s - pane);
  g2.addColorStop(0, 'rgba(255,196,20,0.92)');
  g2.addColorStop(0.45, 'rgba(255,224,90,0.82)');
  g2.addColorStop(1, 'rgba(230,150,0,0.95)');
  c.fillStyle = g2;
  c.fillRect(pane, pane, s - pane * 2, s - pane * 2);
  // diagonal glass reflection streaks
  c.save();
  c.beginPath();
  c.rect(pane, pane, s - pane * 2, s - pane * 2);
  c.clip();
  c.globalAlpha = 0.14;
  c.fillStyle = '#ffffff';
  for (let x = -s; x < s * 2; x += 46) {
    c.beginPath();
    c.moveTo(x, 0); c.lineTo(x + 22, 0); c.lineTo(x + 22 - s, s); c.lineTo(x - s, s);
    c.closePath(); c.fill();
  }
  c.restore();
  // frame inner bevel (light top-left / dark bottom-right)
  c.strokeStyle = 'rgba(255,255,255,0.65)'; c.lineWidth = 5;
  c.strokeRect(pane + 2, pane + 2, s - pane * 2 - 4, s - pane * 2 - 4);
  c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 3;
  c.strokeRect(pane - 2, pane - 2, s - pane * 2 + 4, s - pane * 2 + 4);
  // corner rivets
  for (const [rx, ry] of [[17, 17], [s - 17, 17], [17, s - 17], [s - 17, s - 17]]) {
    const rg = c.createRadialGradient(rx - 2, ry - 2, 1, rx, ry, 9);
    rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.4, '#b9c1cf');
    rg.addColorStop(1, '#4c5462');
    c.fillStyle = rg;
    c.beginPath(); c.arc(rx, ry, 9, 0, Math.PI * 2); c.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 2;
  _boxFaceTex = tex;
  return tex;
}

export function makeItemBoxMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: G.time,
      qTex: { value: makeQuestionTexture() },
      faceTex: { value: boxFaceTexture() },
      sunDir: { value: G.sunDir.value.clone() },
      uGhost: { value: 0 },
    },
    vertexShader: `
      varying vec3 vPos; varying vec3 vNorm; varying vec3 vView; varying vec2 vUv; varying vec3 vWn;
      void main(){
        vPos = position;
        vUv = uv;
        vNorm = normalize(normalMatrix * normal);
        vWn = normalize(mat3(modelMatrix) * normal);
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float time; uniform sampler2D qTex; uniform sampler2D faceTex;
      uniform vec3 sunDir; uniform float uGhost;
      varying vec3 vPos; varying vec3 vNorm; varying vec3 vView; varying vec2 vUv; varying vec3 vWn;
      void main(){
        // ---- physical face: metal frame + glass pane texture ----
        vec3 face = texture2D(faceTex, vUv).rgb;
        // ---- sky environment reflection (cheap fake env-map) ----
        vec3 refl = reflect(-vView, vNorm);
        float up = clamp(refl.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 env = mix(vec3(0.24,0.34,0.50), vec3(0.85,0.93,1.05), up);
        float fres = pow(1.0 - abs(dot(vNorm, vView)), 2.2);
        // ---- sun specular glint sliding over the spinning glass ----
        vec3 h = normalize(normalize(sunDir) + vView);
        float spec = pow(max(dot(vWn, h), 0.0), 60.0);
        // ---- iridescent tint cycling (kept subtle & premium) ----
        float hue = fract(time*0.05 + vPos.y*0.05);
        vec3 irid = 0.5 + 0.5 * cos(6.2831*(hue + vec3(0.0,0.33,0.67)));
        float scan = smoothstep(0.4,0.6, sin(vPos.y*14.0 - time*6.0)*0.5+0.5);
        float pulse = 0.5 + 0.5*sin(time*3.2);
        vec4 q = texture2D(qTex, vUv);
        // compose: textured base + env reflection on fresnel + spec + irid tint
        vec3 c = face * 0.82;
        c += env * fres * 0.85;
        c += vec3(1.0,0.97,0.9) * spec * 1.25;
        c += vec3(1.0,0.85,0.2) * 0.12 * pulse * (1.0 - uGhost);
        c += scan * 0.05;
        c += q.rgb * q.a * (0.55 + 0.55*pulse) * (1.0 - uGhost);
        float a = uGhost > 0.5
          ? 0.10 + fres*0.18 + scan*0.05
          : clamp(0.62 + fres*0.38 + spec*0.4, 0.0, 0.96);
        gl_FragColor = vec4(c * (uGhost > 0.5 ? 0.5 : 1.22), a);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

/** metal frame material for the item box edge beams (per-box: fades in ghost) */
export function makeItemBoxFrameMaterial(): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color: 0xffc21a, emissive: 0x6a4200, transparent: true, opacity: 1 });
  return m;
}

/** additive billboard for the glowing "?" inside the box */
export function makeQuestionBillboardMaterial(): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    map: makeQuestionTexture(), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  return m;
}

/**
 * VOLUMETRIC HEADLIGHT BEAM v2 (user v1.11: "چراغ‌های جلوی ماشین خیلی خفن بشه
 * و بهش شیدر اضافه کنی"): additive cone shader with a HOT CORE near the lamp,
 * soft falloff toward the base AND toward the cone's outer surface (real
 * volumetric feel), plus a subtle engine-rate shimmer.
 */
export function makeHeadlightBeamMaterial(color = '#ffe9b0'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { time: G.time, color: { value: new THREE.Color(color) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `
      varying vec3 vPos;
      void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float time; uniform vec3 color; varying vec3 vPos;
      void main(){
        // cone local: tip (lamp, bright) at y=+1.6, base (far, faded) y=-1.6
        float k = clamp((vPos.y + 1.6) / 3.2, 0.0, 1.0);
        // radial falloff: bright on the axis, fading to the shell
        float r = clamp(length(vPos.xz) / 0.85, 0.0, 1.0);
        float core = pow(1.0 - r, 1.7);
        float a = k * k * (0.10 + core * 0.42);
        // shimmer: two out-of-phase waves so the beam feels alive
        a *= 0.90 + 0.06 * sin(time * 15.0) + 0.04 * sin(time * 23.7 + 1.7);
        gl_FragColor = vec4(color, a);
      }`,
  });
}

/**
 * ENERGY SHIELD BUBBLE v2 (user v1.12: "قدرت سپر — همون دایره آبی نگه داشته
 * بشه ولی شیدر و تکسچر خفن بگیره و پرجزئیات باشه") — the classic blue dome is
 * BACK, rebuilt as a real shader:
 *  - FRESNEL RIM: the shell burns bright cyan at glancing angles while the
 *    face over the car stays glassy-clear
 *  - HEX LATTICE: a honeycomb energy grid (triplanar-mapped, seam-free)
 *    crawling upward over the dome
 *  - RISING ENERGY WAVES + breathing pulse
 *  - additive blending → the car inside stays fully visible
 */
export function makeShieldBubbleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { time: G.time, color: { value: new THREE.Color('#3fa9ff') }, uOpacity: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `
      varying vec3 vLocal; varying vec3 vNorm; varying vec3 vView;
      void main(){
        vLocal = position;
        vNorm = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float time; uniform vec3 color; uniform float uOpacity;
      varying vec3 vLocal; varying vec3 vNorm; varying vec3 vView;
      float hexDist(vec2 p){
        p = abs(p);
        return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
      }
      float hexLattice(vec2 p){
        vec2 r = vec2(1.0, 1.7320508);
        vec2 h = r * 0.5;
        vec2 a = mod(p, r) - h;
        vec2 b = mod(p - h, r) - h;
        vec2 gv = dot(a, a) < dot(b, b) ? a : b;
        float d = hexDist(gv);
        return (1.0 - smoothstep(0.28, 0.50, d)) * 0.85 + smoothstep(0.50, 0.62, d) * 0.4;
      }
      void main(){
        float fres = pow(1.0 - abs(dot(normalize(vNorm), normalize(vView))), 2.3);
        // ---- seam-free triplanar hex lattice, scrolling upward ----
        vec3 an = normalize(abs(vLocal) + vec3(0.0001));
        vec3 w = an / (an.x + an.y + an.z);
        float lat = hexLattice(vLocal.zy * 2.1 + vec2(0.0, -time * 0.45)) * w.x
                  + hexLattice(vLocal.xz * 2.1 + vec2(time * 0.3, 0.0)) * w.y
                  + hexLattice(vLocal.xy * 2.1 + vec2(0.0, -time * 0.45)) * w.z;
        // energy waves sweeping up the dome + soft breathing
        float wave = 0.5 + 0.5 * sin(vLocal.y * 4.6 - time * 3.1);
        float pulse = 0.82 + 0.18 * sin(time * 3.4);
        float a = (0.05 + fres * 0.52 + lat * (0.10 + wave * 0.20)) * pulse * uOpacity;
        vec3 c = color * (0.72 + fres * 0.95) + vec3(0.55, 0.85, 1.0) * lat * 0.38;
        gl_FragColor = vec4(c, a);
      }`,
  });
}

/**
 * UNDERGLOW FX v2 (user v1.11: "چراغ پایین ماشین هم مثل چراغ جلو خیلی خفن
 * بشه"): radial neon glow texture with a hot core, TWO concentric neon
 * rings and soft radial streaks — reads as a real neon rig under the chassis
 * instead of a flat blob. Still a MeshBasicMaterial (color/opacity stay
 * animatable from visuals.ts).
 */
export function makeUnderglowMaterial(color: string): THREE.MeshBasicMaterial {
  const s = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const c = cv.getContext('2d')!;
  const cx = s / 2;
  // base radial glow
  const g = c.createRadialGradient(cx, cx, 4, cx, cx, cx);
  g.addColorStop(0, 'rgba(255,255,255,0.98)');
  g.addColorStop(0.30, 'rgba(255,255,255,0.62)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, s, s);
  // neon ring 1 (bright) + ring 2 (soft) — like LED strips under the skirts
  c.globalCompositeOperation = 'lighter';
  for (const [rr, w, a] of [[0.56, 5, 0.85], [0.82, 3, 0.45]] as [number, number, number][]) {
    c.strokeStyle = `rgba(255,255,255,${a})`;
    c.lineWidth = w;
    c.beginPath();
    c.arc(cx, cx, cx * rr, 0, Math.PI * 2);
    c.stroke();
  }
  // radial streaks (projector beams outward)
  c.strokeStyle = 'rgba(255,255,255,0.10)';
  c.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * Math.PI * 2;
    c.beginPath();
    c.moveTo(cx + Math.cos(ang) * cx * 0.2, cx + Math.sin(ang) * cx * 0.2);
    c.lineTo(cx + Math.cos(ang) * cx * 0.94, cx + Math.sin(ang) * cx * 0.94);
    c.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  const m = new THREE.MeshBasicMaterial({
    map: tex, color: new THREE.Color(color), transparent: true, opacity: 0.9,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return m;
}

/** Gradient sky dome + realistic sun disc + halo + optional stars */
export function makeSkyMaterial(top: string, bottom: string, horizon: string, night: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) },
      horizon: { value: new THREE.Color(horizon) }, time: G.time,
      stars: { value: night ? 1 : 0 },
      sunDir: { value: G.sunDir.value.clone() },
    },
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `
      varying vec3 vDir;
      void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 bottom; uniform vec3 horizon; uniform float stars; uniform float time; uniform vec3 sunDir;
      varying vec3 vDir;
      float hash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        float h = clamp(vDir.y*0.5+0.5, 0.0, 1.0);
        vec3 c = h > 0.5 ? mix(horizon, top, (h-0.5)*2.0) : mix(bottom, horizon, h*2.0);
        // NIGHT GRAPHICS PASS: the gradient collapses to a deep navy so stars,
        // the moon and headlight beams read against a properly dark sky
        c = mix(c, vec3(0.012, 0.018, 0.045), stars * 0.88);
        // --- sun: crisp disc + warm halo + wide ambient glow (day only) ---
        float sd = max(dot(vDir, normalize(sunDir)), 0.0);
        float disc = smoothstep(0.99815, 0.99910, sd);
        float rim  = smoothstep(0.99680, 0.99815, sd);
        float halo = pow(sd, 60.0) * 0.60 + pow(sd, 10.0) * 0.18;
        vec3 sunTint = vec3(1.0, 0.965, 0.86);
        c += (disc * 1.45 + rim * 0.6) * sunTint * (1.0 - stars);
        c += halo * vec3(1.0, 0.86, 0.58) * (1.0 - stars);
        if (stars > 0.5 && vDir.y > 0.02) {
          vec3 sp = floor(vDir*140.0);
          float st = step(0.997, hash(sp));
          c += st * (0.6 + 0.4*sin(time*2.0 + hash(sp*1.7)*40.0));
          // soft moon opposite the sun
          float md = max(dot(vDir, normalize(-sunDir)), 0.0);
          c += smoothstep(0.9994, 0.9998, md) * vec3(0.85, 0.9, 1.0) * 0.9;
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

/** Additive flame / glow sprite material (for boost flames, torches) */
export function makeFlameMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { time: G.time, color: { value: new THREE.Color(color) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float time; uniform vec3 color; varying vec2 vUv;
      void main(){
        vec2 p = vUv*2.0-1.0;
        float d = length(p);
        float flick = 0.85 + 0.15*sin(time*30.0 + vUv.y*20.0);
        float a = smoothstep(1.0, 0.1, d) * flick;
        vec3 c = mix(color, vec3(1.0), smoothstep(0.6,0.0,d));
        gl_FragColor = vec4(c, a);
      }`,
  });
}

/** Soft round particle texture generator (canvas) for Points-based smoke */
export function makeParticleTexture(soft: boolean): THREE.Texture {
  const s = 64;
  const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = (x - s / 2 + 0.5) / (s / 2), dy = (y - s / 2 + 0.5) / (s / 2);
    const d = Math.sqrt(dx * dx + dy * dy);
    let a: number;
    if (soft) a = Math.max(0, 1 - d);
    else { // blocky square (voxel style)
      a = d < 0.85 ? 1 : 0;
      if (d > 0.65 && d < 0.85) a = 1 - (d - 0.65) / 0.2;
    }
    const i = (y * s + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.floor(Math.max(0, Math.min(1, a)) * 255);
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}
