// Upgrades: every faction (you and every rival) buys from this same list.
// Each one changes numbers in the faction's stats; the expansion rules read only those stats.
// Behaviour upgrades shift priorities, so their effect shows up as a different territory shape.

import { BASE_STATS } from './balance';

export type Stats = { -readonly [K in keyof typeof BASE_STATS]: number };

export type UpgradeCategory = 'expansion' | 'combat' | 'defense' | 'strategy' | 'economy';

export const UPGRADE_CATEGORIES: { id: UpgradeCategory; label: string }[] = [
  { id: 'expansion', label: 'Expansion' },
  { id: 'combat', label: 'Combat' },
  { id: 'defense', label: 'Defense' },
  { id: 'strategy', label: 'Strategy' },
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
    effect: (l) => `${num(1.05 * (1 + 0.18 * l))} attempts/s base`,
  },
  {
    id: 'branching', name: 'Branching', category: 'expansion', baseCost: 20, costGrowth: 1.6, maxLevel: 10, unlockEarned: 30,
    blurb: 'Prefer open ground away from your own cells. Territory reaches out in fingers.',
    apply: (s, l) => { s.branching += 0.45 * l; },
    effect: (l) => `Reach-out bias ${num(0.45 * l)}`,
  },
  {
    id: 'consolidation', name: 'Consolidation', category: 'expansion', baseCost: 20, costGrowth: 1.6, maxLevel: 10, unlockEarned: 30,
    blurb: 'Prefer filling gaps next to your own cells. Territory grows compact and hard to cut.',
    apply: (s, l) => { s.consolidation += 0.45 * l; },
    effect: (l) => `Gap-filling bias ${num(0.4 + 0.45 * l)}`,
  },
  {
    id: 'momentum', name: 'Directional Momentum', category: 'expansion', baseCost: 30, costGrowth: 1.6, maxLevel: 10, unlockEarned: 80,
    blurb: 'Push hardest at your outermost edges. Long spearheads race outward.',
    apply: (s, l) => { s.momentum += 0.6 * l; },
    effect: (l) => `Outward push ${num(0.6 * l)}`,
  },
  {
    id: 'targeting', name: 'Frontier Coordination', category: 'expansion', baseCost: 45, costGrowth: 1.8, maxLevel: 6, unlockEarned: 120,
    blurb: 'Each attempt weighs more of your border before choosing. Priorities are followed more precisely.',
    apply: (s, l) => { s.samples += l; },
    effect: (l) => `${4 + l} border cells considered`,
  },

  // ---------- Combat ----------
  {
    id: 'power', name: 'Conversion Power', category: 'combat', baseCost: 10, costGrowth: 1.45, maxLevel: 60, unlockEarned: 0,
    blurb: 'Stronger attacks on enemy cells. Wins more border fights.',
    apply: (s, l) => { s.power *= 1 + 0.15 * l; },
    effect: (l) => `Power ${num(1 + 0.15 * l)}`,
  },
  {
    id: 'aggression', name: 'Aggression', category: 'combat', baseCost: 18, costGrowth: 1.55, maxLevel: 10, unlockEarned: 25,
    blurb: 'Prefer attacking enemy cells over claiming open ground.',
    apply: (s, l) => { s.aggression += 0.35 * l; },
    effect: (l) => `Attack preference ×${num(Math.exp(0.35 * l))}`,
  },
  {
    id: 'pressure', name: 'Pressure', category: 'combat', baseCost: 25, costGrowth: 1.55, maxLevel: 20, unlockEarned: 60,
    blurb: 'Bigger bonus for every side you already touch an enemy cell from.',
    apply: (s, l) => { s.pressure += 0.1 * l; },
    effect: (l) => `${plus(0.25 + 0.1 * l)} power per touching side`,
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
    effect: (l) => `${plus(0.25 + 0.1 * l)} resistance per friendly side`,
  },
  {
    id: 'entrenchment', name: 'Entrenchment', category: 'defense', baseCost: 35, costGrowth: 1.6, maxLevel: 15, unlockEarned: 100,
    blurb: 'Cells you have held for a while become tougher. Old ground is hard to take.',
    apply: (s, l) => { s.entrench += 0.2 * l; },
    effect: (l) => `Up to ${plus(0.2 * l)} resistance after 40s`,
  },
  {
    id: 'recovery', name: 'Recovery', category: 'defense', baseCost: 30, costGrowth: 1.6, maxLevel: 10, unlockEarned: 100,
    blurb: 'Prefer retaking cells you lost in the last 30 seconds.',
    apply: (s, l) => { s.recovery += 0.6 * l; },
    effect: (l) => `Retake priority ×${num(1 + 0.6 * l)}`,
  },

  // ---------- Strategy ----------
  {
    id: 'flanking', name: 'Flanking', category: 'strategy', baseCost: 30, costGrowth: 1.6, maxLevel: 10, unlockEarned: 80,
    blurb: 'Prefer enemy cells with few defenders and ones you already touch from several sides.',
    apply: (s, l) => { s.flanking += 0.5 * l; },
    effect: (l) => `Weak-point focus ${num(0.5 * l)}`,
  },
  {
    id: 'threat', name: 'Threat Response', category: 'strategy', baseCost: 30, costGrowth: 1.6, maxLevel: 10, unlockEarned: 80,
    blurb: 'Concentrate effort where your border is under attack right now.',
    apply: (s, l) => { s.threat += 0.6 * l; },
    effect: (l) => `Focus on attacked areas ×${num(1 + 0.6 * l)}`,
  },

  // ---------- Economy ----------
  {
    id: 'yield', name: 'Energy Yield', category: 'economy', baseCost: 10, costGrowth: 1.45, maxLevel: 60, unlockEarned: 0,
    blurb: 'More energy from every neutral cell you claim.',
    apply: (s, l) => { s.yield *= 1 + 0.25 * l; },
    effect: (l) => `${num(1 + 0.25 * l)} energy per claim`,
  },
  {
    id: 'conquestBonus', name: 'Conquest Bonus', category: 'economy', baseCost: 25, costGrowth: 1.5, maxLevel: 40, unlockEarned: 50,
    blurb: 'More energy from every enemy cell you convert.',
    apply: (s, l) => { s.conquest *= 1 + 0.35 * l; },
    effect: (l) => `${num(3 * (1 + 0.35 * l))} energy per conversion`,
  },
  {
    id: 'efficiency', name: 'Upgrade Cost Reduction', category: 'economy', baseCost: 60, costGrowth: 2.0, maxLevel: 10, unlockEarned: 200,
    blurb: 'Every upgrade costs less.',
    apply: (s, l) => { s.costMult *= 1 - 0.04 * l; },
    effect: (l) => `Prices −${pct(0.04 * l)}`,
  },
];

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

/** Stats for a set of upgrade levels. */
export function deriveStats(levels: Record<string, number>): Stats {
  const s: Stats = { ...BASE_STATS };
  for (const def of UPGRADES) {
    const l = levels[def.id] ?? 0;
    if (l > 0) def.apply(s, l);
  }
  return s;
}
