// Live controller: runs the current match's ticks on a fixed clock, turns events into animations
// and sounds, keeps statistics and league progress, and frames the camera. The rules live in src/sim.

import { AudioEngine } from './audio/audio';
import { ANIM, CAMERA, COLORS, MATCH, TIME } from './config/balance';
import { Anims } from './render/anims';
import { Camera } from './render/camera';
import { centroid } from './sim/faction';
import { NEUTRAL } from './sim/grid';
import { randomSeed } from './sim/rng';
import { PLAYER, World } from './sim/world';
import { createProgress, createSettings, createStats, type LifetimeStats, type Progress, type Settings, type Speed } from './state';

export type GameEvent =
  | { type: 'scale'; level: number }
  | { type: 'eliminated'; faction: number; byPlayer: boolean }
  /** The match is over: you won, a rival won (`winner`), or you were wiped out (winner 0). */
  | { type: 'match-end'; won: boolean; winner: number; unlocked: boolean }
  | { type: 'contact'; faction: number }
  | { type: 'flag-reached' }
  | { type: 'flag'; action: 'planted' | 'removed' | 'hint' };

export class Game {
  world: World;
  readonly camera = new Camera();
  readonly anims = new Anims();
  readonly audio = new AudioEngine();
  settings: Settings;
  stats: LifetimeStats;
  progress: Progress;
  paused = false;
  private acc = 0;
  /** Measured ticks per second and cost (diagnostics). */
  tickRate = 0;
  tickMs = 0;
  private tickCounter = 0;
  private tickTimer = 0;
  /** Rivals the player has already touched this run (for the first-contact notice). */
  private met = new Set<number>();
  private contactTimer = 0;
  /** Player energy already counted into lifetime statistics. */
  private countedEnergy = 0;
  readonly events: GameEvent[] = [];

  constructor(world: World | null, scale = 0, settings = createSettings(), stats = createStats(), progress = createProgress()) {
    this.settings = settings;
    this.stats = stats;
    this.progress = progress;
    this.world = world ?? World.create(randomSeed(), 1);
    this.applyMotion();
    const c = centroid(this.world.player);
    this.camera.snap(scale, c.x + 0.5, c.y + 0.5);
    // A save from late in a match may already show the whole arena: centre on it.
    const t = this.cameraTarget();
    this.camera.snap(scale, t.x, t.y);
    for (const id of this.world.contacts()) this.met.add(id);
    this.countedEnergy = this.world.player.earned;
  }

  get speed(): Speed {
    return this.settings.speed;
  }

  setSpeed(s: Speed) {
    this.settings.speed = s;
  }

  applyMotion() {
    this.anims.reduced = this.settings.reducedMotion;
  }

  /** Start a new match in `league` (default: the current one). Statistics and progress are kept. */
  newRun(seed: number = randomSeed(), league = this.world.league) {
    this.world = World.create(seed, Math.min(league, this.progress.unlocked));
    this.anims.clear();
    this.met.clear();
    this.countedEnergy = 0;
    this.acc = 0;
    this.paused = false;
    this.camera.recenter();
    const c = centroid(this.world.player);
    this.camera.snap(0, c.x + 0.5, c.y + 0.5);
    this.stats.runsStarted++;
  }

  update(dt: number, now: number) {
    this.stats.playSeconds += dt;
    const w = this.world;
    if (!this.paused && !w.ended) {
      const tps = TIME.ticksPerSecond * this.speed;
      this.acc = Math.min(this.acc + dt * tps, TIME.maxTicksPerFrame);
      const tickMs = 1000 / tps;
      let ran = 0;
      const t0 = performance.now();
      while (this.acc >= 1 && !w.ended) {
        this.acc -= 1;
        w.step();
        ran++;
      }
      if (ran > 0) this.tickMs = (performance.now() - t0) / ran;
      this.tickCounter += ran;
      this.digest(now, Math.max(1, ran) * tickMs);
    } else {
      this.acc = 0;
      // Events can still arrive while stopped (e.g. the tick that ended the run).
      if (w.events.length) this.digest(now, 0);
    }
    this.tickTimer += dt;
    if (this.tickTimer >= 1) {
      this.tickRate = this.tickCounter / this.tickTimer;
      this.tickCounter = 0;
      this.tickTimer = 0;
    }
    this.frameCamera(dt);
    this.contactTimer += dt;
    if (this.contactTimer > 0.5) {
      this.contactTimer = 0;
      for (const id of w.contacts()) {
        if (this.met.has(id)) continue;
        this.met.add(id);
        this.events.push({ type: 'contact', faction: id });
      }
    }
  }

