// The simulation: a world, its colonies and a discrete tick. Pure logic, deterministic for a
// given seed, and independent of frame rate or game speed (speed only changes ticks per second).

import { COLORS, PLAYER_TRAITS, TIME, WORLD, type GrowthTraits } from '../config/balance';
import { createColony, includeInBounds, type Colony } from './colony';
import { attemptGrowth, type DecisionTrace } from './growth';
import { Rng } from './rng';
import { generateTerrain } from './terrain';
import { EMPTY, NO_DIR, PLAYER, ROCK, World } from './world';

export interface BirthEvent {
  cell: number;
  colony: number;
}

/** How many recent ticks the growth-rate readout averages over. */
const RATE_WINDOW = 50;

export class Simulation {
  readonly seed: number;
  readonly world: World;
  readonly rng: Rng;
  readonly colonies: Colony[] = [];
  tick = 0;
  /** Open (non-rock) cells in the world — the territory denominator. */
  readonly openCells: number;
  /** Events since the consumer last drained them (renderer / audio). Capped. */
  births: BirthEvent[] = [];
  /** Births per tick over the last RATE_WINDOW ticks (ring buffer). */
  private readonly recent = new Uint16Array(RATE_WINDOW);
  /** Optional decision tracing for the diagnostics overlay. */
  traceNext = false;
  lastTrace: DecisionTrace | null = null;
  readonly startCell: number;

  constructor(seed: number, traits: GrowthTraits = PLAYER_TRAITS, width = WORLD.width, height = WORLD.height) {
    this.seed = seed >>> 0;
    this.world = new World(width, height);
    this.rng = new Rng(this.seed ^ 0xa5a5a5a5);
    const sx = width >> 1;
    const sy = height >> 1;
    this.startCell = this.world.index(sx, sy);
    generateTerrain(this.world, this.seed, sx, sy);
    let open = 0;
    for (let i = 0; i < this.world.size; i++) if (this.world.owner[i] !== ROCK) open++;
    this.openCells = open;
    this.colonies.push(createColony(PLAYER, 'Colony', COLORS.player, traits));
  }

  get player(): Colony {
    return this.colonies[0];
  }

  colony(id: number): Colony {
    return this.colonies[id - 1];
  }

  /** Place the founding cell. */
  seedPlayer() {
    this.place(this.startCell, PLAYER, NO_DIR);
  }

  /** Write a living cell into the world and update all caches. */
  place(cell: number, colonyId: number, dir: number) {
    const w = this.world;
    const c = this.colony(colonyId);
    w.owner[cell] = colonyId;
    w.dir[cell] = dir;
    w.bornAt[cell] = this.tick;
    w.nextAct[cell] = this.tick + this.delay(c.traits, c.traits.maturation);
    c.population++;
    c.totalBorn++;
    if (c.population > c.peakPopulation) c.peakPopulation = c.population;
    includeInBounds(c, cell % w.width, (cell / w.width) | 0);
    if (w.hasEmptyNeighbor(cell, c.traits.diagonalGrowth > 0)) w.activate(cell);
    if (this.births.length < 50000) this.births.push({ cell, colony: colonyId });
  }

  /** Interval with jitter, at least one tick. */
  private delay(t: GrowthTraits, extra = 0): number {
    const j = 1 + t.intervalJitter * (this.rng.next() * 2 - 1);
    return Math.max(1, Math.round(extra + t.interval * j));
  }

  /** Advance one tick. Returns births this tick. */
  step(): number {
    const w = this.world;
    const tick = ++this.tick;
    let born = 0;
    // Walk the active list backwards: swap-removal only moves already-visited cells,
    // and cells born this tick are appended past the cursor (they are still maturing anyway).
    for (let k = w.activeCount - 1; k >= 0; k--) {
      const i = w.active[k];
      if (w.nextAct[i] > tick) continue;
      const colony = this.colony(w.owner[i]);
      let trace: DecisionTrace | undefined;
      if (this.traceNext) trace = { cell: i, options: [], chosen: -1, success: false };
      const r = attemptGrowth(w, i, colony.traits, this.rng, trace);
      if (trace) {
        this.lastTrace = trace;
        this.traceNext = false;
      }
      if (r === null) {
        w.deactivate(i);
        continue;
      }
      w.nextAct[i] = tick + this.delay(colony.traits);
      if (r.born !== -1) {
        this.place(r.born, colony.id, r.dir);
        born++;
      }
    }
    this.recent[tick % RATE_WINDOW] = Math.min(65535, born);
    return born;
  }

