import { describe, expect, it } from 'vitest';
import { BASE_STATS, START, TIME } from '../src/config/balance';
import { UPGRADES, deriveStats, neutralBehavior, type Behavior } from '../src/config/upgrades';
import { buy, isUnlocked, quote, upgradeCost } from '../src/sim/economy';
import { chooseTarget, conversionChance, type Candidate } from '../src/sim/expansion';
import { createFaction, type Faction } from '../src/sim/faction';
import { cellKey, Grid, keyX, keyY, NEUTRAL } from '../src/sim/grid';
import { Rng } from '../src/sim/rng';
import { PLAYER, World } from '../src/sim/world';

const run = (w: World, seconds: number) => {
  for (let t = 0; t < seconds * TIME.ticksPerSecond && !w.ended; t++) w.step();
  return w;
};

/** An empty world with only factions we place by hand (no automatic rivals). */
function lab(seed = 1): World {
  const w = new World(seed);
  w.useTempo = false;
  w.factions.set(PLAYER, createFaction(PLAYER, 'You', '#000', true));
  w.counters = { rivalsCreated: 0, nextSpawnCheck: 1e12 };
  return w;
}

function grantLevels(f: Faction, levels: Record<string, number>) {
  f.levels = { ...levels };
  f.stats = deriveStats(f.levels, f.behavior);
}

function setBehavior(f: Faction, b: Partial<Behavior>) {
  f.behavior = { ...neutralBehavior(), ...b };
  f.stats = deriveStats(f.levels, f.behavior);
}

describe('grid', () => {
  it('packs and unpacks coordinates, including negatives', () => {
    for (const [x, y] of [[0, 0], [-1, -1], [123456, -98765], [-5_000_000, 5_000_000]]) {
      const k = cellKey(x, y);
      expect(keyX(k)).toBe(x);
      expect(keyY(k)).toBe(y);
    }
  });

  it('is infinite: far cells are neutral and can be owned in any direction', () => {
    const g = new Grid();
    expect(g.owner(1e6, -1e6)).toBe(NEUTRAL);
    g.set(-70, 900, 3, 0);
    g.set(5000, -5000, 4, 0);
    expect(g.owner(-70, 900)).toBe(3);
    expect(g.owner(5000, -5000)).toBe(4);
    expect(g.chunks.size).toBe(2);
  });
});

describe('starting clusters', () => {
  it('everyone starts with one connected cluster of 5–9 cells, and rivals start apart', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const w = World.create(seed);
      expect(w.audit()).toEqual([]);
      expect(w.factions.size).toBe(3);
      for (const f of w.factions.values()) {
        expect(f.cells).toBeGreaterThanOrEqual(START.minCells);
        expect(f.cells).toBeLessThanOrEqual(START.maxCells);
        // Connected: flood fill from home reaches every cell.
        const seen = new Set([cellKey(f.homeX, f.homeY)]);
        const stack = [[f.homeX, f.homeY]];
        while (stack.length) {
          const [x, y] = stack.pop()!;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const k = cellKey(x + dx, y + dy);
            if (!seen.has(k) && w.grid.owner(x + dx, y + dy) === f.id) {
              seen.add(k);
              stack.push([x + dx, y + dy]);
            }
          }
        }
        expect(seen.size).toBe(f.cells);
      }
      expect(w.contacts()).toEqual([]);
    }
  });

  it('starting shapes differ between runs', () => {
    const shape = (seed: number) => {
      const w = World.create(seed);
      const cells: string[] = [];
      w.grid.forEachOwned((x, y, o) => o === PLAYER && cells.push(`${x},${y}`));
      return cells.sort().join(' ');
    };
    expect(new Set([1, 2, 3, 4, 5, 6].map(shape)).size).toBeGreaterThan(3);
  });
});

