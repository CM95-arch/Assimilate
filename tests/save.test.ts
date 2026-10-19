import { describe, expect, it } from 'vitest';
import { PLAYER_TRAITS, SAVE } from '../src/config/balance';
import { load, parse, save, serialize, type StorageLike } from '../src/persist/save';
import { Simulation } from '../src/sim/sim';
import { createSettings, createStats } from '../src/state';
import { fmt, fmtDuration, fmtPct } from '../src/util/format';

function memStore(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

function grown(seed = 8, ticks = 500) {
  const sim = new Simulation(seed);
  sim.seedPlayer();
  for (let t = 0; t < ticks; t++) sim.step();
  return sim;
}

describe('saves', () => {
  it('round-trips the colony exactly', () => {
    const sim = grown();
    const settings = { ...createSettings(), speed: 4 as const, sound: false, introSeen: true };
    const stats = { ...createStats(), cellsGrown: 1234, worldsStarted: 3 };
    const snap = parse(serialize({ sim, scale: 2, settings, stats }, 1000));
    expect(snap.sim.seed).toBe(sim.seed);
    expect(snap.sim.tick).toBe(sim.tick);
    expect(snap.sim.player.population).toBe(sim.player.population);
    expect(Array.from(snap.sim.world.owner)).toEqual(Array.from(sim.world.owner));
    expect(Array.from(snap.sim.world.dir).filter((_, i) => sim.world.owner[i] === 1)).toEqual(Array.from(sim.world.dir).filter((_, i) => sim.world.owner[i] === 1));
    expect(snap.scale).toBe(2);
    expect(snap.settings.speed).toBe(4);
    expect(snap.settings.sound).toBe(false);
    expect(snap.settings.introSeen).toBe(true);
    expect(snap.stats.cellsGrown).toBe(1234);
    expect(snap.sim.audit().problems).toEqual([]);
  });

  it('a restored colony keeps growing', () => {
    const sim = grown(4, 300);
    const snap = parse(serialize({ sim, scale: 0, settings: createSettings(), stats: createStats() }, 0));
    const before = snap.sim.player.population;
    for (let t = 0; t < 200; t++) snap.sim.step();
    expect(snap.sim.player.population).toBeGreaterThan(before);
  });

  it('keeps Rule Lab traits and clamps out-of-range values', () => {
    const settings = { ...createSettings(), customTraits: { ...PLAYER_TRAITS, branching: 99 } };
    const snap = parse(serialize({ sim: grown(1, 10), scale: 0, settings, stats: createStats() }, 0));
    expect(snap.settings.customTraits?.branching).toBe(4);
    expect(snap.sim.player.traits.branching).toBe(4);
  });

  it('falls back to the backup when the main save is corrupt', () => {
    const store = memStore();
    const sim = grown();
    expect(save(store, { sim, scale: 1, settings: createSettings(), stats: createStats() }, 1)).toBe(true);
    expect(save(store, { sim, scale: 1, settings: createSettings(), stats: createStats() }, 2)).toBe(true);
    store.data.set(SAVE.key, '{"version":1,"world":{"seed":1,"cells":"!!!not base64"');
    const r = load(store);
    expect(r.source).toBe('backup');
    expect(r.corrupt).toBe(true);
    expect(r.snapshot?.sim.player.population).toBe(sim.player.population);
  });

  it('starts fresh (without crashing) when every save is garbage or from the future', () => {
    const store = memStore();
    store.data.set(SAVE.key, 'garbage');
    store.data.set(SAVE.backupKey, JSON.stringify({ version: 999 }));
    const r = load(store);
    expect(r.snapshot).toBeNull();
    expect(r.corrupt).toBe(true);
  });

  it('rejects a world of the wrong size', () => {
    const bad = JSON.stringify({ version: 1, world: { seed: 1, tick: 0, cells: btoa('\x01\x01'), peak: 0, totalBorn: 0, scale: 0 } });
    expect(() => parse(bad)).toThrow();
  });

  it('reports storage failures instead of throwing', () => {
    const store: StorageLike = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
    expect(save(store, { sim: grown(1, 5), scale: 0, settings: createSettings(), stats: createStats() }, 0)).toBe(false);
  });
});

describe('number formatting', () => {
  it('abbreviates consistently', () => {
    expect(fmt(0)).toBe('0');
    expect(fmt(999)).toBe('999');
    expect(fmt(1234)).toBe('1.23K');
    expect(fmt(4_800_000)).toBe('4.8M');
    expect(fmt(2.3e9)).toBe('2.3B');
    expect(fmt(7.1e12)).toBe('7.1T');
    expect(fmtPct(0.1234)).toBe('12%');
    expect(fmtDuration(125)).toBe('2m 05s');
  });
});
