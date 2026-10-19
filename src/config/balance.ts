// Every tunable number lives here (plus upgrades.ts and profiles.ts).
// After changing values run `npm run sim` to see pacing and `npm test`.

/** Simulation clock. Rules only see whole ticks, so game speed never changes outcomes. */
export const TIME = {
  ticksPerSecond: 10,
  speeds: [1, 2, 4] as const,
  /** Max ticks processed in one animation frame (protects slow phones). */
  maxTicksPerFrame: 12,
};

/** Infinite grid storage. */
export const GRID = {
  /** Cells per chunk side. Chunks are created only where territory exists. */
  chunk: 32,
};

/** Starting clusters for every faction. */
export const START = {
  minCells: 5,
  maxCells: 9,
  /** Energy the player starts with: enough for one first upgrade. */
  playerEnergy: 10,
};

/** Base abilities every faction starts with, before upgrades. */
export const BASE_STATS = {
  /** Expansion attempts per second. */
  rate: 0.36,
  /** Rate grows with territory as rate × (1 + sizeBonus × √cells): helpful, never exponential. */
  sizeBonus: 0.06,
  /** Border cells sampled per attempt when choosing a target (more = smarter choices). */
  samples: 4,
  /** Chance an attempt on a neutral cell succeeds. */
  neutralSuccess: 0.92,
  /** Attack strength and cell resistance; conversion chance is power vs resistance. */
  power: 1,
  resistance: 1,
  /** Attack bonus per attacking cell already touching the target (0–4 sides). */
  pressure: 0.25,
  /** Defence bonus per defending neighbour of the target (0–4 sides). */
  reinforcement: 0.25,
  /** Behaviour priorities. Set from the faction's behaviour sliders (see BEHAVIOR), not upgrades. */
  aggression: 0,
  consolidation: 0.4,
  momentum: 0,
  flanking: 0,
  threat: 0,
  recovery: 0,
  /** Multiplier on all energy income. */
  yield: 1,
  /** Special upgrade effects (0 = not owned). See upgrades.ts for what each does. */
  chain: 0,
  siege: 0,
  counter: 0,
};

/**
 * World tempo: every faction's expansion rate is multiplied by this, rising smoothly from 1× to
 * `max`× over the first `rampSeconds`, then holding. Slow, readable opening; livelier mid-game.
 */
export const TEMPO = {
  max: 2.2,
  rampSeconds: 720,
};

/** Tuning for the special upgrades. */
export const SPECIAL = {
  /** Each further link of a chain reaction is this much less likely than the last. */
  chainDecay: 0.6,
  chainMaxLinks: 6,
  /** An enemy group smaller than this, and less than half its faction, counts as cut off. */
  siegePocketCells: 150,
};

/** Rally flag: your territory leans toward the flag while still growing everywhere. */
export const FLAG = {
  /** Share of border samples that come from the part of the border nearest the flag. */
  share: 0.5,
  /** Those samples are the nearest of this many random border cells. */
  tournament: 6,
  /** Preference for steps that move toward the flag (per cell closer). */
  pull: 1.0,
};

export const COMBAT = {
  /**
   * Strength in numbers: a faction attacking a smaller one gets (its cells ÷ theirs)^sizeEdge more
   * power (and less against a bigger one), clamped to ×1/sizeEdgeMax…×sizeEdgeMax. Leads turn into
   * breakthroughs instead of endless even fronts.
   */
  sizeEdge: 0.35,
  sizeEdgeMax: 2,
  /** Scales every conversion chance, so fronts move steadily rather than flickering. */
  conversionScale: 0.75,
  /** How strongly targets are preferred: enemy cells start less attractive than open ground. */
  enemyBaseWeight: 0.6,
  /** A cell counts as "under attack" for this long after a failed or successful hit. */
  threatSeconds: 6,
  /** Recently lost cells are remembered this long for Recovery. */
  recoverySeconds: 30,
};

/**
 * Energy comes mainly from holding ground: a trickle plus an amount per cell held, every second.
 * Claiming open ground pays little; taking enemy ground pays well.
 */
export const ENERGY = {
  base: 0.6,
  perCell: 0.015,
  neutral: 0.5,
  conquest: 3,
  /** Window for the HUD's energy-per-second readout. */
  rateWindowSeconds: 6,
};

/**
 * Behaviour sliders (each −1…+1, 0 = centre). They set priorities, so they are choices rather
 * than purchases: moving one way always gives up the other. Values below are at the extremes.
 */
