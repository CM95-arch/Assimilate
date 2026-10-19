// Upgrades: every faction (you and every rival) buys from this same list, fresh each match.
// Each one changes numbers in the faction's stats; the expansion rules read only those stats.
// Rule for this list: an upgrade must make a faction strictly better and never compete with
// another upgrade. Preferences that trade one thing for another are behaviour sliders instead
// (see BEHAVIOR in balance.ts and Behavior below).

import { BASE_STATS, BEHAVIOR } from './balance';

export type Stats = { -readonly [K in keyof typeof BASE_STATS]: number };

export interface UpgradeDef {
  id: string;
  name: string;
  baseCost: number;
  costGrowth: number;
  maxLevel: number;
  /** Total energy earned this match before it can be bought (0 = available from the start). */
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

// Upgrades last for one match and prices climb steeply, so a match affords roughly half of
// everything: choosing what to buy is the point.
export const UPGRADES: UpgradeDef[] = [
  {
    id: 'rate', name: 'Expansion Rate', baseCost: 10, costGrowth: 1.9, maxLevel: 15, unlockEarned: 0,
    blurb: 'More expansion attempts every second, everywhere along your border.',
    apply: (s, l) => { s.rate *= 1 + 0.2 * l; },
    effect: (l) => `${num(BASE_STATS.rate * (1 + 0.2 * l))} attempts/s base`,
  },
  {
    id: 'power', name: 'Conversion Power', baseCost: 10, costGrowth: 1.9, maxLevel: 15, unlockEarned: 0,
    blurb: 'Stronger attacks on enemy cells. Wins more border fights.',
    apply: (s, l) => { s.power *= 1 + 0.2 * l; },
    effect: (l) => `Power ${num(1 + 0.2 * l)}`,
  },
  {
    id: 'resistance', name: 'Resistance', baseCost: 10, costGrowth: 1.9, maxLevel: 15, unlockEarned: 0,
    blurb: 'Every cell is harder to convert.',
    apply: (s, l) => { s.resistance *= 1 + 0.2 * l; },
    effect: (l) => `Resistance ${num(1 + 0.2 * l)}`,
  },
  {
    id: 'yield', name: 'Income', baseCost: 10, costGrowth: 1.9, maxLevel: 15, unlockEarned: 0,
    blurb: 'More energy from everything: the ground you hold, the land you claim, the cells you take.',
    apply: (s, l) => { s.yield *= 1 + 0.15 * l; },
    effect: (l) => `${plus(0.15 * l)} energy`,
  },
  {
    id: 'reinforcement', name: 'Reinforcement', baseCost: 20, costGrowth: 1.9, maxLevel: 8, unlockEarned: 40,
    blurb: 'Cells surrounded by your own cells defend much better. Thick borders hold.',
    apply: (s, l) => { s.reinforcement += 0.08 * l; },
    effect: (l) => `${plus(BASE_STATS.reinforcement + 0.08 * l)} resistance per friendly side`,
  },
  {
    id: 'chain', name: 'Chain Reaction', baseCost: 30, costGrowth: 2.1, maxLevel: 6, unlockEarned: 120,
    blurb: 'A conversion can instantly flip a neighbouring enemy cell too, and that one the next. Fronts can collapse in a cascade.',
    apply: (s, l) => { s.chain += 0.08 * l; },
    effect: (l) => `${pct(0.08 * l)} chance to chain`,
  },
  {
    id: 'siege', name: 'Siege', baseCost: 30, costGrowth: 2.1, maxLevel: 6, unlockEarned: 120,
    blurb: 'Enemy pockets cut off from their main territory lose resistance. Encircle them and they crumble.',
    apply: (s, l) => { s.siege += 0.12 * l; },
    effect: (l) => `Cut-off enemy cells −${pct(0.12 * l)} resistance`,
  },
  {
    id: 'counter', name: 'Counterattack', baseCost: 30, costGrowth: 2.1, maxLevel: 6, unlockEarned: 120,
    blurb: 'When an attack on you fails, your cell may strike straight back at the cell it came from.',
    apply: (s, l) => { s.counter += 0.1 * l; },
    effect: (l) => `${pct(0.1 * l)} chance to strike back`,
  },
];

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
