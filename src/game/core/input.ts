// KUBO KARTS - Unified input system: touch UI buttons + keyboard (desktop testing)
// Steering analog value from wheel drag or keys; digital gas/brake/drift/item.
//
// STEERING SIGN CONVENTION (BUGFIX: "فرمون برعکس کار می‌کند"):
//   uiSteer:  +1 = user intents RIGHT (finger right / ▶ / D key)
//   state.steer: value consumed by Kart physics. Kart forward = (sin h, cos h),
//   so heading+ rotates forward toward +X — which the chase camera (looking
//   along +forward) shows on the LEFT of the screen. Therefore the human input
//   is NEGATED here: intent right (+1) → state.steer = -1 → heading decreases →
//   kart turns toward -X = screen RIGHT. AI drivers already use world-space
//   atan2 steering and are unaffected by this flip.
import { clamp } from './utils';

export interface InputState {
  steer: number;       // -1..1 (left..right), analog
  gas: boolean;
  brake: boolean;
  drift: boolean;
  lookBack: boolean;
  useItem: boolean;    // edge-triggered, consumed by race (first available slot)
  useItemSlot: number; // edge-triggered slot index 0..2, -1 = none (user: 3 power slots, each button fires ITS slot)
  pause: boolean;      // edge-triggered
  anyKeyPress: boolean; // edge
}

type Key = string;

export class InputSystem {
  state: InputState = { steer: 0, gas: false, brake: false, drift: false, lookBack: false, useItem: false, useItemSlot: -1, pause: false, anyKeyPress: false };
  /** steering as the USER perceives it (+1 = right) — for wheel/arrow visuals */
  uiSteer = 0;
  private keys = new Set<Key>();
  private steerLeft = 0; private steerRight = 0; // analog accumulators from touch wheel
  sensitivity = 1.0; // steering sensitivity setting 0.6..1.6
  autoGas = false;   // auto-accelerate (set from settings)
  enabled = true;
  steerMode: 'wheel' | 'buttons' = 'wheel';
  mirror = false;    // optional "invert steering" accessibility setting

  // Touch control hooks (set by UI)
  touchSteer = 0;        // -1..1 from wheel drag
  touchGas = false;
  touchBrake = false;
  touchDrift = false;
  touchLookBack = false;

  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'shift'].includes(k)) e.preventDefault();
    if (!this.keys.has(k)) {
      if (k === 'e' || k === 'enter') this.state.useItem = true;
      // desktop parity for the 3 power-up slots
      if (k === '1') this.state.useItemSlot = 0;
      if (k === '2') this.state.useItemSlot = 1;
      if (k === '3') this.state.useItemSlot = 2;
      if (k === 'escape' || k === 'p') this.state.pause = true;
      this.state.anyKeyPress = true;
    }
    this.keys.add(k);
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); };
  private onBlur = () => { this.keys.clear(); this.touchGas = this.touchBrake = this.touchDrift = false; this.touchSteer = 0; };

  attach() {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }
  detach() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  /** Called once per fixed step. Produces smoothed analog steering. */
  sample(dt: number) {
    if (!this.enabled) {
      this.state.steer = 0; this.uiSteer = 0;
      this.state.gas = this.state.brake = this.state.drift = false;
      return;
    }
    const kL = this.keys.has('a') || this.keys.has('arrowleft');
    const kR = this.keys.has('d') || this.keys.has('arrowright');
    const kGas = this.keys.has('w') || this.keys.has('arrowup');
    const kBrake = this.keys.has('s') || this.keys.has('arrowdown');
    const kDrift = this.keys.has(' ') || this.keys.has('shift');
    const kBack = this.keys.has('c');

    // target = wheel drag / arrow buttons; keys act as digital full-lock input
    let target = clamp(this.touchSteer, -1, 1);
    if (kL) target = -1;
    if (kR) target = 1;
    if (kL && kR) target = 0;

    // Analog smoothing. Wheel mode: near-instant follow (drag IS the analog value).
    // Buttons mode: quick ramp so taps feel analog; sensitivity scales both.
    const rate = this.steerMode === 'wheel' ? 26 * clamp(this.sensitivity, 0.5, 1.4) : 13 * this.sensitivity;
    const cur = this.uiSteer;
    const next = cur + (target - cur) * Math.min(1, rate * dt);
    this.uiSteer = Math.abs(next) < 0.01 ? 0 : next;
    // BUGFIX: negate for kart world-space (see header). "mirror" setting flips
    // again for players who prefer inverted steering.
    const flipped = -this.uiSteer;
    this.state.steer = this.mirror ? -flipped : flipped;

    this.state.gas = (this.touchGas || kGas || this.autoGas) && !(this.touchBrake || kBrake);
    this.state.brake = this.touchBrake || kBrake;
    this.state.drift = this.touchDrift || kDrift;
    this.state.lookBack = this.touchLookBack || kBack;
  }

  consumeItem(): boolean { const v = this.state.useItem; this.state.useItem = false; return v; }
  /** returns the pressed slot (0..2) once, or -1 */
  consumeItemSlot(): number { const v = this.state.useItemSlot; this.state.useItemSlot = -1; return v; }
  consumePause(): boolean { const v = this.state.pause; this.state.pause = false; return v; }
  consumeAnyKey(): boolean { const v = this.state.anyKeyPress; this.state.anyKeyPress = false; return v; }

  reset() {
    this.state.steer = 0;
    this.uiSteer = 0;
    this.touchSteer = 0;
    this.steerLeft = this.steerRight = 0;
    this.state.useItem = this.state.pause = false;
    this.state.useItemSlot = -1;
    this.state.gas = this.state.brake = this.state.drift = false;
    this.touchGas = this.touchBrake = this.touchDrift = false;
  }
}