export const BEHAVIOR = {
  /** Focus: claim open ground (−1) ↔ attack enemy cells (+1). Adds to `aggression`. */
  focus: 2,
  /** Shape: compact (−1) ↔ branching (+1). Subtracted from `consolidation`. */
  shape: 2.6,
  /** Reach: even growth (−1) ↔ spearheads at the outer edges (+1). Sets `momentum`. */
  reach: 2.4,
  /** Posture: defend and retake (−1) ↔ exploit weak points (+1). */
  defend: 2.5,
  exploit: 3,
};

/**
 * Matches: a square arena with you and a few rivals spread around it. Whoever first holds
 * `winShare` of the arena wins. Each league you win unlocks the next, which is bigger, more
 * crowded and has richer rivals.
 */
export const MATCH = {
  winShare: 0.6,
  /** Starting clusters sit on a ring this far from the centre (fraction of the arena's side). */
  ring: 0.33,
  /** Highest league. */
  maxLeague: 10,
};

export interface League {
  league: number;
  /** Side of the square arena, in cells. */
  size: number;
  rivals: number;
  /** Rivals' income multiplier (1 = the same as yours). */
  rivalIncome: number;
}

export function leagueInfo(league: number): League {
  const l = Math.max(1, Math.min(MATCH.maxLeague, Math.floor(league)));
  // A rival more every second league; the arena grows to keep about 600 cells per faction.
  const rivals = Math.min(7, 2 + Math.ceil(l / 2));
  return { league: l, size: Math.round(Math.sqrt(600 * (rivals + 1))), rivals, rivalIncome: 1 + 0.05 * (l - 1) };
}

/**
 * Rivals gang up on whoever leads. When one faction is clearly bigger than the next, rivals
 * prefer its cells by up to `maxFocus`× and go easier on each other.
 */
export const LEADER = {
  /** Lead (leader's cells ÷ runner-up's) at which ganging up starts, and where it is at full strength. */
  from: 1.15,
  full: 2,
  maxFocus: 2.2,
  /** Rivals' preference for each other's (non-leader) cells while ganging up at full strength. */
  truce: 0.65,
};

/** Camera framing. The view widens smoothly as your territory grows. */
export const CAMERA = {
  /** Cells visible across the narrow side of the battlefield at each scale. */
  viewCells: [17, 25, 37, 55, 80, 115, 165, 240, 340, 480, 680],
  /** Zoom out when your territory's extent exceeds this fraction of the view. */
  fitFraction: 0.55,
  zoomSeconds: 2.4,
  /** How quickly the camera follows your territory's centre (per second). */
  followRate: 1.6,
  /** Manual zoom limits, relative to the automatic scale. */
  manualMin: 0.25,
  manualMax: 4,
};

/** Rendering and animation timings (milliseconds unless noted). */
export const ANIM = {
  captureMs: 260,
  /** Delay between the links of a chain reaction, so a cascade reads as a wave. */
  chainStepMs: 70,
  hitMs: 220,
  captureStartScale: 0.55,
  overshoot: 2.0,
  hitScale: 0.82,
  gapFraction: 0.12,
  gapMinPx: 1,
  gapMaxPx: 3,
  /** Below this pitch (CSS px) blocks have no gaps; below neutralHidePx empty cells aren't drawn. */
  noGapBelowPx: 6,
  neutralHidePx: 4,
  cornerFraction: 0.16,
  roundAbovePx: 9,
  /** With more owned cells than this on screen, corners are square (much cheaper to draw). */
  roundMaxCells: 2500,
  /**
   * Below this pitch (CSS px) territory is drawn from cached per-chunk images instead of cell by
   * cell, and below `animMinPx` capture/hit effects are skipped (too small to see).
   */
  bitmapBelowPx: 8,
  animMinPx: 4,
};

export const COLORS = {
  background: '#FBFBF9',
  neutral: '#EFEEEA',
  player: '#1B1B1B',
  rivals: ['#E69A71', '#89AECC', '#88B69F', '#B49BCC', '#D8BE75', '#D77F78', '#7DB8B4', '#D49BB8'],
  rivalNames: ['Orange', 'Blue', 'Green', 'Purple', 'Yellow', 'Red', 'Teal', 'Pink'],
};

export const AUDIO = {
  /** Never play more than this many capture sounds per second. */
  maxPopsPerSecond: 8,
};

export const SAVE = {
  key: 'assimilate.save',
  backupKey: 'assimilate.save.bak',
  version: 4,
  autosaveSeconds: 10,
};
