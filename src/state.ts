// Player-facing state that lives outside the grid: settings and lifetime statistics.

export type Speed = 1 | 2 | 4;

export interface Settings {
  sound: boolean;
  volume: number;
  reducedMotion: boolean;
  diagnostics: boolean;
  speed: Speed;
  /** First-launch tip dismissed. */
  introSeen: boolean;
}

export interface LifetimeStats {
  playSeconds: number;
  runsStarted: number;
  cellsClaimed: number;
  cellsConverted: number;
  cellsLost: number;
  rivalsEliminated: number;
  bestTerritory: number;
  highestScale: number;
  energyEarned: number;
}

export function createSettings(reducedMotion = false): Settings {
  return { sound: true, volume: 0.6, reducedMotion, diagnostics: false, speed: 1, introSeen: false };
}

export function createStats(): LifetimeStats {
  return {
    playSeconds: 0, runsStarted: 1, cellsClaimed: 0, cellsConverted: 0, cellsLost: 0,
    rivalsEliminated: 0, bestTerritory: 0, highestScale: 1, energyEarned: 0,
  };
}
