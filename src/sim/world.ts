// The simulation: an infinite grid, the factions on it and a fixed tick. Pure logic,
// deterministic per seed, no rendering. Shared by live play, tests and scripts.

import { COLORS, ENERGY, RIVALS, START, TIME } from '../config/balance';
import { UPGRADES } from '../config/upgrades';
import { PROFILE_BY_ID, PROFILES } from '../config/profiles';
import { buy, isUnlocked, upgradeCost } from './economy';
import { chooseTarget, conversionChance, type Candidate, type Context } from './expansion';
import { centroid, createFaction, radius, refreshStats, type Faction } from './faction';
import { cellKey, DX, DY, Grid, keyX, keyY, NEUTRAL } from './grid';
import { Rng } from './rng';

export const PLAYER = 1;

export type SimEvent =
  | { type: 'capture'; x: number; y: number; by: number; from: number }
  | { type: 'hit'; x: number; y: number; by: number; owner: number }
  | { type: 'spawn'; faction: number }
  | { type: 'eliminated'; faction: number; by: number }
  | { type: 'defeat' };

const DT = 1 / TIME.ticksPerSecond;

export class World {
  readonly grid = new Grid();
  readonly rng: Rng;
  readonly factions = new Map<number, Faction>();
  tick = 0;
  /** Events since the consumer last drained them (renderer, audio, UI). Capped. */
  events: SimEvent[] = [];
  /** Energy gained by the player per tick over the last few seconds (for the HUD rate). */
  private energyLog: number[] = [];
  private cellLog: number[] = [];
  private nextSpawnCheck = 0;
  private rivalsCreated = 0;
  ended = false;

  constructor(readonly seed: number) {
    this.rng = new Rng(seed ^ 0x9e3779b9);
  }

  get time(): number {
    return this.tick * DT;
  }

  get player(): Faction {
    return this.factions.get(PLAYER)!;
  }

  /** A new run: your cluster at the origin and the first two rivals. */
  static create(seed: number): World {
    const w = new World(seed);
    const p = createFaction(PLAYER, 'You', COLORS.player, true);
    w.factions.set(PLAYER, p);
    p.energy = START.playerEnergy;
    w.placeCluster(p, 0, 0);
    const a = w.rng.next() * Math.PI * 2;
    w.spawnRival(a, RIVALS.firstDistance, 0, 0);
    w.spawnRival(a + Math.PI * (0.6 + w.rng.next() * 0.8), RIVALS.secondDistance, 0, 0);
    w.events.length = 0;
    return w;
  }

  // ---------------------------------------------------------------- territory bookkeeping

  /** Change a cell's owner and keep every faction's caches exact. */
  transfer(x: number, y: number, to: number) {
    const from = this.grid.set(x, y, to, this.time);
    if (from === to) return;
    const k = cellKey(x, y);
    if (from !== NEUTRAL) {
      const f = this.factions.get(from)!;
      f.cells--;
      f.sumX -= x;
      f.sumY -= y;
      f.lost++;
      f.frontier.delete(k);
    }
    if (to !== NEUTRAL) {
      const f = this.factions.get(to)!;
      f.cells++;
      f.sumX += x;
      f.sumY += y;
      if (f.cells > f.peakCells) f.peakCells = f.cells;
      if (f.cells === 1) {
        f.minX = f.maxX = x;
        f.minY = f.maxY = y;
      } else {
        if (x < f.minX) f.minX = x;
        if (x > f.maxX) f.maxX = x;
        if (y < f.minY) f.minY = y;
        if (y > f.maxY) f.maxY = y;
      }
    }
    // The cell and its four neighbours may have gained or lost frontier status.
    this.refreshFrontier(x, y);
    for (let d = 0; d < 4; d++) this.refreshFrontier(x + DX[d], y + DY[d]);
  }

  private refreshFrontier(x: number, y: number) {
    const o = this.grid.owner(x, y);
    if (o === NEUTRAL) return;
    const f = this.factions.get(o)!;
    if (this.grid.isFrontier(x, y, o)) f.frontier.add(cellKey(x, y));
    else f.frontier.delete(cellKey(x, y));
  }

