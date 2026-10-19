import { describe, expect, it } from 'vitest';
import { PLAYER_TRAITS, TIME, type GrowthTraits } from '../src/config/balance';
import { acceptChance, attemptGrowth, choiceWeight } from '../src/sim/growth';
import { shapeMetrics } from '../src/sim/metrics';
import { Rng } from '../src/sim/rng';
import { Simulation } from '../src/sim/sim';
import { EMPTY, PLAYER, ROCK, World } from '../src/sim/world';

function grow(seed: number, ticks: number, traits: Partial<GrowthTraits> = {}) {
  const sim = new Simulation(seed, { ...PLAYER_TRAITS, ...traits });
  sim.seedPlayer();
  for (let t = 0; t < ticks; t++) sim.step();
  return sim;
}

describe('rng', () => {
  it('is deterministic per seed and in range', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) {
      const x = a.next();
      expect(x).toBe(b.next());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('world generation', () => {
  it('keeps the start area open and fertile enough', () => {
    const sim = new Simulation(123);
    const w = sim.world;
    const sx = w.width >> 1;
    const sy = w.height >> 1;
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) expect(w.owner[w.index(sx + dx, sy + dy)]).not.toBe(ROCK);
    expect(w.fertility[sim.startCell]).toBeGreaterThan(0.3);
  });

  it('has some rock and varied fertility, the same for the same seed', () => {
    const a = new Simulation(9);
    const b = new Simulation(9);
    expect(a.openCells).toBeLessThan(a.world.size);
    expect(a.openCells).toBeGreaterThan(a.world.size * 0.75);
    expect(Array.from(a.world.owner)).toEqual(Array.from(b.world.owner));
    let lo = 1;
    let hi = 0;
    for (const f of a.world.fertility) {
      lo = Math.min(lo, f);
      hi = Math.max(hi, f);
    }
    expect(hi - lo).toBeGreaterThan(0.6);
  });
});

describe('reproduction', () => {
  it('starts from exactly one cell and grows over time', () => {
    const sim = new Simulation(1);
    sim.seedPlayer();
    expect(sim.player.population).toBe(1);
    for (let t = 0; t < 300; t++) sim.step();
    expect(sim.player.population).toBeGreaterThan(30);
  });

  it('only ever grows into empty cells next to an existing cell, never into rock', () => {
    const sim = new Simulation(5);
    sim.seedPlayer();
    sim.births.length = 0;
    const w = sim.world;
    for (let t = 0; t < 600; t++) {
      const before = Uint8Array.from(w.owner);
      sim.step();
      for (const b of sim.births) {
        expect(before[b.cell]).toBe(EMPTY);
        let touching = false;
        for (let d = 0; d < 8; d++) {
          const n = w.neighbor(b.cell, d);
          if (n !== -1 && before[n] === PLAYER) touching = true;
        }
        expect(touching).toBe(true);
      }
      sim.births.length = 0;
    }
    const terrain = new Simulation(5).world.owner;
    for (let i = 0; i < w.size; i++) if (w.owner[i] === PLAYER) expect(terrain[i]).not.toBe(ROCK);
  });

  it('keeps cached population, frontier and bounds consistent with the grid', () => {
    const sim = grow(11, 900);
    const audit = sim.audit();
    expect(audit.problems).toEqual([]);
    expect(audit.population).toBe(sim.player.population);
    const w = sim.world;
    const c = sim.player;
    for (let i = 0; i < w.size; i++) {
      if (w.owner[i] !== PLAYER) continue;
      const x = i % w.width;
      const y = (i / w.width) | 0;
      expect(x >= c.minX && x <= c.maxX && y >= c.minY && y <= c.maxY).toBe(true);
    }
  });

  it('dormant (inactive) cells really have no room to grow', () => {
    const sim = grow(3, 700);
    const w = sim.world;
    for (let i = 0; i < w.size; i++) {
      if (w.owner[i] === PLAYER && w.activePos[i] === -1) expect(w.hasEmptyNeighbor(i, true)).toBe(false);
    }
  });

  it('is fully deterministic for a seed', () => {
    const a = grow(77, 500);
    const b = grow(77, 500);
    expect(a.player.population).toBe(b.player.population);
    expect(Array.from(a.world.owner)).toEqual(Array.from(b.world.owner));
  });

  it('newborn cells wait out their maturation before dividing', () => {
    const traits = { ...PLAYER_TRAITS, maturation: 30, interval: 2, intervalJitter: 0 };
    const sim = new Simulation(4, traits);
    sim.seedPlayer();
    for (let t = 0; t < 29; t++) sim.step();
    expect(sim.player.population).toBe(1);
  });

  it('fills the whole reachable world eventually and then reports filled', () => {
    const sim = new Simulation(2, { ...PLAYER_TRAITS, interval: 2, maturation: 1, vigor: 1, barrenFloor: 1 }, 30, 30);
    sim.seedPlayer();
    for (let t = 0; t < 4000 && !sim.filled; t++) sim.step();
    expect(sim.filled).toBe(true);
    expect(sim.world.activeCount).toBe(0);
    expect(sim.audit().problems).toEqual([]);
  });
});

describe('local decision rule', () => {
  it('prefers open ground when branching is positive and gaps when negative', () => {
    const t = (b: number) => ({ ...PLAYER_TRAITS, branching: b });
    expect(choiceWeight(t(2), 0, 0.5, false)).toBeGreaterThan(choiceWeight(t(2), 0.8, 0.5, false));
    expect(choiceWeight(t(-2), 0, 0.5, false)).toBeLessThan(choiceWeight(t(-2), 0.8, 0.5, false));
  });

  it('succeeds more often in rich soil and less often when crowded', () => {
    expect(acceptChance(PLAYER_TRAITS, 0, 1)).toBeGreaterThan(acceptChance(PLAYER_TRAITS, 0, 0));
    expect(acceptChance(PLAYER_TRAITS, 0, 0.5)).toBeGreaterThan(acceptChance(PLAYER_TRAITS, 0.8, 0.5));
    expect(acceptChance(PLAYER_TRAITS, 0, 1)).toBeLessThanOrEqual(1);
  });

  it('returns null (go dormant) for a fully surrounded cell', () => {
    const w = new World(5, 5);
    w.owner.fill(PLAYER);
    expect(attemptGrowth(w, w.index(2, 2), PLAYER_TRAITS, new Rng(1))).toBeNull();
  });

  it('follows rich soil: a lone cell between barren and rich ground mostly grows toward the rich side', () => {
    const w = new World(3, 1);
    w.owner[1] = PLAYER;
    w.dir[1] = 8;
    w.fertility[0] = 0;
    w.fertility[2] = 1;
    const rng = new Rng(3);
    let right = 0;
    let left = 0;
    for (let k = 0; k < 2000; k++) {
      const r = attemptGrowth(w, 1, { ...PLAYER_TRAITS, diagonalGrowth: 0 }, rng);
      if (r && r.born === 2) right++;
      if (r && r.born === 0) left++;
    }
    expect(right).toBeGreaterThan(left * 5);
  });
});

describe('emergent structure (different rules → visibly different colonies)', () => {
  // Same seeds, same population; only the preferences differ.
  const atPop = (seed: number, traits: Partial<GrowthTraits>, pop = 1500) => {
    const sim = new Simulation(seed, { ...PLAYER_TRAITS, ...traits });
    sim.seedPlayer();
    while (sim.player.population < pop && sim.tick < 8000) sim.step();
    return shapeMetrics(sim);
  };
  const seeds = [1, 2, 3, 4];
  const avg = (f: (s: number) => number) => seeds.reduce((a, s) => a + f(s), 0) / seeds.length;

  it('branch-seeking colonies have far more edge and more tips than gap-filling ones', () => {
    const branchy = { branching: 3.5, crowdRefusal: 2.5, persistence: 1.8 };
    const compact = { branching: -2, crowdRefusal: 0, persistence: 0 };
    const edgeB = avg((s) => atPop(s, branchy).edgeRatio);
    const edgeC = avg((s) => atPop(s, compact).edgeRatio);
    expect(edgeB).toBeGreaterThan(edgeC * 2.5);
    expect(avg((s) => atPop(s, branchy).tips)).toBeGreaterThan(avg((s) => atPop(s, compact).tips) * 2);
  });

  it('default colonies are roughly round, not lattice diamonds', () => {
    for (const seed of seeds) {
      const sim = new Simulation(seed);
      sim.seedPlayer();
      while (sim.player.population < 2500) sim.step();
      const w = sim.world;
      const cx = w.width >> 1;
      const cy = w.height >> 1;
      let axis = 0;
      let diag = 0;
      for (let i = 0; i < w.size; i++) {
        if (w.owner[i] !== PLAYER) continue;
        const x = (i % w.width) - cx;
        const y = ((i / w.width) | 0) - cy;
        axis = Math.max(axis, Math.abs(x), Math.abs(y));
        diag = Math.max(diag, (Math.abs(x) + Math.abs(y)) / Math.SQRT2);
      }
      expect(axis / diag).toBeLessThan(1.25);
      expect(axis / diag).toBeGreaterThan(0.75);
    }
  });
});

describe('timing', () => {
  it('reaches a visible colony in the first minute of play', () => {
    const sim = grow(1, 60 * TIME.ticksPerSecond);
    expect(sim.player.population).toBeGreaterThan(80);
  });
});
