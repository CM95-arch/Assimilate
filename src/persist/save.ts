// Versioned saves with validation, a backup copy and graceful recovery.
// Territory is stored per chunk: owner bytes plus a coarse "held for" age (for entrenchment).
// Everything derived (frontiers, counts, stats) is rebuilt on load rather than trusted.

import { GRID, SAVE } from '../config/balance';
import { PROFILE_BY_ID } from '../config/profiles';
import { BEHAVIOR_KEYS, UPGRADE_BY_ID, type Behavior } from '../config/upgrades';
import { createFaction, type Faction } from '../sim/faction';
import { Chunk, cellKey } from '../sim/grid';
import { World } from '../sim/world';
import { createSettings, createStats, type LifetimeStats, type Settings } from '../state';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface SavedFaction {
  id: number; name: string; color: string; isPlayer: boolean; profile: string;
  taste: Record<string, number>; levels: Record<string, number>; behavior: Behavior;
  energy: number; earned: number; alive: boolean; spawnedAt: number; homeX: number; homeY: number;
  claimed: number; converted: number; lost: number; peakCells: number;
}

export interface SaveFile {
  version: number;
  savedAt: number;
  world: {
    seed: number; tick: number; rng: number; ended: boolean;
    counters: { rivalsCreated: number; nextSpawnCheck: number };
    factions: SavedFaction[];
    chunks: { cx: number; cy: number; owner: string; age: string }[];
  };
  scale: number;
  settings: Settings;
  stats: LifetimeStats;
}

export interface Snapshot {
  world: World;
  scale: number;
  settings: Settings;
  stats: LifetimeStats;
}

/** Seconds per step of the stored "held for" age (255 steps ≈ 8.5 minutes). */
const AGE_STEP = 2;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string, length: number): Uint8Array {
  const s = atob(b64);
  if (s.length !== length) throw new Error('Chunk data has the wrong size');
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function serialize(snap: Snapshot, now: number): string {
  const w = snap.world;
  const N = GRID.chunk * GRID.chunk;
  const chunks: SaveFile['world']['chunks'] = [];
  for (const c of w.grid.chunks.values()) {
    if (c.count === 0) continue;
    const age = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (c.owner[i]) age[i] = Math.min(255, Math.max(0, Math.floor((w.time - c.since[i]) / AGE_STEP)));
    chunks.push({ cx: c.cx, cy: c.cy, owner: toBase64(c.owner), age: toBase64(age) });
  }
  const factions: SavedFaction[] = [...w.factions.values()].map((f) => ({
    id: f.id, name: f.name, color: f.color, isPlayer: f.isPlayer, profile: f.profile, taste: f.taste, levels: f.levels, behavior: f.behavior,
    energy: f.energy, earned: f.earned, alive: f.alive, spawnedAt: f.spawnedAt, homeX: f.homeX, homeY: f.homeY,
    claimed: f.claimed, converted: f.converted, lost: f.lost, peakCells: f.peakCells,
  }));
  const file: SaveFile = {
    version: SAVE.version,
    savedAt: now,
    world: { seed: w.seed, tick: w.tick, rng: w.rng.state, ended: w.ended, counters: w.counters, factions, chunks },
    scale: snap.scale,
    settings: snap.settings,
    stats: snap.stats,
  };
  return JSON.stringify(file);
}

const num = (v: unknown, fallback: number, min = -Number.MAX_VALUE, max = Number.MAX_VALUE): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v.length < 64 ? v : fallback);

export function sanitizeSettings(v: unknown, fallback = createSettings()): Settings {
  const s = (v ?? {}) as Record<string, unknown>;
  return {
    sound: bool(s.sound, fallback.sound),
    volume: num(s.volume, fallback.volume, 0, 1),
    reducedMotion: bool(s.reducedMotion, fallback.reducedMotion),
    diagnostics: bool(s.diagnostics, false),
    speed: s.speed === 2 || s.speed === 4 ? s.speed : 1,
    introSeen: bool(s.introSeen, false),
  };
}

function sanitizeStats(v: unknown): LifetimeStats {
  const s = (v ?? {}) as Record<string, unknown>;
  const base = createStats();
  const out = { ...base };
  for (const k of Object.keys(base) as (keyof LifetimeStats)[]) out[k] = num(s[k], base[k], 0);
  out.runsStarted = Math.max(1, Math.floor(out.runsStarted));
  out.highestScale = Math.max(1, Math.floor(out.highestScale));
  return out;
}

function levels(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object') {
    for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
      const def = UPGRADE_BY_ID[k];
      if (!def) continue;
      const n = Math.floor(num(raw, 0, 0, def.maxLevel));
      if (n > 0) out[k] = n;
    }
  }
  return out;
}