  /** Grow a random connected cluster of 5–9 cells for a faction around (x, y). */
  placeCluster(f: Faction, x: number, y: number) {
    f.homeX = x;
    f.homeY = y;
    f.spawnedAt = this.time;
    const size = START.minCells + this.rng.int(START.maxCells - START.minCells + 1);
    this.transfer(x, y, f.id);
    let guard = 0;
    while (f.cells < size && guard++ < 500) {
      const k = f.frontier.pick(this.rng.next());
      const d = this.rng.int(4);
      const nx = keyX(k) + DX[d];
      const ny = keyY(k) + DY[d];
      if (this.grid.owner(nx, ny) === NEUTRAL) this.transfer(nx, ny, f.id);
    }
  }

  /** Recompute a faction's bounding box from its frontier (extremes are always frontier cells). */
  refreshBounds(f: Faction) {
    if (f.frontier.size === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const k of f.frontier.values()) {
      const x = keyX(k);
      const y = keyY(k);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    f.minX = minX;
    f.maxX = maxX;
    f.minY = minY;
    f.maxY = maxY;
  }

  // ---------------------------------------------------------------- rivals

  /** How far the player's territory reaches from its centre (cells). */
  playerReach(): number {
    const p = this.player;
    const c = centroid(p);
    return Math.max(4, Math.abs(p.minX - c.x), Math.abs(p.maxX - c.x), Math.abs(p.minY - c.y), Math.abs(p.maxY - c.y));
  }

  /** True if a square of radius r around (x, y) is neutral and no territory lies within `gap`. */
  private siteIsClear(x: number, y: number, r: number, gap: number): boolean {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (this.grid.owner(x + dx, y + dy) !== NEUTRAL) return false;
    for (const f of this.factions.values()) {
      if (!f.alive || f.cells === 0) continue;
      // Quick reject by bounding box, then an exact check on frontier cells.
      if (x < f.minX - gap || x > f.maxX + gap || y < f.minY - gap || y > f.maxY + gap) continue;
      for (const k of f.frontier.values()) if (Math.abs(keyX(k) - x) <= gap && Math.abs(keyY(k) - y) <= gap) return false;
    }
    return true;
  }

  /**
   * Spawn a rival at `angle` and a random distance in `dist` from (ox, oy). It receives about as
   * much energy as you have earned so far and spends it on its own upgrade route at once.
   */
  spawnRival(angle: number, dist: readonly [number, number], ox: number, oy: number): Faction | null {
    let site: { x: number; y: number } | null = null;
    for (let tries = 0; tries < 24 && !site; tries++) {
      const a = angle + (tries === 0 ? 0 : (this.rng.next() - 0.5) * Math.PI * 0.9);
      const d = dist[0] + this.rng.next() * (dist[1] - dist[0]) + tries;
      const x = Math.round(ox + Math.cos(a) * d);
      const y = Math.round(oy + Math.sin(a) * d);
      if (this.siteIsClear(x, y, RIVALS.clearRadius, RIVALS.minGapToTerritory)) site = { x, y };
    }
    if (!site) return null;
    // Fresh ids keep old territory memories (Recovery) from being inherited; reuse only past 254.
    let id = 2 + this.rivalsCreated;
    if (id > 254) {
      id = 2;
      while (this.factions.get(id)?.alive) id++;
      if (id > 254) return null;
    }
    const n = this.rivalsCreated++;
    const profile = PROFILES[this.rng.int(PROFILES.length)];
    const taste: Record<string, number> = {};
    for (const u of UPGRADES) taste[u.id] = Math.exp((this.rng.next() - 0.5) * 1.6);
    const color = COLORS.rivals[n % COLORS.rivals.length];
    const name = COLORS.rivalNames[n % COLORS.rivalNames.length];
    const f = createFaction(id, name, color, false, profile.id, taste);
    this.factions.set(id, f);
    this.placeCluster(f, site.x, site.y);
    const p = this.factions.get(PLAYER);
    if (p) {
      const j = RIVALS.budgetJitter;
      // As if it had played since the start: the same starting energy plus what you have earned.
      const earned = p.earned * (j[0] + this.rng.next() * (j[1] - j[0]));
      f.energy = START.playerEnergy + earned;
      f.earned = earned;
      this.rivalShop(f);
    }
    this.events.push({ type: 'spawn', faction: id });
    return f;
  }

  /** Rival purchasing: best value by this rival's own tastes, saving up when needed. */
  rivalShop(f: Faction) {
    const profile = PROFILE_BY_ID[f.profile];
    for (let guard = 0; guard < 400; guard++) {
      let best: string | null = null;
      let bestScore = 0;
      let bestCost = 0;
      for (const def of UPGRADES) {
        const level = f.levels[def.id] ?? 0;
        if (level >= def.maxLevel || !isUnlocked(def, f)) continue;
        const want = (profile?.weights[def.id] ?? 0.3) * (f.taste[def.id] ?? 1);
        const cost = upgradeCost(def, level, f.stats.costMult);
        // Diminishing returns: each level a little less appealing than the last.
        const value = want / (cost * (1 + 0.08 * level));
        if (value > bestScore) {
          bestScore = value;
          best = def.id;
          bestCost = cost;
        }
      }
      if (!best || bestCost > f.energy) return;
      buy(f, best, 1);
    }
  }

  private maybeSpawnRivals() {
    if (this.time < this.nextSpawnCheck) return;
    this.nextSpawnCheck = this.time + RIVALS.checkSeconds;
    const p = this.player;
    if (!p.alive) return;
    this.refreshBounds(p);
    const reach = this.playerReach();
    const c = centroid(p);
    const near = RIVALS.dormantBeyond + reach;
    let nearby = 0;
    let alive = 0;
    for (const f of this.factions.values()) {
      if (f.isPlayer || !f.alive) continue;
      alive++;
      const fc = centroid(f);
      if (Math.hypot(fc.x - c.x, fc.y - c.y) < near) nearby++;
    }
    const wanted = RIVALS.baseCount + Math.floor(reach / RIVALS.reachPerExtra);
    if (nearby < wanted && alive < RIVALS.maxAlive) {
      const dist = [reach + RIVALS.spawnBeyond[0], reach + RIVALS.spawnBeyond[1]] as const;
      this.spawnRival(this.rng.next() * Math.PI * 2, dist, Math.round(c.x), Math.round(c.y));
    }
  }

  /** Factions far from you pause, so an infinite world costs nothing where you aren't. */
  isDormant(f: Faction): boolean {
    if (f.isPlayer) return false;
    const p = this.player;
    const pc = centroid(p);
    const fc = centroid(f);
    return Math.hypot(fc.x - pc.x, fc.y - pc.y) > RIVALS.dormantBeyond + this.playerReach() + radius(f);
  }

  // ---------------------------------------------------------------- the tick

  step() {
    this.tick++;
    const now = this.time;
    const p = this.player;
    const energyBefore = p.earned;
    const cellsBefore = p.cells;
    const order = [...this.factions.values()].filter((f) => f.alive && f.cells > 0 && !this.isDormant(f));
    // Shuffle so no faction always moves first.
    for (let i = order.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const f of order) {
      if (!f.alive) continue;
      f.budget += f.stats.rate * (1 + f.stats.sizeBonus * Math.sqrt(f.cells)) * DT;
      if (f.budget < 1) continue;
      const c = centroid(f);
      const ctx: Context = { grid: this.grid, f, now, cx: c.x, cy: c.y, r: radius(f) };
      while (f.budget >= 1 && f.alive) {
        f.budget -= 1;
        this.attempt(ctx);
      }
      if (!f.isPlayer) this.rivalShop(f);
    }
    if (this.tick % 10 === 0) for (const f of this.factions.values()) if (f.alive) this.refreshBounds(f);
    this.maybeSpawnRivals();
    this.energyLog.push(p.earned - energyBefore);
    this.cellLog.push(p.cells - cellsBefore);
    const window = ENERGY.rateWindowSeconds * TIME.ticksPerSecond;
    if (this.energyLog.length > window) this.energyLog.shift();
    if (this.cellLog.length > window) this.cellLog.shift();
  }

  private readonly scratch: Candidate[] = [];

  private attempt(ctx: Context) {
    const f = ctx.f;
    const t = chooseTarget(ctx, this.rng, this.scratch);
    if (!t) return;
    if (t.owner === NEUTRAL) {
      if (this.rng.next() >= f.stats.neutralSuccess) return;
      this.transfer(t.x, t.y, f.id);
      f.claimed++;
      this.earn(f, ENERGY.neutral * f.stats.yield);
      this.emit({ type: 'capture', x: t.x, y: t.y, by: f.id, from: NEUTRAL });
      return;
    }
    const def = this.factions.get(t.owner)!;
    const p = conversionChance(this.grid, f.stats, f.id, def.stats, def.id, t.x, t.y, ctx.now);
    this.grid.markHit(t.x, t.y, ctx.now);
    if (this.rng.next() >= p) {
      this.emit({ type: 'hit', x: t.x, y: t.y, by: f.id, owner: def.id });
      return;
    }
    this.transfer(t.x, t.y, f.id);
    f.converted++;
    this.earn(f, ENERGY.conquest * f.stats.conquest);
    this.emit({ type: 'capture', x: t.x, y: t.y, by: f.id, from: def.id });
    if (def.cells === 0) this.eliminate(def, f.id);
  }

  private earn(f: Faction, amount: number) {
    f.energy += amount;
    f.earned += amount;
  }

  private eliminate(f: Faction, by: number) {
    f.alive = false;
    f.frontier.clear();
    this.emit({ type: 'eliminated', faction: f.id, by });
    if (f.isPlayer) {
      this.ended = true;
      this.emit({ type: 'defeat' });
    }
  }

  private emit(e: SimEvent) {
    if (this.events.length < 20000) this.events.push(e);
  }

  /** Player energy per second over the recent window. */
  energyRate(): number {
    if (this.energyLog.length === 0) return 0;
    return (this.energyLog.reduce((a, b) => a + b, 0) / this.energyLog.length) * TIME.ticksPerSecond;
  }

  /** Player net cells per second over the recent window. */
  cellRate(): number {
    if (this.cellLog.length === 0) return 0;
    return (this.cellLog.reduce((a, b) => a + b, 0) / this.cellLog.length) * TIME.ticksPerSecond;
  }

  /** Living rivals that share a border with the player right now. */
  contacts(): number[] {
    const p = this.player;
    const touching = new Set<number>();
    for (const k of p.frontier.values()) {
      const x = keyX(k);
      const y = keyY(k);
      for (let d = 0; d < 4; d++) {
        const o = this.grid.owner(x + DX[d], y + DY[d]);
        if (o !== NEUTRAL && o !== PLAYER) touching.add(o);
      }
    }
    return [...touching];
  }

  // ---------------------------------------------------------------- persistence support

  /** Internal counters a save must carry to resume exactly. */
  get counters() {
    return { rivalsCreated: this.rivalsCreated, nextSpawnCheck: this.nextSpawnCheck };
  }

  set counters(c: { rivalsCreated: number; nextSpawnCheck: number }) {
    this.rivalsCreated = c.rivalsCreated;
    this.nextSpawnCheck = c.nextSpawnCheck;
  }

  /** Rebuild every faction's cached territory facts from the grid (after loading). */
  rebuildCaches() {
    for (const f of this.factions.values()) {
      f.cells = 0;
      f.sumX = 0;
      f.sumY = 0;
      f.frontier.clear();
    }
    this.grid.forEachOwned((x, y, o) => {
      const f = this.factions.get(o);
      if (!f) return;
      f.cells++;
      f.sumX += x;
      f.sumY += y;
      if (this.grid.isFrontier(x, y, o)) f.frontier.add(cellKey(x, y));
    });
    for (const f of this.factions.values()) {
      refreshStats(f);
      this.refreshBounds(f);
      if (f.cells === 0 && f.alive) f.alive = false;
    }
  }

  /** Recount from the grid; tests use this to prove caches never drift. */
  audit(): string[] {
    const problems: string[] = [];
    const counts = new Map<number, number>();
    const front = new Map<number, number>();
    this.grid.forEachOwned((x, y, o) => {
      counts.set(o, (counts.get(o) ?? 0) + 1);
      const f = this.factions.get(o);
      if (!f) {
        problems.push(`cell ${x},${y} owned by unknown faction ${o}`);
        return;
      }
      const isF = this.grid.isFrontier(x, y, o);
      if (isF) front.set(o, (front.get(o) ?? 0) + 1);
      if (isF !== f.frontier.has(cellKey(x, y))) problems.push(`frontier mismatch at ${x},${y} for ${o}`);
    });
    for (const f of this.factions.values()) {
      if ((counts.get(f.id) ?? 0) !== f.cells) problems.push(`${f.name}: cells cache ${f.cells} ≠ grid ${counts.get(f.id) ?? 0}`);
      if ((front.get(f.id) ?? 0) !== f.frontier.size) problems.push(`${f.name}: frontier size ${f.frontier.size} ≠ ${front.get(f.id) ?? 0}`);
    }
    return problems;
  }
}