describe('expansion pace', () => {
  it('starts at about one neutral capture every three seconds', () => {
    const w = lab();
    w.placeCluster(w.player, 0, 0);
    const start = w.player.cells;
    run(w, 60);
    const per = (w.player.cells - start) / 60;
    expect(per).toBeGreaterThan(0.25);
    expect(per).toBeLessThan(0.5);
  });

  it('territory size helps only modestly (square-root bonus)', () => {
    const w = lab();
    w.placeCluster(w.player, 0, 0);
    run(w, 180);
    const early = w.player.cells;
    run(w, 180);
    const mid = w.player.cells - early;
    run(w, 180);
    const late = w.player.cells - early - mid;
    expect(late).toBeGreaterThan(mid * 0.9);
    expect(late).toBeLessThan(mid * 1.6);
  });

  it('Expansion Rate visibly speeds growth', () => {
    const grow = (levels: number) => {
      const w = lab(3);
      w.placeCluster(w.player, 0, 0);
      grantLevels(w.player, { rate: levels });
      return run(w, 120).player.cells;
    };
    expect(grow(5)).toBeGreaterThan(grow(0) * 1.6);
  });
});

describe('combat', () => {
  const g = () => new Grid();
  it('support on either side shifts the odds', () => {
    const grid = g();
    grid.set(0, 0, 2, 0);
    grid.set(-1, 0, 1, 0);
    const base = conversionChance(grid, BASE_STATS, 1, BASE_STATS, 2, 0, 0, 0);
    grid.set(0, -1, 1, 0);
    grid.set(0, 1, 1, 0);
    const surrounded = conversionChance(grid, BASE_STATS, 1, BASE_STATS, 2, 0, 0, 0);
    expect(surrounded).toBeGreaterThan(base);
    const grid2 = g();
    grid2.set(0, 0, 2, 0);
    grid2.set(-1, 0, 1, 0);
    grid2.set(1, 0, 2, 0);
    grid2.set(0, 1, 2, 0);
    expect(conversionChance(grid2, BASE_STATS, 1, BASE_STATS, 2, 0, 0, 0)).toBeLessThan(base);
  });

  it('power, resistance and entrenchment all matter', () => {
    const grid = g();
    grid.set(0, 0, 2, 0);
    grid.set(-1, 0, 1, 0);
    const strong = deriveStats({ power: 10 });
    const tough = deriveStats({ resistance: 10 });
    const dug = deriveStats({ entrenchment: 10 });
    const base = conversionChance(grid, BASE_STATS, 1, BASE_STATS, 2, 0, 0, 0);
    expect(conversionChance(grid, strong, 1, BASE_STATS, 2, 0, 0, 0)).toBeGreaterThan(base);
    expect(conversionChance(grid, BASE_STATS, 1, tough, 2, 0, 0, 0)).toBeLessThan(base);
    expect(conversionChance(grid, BASE_STATS, 1, dug, 2, 0, 0, 100)).toBeLessThan(conversionChance(grid, BASE_STATS, 1, dug, 2, 0, 0, 0));
  });

  it('caches stay exact through long multi-faction battles', () => {
    const w = run(World.create(11), 600);
    expect(w.audit()).toEqual([]);
    let fights = 0;
    for (const f of w.factions.values()) fights += f.converted;
    expect(fights).toBeGreaterThan(20);
  });

  it('a faction reduced to zero cells is eliminated and reported', () => {
    const w = lab();
    const p = w.player;
    const weak = createFaction(2, 'Weak', '#f00', false, 'balanced');
    w.factions.set(2, weak);
    w.transfer(0, 0, PLAYER);
    w.transfer(1, 0, 2);
    grantLevels(p, { power: 60 });
    setBehavior(p, { focus: 1 });
    weak.stats.rate = 0;
    run(w, 20);
    expect(weak.alive).toBe(false);
    expect(w.events.some((e) => e.type === 'eliminated' && e.faction === 2)).toBe(true);
  });

  it('the player being wiped out ends the run', () => {
    const w = lab();
    const strong = createFaction(2, 'Strong', '#f00', false, 'conqueror');
    w.factions.set(2, strong);
    w.transfer(0, 0, PLAYER);
    w.transfer(1, 0, 2);
    grantLevels(strong, { power: 60 });
    setBehavior(strong, { focus: 1 });
    w.player.stats.rate = 0;
    run(w, 60);
    expect(w.ended).toBe(true);
    expect(w.events.some((e) => e.type === 'defeat')).toBe(true);
  });
});

