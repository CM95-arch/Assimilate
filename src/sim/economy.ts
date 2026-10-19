// Prices, unlocks and purchases. Used by the player's Upgrades screen and by rival AI alike.

import { UPGRADE_BY_ID, UPGRADES, type UpgradeDef } from '../config/upgrades';
import { refreshStats, type Faction } from './faction';

export type BuyAmount = 1 | 10 | 'max';

export function upgradeCost(def: UpgradeDef, level: number): number {
  return Math.ceil(def.baseCost * def.costGrowth ** level);
}

export function isUnlocked(def: UpgradeDef, f: Faction): boolean {
  return f.earned >= def.unlockEarned;
}

export interface Quote {
  count: number;
  cost: number;
  nextCost: number;
}

/** What `amount` would buy right now. ×1 and ×10 quote the full amount even if unaffordable. */
export function quote(f: Faction, id: string, amount: BuyAmount): Quote {
  const def = UPGRADE_BY_ID[id];
  const level = f.levels[id] ?? 0;
  const room = def.maxLevel - level;
  const nextCost = room > 0 ? upgradeCost(def, level) : Infinity;
  const want = amount === 'max' ? room : Math.min(amount, room);
  let cost = 0;
  let count = 0;
  for (let i = 0; i < want; i++) {
    const c = upgradeCost(def, level + i);
    if (amount === 'max' && cost + c > f.energy) break;
    cost += c;
    count++;
  }
  if (amount === 'max' && count === 0 && room > 0) return { count: 1, cost: nextCost, nextCost };
  return { count, cost, nextCost };
}

export interface BuyResult {
  ok: boolean;
  bought: number;
  reason?: string;
}

export function buy(f: Faction, id: string, amount: BuyAmount = 1): BuyResult {
  const def = UPGRADE_BY_ID[id];
  if (!def) return { ok: false, bought: 0, reason: 'Unknown upgrade' };
  if (!f.alive) return { ok: false, bought: 0, reason: 'This match has ended' };
  if (!isUnlocked(def, f)) return { ok: false, bought: 0, reason: 'Not unlocked yet' };
  const q = quote(f, id, amount);
  if (q.count === 0) return { ok: false, bought: 0, reason: 'Already at max level' };
  if (q.cost > f.energy) return { ok: false, bought: 0, reason: `Need ${Math.ceil(q.cost - f.energy)} more energy` };
  f.energy -= q.cost;
  f.levels[id] = (f.levels[id] ?? 0) + q.count;
  refreshStats(f);
  return { ok: true, bought: q.count };
}

/** Anything the faction could buy right now (for the Upgrades tab badge). */
export function anyAffordable(f: Faction): boolean {
  return UPGRADES.some((d) => isUnlocked(d, f) && (f.levels[d.id] ?? 0) < d.maxLevel && upgradeCost(d, f.levels[d.id] ?? 0) <= f.energy);
}
