import { describe, expect, it } from 'vitest';
import { SAVE } from '../src/config/balance';
import { buy } from '../src/sim/economy';
import { load, parse, save, serialize, type StorageLike } from '../src/persist/save';
import { World } from '../src/sim/world';
import { createSettings, createStats } from '../src/state';
import { fmt, fmtDuration, fmtPct } from '../src/util/format';

function memStore(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

function played(seed = 8, ticks = 1200) {
  const w = World.create(seed);
  buy(w.player, 'rate');
  for (let t = 0; t < ticks; t++) w.step();
  return w;
}

const snap = (world: World, extra: Partial<{ scale: number }> = {}) => ({ world, scale: extra.scale ?? 0, settings: createSettings(), stats: createStats() });

describe('saves', () => {
  it('round-trips territory, factions, upgrades and energy exactly', () => {
    const w = played();
    const back = parse(serialize(snap(w, { scale: 2 }), 1000)).world;
    expect(back.audit()).toEqual([]);
    expect(back.tick).toBe(w.tick);
    expect(back.factions.size).toBe(w.factions.size);
    for (const f of w.factions.values()) {
      const g = back.factions.get(f.id)!;
      expect(g.cells).toBe(f.cells);
      expect(g.frontier.size).toBe(f.frontier.size);
      expect(g.levels).toEqual(f.levels);
      expect(g.energy).toBeCloseTo(f.energy, 6);
      expect(g.profile).toBe(f.profile);
      expect(g.stats.rate).toBeCloseTo(f.stats.rate, 9);
    }
    w.grid.forEachOwned((x, y, o) => expect(back.grid.owner(x, y)).toBe(o));
  });

  it('a restored run carries on normally (random order of border cells may differ)', () => {
    const a = played(5, 600);
    const b = parse(serialize(snap(a), 0)).world;
    for (let t = 0; t < 300; t++) {
      a.step();
      b.step();
    }
    expect(b.audit()).toEqual([]);
    expect(b.player.cells).toBeGreaterThan(a.player.cells * 0.85);
    expect(b.player.cells).toBeLessThan(a.player.cells * 1.15);
  });

  it('keeps settings and stats', () => {
    const settings = { ...createSettings(), speed: 4 as const, sound: false, introSeen: true };
    const stats = { ...createStats(), cellsConverted: 1234, runsStarted: 3 };
    const s = parse(serialize({ world: played(1, 10), scale: 1, settings, stats }, 0));
    expect(s.settings.speed).toBe(4);
    expect(s.settings.sound).toBe(false);
    expect(s.stats.cellsConverted).toBe(1234);
    expect(s.stats.runsStarted).toBe(3);
    expect(s.scale).toBe(1);
  });

  it('falls back to the backup when the main save is corrupt', () => {
    const store = memStore();
    const w = played();
    expect(save(store, snap(w), 1)).toBe(true);
    expect(save(store, snap(w), 2)).toBe(true);
    store.data.set(SAVE.key, '{"version":2,"world":{"seed":1');
    const r = load(store);
    expect(r.source).toBe('backup');
    expect(r.corrupt).toBe(true);
    expect(r.snapshot?.world.player.cells).toBe(w.player.cells);
  });

  it('sets aside saves from the old biology design without calling them corrupt', () => {
    const store = memStore();
    store.data.set(SAVE.key, JSON.stringify({ version: 1, world: { seed: 1, cells: '' } }));
    const r = load(store);
    expect(r.snapshot).toBeNull();
    expect(r.outdated).toBe(true);
    expect(r.corrupt).toBe(false);
  });

  it('starts fresh when every save is garbage or from the future', () => {
    const store = memStore();
    store.data.set(SAVE.key, 'garbage');
    store.data.set(SAVE.backupKey, JSON.stringify({ version: 999 }));
    const r = load(store);
    expect(r.snapshot).toBeNull();
    expect(r.corrupt).toBe(true);
  });

  it('rejects chunks of the wrong size and saves without a player', () => {
    const base = JSON.parse(serialize(snap(played(1, 20)), 0));
    const bad = structuredClone(base);
    bad.world.chunks[0].owner = btoa('\x01\x01');
    expect(() => parse(JSON.stringify(bad))).toThrow();
    const noPlayer = structuredClone(base);
    noPlayer.world.factions = noPlayer.world.factions.filter((f: { id: number }) => f.id !== 1);
    expect(() => parse(JSON.stringify(noPlayer))).toThrow();
  });

  it('clamps tampered upgrade levels', () => {
    const base = JSON.parse(serialize(snap(played(1, 20)), 0));
    base.world.factions[0].levels = { rate: 99999, nonsense: 5 };
    const w = parse(JSON.stringify(base)).world;
    expect(w.player.levels).toEqual({ rate: 60 });
  });

  it('reports storage failures instead of throwing', () => {
    const store: StorageLike = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
    expect(save(store, snap(played(1, 5)), 0)).toBe(false);
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
