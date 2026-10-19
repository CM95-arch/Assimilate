// Player-facing state that lives outside the grid: settings and lifetime statistics.

import { PLAYER_TRAITS, type GrowthTraits } from './config/balance';

export type Speed = 1 | 2 | 4;

export interface Settings {
  sound: boolean;
  volume: number;
  reducedMotion: boolean;
  diagnostics: boolean;
  speed: Speed;
  /** First-launch tip dismissed. */
  introSeen: boolean;
  /** Developer Rule Lab: custom growth traits, or null for the defaults. */
  customTraits: GrowthTraits | null;
}

export interface LifetimeStats {
  playSeconds: number;
  worldsStarted: number;
  cellsGrown: number;
  bestPopulation: number;
  highestScale: number;
}

export function createSettings(reducedMotion = false): Settings {
  return { sound: true, volume: 0.6, reducedMotion, diagnostics: false, speed: 1, introSeen: false, customTraits: null };
}

export function createStats(): LifetimeStats {
  return { playSeconds: 0, worldsStarted: 1, cellsGrown: 0, bestPopulation: 0, highestScale: 1 };
}

export function activeTraits(s: Settings): GrowthTraits {
  return s.customTraits ? { ...PLAYER_TRAITS, ...s.customTraits } : { ...PLAYER_TRAITS };
}