describe('emergent behaviour from the behaviour sliders', () => {
  /** Exposed edges per cell: low for compact blobs, high for branching shapes. */
  const edgeRatio = (w: World, id: number) => {
    let edges = 0;
    let cells = 0;
    w.grid.forEachOwned((x, y, o) => {
      if (o !== id) return;
      cells++;
      edges += 4 - w.grid.sides(x, y, id);
    });
    return edges / cells;
  };
  const grownWith = (seed: number, b: Partial<Behavior>, cells = 400) => {
    const w = lab(seed);
    w.placeCluster(w.player, 0, 0);
    setBehavior(w.player, b);
    while (w.player.cells < cells) w.step();
    return w;
  };

  it('Shape: branching gives spread-out territory, compact gives a solid mass', () => {
    let branchy = 0;
    let compact = 0;
    for (const seed of [1, 2, 3]) {
      branchy += edgeRatio(grownWith(seed, { shape: 1 }), PLAYER);
      compact += edgeRatio(grownWith(seed, { shape: -1 }), PLAYER);
    }
    expect(branchy).toBeGreaterThan(compact * 1.6);
  });

  it('Reach: spearheads stretch territory further than even growth', () => {
    const reach = (levels: Partial<Behavior>) => {
      let r = 0;
      for (const seed of [1, 2, 3]) {
        const w = grownWith(seed, levels);
        w.refreshBounds(w.player);
        r += Math.max(w.player.maxX - w.player.minX, w.player.maxY - w.player.minY);
      }
      return r;
    };
    expect(reach({ reach: 1 })).toBeGreaterThan(reach({ reach: -1 }) * 1.3);
  });

  it('Focus: attack shifts effort from open ground to enemy cells', () => {
    const attackShare = (b: Partial<Behavior>) => {
      const w = lab(4);
      const rival = createFaction(2, 'Rival', '#f00', false, 'balanced');
      w.factions.set(2, rival);
      for (let y = -6; y <= 6; y++) {
        for (let x = -6; x <= 6; x++) w.transfer(x, y, x < 0 ? PLAYER : 2);
      }
      setBehavior(w.player, b);
      const rng = new Rng(9);
      let enemy = 0;
      const n = 3000;
      const out: Candidate[] = [];
      for (let i = 0; i < n; i++) {
        const t = chooseTarget({ grid: w.grid, f: w.player, now: 0, cx: -3, cy: 0, r: 7 }, rng, out);
        if (t && t.owner === 2) enemy++;
      }
      return enemy / n;
    };
    expect(attackShare({ focus: 1 })).toBeGreaterThan(attackShare({ focus: -1 }) * 3);
  });

  it('Posture: exploit focuses attacks on exposed, already-touched enemy cells', () => {
    const w = lab(5);
    const rival = createFaction(2, 'Rival', '#f00', false, 'balanced');
    w.factions.set(2, rival);
    // Enemy block with one protruding cell at (0,-1) surrounded by us on three sides.
    for (let x = -3; x <= 3; x++) for (let y = 0; y <= 3; y++) w.transfer(x, y, 2);
    w.transfer(0, -1, 2);
    for (let x = -3; x <= 3; x++) if (x !== 0) w.transfer(x, -1, PLAYER);
    for (let x = -3; x <= 3; x++) w.transfer(x, -2, PLAYER);
    const share = (posture: number) => {
      setBehavior(w.player, { focus: 1, posture });
      const rng = new Rng(2);
      let tip = 0;
      let enemy = 0;
      const out: Candidate[] = [];
      for (let i = 0; i < 4000; i++) {
        const t = chooseTarget({ grid: w.grid, f: w.player, now: 0, cx: 0, cy: -2, r: 4 }, rng, out);
        if (!t || t.owner !== 2) continue;
        enemy++;
        if (t.x === 0 && t.y === -1) tip++;
      }
      return tip / enemy;
    };
    expect(share(1)).toBeGreaterThan(share(0) * 1.5);
  });

  it('Posture: defend concentrates effort where the border is under attack', () => {
    const w = lab(6);
    w.placeCluster(w.player, 0, 0);
    for (let x = -8; x <= 8; x++) w.transfer(x, 0, PLAYER);
    // Mark the left end as recently attacked.
    for (let x = -8; x <= -5; x++) w.grid.markHit(x, 0, 0);
    const leftShare = (posture: number) => {
      setBehavior(w.player, { posture });
      const rng = new Rng(4);
      let left = 0;
      const out: Candidate[] = [];
      for (let i = 0; i < 4000; i++) {
        const t = chooseTarget({ grid: w.grid, f: w.player, now: 1, cx: 0, cy: 0, r: 4 }, rng, out);
        if (t && t.x <= -4) left++;
      }
      return left / 4000;
    };
    expect(leftShare(-1)).toBeGreaterThan(leftShare(0) * 1.5);
  });

  it('every upgrade is strictly beneficial: no two upgrades pull stats in opposite directions', () => {
    const base = deriveStats({});
    for (const def of UPGRADES) {
      const up = deriveStats({ [def.id]: 5 });
      const changed = (Object.keys(base) as (keyof typeof base)[]).filter((k) => up[k] !== base[k]);
      expect(changed.length, `${def.id} changes nothing`).toBeGreaterThan(0);
      for (const k of changed) {
        // Lower is better only for prices; everything else must go up.
        if (k === 'costMult') expect(up[k]).toBeLessThan(base[k]);
        else expect(up[k], `${def.id} lowers ${k}`).toBeGreaterThan(base[k]);
      }
      for (const k of ['aggression', 'consolidation', 'momentum', 'flanking', 'threat', 'recovery'] as const) {
        expect(up[k], `${def.id} touches behaviour stat ${k}`).toBe(base[k]);
      }
    }
  });
});

