// KUBO KARTS - GRAPHICS SCALABILITY (v1.20, spec §3/§4/§19).
// One table drives every cosmetic cost. Gameplay/physics NEVER read it:
// the simulation is fixed-step and identical on every preset.
export type QualityId = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityProfile {
  pixelRatioCap: number;     // render resolution cap (× CSS px)
  mobilePixelRatioCap: number; // v3.8: tighter cap on phones
  shadows: boolean;
  shadowMap: number;         // shadow map resolution
  shadowSoft: boolean;       // PCF soft vs. basic
  particles: number;         // particle/debris density multiplier
  vfx: number;               // weather / sparks / trails density
  lampLights: number;        // real point lights for night street lamps
  drawDistance: number;      // fog/far multiplier (1 = theme default)
  headlightShadows: boolean;
  antialias: boolean;        // MSAA hint (applied on next boot)
  toneExposure: number;
  adaptive: boolean;         // dynamic resolution when FPS drops
}

export const QUALITY_PROFILES: Record<QualityId, QualityProfile> = {
  // v3.8: MSAA (antialias) is ON from MEDIUM up. On phone GPUs (tile-based:
  // Adreno / Mali / Apple) 4× MSAA is almost free and removes the jagged,
  // shimmering edges — it looks better than a higher resolution without AA
  // and costs far less. Phones also get a lower resolution ceiling
  // (mobilePixelRatioCap): a 3× screen rendered at 3× was the #1 FPS killer.
  low:    { pixelRatioCap: 1.0, mobilePixelRatioCap: 1.0,  shadows: false, shadowMap: 512,  shadowSoft: false, particles: 0.4, vfx: 0.45, lampLights: 1, drawDistance: 0.75, headlightShadows: false, antialias: false, toneExposure: 1.1,  adaptive: true },
  medium: { pixelRatioCap: 1.5, mobilePixelRatioCap: 1.35, shadows: true,  shadowMap: 1024, shadowSoft: false, particles: 0.7, vfx: 0.7,  lampLights: 2, drawDistance: 0.9,  headlightShadows: false, antialias: true,  toneExposure: 1.12, adaptive: true },
  high:   { pixelRatioCap: 2.0, mobilePixelRatioCap: 1.6,  shadows: true,  shadowMap: 2048, shadowSoft: true,  particles: 1.0, vfx: 1.0,  lampLights: 3, drawDistance: 1.0,  headlightShadows: false, antialias: true,  toneExposure: 1.12, adaptive: true },
  ultra:  { pixelRatioCap: 2.5, mobilePixelRatioCap: 2.0,  shadows: true,  shadowMap: 2048, shadowSoft: true,  particles: 1.4, vfx: 1.3,  lampLights: 4, drawDistance: 1.15, headlightShadows: true,  antialias: true,  toneExposure: 1.14, adaptive: true },
};

export const IS_MOBILE = typeof navigator !== 'undefined' && /android|iphone|ipad|mobile/i.test(navigator.userAgent);

/** v3.8: the render resolution for a preset on THIS device */
export function pixelRatioFor(q: QualityId, scale = 1): number {
  const P = QUALITY_PROFILES[q] ?? QUALITY_PROFILES.medium;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  return Math.min(dpr, IS_MOBILE ? P.mobilePixelRatioCap : P.pixelRatioCap) * scale;
}

/** v3.9: PCF-SOFT shadows sample the shadow map many more times per pixel.
 *  On phone GPUs that alone cost 3-6 ms per frame at 2048². Phones use the
 *  normal PCF filter (with the texel-snapped, tighter shadow camera in
 *  race.ts it still looks crisp) — desktops keep soft shadows. */
export function shadowSoftFor(q: QualityId): boolean {
  const P = QUALITY_PROFILES[q] ?? QUALITY_PROFILES.medium;
  return P.shadowSoft && !IS_MOBILE;
}

/** first-boot preset from GPU string, cores, memory and screen size */
export function detectQuality(renderer?: { getContext(): WebGLRenderingContext | WebGL2RenderingContext }): QualityId {
  try {
    let gpu = '';
    const gl = renderer?.getContext();
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    }
    const cores = navigator.hardwareConcurrency || 4;
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
    const px = screen.width * screen.height * (window.devicePixelRatio || 1) ** 2;
    const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent);
    if (/swiftshader|llvmpipe|software|mali-4|mali-t[67]|adreno \(tm\) [34]\d\d|powervr sgx/.test(gpu)) return 'low';
    if (mobile) {
      // v3.9 tiers (old rule sent every 4-core phone to LOW and every
      // Adreno 6xx flagship to MEDIUM)
      if (mem <= 2) return 'low';
      if (/adreno \(tm\) (5[0-3]\d|6[01]\d)|mali-g(31|51|52|57|68)|powervr/.test(gpu)) return mem >= 4 ? 'medium' : 'low';
      if (/adreno \(tm\) (7[3-9]\d|8\d\d)|apple gpu|mali-g7[1-9]\d|mali-g[89]\d\d|immortalis|xclipse/.test(gpu) && mem >= 6) return 'high';
      if (/adreno \(tm\) (6[4-9]\d|7\d\d)|mali-g7[1-9]|mali-g6[1-9]\d|mali-g7\d\d/.test(gpu) && mem >= 6) return 'high';
      if (cores <= 4 && mem <= 3) return 'low';
      return 'medium';
    }
    if (/rtx|radeon rx [67]\d\d\d|apple m[1-9]|arc a/.test(gpu) && cores >= 8) return px > 8e6 ? 'high' : 'ultra';
    if (/intel|uhd|iris/.test(gpu)) return 'medium';
    return 'high';
  } catch { return 'medium'; }
}

/** DYNAMIC RESOLUTION: trims pixel ratio when frame time stays high and
 *  restores it when there is headroom. Never touches gameplay. */
export class AdaptiveResolution {
  // v3.9: budget follows the real frame pacing (60 or 72 fps), steps are
  // small (5%) so the picture never visibly "pops", and there is a cooldown
  // after each change — every setPixelRatio reallocates the framebuffer.
  private slowT = 0; private fastT = 0; private cool = 0;
  scale = 1;
  update(frameMs: number, dt: number, targetMs = 1000 / 60): boolean {
    this.cool = Math.max(0, this.cool - dt);
    if (frameMs > targetMs * 1.3) { this.slowT += dt; this.fastT = 0; }
    else if (frameMs < targetMs * 1.06) { this.fastT += dt; this.slowT = 0; }
    else { this.slowT = Math.max(0, this.slowT - dt); this.fastT = Math.max(0, this.fastT - dt); }
    if (this.cool > 0) return false;
    if (this.slowT > 1.5 && this.scale > 0.65) { this.scale = Math.max(0.65, this.scale - 0.05); this.slowT = 0; this.cool = 1.2; return true; }
    if (this.fastT > 5 && this.scale < 1) { this.scale = Math.min(1, this.scale + 0.05); this.fastT = 0; this.cool = 2; return true; }
    return false;
  }
}
