// The simulation: one match in a square arena, the factions in it and a fixed tick. Pure logic,
// deterministic per seed, no rendering. Shared by live play, tests and scripts.

import { COMBAT, COLORS, ENERGY, LEADER, leagueInfo, MATCH, SPECIAL, START, TEMPO, TIME, type League } from '../config/balance';
import { UPGRADES } from '../config/upgrades';
import { PROFILE_BY_ID, PROFILES } from '../config/profiles';
import { buy, isUnlocked, upgradeCost } from './economy';
import { chooseTarget, conversionChance, groupSize, type Candidate, type Context } from './expansion';
import { centroid, createFaction, radius, refreshStats, type Faction } from './faction';
import { cellKey, DX, DY, Grid, keyX, keyY, NEUTRAL } from './grid';
import { Rng } from './rng';

export const PLAYER = 1;

/** Why a capture happened, for its visual effect. */
export type CaptureKind = 'normal' | 'chain' | 'counter';

export type SimEvent =
  | { type: 'capture'; x: number; y: number; by: number; from: number; kind?: CaptureKind; link?: number }
  | { type: 'hit'; x: number; y: number; by: number; owner: number }
  | { type: 'spawn'; faction: number }
  | { type: 'eliminated'; faction: number; by: number }
  /** A faction's territory reached its rally flag (the flag is then taken down). */
  | { type: 'flag'; faction: number }
  | { type: 'defeat' }
  /** Someone holds the winning share of the arena (you, or a rival: then you lose). */
  | { type: 'won'; faction: number };

const DT = 1 / TIME.ticksPerSecond;

export class World {
  readonly grid = new Grid();
  readonly rng: Rng;
  /** Bumped whenever a flag moves, so the screen knows to redraw. */
  flagVersion = 0;
  readonly factions = new Map<number, Faction>();
  tick = 0;
  /** Events since the consumer last drained them (renderer, audio, UI). Capped. */
  events: SimEvent[] = [];
  /** Energy gained by the player per tick over the last few seconds (for the HUD rate). */
  private energyLog: number[] = [];
  private cellLog: number[] = [];
  ended = false;
  /** The faction that won the match, once it is over (0 if you were wiped out first). */
  winner = 0;
  /** This match's league: arena size, number of rivals and their income. */
  readonly info: League;
  /** The faction rivals are ganging up on (0 if nobody leads clearly), and how hard (≥ 1). */
  leader = 0;
  leaderFocus = 1;
  /** Tests can switch the world tempo off to measure the base rules. */
  useTempo = true;
  /** Siege pocket checks, memoised per tick. */
  private pocketMemo = new Map<number, boolean>();

  constructor(readonly seed: number, readonly league = 1) {
    this.rng = new Rng(seed ^ 0x9e3779b9);
    this.info = leagueInfo(league);
  }

  /** Side of the square arena (cells run from 0 to size − 1 on both axes). */
  get size(): number {
    return this.info.size;
  }

  /** Rule tests switch the arena's edges off to study the rules on open ground. */
  unbounded = false;

  /** Lowest and one-past-highest coordinate inside the arena, on both axes. */
  get lo(): number {
    return this.unbounded ? -Infinity : 0;
  }

  get hi(): number {
    return this.unbounded ? Infinity : this.info.size;
  }

  inBounds(x: number, y: number): boolean {
    return x >= this.lo && y >= this.lo && x < this.hi && y < this.hi;
  }

  /** Cells needed to win: the winning share of the whole arena. */
  get winCells(): number {
    return this.unbounded ? Infinity : Math.ceil(MATCH.winShare * this.size * this.size);
  }

  get time(): number {
    return this.tick * DT;
  }

  /** Expansion-rate multiplier for everyone: rises from 1× to TEMPO.max over TEMPO.rampSeconds. */
  tempo(): number {
    if (!this.useTempo) return 1;
    const t = Math.min(1, this.time / TEMPO.rampSeconds);
    return 1 + (TEMPO.max - 1) * t * t * (3 - 2 * t);
  }

  get player(): Faction {
    return this.factions.get(PLAYER)!;
  }

  /**
   * A new match: you and every rival start at the same moment with the same energy, spread
   * evenly around a ring, each rival with its own personality.
   */
  static create(seed: number, league = 1): World {
    const w = new World(seed, league);
    const p = createFaction(PLAYER, 'You', COLORS.player, true);
    w.factions.set(PLAYER, p);
    const n = w.info.rivals + 1;
    const a0 = w.rng.next() * Math.PI * 2;
    const c = (w.size - 1) / 2;
    const r = w.size * MATCH.ring;
    for (let i = 0; i < n; i++) {
      const f = i === 0 ? p : w.createRival(i + 1, i - 1);
      // A little jitter so starts aren't perfectly symmetric.
      const a = a0 + (i / n) * Math.PI * 2 + (w.rng.next() - 0.5) * 0.25;
      w.placeCluster(f, Math.round(c + Math.cos(a) * r), Math.round(c + Math.sin(a) * r));
      f.energy = START.playerEnergy;
    }
    w.events.length = 0;
    return w;
  }