describe('economy', () => {
  it('the player can buy an upgrade immediately and several within the first minute', () => {
    const w = World.create(2);
    const p = w.player;
    const starters = UPGRADES.filter((d) => isUnlocked(d, p));
    expect(starters.map((d) => d.id).sort()).toEqual(['power', 'rate', 'resistance', 'yield']);
    expect(starters.some((d) => upgradeCost(d, 0, 1) <= p.energy)).toBe(true);
    let bought = 0;
    for (let t = 0; t < 60 * TIME.ticksPerSecond; t++) {
      w.step();
      const cheapest = starters.slice().sort((a, b) => upgradeCost(a, p.levels[a.id] ?? 0, 1) - upgradeCost(b, p.levels[b.id] ?? 0, 1))[0];
      if (buy(p, cheapest.id).ok) bought++;
    }
    expect(bought).toBeGreaterThanOrEqual(4);
  });

  it('prices escalate, ×10 quotes ten levels, Max buys what is affordable', () => {
    const f = createFaction(1, 'You', '#000', true);
    f.energy = 1e6;
    f.earned = 1e6;
    const q1 = quote(f, 'rate', 1);
    const q10 = quote(f, 'rate', 10);
    expect(q10.count).toBe(10);
    expect(q10.cost).toBeGreaterThan(q1.cost * 10);
    f.energy = q10.cost + 1;
    const qm = quote(f, 'rate', 'max');
    expect(qm.count).toBe(10);
    expect(buy(f, 'rate', 'max').bought).toBe(10);
    expect(f.energy).toBeCloseTo(1, 6);
  });

  it('refuses unaffordable or locked purchases without spending', () => {
    const f = createFaction(1, 'You', '#000', true);
    f.energy = 1;
    expect(buy(f, 'rate').ok).toBe(false);
    f.energy = 1e6;
    expect(buy(f, 'efficiency').ok).toBe(false);
    expect(f.energy).toBe(1e6);
  });

  it('claims and conversions earn energy', () => {
    const w = run(World.create(3), 60);
    expect(w.player.earned).toBeGreaterThan(40);
  });
});

