// Every tunable number in the game lives here (and, later, in upgrades/mutations config files).
// Change values, then run `npm run patterns` to see how colony shapes respond and `npm test`.

/** World grid. Cells are addressed as index = y * width + x. Portrait, like the phone. */
export const WORLD = {
  width: 200,
  height: 320,
  /** Radius (in cells) around the starting cell kept free of obstacles. */
  startClearRadius: 7,
};

/** Simulation clock. Rules only ever see whole ticks, so speed never changes outcomes. */
export const TIME = {
  ticksPerSecond: 10,
  speeds: [1, 2, 4] as const,
  /** Max ticks processed in one animation frame (protects slow phones from spiral-of-death). */
  maxTicksPerFrame: 12,
};

/** Soil fertility: a smooth noise field that makes some regions better to grow into. */
export const TERRAIN = {
  /** Feature size of fertile patches, in cells. */
  fertilityScale: 22,
  /** Second, finer octave for irregular edges. */
  detailScale: 7,
  detailWeight: 0.3,
  /** Contrast applied after noise: >1 makes rich/barren regions more distinct. */
  contrast: 1.6,
  /** Obstacles (rock) appear where a separate noise field exceeds this threshold. */
  rockScale: 13,
  rockDetailScale: 5,
  rockThreshold: 0.74,
};

/**
 * Growth traits: the local rules every colony follows. Different colonies (and, later,
 * upgrades and mutations) are just different numbers here.
 */
export interface GrowthTraits {
  /** Ticks between reproduction attempts for a mature cell (before jitter). */
  interval: number;
  /** ±fraction of random variation applied to each interval. */
  intervalJitter: number;
  /** Ticks a newborn cell needs before it can reproduce. */
  maturation: number;
  /** Base chance an attempt succeeds into perfectly fertile, uncrowded ground. */
  vigor: number;
  /** Floor on the success chance in the worst soil (0–1 of vigor). */
  barrenFloor: number;
  /** >0 prefers targets with few friendly neighbours (branches); <0 prefers gaps (compact). */
  branching: number;
  /** How strongly crowded targets are refused outright (slows gap-filling behind tips). */
  crowdRefusal: number;
  /** Preference for continuing in the direction the cell itself was born in (tendrils). */
  persistence: number;
  /** Preference for richer soil when choosing where to grow. */
  fertilityPreference: number;
  /**
   * Relative weight of the four diagonal neighbours as growth targets (0 = cardinal only).
   * Pure 4-neighbour growth drifts into a diamond; a little diagonal growth rounds it out.
   */
  diagonalGrowth: number;
}

export const PLAYER_TRAITS: GrowthTraits = {
  interval: 8,
  intervalJitter: 0.5,
  maturation: 12,
  vigor: 0.9,
  barrenFloor: 0.3,
  branching: 1.6,
  crowdRefusal: 1.1,
  persistence: 0.8,
  fertilityPreference: 2.2,
  diagonalGrowth: 0.2,
};

/** Ranges for the developer Rule Lab sliders (Settings → Developer). */
export const TRAIT_LIMITS: Record<keyof GrowthTraits, { min: number; max: number; step: number; label: string; hint: string }> = {
  interval: { min: 4, max: 40, step: 1, label: 'Division interval', hint: 'Ticks between attempts (lower = faster)' },
  intervalJitter: { min: 0, max: 0.9, step: 0.05, label: 'Timing variation', hint: 'Randomness in each cell’s rhythm' },
  maturation: { min: 0, max: 60, step: 1, label: 'Maturation', hint: 'Ticks before a newborn can divide' },
  vigor: { min: 0.1, max: 1, step: 0.05, label: 'Vigor', hint: 'Success chance in ideal ground' },
  barrenFloor: { min: 0, max: 1, step: 0.05, label: 'Barren tolerance', hint: 'How well it grows in poor soil' },
  branching: { min: -3, max: 4, step: 0.1, label: 'Branching', hint: '+ seeks open space, − fills gaps' },
  crowdRefusal: { min: 0, max: 3, step: 0.1, label: 'Crowd refusal', hint: 'Reluctance to divide into crowded spots' },
  persistence: { min: 0, max: 3, step: 0.1, label: 'Persistence', hint: 'Keeps growing in the same direction' },
  fertilityPreference: { min: 0, max: 5, step: 0.1, label: 'Soil seeking', hint: 'Steers growth toward rich soil' },
  diagonalGrowth: { min: 0, max: 1, step: 0.05, label: 'Diagonal growth', hint: 'Can divide into corner neighbours' },
};

/** Camera framing. The view widens at population milestones (and if the colony nears the edge). */
export const CAMERA = {
  /** Cells visible across the narrow side of the playfield at each scale. */
  viewCells: [21, 31, 45, 65, 95, 140, 200],
  /** Population that triggers the next scale. Length = viewCells.length - 1. */
  milestones: [70, 220, 650, 1700, 4200, 10000],
  /** Also zoom out early if the colony reaches this fraction of the view half-width. */
  edgeFraction: 0.82,
  zoomSeconds: 2.6,
};

/** Rendering and animation timings (milliseconds unless noted). */
export const ANIM = {
  birthMs: 340,
  /** Starting size of a newborn cell, as a fraction of a full cell. */
  birthStartScale: 0.5,
  /** Overshoot of the elastic settle (easeOutBack constant). */
  birthOvershoot: 2.2,
  /** Gap between blocks as a fraction of the cell pitch, and its pixel bounds. */
  gapFraction: 0.12,
  gapMinPx: 1,
  gapMaxPx: 3,
  /** Below this pitch (CSS px) blocks are drawn without gaps or rounding. */
  noGapBelowPx: 6,
  cornerFraction: 0.16,
  /** Below this pitch rounded corners are skipped (cheaper and invisible anyway). */
  roundAbovePx: 9,
};

export const COLORS = {
  background: '#FBFBF9',
  /** Empty soil, barren → rich. Kept very pale so the grid never overwhelms. */
  soilBarren: [0xf3, 0xf3, 0xf0] as const,
  soilRich: [0xe4, 0xe2, 0xd9] as const,
  soilBuckets: 6,
  rock: '#CDCAC2',
  player: '#1B1B1B',
  /** Newborn player cells darken to `player` as they mature. */
  playerYoung: '#5A5A58',
  rivals: {
    orange: '#E69A71',
    blue: '#89AECC',
    green: '#88B69F',
    purple: '#B49BCC',
    yellow: '#D8BE75',
    red: '#D77F78',
  },
};

export const AUDIO = {
  /** Never play more than this many birth pops per second, however many cells divide. */
  maxPopsPerSecond: 9,
};

export const SAVE = {
  key: 'assimilate.save',
  backupKey: 'assimilate.save.bak',
  version: 1,
  autosaveSeconds: 10,
};
