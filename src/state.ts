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

/** League progress: which leagues are open and your fastest win in each. */
export interface Progress {
  /** Highest league you may play (winning a league opens the next). */
  unlocked: number;
  /** Fastest win per league, in seconds of match time. */
  best: Record<number, number>;
  wins: number;
  losses: number;
}

export function createProgress(): Progress {
  return { unlocked: 1, best: {}, wins: 0, losses: 0 };
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