function faction(v: unknown): Faction {
  const s = (v ?? {}) as Record<string, unknown>;
  const id = Math.floor(num(s.id, 0, 1, 254));
  const isPlayer = id === 1;
  const profile = isPlayer ? '' : str(s.profile, 'balanced');
  const taste: Record<string, number> = {};
  if (s.taste && typeof s.taste === 'object') for (const [k, t] of Object.entries(s.taste as Record<string, unknown>)) if (UPGRADE_BY_ID[k]) taste[k] = num(t, 1, 0.01, 100);
  const f = createFaction(id, str(s.name, isPlayer ? 'You' : 'Rival'), str(s.color, '#888888'), isPlayer, (PROFILE_BY_ID[profile] || isPlayer) ? profile : 'balanced', taste);
  f.levels = levels(s.levels);
  const b = (s.behavior ?? {}) as Record<string, unknown>;
  for (const k of BEHAVIOR_KEYS) f.behavior[k] = num(b[k], 0, -1, 1);
  f.energy = num(s.energy, 0, 0);
  f.earned = num(s.earned, 0, 0);
  f.alive = bool(s.alive, true);
  f.spawnedAt = num(s.spawnedAt, 0, 0);
  f.homeX = Math.floor(num(s.homeX, 0));
  f.homeY = Math.floor(num(s.homeY, 0));
  f.claimed = Math.floor(num(s.claimed, 0, 0));
  f.converted = Math.floor(num(s.converted, 0, 0));
  f.lost = Math.floor(num(s.lost, 0, 0));
  f.peakCells = Math.floor(num(s.peakCells, 0, 0));
  return f;
}

export class OutdatedSaveError extends Error {}

/** Parse and validate a save string. Throws on anything unusable. */
export function parse(raw: string): Snapshot {
  const file = JSON.parse(raw) as Partial<SaveFile>;
  if (!file || typeof file !== 'object') throw new Error('Not a save');
  if (typeof file.version !== 'number') throw new Error('Save has no version');
  if (file.version < SAVE.version) throw new OutdatedSaveError(`Save version ${file.version} is from an earlier design`);
  if (file.version > SAVE.version) throw new Error(`Save version ${file.version} is newer than this game`);
  const src = file.world;
  if (!src || !Array.isArray(src.factions) || !Array.isArray(src.chunks)) throw new Error('Save has no world');
  const world = new World(Math.floor(num(src.seed, 1, 0, 2 ** 32)) >>> 0);
  world.tick = Math.floor(num(src.tick, 0, 0, 2 ** 31));
  world.rng.state = Math.floor(num(src.rng, 1, 0, 2 ** 32)) >>> 0;
  world.ended = bool(src.ended, false);
  const counters = (src.counters ?? {}) as Partial<World['counters']>;
  world.counters = { rivalsCreated: Math.floor(num(counters.rivalsCreated, 0, 0, 1e6)), nextSpawnCheck: num(counters.nextSpawnCheck, 0, 0) };
  for (const raw of src.factions) {
    const f = faction(raw);
    world.factions.set(f.id, f);
  }
  if (!world.factions.get(1)) throw new Error('Save has no player faction');
  const N = GRID.chunk * GRID.chunk;
  for (const c of src.chunks) {
    const cx = Math.floor(num(c?.cx, NaN));
    const cy = Math.floor(num(c?.cy, NaN));
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || typeof c.owner !== 'string' || typeof c.age !== 'string') throw new Error('Bad chunk');
    const owner = fromBase64(c.owner, N);
    const age = fromBase64(c.age, N);
    const chunk = new Chunk(cx, cy);
    for (let i = 0; i < N; i++) {
      const o = owner[i];
      if (o === 0 || !world.factions.has(o)) continue;
      chunk.owner[i] = o;
      chunk.since[i] = world.time - age[i] * AGE_STEP;
      chunk.count++;
    }
    world.grid.chunks.set(cellKey(cx, cy), chunk);
  }
  world.rebuildCaches();
  return { world, scale: Math.floor(num(file.scale, 0, 0, 20)), settings: sanitizeSettings(file.settings), stats: sanitizeStats(file.stats) };
}

export interface LoadResult {
  snapshot: Snapshot | null;
  source: 'main' | 'backup' | 'none';
  corrupt: boolean;
  /** A save from the earlier (pre-redesign) version was found and set aside. */
  outdated: boolean;
}

export function load(store: StorageLike): LoadResult {
  let corrupt = false;
  let outdated = false;
  for (const [key, source] of [[SAVE.key, 'main'], [SAVE.backupKey, 'backup']] as const) {
    let raw: string | null = null;
    try {
      raw = store.getItem(key);
    } catch {
      raw = null;
    }
    if (!raw) continue;
    try {
      return { snapshot: parse(raw), source, corrupt, outdated };
    } catch (e) {
      if (e instanceof OutdatedSaveError) outdated = true;
      else {
        console.warn(`Save "${key}" unreadable:`, e);
        corrupt = true;
      }
    }
  }
  return { snapshot: null, source: 'none', corrupt, outdated };
}

/** Write the save, keeping the previous good save as a backup. Returns false if storage failed. */
export function save(store: StorageLike, snap: Snapshot, now: number): boolean {
  try {
    const data = serialize(snap, now);
    const prev = store.getItem(SAVE.key);
    if (prev) store.setItem(SAVE.backupKey, prev);
    store.setItem(SAVE.key, data);
    return true;
  } catch (e) {
    console.warn('Save failed:', e);
    return false;
  }
}

export function wipe(store: StorageLike) {
  try {
    store.removeItem(SAVE.key);
    store.removeItem(SAVE.backupKey);
  } catch {
    /* ignore */
  }
}
