// Versioned saves with validation, a backup copy and graceful recovery (§21.6).
// The grid is stored compactly: one byte per cell (0 = not ours, 1–5 = ours + birth direction),
// base64-encoded. Terrain is regenerated from the seed instead of being stored.

import { SAVE, TRAIT_LIMITS, type GrowthTraits } from '../config/balance';
import { Simulation } from '../sim/sim';
import { NO_DIR, PLAYER } from '../sim/world';
import { activeTraits, createSettings, createStats, type LifetimeStats, type Settings } from '../state';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SaveFile {
  version: number;
  savedAt: number;
  world: { seed: number; tick: number; cells: string; peak: number; totalBorn: number; scale: number };
  settings: Settings;
  stats: LifetimeStats;
}

export interface Snapshot {
  sim: Simulation;
  scale: number;
  settings: Settings;
  stats: LifetimeStats;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function serialize(snap: Snapshot, now: number): string {
  const { sim } = snap;
  const w = sim.world;
  const cells = new Uint8Array(w.size);
  for (let i = 0; i < w.size; i++) if (w.owner[i] === PLAYER) cells[i] = 1 + Math.min(NO_DIR, w.dir[i]);
  const file: SaveFile = {
    version: SAVE.version,
    savedAt: now,
    world: { seed: sim.seed, tick: sim.tick, cells: toBase64(cells), peak: sim.player.peakPopulation, totalBorn: sim.player.totalBorn, scale: snap.scale },
    settings: snap.settings,
    stats: snap.stats,
  };
  return JSON.stringify(file);
}

const num = (v: unknown, fallback: number, min = 0, max = Number.MAX_VALUE): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

function traits(v: unknown): GrowthTraits | null {
  if (!v || typeof v !== 'object') return null;
  const src = v as Record<string, unknown>;
  const out = {} as GrowthTraits;
  for (const [k, lim] of Object.entries(TRAIT_LIMITS) as [keyof GrowthTraits, (typeof TRAIT_LIMITS)[keyof GrowthTraits]][]) {
    if (typeof src[k] !== 'number' || !Number.isFinite(src[k])) return null;
    out[k] = num(src[k], 0, lim.min, lim.max);
  }
  return out;
}

export function sanitizeSettings(v: unknown, fallback = createSettings()): Settings {
  const s = (v ?? {}) as Record<string, unknown>;
  const speed = s.speed === 2 || s.speed === 4 ? s.speed : 1;
  return {
    sound: bool(s.sound, fallback.sound),
    volume: num(s.volume, fallback.volume, 0, 1),
    reducedMotion: bool(s.reducedMotion, fallback.reducedMotion),
    diagnostics: bool(s.diagnostics, false),
    speed,
    introSeen: bool(s.introSeen, false),
    customTraits: traits(s.customTraits),
  };
}

function sanitizeStats(v: unknown): LifetimeStats {
  const s = (v ?? {}) as Record<string, unknown>;
  const base = createStats();
  return {
    playSeconds: num(s.playSeconds, 0),
    worldsStarted: Math.floor(num(s.worldsStarted, base.worldsStarted, 1)),
    cellsGrown: Math.floor(num(s.cellsGrown, 0)),
    bestPopulation: Math.floor(num(s.bestPopulation, 0)),
    highestScale: Math.floor(num(s.highestScale, 1, 1, 99)),
  };
}

/** Parse and validate a save string. Throws on anything unusable. */
export function parse(raw: string): Snapshot {
  const file = JSON.parse(raw) as Partial<SaveFile>;
  if (!file || typeof file !== 'object') throw new Error('Not a save');
  if (typeof file.version !== 'number' || file.version > SAVE.version) throw new Error(`Unsupported save version ${String(file.version)}`);
  const w = file.world;
  if (!w || typeof w.cells !== 'string' || typeof w.seed !== 'number') throw new Error('Save has no world');
  const settings = sanitizeSettings(file.settings);
  const bytes = fromBase64(w.cells);
  const owners = new Uint8Array(bytes.length);
  const dirs = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] > 0) {
      owners[i] = PLAYER;
      dirs[i] = Math.min(NO_DIR, bytes[i] - 1);
    }
  }
  const tick = Math.floor(num(w.tick, 0, 0, 2 ** 31));
  const sim = Simulation.restore(w.seed >>> 0, tick, owners, dirs, activeTraits(settings), Math.floor(num(w.peak, 0)), Math.floor(num(w.totalBorn, 0)));
  if (sim.player.population === 0) sim.seedPlayer();
  return { sim, scale: Math.floor(num(w.scale, 0, 0, 20)), settings, stats: sanitizeStats(file.stats) };
}

export interface LoadResult {
  snapshot: Snapshot | null;
  source: 'main' | 'backup' | 'none';
  corrupt: boolean;
}

export function load(store: StorageLike): LoadResult {
  let corrupt = false;
  for (const [key, source] of [[SAVE.key, 'main'], [SAVE.backupKey, 'backup']] as const) {
    let raw: string | null = null;
    try {
      raw = store.getItem(key);
    } catch {
      raw = null;
    }
    if (!raw) continue;
    try {
      return { snapshot: parse(raw), source, corrupt };
    } catch (e) {
      console.warn(`Save "${key}" unreadable:`, e);
      corrupt = true;
    }
  }
  return { snapshot: null, source: 'none', corrupt };
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
