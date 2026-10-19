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
  /** Extra resistance a fully entrenched cell gets, and seconds to fully entrench. */
  entrench: 0,
  entrenchSeconds: 40,
  /** Behaviour priorities. Set from the faction's behaviour sliders (see BEHAVIOR), not upgrades. */
  aggression: 0,
  consolidation: 0.4,
  momentum: 0,
  flanking: 0,
  threat: 0,
  recovery: 0,
  /** Energy multipliers and upgrade price multiplier. */
  yield: 1,
  conquest: 1,
  costMult: 1,
  /** Special upgrade effects (0 = not owned). See upgrades.ts for what each does. */
  outpost: 0,
  chain: 0,
  siege: 0,
  counter: 0,
  tribute: 0,
  capital: 0,
  veins: 0,
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
  /** Outposts land this many cells beyond the border cell they launch from. */
  outpostDistance: [3, 5] as const,
  /** Each further link of a chain reaction is this much less likely than the last. */
  chainDecay: 0.6,
  chainMaxLinks: 6,
  /** An enemy group smaller than this, and less than half its faction, counts as cut off. */
  siegePocketCells: 150,
  /** Capital protection fades to nothing at this distance (cells) from home. */
  capitalRadius: 7,
  /** Veins run over a coarse grid of blocks this many cells wide. */
  veinBlock: 4,
  /** A block carries a vein only if the faction holds at least this many of its cells. */
  veinBlockMin: 6,
  /** Most fronts a faction's vein network reaches, and how often (s) it is re-routed. */
  veinTargets: 10,
  veinSeconds: 2,
  /** Huge territories route over doubled blocks until there are at most this many (keeps it cheap). */
  veinMaxBlocks: 1500,
  /** At most this many border cells are examined when picking fronts. */
  veinFrontSample: 3000,
};

export const COMBAT = {
  /** Scales every conversion chance, so fronts move steadily rather than flickering. */
  conversionScale: 0.75,
  /** How strongly targets are preferred: enemy cells start less attractive than open ground. */
  enemyBaseWeight: 0.6,
  /** A cell counts as "under attack" for this long after a failed or successful hit. */
  threatSeconds: 6,
  /** Recently lost cells are remembered this long for Recovery. */
  recoverySeconds: 30,
};

export const ENERGY = {
  /** Per neutral cell claimed and per enemy cell converted, before multipliers. */
  neutral: 2,
  conquest: 6,
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

/** Rival placement and pacing. */
export const RIVALS = {
  /** First rival's distance from your start (cells): first contact after ~2.5–4 minutes. */
  firstDistance: [16, 19] as const,
  secondDistance: [42, 50] as const,
  /** New rivals appear this far beyond your territory's reach. */
  spawnBeyond: [26, 46] as const,
  /** Rivals wanted near you: base + one more per this many cells of reach. */
  baseCount: 2,
  reachPerExtra: 28,
  maxAlive: 9,
  /** A spawn site must be empty for this radius, and this far from any territory. */
  clearRadius: 6,
  minGapToTerritory: 12,
  /** Factions further than this (beyond your reach) pause until you come closer. */
  dormantBeyond: 140,
  /** A newly spawned rival gets your earned energy × a random factor in this range. */
  budgetJitter: [0.85, 1.15] as const,
  /** How often (s) spawning is reconsidered. */
  checkSeconds: 2,
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
  /** Outpost landing ring, and the delay between links of a chain reaction. */
  ringMs: 650,
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
  rivals: ['#E69A71', '#89AECC', '#88B69F', '#B49BCC', '#D8BE75', '#D77F78'],
  rivalNames: ['Orange', 'Blue', 'Green', 'Purple', 'Yellow', 'Red'],
};

export const AUDIO = {
  /** Never play more than this many capture sounds per second. */
  maxPopsPerSecond: 8,
};

export const SAVE = {
  key: 'assimilate.save',
  backupKey: 'assimilate.save.bak',
  version: 3,
  autosaveSeconds: 10,
};
