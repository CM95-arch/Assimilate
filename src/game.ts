// Live controller: runs simulation ticks on a fixed clock, turns births into animations and
// sounds, and frames the camera. Holds no rules of its own — those live in src/sim.

import { AudioEngine } from './audio/audio';
import { ANIM, CAMERA, TIME } from './config/balance';
import { BirthAnims } from './render/anims';
import { Camera } from './render/camera';
import { randomSeed } from './sim/rng';
import { Simulation } from './sim/sim';
import { activeTraits, createSettings, createStats, type LifetimeStats, type Settings, type Speed } from './state';

export type GameEvent = { type: 'scale'; level: number } | { type: 'filled' };

export class Game {
  sim: Simulation;
  readonly camera = new Camera();
  anims: BirthAnims;
  readonly audio = new AudioEngine();
  settings: Settings;
  stats: LifetimeStats;
  paused = false;
  /** Fractional ticks waiting to run. */
  private acc = 0;
  /** Measured ticks per second (diagnostics). */
  tickRate = 0;
  tickMs = 0;
  private tickCounter = 0;
  private tickTimer = 0;
  private filledAnnounced = false;
  readonly events: GameEvent[] = [];

  constructor(sim: Simulation | null, scale = 0, settings = createSettings(), stats = createStats()) {
    this.settings = settings;
    this.stats = stats;
    this.sim = sim ?? Game.freshSim(randomSeed(), settings);
    this.anims = new BirthAnims(this.sim.world.size);
    this.applyMotion();
    this.snapToStart(scale);
    if (scale > 0) this.frame(true);
    this.filledAnnounced = this.sim.filled;
    // Restored cells are already settled; only new births animate.
    this.sim.births.length = 0;
  }

  static freshSim(seed: number, settings: Settings): Simulation {
    const sim = new Simulation(seed, activeTraits(settings));
    sim.seedPlayer();
    return sim;
  }

  get speed(): Speed {
    return this.settings.speed;
  }

  setSpeed(s: Speed) {
    this.settings.speed = s;
  }

  applyMotion() {
    this.anims.bounce = !this.settings.reducedMotion;
    this.anims.durationMs = this.settings.reducedMotion ? 140 : ANIM.birthMs;
  }

  private snapToStart(level: number) {
    const w = this.sim.world;
    this.camera.snap(level, (this.sim.startCell % w.width) + 0.5, ((this.sim.startCell / w.width) | 0) + 0.5);
  }

  /** Start a new world (new seed) or replay the current one (same seed). */
  restart(seed: number = randomSeed()) {
    this.sim = Game.freshSim(seed, this.settings);
    this.anims = new BirthAnims(this.sim.world.size);
    this.applyMotion();
    this.snapToStart(0);
    this.acc = 0;
    this.filledAnnounced = false;
    this.stats.worldsStarted++;
  }

  /** Apply Rule Lab traits to the running colony. */
  applyTraits() {
    this.sim.setTraits(1, activeTraits(this.settings));
  }

  /** Advance real time by dt seconds (already clamped by the caller). */
  update(dt: number, now: number) {
    this.camera.update(dt);
    this.stats.playSeconds += dt;
    if (this.paused) {
      this.acc = 0;
      return;
    }
    const tps = TIME.ticksPerSecond * this.speed;
    this.acc = Math.min(this.acc + dt * tps, TIME.maxTicksPerFrame);
    const tickMs = 1000 / tps;
    let ran = 0;
    const t0 = performance.now();
    while (this.acc >= 1) {
      this.acc -= 1;
      this.sim.step();
      ran++;
    }
    if (ran > 0) this.tickMs = (performance.now() - t0) / ran;
    this.tickCounter += ran;
    this.tickTimer += dt;
    if (this.tickTimer >= 1) {
      this.tickRate = this.tickCounter / this.tickTimer;
      this.tickCounter = 0;
      this.tickTimer = 0;
    }

    const births = this.sim.births;
    if (births.length > 0) {
      const busy = this.sim.birthRate();
      // Spread births over the interval they represent so growth looks continuous.
      const span = Math.max(1, ran) * tickMs;
      for (const b of births) this.anims.add(b.cell, now + Math.random() * span);
      this.stats.cellsGrown += births.length;
      if (this.settings.sound) this.audio.pop(busy);
      births.length = 0;
    }
    const pop = this.sim.player.population;
    if (pop > this.stats.bestPopulation) this.stats.bestPopulation = pop;
    this.frame(false);
    if (this.sim.filled && !this.filledAnnounced) {
      this.filledAnnounced = true;
      this.events.push({ type: 'filled' });
    }
  }

  /** Zoom out at population milestones, or early if the colony nears the view edge. */
  private frame(force: boolean) {
    const cam = this.camera;
    const c = this.sim.player;
    const levels = CAMERA.viewCells.length;
    let level = cam.level;
    const half = () => CAMERA.viewCells[level] / 2;
    const reach = () => Math.max(cam.cx - c.minX, c.maxX + 1 - cam.cx, cam.cy - c.minY, c.maxY + 1 - cam.cy);
    while (level < levels - 1 && (c.population >= CAMERA.milestones[level] || reach() > half() * CAMERA.edgeFraction)) level++;
    if (level === cam.level && !force) return;
    // Centre on the colony, but keep the world filling the view where possible.
    const w = this.sim.world;
    const halfView = CAMERA.viewCells[level] / 2;
    const clampC = (v: number, size: number) => (size <= halfView * 2 ? size / 2 : Math.min(size - halfView, Math.max(halfView, v)));
    const cx = clampC((c.minX + c.maxX + 1) / 2, w.width);
    const cy = clampC((c.minY + c.maxY + 1) / 2, w.height);
    if (force) cam.snap(level, cx, cy);
    else {
      cam.zoomTo(level, cx, cy, this.settings.reducedMotion ? 0.6 : CAMERA.zoomSeconds);
      if (this.settings.sound) this.audio.whoosh();
      this.events.push({ type: 'scale', level });
    }
    if (level + 1 > this.stats.highestScale) this.stats.highestScale = level + 1;
  }

  status(): 'Growing' | 'Slowing' | 'Filled' | 'Paused' | 'Dormant' {
    if (this.sim.filled) return 'Filled';
    if (this.paused) return 'Paused';
    const r = this.sim.birthRate();
    if (this.sim.tick < 30) return 'Growing';
    if (r <= 0.05) return 'Dormant';
    return r < 1 ? 'Slowing' : 'Growing';
  }
}
