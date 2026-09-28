// KUBO KARTS - Shared context between UI screens and the game app.
import type { UIManager } from './ui';
import type { Showcase } from './showcase';
import type { Meta } from '../meta/meta';
import type { LevelDef } from '../race/levels';
import type { CarDef } from '../data/cars';
import type { MpSettings } from '../net/client';

export interface GameCtx {
  meta: Meta;
  ui: UIManager;
  showcase: Showcase;
  carList(): CarDef[];
  startLevel(level: LevelDef): void;
  startQuickRace(themeId: string, laps?: number): void;
  // multiplayer v2 (IP-based Wi-Fi rooms)
  hostRoom(name: string, settings: MpSettings): void;
  joinRoom(addr: string, name: string): void;
  setLobbyCar?(carId: string): void;
  setLobbyChar?(charId: string): void;
  hostChangeSettings?(s: Partial<MpSettings>): void;
  applyQuality(): void;
  applyFpsSetting(): void;
  exportSave(): string;
  importSave(code: string): boolean;
  resetSave(): void;
  leaveMp(): void;
  toggleReady(): void;
  hostStartRace(): void;
  resumeRace(): void;
  restartRace(): void;
  quitRace(): void;
  nextLevel(): void;
  backToLobby(): void;
}