describe('rivals', () => {
  it('a rival arriving later has earned about as much as you, spent on its own route', () => {
    const w = World.create(6);
    run(w, 240);
    const p = w.player;
    const late = w.spawnRival(1, [60, 80], 0, 0)!;
    expect(late).not.toBeNull();
    expect(late.earned).toBeGreaterThan(p.earned * 0.8);
    expect(late.earned).toBeLessThan(p.earned * 1.2);
    const spent = Object.values(late.levels).reduce((a, b) => a + b, 0);
    expect(spent).toBeGreaterThan(5);
  });

  it('rivals with different profiles end up with different builds', () => {
    const w = World.create(7);
    run(w, 120);
    const builds = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const f = w.spawnRival(i, [80, 120], 0, 0);
      if (f) builds.add(Object.entries(f.levels).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k).join('+'));
    }
    expect(builds.size).toBeGreaterThan(2);
  });

  it('new rivals appear as your territory reaches further, never inside anyone’s territory', () => {
    const w = World.create(8);
    grantLevels(w.player, { rate: 30, power: 10, resistance: 10 });
    const before = w.factions.size;
    run(w, 600);
    expect(w.factions.size).toBeGreaterThan(before);
    expect(w.audit()).toEqual([]);
  });

  it('spawn sites are rejected when anything is near', () => {
    const w = lab();
    for (let x = -30; x <= 30; x++) for (let y = -30; y <= 30; y++) w.transfer(x, y, PLAYER);
    expect(w.spawnRival(0, [5, 10], 0, 0)).toBeNull();
  });

  it('far-away factions go dormant and cost nothing', () => {
    const w = lab();
    w.placeCluster(w.player, 0, 0);
    const far = createFaction(2, 'Far', '#f00', false, 'balanced');
    w.factions.set(2, far);
    w.placeCluster(far, 5000, 5000);
    const cells = far.cells;
    run(w, 20);
    expect(w.isDormant(far)).toBe(true);
    expect(far.cells).toBe(cells);
  });
});

describe('determinism', () => {
  it('the same seed plays out identically', () => {
    const a = run(World.create(42), 120);
    const b = run(World.create(42), 120);
    for (const f of a.factions.values()) expect(b.factions.get(f.id)!.cells).toBe(f.cells);
  });
});

describe('world tempo', () => {
  it('starts at 1×, rises smoothly, and settles around 2.2× by minute 12', () => {
    const w = new World(1);
    const at = (s: number) => {
      w.tick = s * TIME.ticksPerSecond;
      return w.tempo();
    };
    expect(at(0)).toBe(1);
    expect(at(60)).toBeLessThan(1.05);
    expect(at(300)).toBeGreaterThan(1.3);
    expect(at(300)).toBeLessThan(1.7);
    expect(at(600)).toBeGreaterThan(1.8);
    expect(at(720)).toBeCloseTo(2.2, 5);
    expect(at(3600)).toBeCloseTo(2.2, 5);
    for (let s = 0; s < 720; s += 30) expect(at(s + 30)).toBeGreaterThanOrEqual(at(s));
  });
});