  /** Average births per second over the recent window. */
  birthRate(): number {
    let s = 0;
    const n = Math.min(this.tick, RATE_WINDOW);
    if (n === 0) return 0;
    for (let k = 0; k < RATE_WINDOW; k++) s += this.recent[k];
    return (s / n) * TIME.ticksPerSecond;
  }

  /** True when no cell can grow any further (the reachable world is full). */
  get filled(): boolean {
    return this.tick > 0 && this.world.activeCount === 0;
  }

  territoryFraction(colonyId = PLAYER): number {
    return this.colony(colonyId).population / this.openCells;
  }

  /** Living cells still maturing (cannot divide yet). */
  youngCount(colonyId = PLAYER): number {
    const w = this.world;
    const mat = this.colony(colonyId).traits.maturation;
    let n = 0;
    for (let k = 0; k < w.activeCount; k++) {
      const i = w.active[k];
      if (w.owner[i] === colonyId && this.tick - w.bornAt[i] < mat) n++;
    }
    return n;
  }

  /** Replace a colony's traits (Rule Lab / future upgrades). Takes effect on the next decisions. */
  setTraits(colonyId: number, traits: GrowthTraits) {
    this.colony(colonyId).traits = { ...traits };
  }

  /**
   * Rebuild a simulation from saved cell ownership. Cells are restored as mature, and
   * everything derived (activity, counts, bounds) is recomputed rather than trusted.
   */
  static restore(seed: number, tick: number, cells: Uint8Array, dirs: Uint8Array, traits: GrowthTraits, peak: number, totalBorn: number): Simulation {
    const sim = new Simulation(seed, traits);
    const w = sim.world;
    if (cells.length !== w.size || dirs.length !== w.size) throw new Error('Saved world has the wrong size');
    sim.tick = tick;
    const c = sim.player;
    for (let i = 0; i < w.size; i++) {
      if (cells[i] !== PLAYER || w.owner[i] === ROCK) continue;
      w.owner[i] = PLAYER;
      w.dir[i] = dirs[i] <= NO_DIR ? dirs[i] : NO_DIR;
      w.bornAt[i] = Math.max(0, tick - traits.maturation);
      c.population++;
      includeInBounds(c, i % w.width, (i / w.width) | 0);
    }
    for (let i = 0; i < w.size; i++) {
      if (w.owner[i] !== PLAYER) continue;
      if (w.hasEmptyNeighbor(i, traits.diagonalGrowth > 0)) {
        w.activate(i);
        w.nextAct[i] = tick + 1 + sim.rng.int(Math.max(1, traits.interval));
      }
    }
    c.peakPopulation = Math.max(peak, c.population);
    c.totalBorn = Math.max(totalBorn, c.population);
    return sim;
  }

  /** Recount everything from the grid; used by tests to prove the caches never drift. */
  audit(): { population: number; active: number; problems: string[] } {
    const w = this.world;
    const problems: string[] = [];
    let population = 0;
    for (let i = 0; i < w.size; i++) {
      const o = w.owner[i];
      if (o !== EMPTY && o !== ROCK) population++;
      const isActive = w.activePos[i] !== -1;
      if (isActive && (o === EMPTY || o === ROCK)) problems.push(`non-living cell ${i} is active`);
    }
    for (let k = 0; k < w.activeCount; k++) if (w.activePos[w.active[k]] !== k) problems.push(`active index mismatch at ${k}`);
    const cached = this.colonies.reduce((s, c) => s + c.population, 0);
    if (cached !== population) problems.push(`population cache ${cached} ≠ grid ${population}`);
    return { population, active: w.activeCount, problems };
  }
}