  /** A rival with a random personality, its own twist on that personality's sliders and tastes. */
  private createRival(id: number, n: number): Faction {
    const profile = PROFILES[this.rng.int(PROFILES.length)];
    const taste: Record<string, number> = {};
    for (const u of UPGRADES) taste[u.id] = Math.exp((this.rng.next() - 0.5) * 1.6);
    const f = createFaction(id, COLORS.rivalNames[n % COLORS.rivalNames.length], COLORS.rivals[n % COLORS.rivals.length], false, profile.id, taste);
    // Personal twist on the profile's behaviour, so two Fortresses still play differently.
    const twist = (v: number) => Math.max(-1, Math.min(1, v + (this.rng.next() - 0.5) * 0.6));
    f.behavior = { focus: twist(profile.behavior.focus), shape: twist(profile.behavior.shape), reach: twist(profile.behavior.reach), posture: twist(profile.behavior.posture) };
    refreshStats(f);
    this.factions.set(id, f);
    return f;
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
    if (to !== NEUTRAL) {
      const f = this.factions.get(to)!;
      if (f.flag && f.flag.x === x && f.flag.y === y) {
        this.setFlag(f, null);
        this.emit({ type: 'flag', faction: f.id });
      }
    }
  }

  /** Plant (or with null, take down) a faction's rally flag. */
  setFlag(f: Faction, at: { x: number; y: number } | null) {
    f.flag = at ? { x: Math.round(at.x), y: Math.round(at.y) } : null;
    this.flagVersion++;
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
      if (this.inBounds(nx, ny) && this.grid.owner(nx, ny) === NEUTRAL) this.transfer(nx, ny, f.id);
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
        const cost = upgradeCost(def, level);
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

  /**
   * Who the rivals gang up on: the biggest faction, once it is clearly ahead of the runner-up.
   * The further ahead, the harder they focus on it.
   */
  private updateLeader() {
    let first: Faction | null = null;
    let second = 0;
    for (const f of this.factions.values()) {
      if (!f.alive) continue;
      if (!first || f.cells > first.cells) {
        if (first) second = Math.max(second, first.cells);
        first = f;
      } else second = Math.max(second, f.cells);
    }
    const lead = first ? first.cells / Math.max(1, second) : 0;
    const t = Math.min(1, Math.max(0, (lead - LEADER.from) / (LEADER.full - LEADER.from)));
    this.leader = first && t > 0 ? first.id : 0;
    this.leaderFocus = 1 + (LEADER.maxFocus - 1) * t;
  }

  // ---------------------------------------------------------------- the tick

  step() {
    this.tick++;
    const now = this.time;
    const p = this.player;
    const energyBefore = p.earned;
    const cellsBefore = p.cells;
    const order = [...this.factions.values()].filter((f) => f.alive && f.cells > 0);
    // Shuffle so no faction always moves first.
    for (let i = order.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    const tempo = this.tempo();
    this.pocketMemo.clear();
    if (this.tick % 5 === 1) this.updateLeader();
    for (const f of order) {
      if (!f.alive) continue;
      // Income from the ground you hold.
      this.earn(f, (ENERGY.base + ENERGY.perCell * f.cells) * DT);
      f.budget += f.stats.rate * tempo * (1 + f.stats.sizeBonus * Math.sqrt(f.cells)) * DT;
      if (f.budget < 1) continue;
      const c = centroid(f);
      const ctx: Context = { grid: this.grid, f, now, cx: c.x, cy: c.y, r: radius(f), lo: this.lo, hi: this.hi, leader: this.leader, leaderFocus: this.leaderFocus };
      while (f.budget >= 1 && f.alive) {
        f.budget -= 1;
        this.attempt(ctx);
      }
      if (!f.isPlayer) this.rivalShop(f);
    }
    if (this.tick % 10 === 0) for (const f of this.factions.values()) if (f.alive) this.refreshBounds(f);
    this.checkWin();
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
      this.earn(f, ENERGY.neutral);
      this.emit({ type: 'capture', x: t.x, y: t.y, by: f.id, from: NEUTRAL });
      return;
    }
    const def = this.factions.get(t.owner)!;
    const p = conversionChance(this.grid, f.stats, f.id, def.stats, def.id, t.x, t.y, this.resistMult(f, def, t.x, t.y));
    this.grid.markHit(t.x, t.y, ctx.now);
    if (this.rng.next() >= p) {
      this.emit({ type: 'hit', x: t.x, y: t.y, by: f.id, owner: def.id });
      // Counterattack: the defender may strike straight back at the cell the attack came from.
      if (def.stats.counter > 0 && this.rng.next() < def.stats.counter && this.grid.owner(t.sx, t.sy) === f.id) {
        this.conquer(def, f, t.sx, t.sy, ctx.now, 'counter', 0);
      }
      return;
    }
    this.convert(f, def, t.x, t.y, 'normal', 0);
    // Chain reaction: each success may flip a neighbouring cell of the same enemy, less likely each time.
    let chance = f.stats.chain;
    let cx = t.x;
    let cy = t.y;
    for (let link = 1; link <= SPECIAL.chainMaxLinks && chance > 0 && def.alive; link++) {
      if (this.rng.next() >= chance) break;
      const d0 = this.rng.int(4);
      let next = -1;
      for (let i = 0; i < 4; i++) {
        const d = (d0 + i) % 4;
        if (this.grid.owner(cx + DX[d], cy + DY[d]) === def.id) {
          next = d;
          break;
        }
      }
      if (next < 0) break;
      cx += DX[next];
      cy += DY[next];
      this.convert(f, def, cx, cy, 'chain', link);
      chance *= SPECIAL.chainDecay;
    }
  }

  /** Attempt to convert (x, y) held by `def` for `att` (used by counterattacks). */
  private conquer(att: Faction, def: Faction, x: number, y: number, now: number, kind: CaptureKind, link: number) {
    const p = conversionChance(this.grid, att.stats, att.id, def.stats, def.id, x, y, this.resistMult(att, def, x, y));
    this.grid.markHit(x, y, now);
    if (this.rng.next() < p) this.convert(att, def, x, y, kind, link);
    else this.emit({ type: 'hit', x, y, by: att.id, owner: def.id });
  }

  /** Hand an enemy cell to `att`, pay the conquest reward and check for elimination. */
  private convert(att: Faction, def: Faction, x: number, y: number, kind: CaptureKind, link: number) {
    this.transfer(x, y, att.id);
    att.converted++;
    this.earn(att, ENERGY.conquest);
    this.emit({ type: 'capture', x, y, by: att.id, from: def.id, kind, link });
    if (def.cells === 0 && def.alive) this.eliminate(def, att.id);
  }

  /**
   * Resistance multiplier for `def`'s cell at (x, y) under attack from `att`: the bigger side has
   * the edge (strength in numbers), and Siege weakens cut-off pockets.
   */
  resistMult(att: Faction, def: Faction, x: number, y: number): number {
    const edge = Math.min(COMBAT.sizeEdgeMax, Math.max(1 / COMBAT.sizeEdgeMax, (Math.max(1, def.cells) / Math.max(1, att.cells)) ** COMBAT.sizeEdge));
    if (att.stats.siege > 0 && this.isPocket(def, x, y)) return edge * Math.max(0.2, 1 - att.stats.siege);
    return edge;
  }

  /** True if (x, y) belongs to a small group cut off from most of its faction. */
  isPocket(def: Faction, x: number, y: number): boolean {
    const k = cellKey(x, y);
    const memo = this.pocketMemo.get(k);
    if (memo !== undefined) return memo;
    const limit = SPECIAL.siegePocketCells;
    const size = groupSize(this.grid, x, y, def.id, limit);
    const pocket = size <= limit && size * 2 < def.cells;
    this.pocketMemo.set(k, pocket);
    return pocket;
  }

  /** Pay energy, after the faction's Income upgrade and (for rivals) the league's rival bonus. */
  private earn(f: Faction, amount: number) {
    const v = amount * f.stats.yield * (f.isPlayer ? 1 : this.info.rivalIncome);
    f.energy += v;
    f.earned += v;
  }

  /** The match ends when anyone holds the winning share, or when you are wiped out. */
  private checkWin() {
    if (this.ended) return;
    for (const f of this.factions.values()) {
      if (!f.alive || f.cells < this.winCells) continue;
      this.ended = true;
      this.winner = f.id;
      this.emit({ type: 'won', faction: f.id });
      return;
    }
  }

  private eliminate(f: Faction, by: number) {
    f.alive = false;
    f.frontier.clear();
    this.emit({ type: 'eliminated', faction: f.id, by });
    if (f.isPlayer && !this.ended) {
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
