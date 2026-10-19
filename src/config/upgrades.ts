// Upgrades: every faction (you and every rival) buys from this same list.
// Each one changes numbers in the faction's stats; the expansion rules read only those stats.
// Rule for this list: an upgrade must make a faction strictly better and never compete with
// another upgrade. Preferences that trade one thing for another are behaviour sliders instead
// (see BEHAVIOR in balance.ts and Behavior below).

import { BASE_STATS, BEHAVIOR, SPECIAL } from './balance';

export type Stats = { -readonly [K in keyof typeof BASE_STATS]: number };

export type UpgradeCategory = 'expansion' | 'combat' | 'defense' | 'economy';

export const UPGRADE_CATEGORIES: { id: UpgradeCategory; label: string }[] = [
  { id: 'expansion', label: 'Expansion' },
  { id: 'combat', label: 'Combat' },
  { id: 'defense', label: 'Defense' },
  { id: 'economy', label: 'Economy' },
];

export interface UpgradeDef {
  id: string;
  name: string;
  category: UpgradeCategory;
  baseCost: number;
  costGrowth: number;
  maxLevel: number;
  /** Total energy earned this run before it can be bought (0 = available from the start). */
  unlockEarned: number;
  /** One sentence: what it does on the board. */
  blurb: string;
  /** Apply `level` levels to stats. */
  apply: (s: Stats, level: number) => void;
  /** Player-facing value at a level, e.g. "+40% attempts". */
  effect: (level: number) => string;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const plus = (x: number) => `+${Math.round(x * 100)}%`;
const num = (x: number) => (Math.round(x * 100) / 100).toString();

export const UPGRADES: UpgradeDef[] = [
  // ---------- Expansion ----------
  {
    id: 'rate', name: 'Expansion Rate', category: 'expansion', baseCost: 8, costGrowth: 1.42, maxLevel: 60, unlockEarned: 0,
    blurb: 'More expansion attempts every second, everywhere along your border.',
    apply: (s, l) => { s.rate *= 1 + 0.18 * l; },
    effect: (l) => `${num(BASE_STATS.rate * (1 + 0.18 * l))} attempts/s base`,
  },
  {
    id: 'outposts', name: 'Outposts', category: 'expansion', baseCost: 45, costGrowth: 1.7, maxLevel: 10, unlockEarned: 150,
    blurb: 'Some attempts plant a new cell a few squares beyond your border, on open ground. It grows from there.',
    apply: (s, l) => { s.outpost += 0.015 * l; },
    effect: (l) => `${pct(0.015 * l)} of attempts launch an outpost`,
  },
  {
    id: 'targeting', name: 'Coordination', category: 'expansion', baseCost: 40, costGrowth: 1.8, maxLevel: 6, unlockEarned: 120,
    blurb: 'Each attempt weighs more of your border before choosing, so your behaviour settings are followed more precisely.',
    apply: (s, l) => { s.samples += l; },
    effect: (l) => `${BASE_STATS.samples + l} border cells considered`,
  },

  // ---------- Combat ----------
  {
    id: 'power', name: 'Conversion Power', category: 'combat', baseCost: 10, costGrowth: 1.45, maxLevel: 60, unlockEarned: 0,
    blurb: 'Stronger attacks on enemy cells. Wins more border fights.',
    apply: (s, l) => { s.power *= 1 + 0.15 * l; },
    effect: (l) => `Power ${num(1 + 0.15 * l)}`,
  },
  {
    id: 'pressure', name: 'Pressure', category: 'combat', baseCost: 25, costGrowth: 1.55, maxLevel: 20, unlockEarned: 60,
    blurb: 'Bigger bonus for every side you already touch an enemy cell from.',
    apply: (s, l) => { s.pressure += 0.1 * l; },
    effect: (l) => `${plus(BASE_STATS.pressure + 0.1 * l)} power per touching side`,
  },

  {
    id: 'chain', name: 'Chain Reaction', category: 'combat', baseCost: 50, costGrowth: 1.7, maxLevel: 8, unlockEarned: 150,
    blurb: 'A conversion can instantly flip a neighbouring enemy cell too, and that one the next. Fronts can collapse in a cascade.',
    apply: (s, l) => { s.chain += 0.06 * l; },
    effect: (l) => `${pct(0.06 * l)} chance to chain`,
  },
  {
    id: 'veins', name: 'Veins', category: 'combat', baseCost: 45, costGrowth: 1.7, maxLevel: 10, unlockEarned: 150,
    blurb: 'Your capital sends pulses through your territory to the spots spread thinnest or closest to being surrounded, boosting them when they arrive.',
    apply: (s, l) => { s.veins += l; },
    effect: (l) => `Pulse every ${pulseInterval(l)}s to ${pulseTargets(l)} spot${pulseTargets(l) > 1 ? 's' : ''}, +${pct(pulseBoost(l))} power & resistance there`,
  },
  {
    id: 'siege', name: 'Siege', category: 'combat', baseCost: 50, costGrowth: 1.7, maxLevel: 8, unlockEarned: 180,
    blurb: 'Enemy pockets cut off from their main territory lose resistance. Encircle them and they crumble.',
    apply: (s, l) => { s.siege += 0.08 * l; },
    effect: (l) => `Cut-off enemy cells −${pct(0.08 * l)} resistance`,
  },

  // ---------- Defense ----------
  {
    id: 'resistance', name: 'Resistance', category: 'defense', baseCost: 10, costGrowth: 1.45, maxLevel: 60, unlockEarned: 0,
    blurb: 'Every cell is harder to convert.',
    apply: (s, l) => { s.resistance *= 1 + 0.15 * l; },
    effect: (l) => `Resistance ${num(1 + 0.15 * l)}`,
  },
  {
    id: 'reinforcement', name: 'Reinforcement', category: 'defense', baseCost: 25, costGrowth: 1.55, maxLevel: 20, unlockEarned: 60,
    blurb: 'Cells surrounded by your own cells defend much better. Thick borders hold.',
    apply: (s, l) => { s.reinforcement += 0.1 * l; },
    effect: (l) => `${plus(BASE_STATS.reinforcement + 0.1 * l)} resistance per friendly side`,
  },
  {
    id: 'entrenchment', name: 'Entrenchment', category: 'defense', baseCost: 35, costGrowth: 1.6, maxLevel: 15, unlockEarned: 100,
    blurb: 'Cells you have held for a while become tougher. Old ground is hard to take.',
    apply: (s, l) => { s.entrench += 0.2 * l; },
    effect: (l) => `Up to ${plus(0.2 * l)} resistance after ${BASE_STATS.entrenchSeconds}s`,
  },

  {
    id: 'counter', name: 'Counterattack', category: 'defense', baseCost: 40, costGrowth: 1.65, maxLevel: 8, unlockEarned: 120,
    blurb: 'When an attack on you fails, your cell may strike straight back at the cell it came from.',
    apply: (s, l) => { s.counter += 0.08 * l; },
    effect: (l) => `${pct(0.08 * l)} chance to strike back`,
  },
  {
    id: 'capital', name: 'Capital', category: 'defense', baseCost: 30, costGrowth: 1.6, maxLevel: 10, unlockEarned: 80,
    blurb: 'Your starting ground becomes a hardened core. Protection is strongest at home and fades with distance.',
    apply: (s, l) => { s.capital += 0.5 * l; },
    effect: (l) => `Up to +${pct(0.5 * l)} resistance at home`,
  },

  // ---------- Economy ----------
  {
    id: 'yield', name: 'Energy Yield', category: 'economy', baseCost: 10, costGrowth: 1.45, maxLevel: 60, unlockEarned: 0,
    blurb: 'More energy from every neutral cell you claim.',
    apply: (s, l) => { s.yield *= 1 + 0.25 * l; },
    effect: (l) => `${num(2 * (1 + 0.25 * l))} energy per claim`,
  },
  {
    id: 'conquestBonus', name: 'Conquest Bonus', category: 'economy', baseCost: 25, costGrowth: 1.5, maxLevel: 40, unlockEarned: 50,
    blurb: 'More energy from every enemy cell you convert.',
    apply: (s, l) => { s.conquest *= 1 + 0.35 * l; },
    effect: (l) => `${num(6 * (1 + 0.35 * l))} energy per conversion`,
  },
  {
    id: 'tribute', name: 'Tribute', category: 'economy', baseCost: 30, costGrowth: 1.55, maxLevel: 30, unlockEarned: 100,
    blurb: 'Steady energy every second for the territory you hold, even when nothing moves.',
    apply: (s, l) => { s.tribute += 0.25 * l; },
    effect: (l) => `+${num(0.25 * l)} energy/s per 100 cells`,
  },
  {
    id: 'efficiency', name: 'Upgrade Cost Reduction', category: 'economy', baseCost: 60, costGrowth: 2.0, maxLevel: 10, unlockEarned: 200,
    blurb: 'Every upgrade costs less.',
    apply: (s, l) => { s.costMult *= 1 - 0.04 * l; },
    effect: (l) => `Prices −${pct(0.04 * l)}`,
  },
];

/** Veins (pulses) by level: seconds between pulses, weak spots reached, and the boost given. */
export function pulseInterval(level: number): number {
  return Math.max(SPECIAL.pulseIntervalMin, Math.round(SPECIAL.pulseInterval - SPECIAL.pulseIntervalPerLevel * (level - 1)));
}
export function pulseTargets(level: number): number {
  return 1 + Math.floor(level / 4);
}
export function pulseBoost(level: number): number {
  return 0.15 + 0.07 * level;
}

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

/** Behaviour slider positions, each −1…+1. */
export interface Behavior {
  /** Claim open ground (−1) ↔ attack enemies (+1). */
  focus: number;
  /** Compact (−1) ↔ branching (+1). */
  shape: number;
  /** Even growth (−1) ↔ spearheads (+1). */
  reach: number;
  /** Defend and retake (−1) ↔ exploit weak points (+1). */
  posture: number;
}

export const BEHAVIOR_KEYS = ['focus', 'shape', 'reach', 'posture'] as const;

export function neutralBehavior(): Behavior {
  return { focus: 0, shape: 0, reach: 0, posture: 0 };
}

/** Stats for a set of upgrade levels and behaviour settings. */
export function deriveStats(levels: Record<string, number>, b: Behavior = neutralBehavior()): Stats {
  const s: Stats = { ...BASE_STATS };
  for (const def of UPGRADES) {
    const l = levels[def.id] ?? 0;
    if (l > 0) def.apply(s, l);
  }
  s.aggression += BEHAVIOR.focus * b.focus;
  s.consolidation -= BEHAVIOR.shape * b.shape;
  s.momentum = BEHAVIOR.reach * b.reach;
  const defend = Math.max(0, -b.posture);
  const exploit = Math.max(0, b.posture);
  s.threat = BEHAVIOR.defend * defend;
  s.recovery = BEHAVIOR.defend * defend;
  s.flanking = BEHAVIOR.exploit * exploit;
  return s;
}