  /** Turn simulation events into effects, sounds, statistics and UI notices. */
  private digest(now: number, span: number) {
    const w = this.world;
    const colorOf = (id: number) => (id === NEUTRAL ? '' : w.factions.get(id)?.color ?? '#000');
    let playerGain = 0;
    let playerConquest = 0;
    let playerLoss = 0;
    for (const e of w.events) {
      switch (e.type) {
        case 'capture': {
          const from = e.from === NEUTRAL ? '' : colorOf(e.from);
          let start = now + Math.random() * span;
          // Chain links pop one after another, so a cascade reads as a wave.
          if (e.kind === 'chain') start = now + (e.link ?? 1) * ANIM.chainStepMs;
          this.anims.add({ x: e.x, y: e.y, kind: 'capture', start, fromColor: from || COLORS.neutral, toColor: colorOf(e.by) });
          if (e.by === PLAYER) {
            if (e.from === NEUTRAL) {
              this.stats.cellsClaimed++;
              playerGain++;
            } else {
              this.stats.cellsConverted++;
              playerConquest++;
            }
          } else if (e.from === PLAYER) {
            this.stats.cellsLost++;
            playerLoss++;
          }
          break;
        }
        case 'hit':
          this.anims.add({ x: e.x, y: e.y, kind: 'hit', start: now + Math.random() * span, fromColor: colorOf(e.owner), toColor: colorOf(e.owner) });
          break;
        case 'eliminated':
          if (e.faction !== PLAYER) {
            if (e.by === PLAYER) this.stats.rivalsEliminated++;
            this.events.push({ type: 'eliminated', faction: e.faction, byPlayer: e.by === PLAYER });
          }
          break;
        case 'defeat':
          this.endMatch(0);
          break;
        case 'won':
          this.endMatch(e.faction);
          break;
        case 'flag':
          if (e.faction === PLAYER) this.events.push({ type: 'flag-reached' });
          break;
      }
    }
    w.events.length = 0;
    const p = w.player;
    this.stats.energyEarned += p.earned - this.countedEnergy;
    this.countedEnergy = p.earned;
    if (p.cells > this.stats.bestTerritory) this.stats.bestTerritory = p.cells;
    if (this.settings.sound) {
      if (playerConquest) this.audio.convert();
      else if (playerGain) this.audio.pop();
      if (playerLoss) this.audio.lose();
    }
  }

  /** Record the result in league progress and tell the UI. */
  private endMatch(winner: number) {
    const won = winner === PLAYER;
    const pr = this.progress;
    const league = this.world.league;
    let unlocked = false;
    if (won) {
      pr.wins++;
      const t = this.world.time;
      if (!pr.best[league] || t < pr.best[league]) pr.best[league] = t;
      if (league === pr.unlocked && league < MATCH.maxLeague) {
        pr.unlocked++;
        unlocked = true;
      }
    } else pr.losses++;
    this.events.push({ type: 'match-end', won, winner, unlocked });
  }

  /** Follow the player's territory and widen the view as its extent grows, up to the whole arena. */
  private frameCamera(dt: number) {
    const p = this.world.player;
    const cam = this.camera;
    const target = this.cameraTarget();
    cam.update(dt, target.x, target.y);
    if (p.cells === 0) return;
    const extent = Math.max(p.maxX - p.minX, p.maxY - p.minY) + 3;
    let level = cam.level;
    const last = this.arenaLevel();
    while (level < last && extent > CAMERA.viewCells[level] * CAMERA.fitFraction) level++;
    if (level > cam.level) {
      cam.zoomTo(level, this.settings.reducedMotion ? 0.5 : CAMERA.zoomSeconds);
      if (this.settings.sound) this.audio.whoosh();
      this.events.push({ type: 'scale', level });
      if (level + 1 > this.stats.highestScale) this.stats.highestScale = level + 1;
    }
  }

  /**
   * A tap on the map at cell (x, y): plant the rally flag there, or take it down if the tap is on
   * the flag itself or on your own ground.
   */
  tapFlag(x: number, y: number, tolerance: number) {
    const w = this.world;
    const p = w.player;
    if (!p.alive || w.ended) return;
    const fl = p.flag;
    if (fl && Math.hypot(fl.x - x, fl.y - y) <= tolerance) {
      w.setFlag(p, null);
      this.events.push({ type: 'flag', action: 'removed' });
    } else if (w.grid.owner(x, y) === PLAYER) {
      // Your own ground is no place for a flag: tapping it takes the flag down, or explains.
      if (fl) w.setFlag(p, null);
      this.events.push({ type: 'flag', action: fl ? 'removed' : 'hint' });
    } else {
      w.setFlag(p, { x, y });
      this.events.push({ type: 'flag', action: 'planted' });
    }
    if (this.settings.sound) this.audio.click();
  }

  /** Where the camera looks: your territory, until the view is wide enough to show the whole arena. */
  cameraTarget(): { x: number; y: number } {
    const w = this.world;
    const p = w.player;
    if (this.camera.level >= this.arenaLevel() || p.cells === 0) return { x: w.size / 2, y: w.size / 2 };
    return { x: (p.minX + p.maxX + 1) / 2, y: (p.minY + p.maxY + 1) / 2 };
  }

  /** The first scale that shows the whole arena; the view never needs to widen beyond it. */
  arenaLevel(): number {
    const i = CAMERA.viewCells.findIndex((v) => v >= this.world.size + 4);
    return i < 0 ? CAMERA.viewCells.length - 1 : i;
  }

  status(): 'Expanding' | 'At war' | 'Losing ground' | 'Leading' | 'Paused' | 'Victory' | 'Defeated' {
    const w = this.world;
    if (w.ended) return w.winner === PLAYER ? 'Victory' : 'Defeated';
    if (this.paused) return 'Paused';
    if (w.cellRate() < -0.2) return 'Losing ground';
    if (w.leader === PLAYER) return 'Leading';
    return w.contacts().length ? 'At war' : 'Expanding';
  }
}
