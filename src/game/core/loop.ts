// KUBO KARTS - Fixed timestep game loop (60Hz sim, interpolated rendering)
//
// v3.9 FRAME PACING: many phones now have 90/120/144 Hz screens. The old loop
// rendered EVERY vsync → at 120 Hz the GPU drew twice as many frames as
// needed, the phone heated up within a minute, the SoC throttled and the game
// fell to ~25 fps with big stutters ("لگ و کندی بعد از چند دقیقه").
// Now the loop measures the real refresh rate and, above ~100 Hz, renders
// every 2nd vsync (120 → 60, 144 → 72). Simulation is unchanged (fixed 60 Hz).
export type UpdateFn = (dt: number) => void; // dt = fixed 1/60
export type RenderFn = (alpha: number, frameDt: number) => void;

export class GameLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;
  private readonly STEP = 1 / 60;
  private readonly MAX_FRAME = 0.1;
  fps = 60;
  private fpsAcc = 0; private fpsCount = 0;
  /** measured display refresh (Hz), shared by every loop instance */
  static refreshHz = 60;
  private static samples: number[] = [];
  private static lastVsync = 0;
  /** render divider: 1 = every vsync, 2 = every other vsync */
  private static divider = 1;
  private vsyncCount = 0;

  constructor(private update: UpdateFn, private render: RenderFn) {}

  private static sampleVsync(now: number) {
    const d = now - GameLoop.lastVsync;
    GameLoop.lastVsync = now;
    if (d <= 2 || d > 40) return;
    const s = GameLoop.samples;
    s.push(d);
    if (s.length >= 40) {
      const sorted = s.slice().sort((a, b) => a - b);
      const med = sorted[sorted.length >> 1];
      GameLoop.refreshHz = Math.round(1000 / med);
      GameLoop.divider = GameLoop.refreshHz >= 100 ? 2 : 1;
      s.length = 0;
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      GameLoop.sampleVsync(now);
      // frame pacing on high-refresh screens (see header)
      if (GameLoop.divider > 1 && (++this.vsyncCount % GameLoop.divider) !== 0) return;
      let frameDt = (now - this.last) / 1000;
      this.last = now;
      if (frameDt > this.MAX_FRAME) frameDt = this.MAX_FRAME; // tab switch protection
      // fps tracking
      this.fpsAcc += frameDt; this.fpsCount++;
      if (this.fpsAcc >= 0.5) { this.fps = Math.round(this.fpsCount / this.fpsAcc); this.fpsAcc = 0; this.fpsCount = 0; }
      // fixed-step accumulation (cap to avoid spiral of death)
      this.acc += frameDt;
      let steps = 0;
      while (this.acc >= this.STEP && steps < 4) {
        this.update(this.STEP);
        this.acc -= this.STEP;
        steps++;
      }
      if (steps === 4) this.acc = 0;
      this.render(this.acc / this.STEP, frameDt);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