describe('special upgrades', () => {
  const duel = (seed: number) => {
    const w = lab(seed);
    const rival = createFaction(2, 'Rival', '#f00', false, 'balanced');
    w.factions.set(2, rival);
    for (let y = -10; y <= 10; y++) for (let x = -12; x <= 12; x++) w.transfer(x, y, x < 0 ? PLAYER : 2);
    w.player.homeX = -6;
    rival.homeX = 6;
    return { w, rival };
  };

  it('Outposts plant cells beyond the border that are not touching it', () => {
    const w = lab(2);
    w.placeCluster(w.player, 0, 0);
    grantLevels(w.player, { outposts: 10 });
    let outposts = 0;
    for (let t = 0; t < 1200; t++) {
      w.step();
      for (const e of w.events) if (e.type === 'capture' && e.kind === 'outpost') outposts++;
      w.events.length = 0;
    }
    expect(outposts).toBeGreaterThan(3);
    expect(w.audit()).toEqual([]);
  });

  it('Chain Reaction converts extra enemy cells in cascades', () => {
    const count = (levels: Record<string, number>) => {
      const { w } = duel(3);
      grantLevels(w.player, { power: 10, rate: 20, ...levels });
      setBehavior(w.player, { focus: 1 });
      let chains = 0;
      for (let t = 0; t < 400; t++) {
        w.step();
        for (const e of w.events) if (e.type === 'capture' && e.kind === 'chain') chains++;
        w.events.length = 0;
      }
      return { chains, converted: w.player.converted };
    };
    const without = count({});
    const withChain = count({ chain: 8 });
    expect(without.chains).toBe(0);
    expect(withChain.chains).toBeGreaterThan(10);
    expect(withChain.converted).toBeGreaterThan(without.converted);
  });

  it('Siege weakens only enemy pockets cut off from their main territory', () => {
    const { w, rival } = duel(4);
    // A small rival pocket deep inside our side, cut off from the main rival block.
    for (let y = -2; y <= 0; y++) for (let x = -9; x <= -7; x++) w.transfer(x, y, 2);
    grantLevels(w.player, { siege: 8 });
    expect(w.isPocket(rival, -8, -1)).toBe(true);
    expect(w.isPocket(rival, 6, 0)).toBe(false);
    expect(w.resistMult(w.player, rival, -8, -1)).toBeLessThan(0.5);
    expect(w.resistMult(w.player, rival, 6, 0)).toBe(1);
  });

  it('Counterattack strikes back at attackers when their attacks fail', () => {
    const { w, rival } = duel(5);
    grantLevels(rival, { counter: 8, resistance: 20 });
    grantLevels(w.player, { rate: 20 });
    setBehavior(w.player, { focus: 1 });
    let counters = 0;
    for (let t = 0; t < 600; t++) {
      w.step();
      for (const e of w.events) if (e.type === 'capture' && e.kind === 'counter') counters++;
      w.events.length = 0;
    }
    expect(counters).toBeGreaterThan(3);
  });

  it('Tribute pays energy even when nothing is happening', () => {
    const w = lab(6);
    for (let x = 0; x < 20; x++) for (let y = 0; y < 10; y++) w.transfer(x, y, PLAYER);
    grantLevels(w.player, { tribute: 4 });
    w.player.stats.rate = 0;
    const e0 = w.player.energy;
    run(w, 10);
    // 200 cells × 1 energy/s per 100 cells × 10 s = 20.
    expect(w.player.energy - e0).toBeCloseTo(20, 0);
  });

  it('Capital makes home ground much harder to take, fading with distance', () => {
    const { w, rival } = duel(7);
    grantLevels(rival, { capital: 10 });
    const home = w.resistMult(w.player, rival, rival.homeX, rival.homeY);
    const near = w.resistMult(w.player, rival, rival.homeX + 3, rival.homeY);
    const far = w.resistMult(w.player, rival, rival.homeX + 10, rival.homeY);
    expect(home).toBeCloseTo(6, 5);
    expect(near).toBeGreaterThan(1);
    expect(near).toBeLessThan(home);
    expect(far).toBe(1);
  });
});

describe('caches', () => {
  it('stay exact while running a full game', () => {
    const w = World.create(9);
    run(w, 120);
    expect(w.audit()).toEqual([]);
  });
});
