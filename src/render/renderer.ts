// Canvas drawing. Everything is procedural: flat rounded blocks, no sprites.
// Soil and rock rarely change, so they are cached in an offscreen layer that is redrawn only
// when the camera moves; living cells are drawn each frame in a few batched paths.

import { ANIM, COLORS } from '../config/balance';
import type { Simulation } from '../sim/sim';
import { EMPTY, ROCK } from '../sim/world';
import type { BirthAnims } from './anims';
import type { Camera, Rect } from './camera';

const hex = (rgb: readonly number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: string, b: string, t: number) => {
  const pa = [1, 3, 5].map((k) => parseInt(a.slice(k, k + 2), 16));
  const pb = [1, 3, 5].map((k) => parseInt(b.slice(k, k + 2), 16));
  return hex(pa.map((v, k) => v + (pb[k] - v) * t));
};

const SOIL = Array.from({ length: COLORS.soilBuckets }, (_, k) => {
  const t = k / (COLORS.soilBuckets - 1);
  return hex(COLORS.soilBarren.map((v, j) => v + (COLORS.soilRich[j] - v) * t));
});
/** Maturity shades from newborn to adult. */
const AGE_SHADES = 4;
const PLAYER_SHADES = Array.from({ length: AGE_SHADES }, (_, k) => mix(COLORS.playerYoung, COLORS.player, k / (AGE_SHADES - 1)));

const hasRoundRect =
  typeof Path2D !== 'undefined' && 'roundRect' in Path2D.prototype &&
  typeof CanvasRenderingContext2D !== 'undefined' && 'roundRect' in CanvasRenderingContext2D.prototype;

export interface FrameInfo {
  /** Milliseconds spent drawing the last frame. */
  drawMs: number;
  cellsDrawn: number;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layer: HTMLCanvasElement;
  private readonly lctx: CanvasRenderingContext2D;
  private layerKey = '';
  private dpr = 1;
  private cssW = 1;
  private cssH = 1;
  /** Playfield: the area between the HUD and the bottom controls (CSS px). */
  play: Rect = { x: 0, y: 0, w: 1, h: 1 };
  info: FrameInfo = { drawMs: 0, cellsDrawn: 0 };

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.layer = document.createElement('canvas');
    this.lctx = this.layer.getContext('2d', { alpha: false })!;
  }

  resize(cssW: number, cssH: number, play: Rect) {
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.cssW = cssW;
    this.cssH = cssH;
    this.play = play;
    const w = Math.max(1, Math.round(cssW * this.dpr));
    const h = Math.max(1, Math.round(cssH * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.layer.width = w;
      this.layer.height = h;
    }
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.layerKey = '';
  }

  /** Geometry shared by both passes, in device pixels. */
  private geometry(cam: Camera, sim: Simulation) {
    const d = this.dpr;
    const pitchCss = cam.pitch(this.play);
    const pitch = pitchCss * d;
    const ox = (this.play.x + this.play.w / 2) * d - cam.cx * pitch;
    const oy = (this.play.y + this.play.h / 2) * d - cam.cy * pitch;
    const gapCss = pitchCss < ANIM.noGapBelowPx ? 0 : Math.min(ANIM.gapMaxPx, Math.max(ANIM.gapMinPx, pitchCss * ANIM.gapFraction));
    const gap = gapCss * d;
    const radius = pitchCss >= ANIM.roundAbovePx && hasRoundRect ? pitch * ANIM.cornerFraction : 0;
    const w = sim.world;
    const x0 = Math.max(0, Math.floor(-ox / pitch));
    const y0 = Math.max(0, Math.floor(-oy / pitch));
    const x1 = Math.min(w.width - 1, Math.ceil((this.canvas.width - ox) / pitch));
    const y1 = Math.min(w.height - 1, Math.ceil((this.canvas.height - oy) / pitch));
    return { pitch, ox, oy, gap, radius, x0, y0, x1, y1 };
  }

  /** Edges are rounded to device pixels separately, so adjacent blocks never leave seams. */
  private addBlock(p: Path2D, left: number, top: number, right: number, bottom: number, radius: number) {
    const w = Math.max(1, right - left);
    const h = Math.max(1, bottom - top);
    if (radius > 0) p.roundRect(left, top, w, h, radius);
    else p.rect(left, top, w, h);
  }

  /** Soil + rock layer. */
  private drawLayer(cam: Camera, sim: Simulation) {
    const g = this.geometry(cam, sim);
    const key = `${cam.version}|${this.canvas.width}x${this.canvas.height}|${sim.seed}|${this.play.y}|${this.play.h}`;
    if (key === this.layerKey) return;
    this.layerKey = key;
    const c = this.lctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = COLORS.background;
    c.fillRect(0, 0, this.layer.width, this.layer.height);
    const w = sim.world;
    const soil = SOIL.map(() => new Path2D());
    const rock = new Path2D();
    for (let y = g.y0; y <= g.y1; y++) {
      const top = Math.round(g.oy + y * g.pitch + g.gap / 2);
      const bottom = Math.round(g.oy + (y + 1) * g.pitch - g.gap / 2);
      for (let x = g.x0; x <= g.x1; x++) {
        const i = y * w.width + x;
        const left = Math.round(g.ox + x * g.pitch + g.gap / 2);
        const right = Math.round(g.ox + (x + 1) * g.pitch - g.gap / 2);
        if (w.owner[i] === ROCK) this.addBlock(rock, left, top, right, bottom, g.radius);
        else this.addBlock(soil[Math.min(SOIL.length - 1, Math.floor(w.fertility[i] * SOIL.length))], left, top, right, bottom, g.radius);
      }
    }
    soil.forEach((p, k) => {
      c.fillStyle = SOIL[k];
      c.fill(p);
    });
    c.fillStyle = COLORS.rock;
    c.fill(rock);
  }

  draw(cam: Camera, sim: Simulation, anims: BirthAnims, now: number) {
    const t0 = performance.now();
    this.drawLayer(cam, sim);
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layer, 0, 0);
    const g = this.geometry(cam, sim);
    const w = sim.world;
    const shades = PLAYER_SHADES.map(() => new Path2D());
    const maturation = Math.max(1, sim.player.traits.maturation);
    let drawn = 0;
    for (let y = g.y0; y <= g.y1; y++) {
      const top = Math.round(g.oy + y * g.pitch + g.gap / 2);
      const bottom = Math.round(g.oy + (y + 1) * g.pitch - g.gap / 2);
      const row = y * w.width;
      for (let x = g.x0; x <= g.x1; x++) {
        const i = row + x;
        const o = w.owner[i];
        if (o === EMPTY || o === ROCK) continue;
        if (anims.hides(i, now)) continue;
        const left = Math.round(g.ox + x * g.pitch + g.gap / 2);
        const right = Math.round(g.ox + (x + 1) * g.pitch - g.gap / 2);
        const age = sim.tick - w.bornAt[i];
        const shade = age >= maturation ? AGE_SHADES - 1 : Math.min(AGE_SHADES - 2, Math.floor((age / maturation) * (AGE_SHADES - 1)));
        this.addBlock(shades[shade], left, top, right, bottom, g.radius);
        drawn++;
      }
    }
    shades.forEach((p, k) => {
      ctx.fillStyle = PLAYER_SHADES[k];
      ctx.fill(p);
    });

    // Births in progress: grow from the soil tile with a small elastic settle.
    ctx.fillStyle = PLAYER_SHADES[0];
    anims.forEachActive(now, (cell, scale) => {
      const x = cell % w.width;
      const y = (cell / w.width) | 0;
      if (x < g.x0 || x > g.x1 || y < g.y0 || y > g.y1) return;
      const full = g.pitch - g.gap;
      const s = full * scale;
      const cx = g.ox + (x + 0.5) * g.pitch;
      const cy = g.oy + (y + 0.5) * g.pitch;
      ctx.beginPath();
      if (g.radius > 0) ctx.roundRect(cx - s / 2, cy - s / 2, s, s, g.radius * scale);
      else ctx.rect(cx - s / 2, cy - s / 2, s, s);
      ctx.fill();
      drawn++;
    });

    this.info = { drawMs: performance.now() - t0, cellsDrawn: drawn };
  }

  /** Screen position (CSS px) of a world cell centre — for UI anchoring. */
  cellToScreen(cam: Camera, x: number, y: number): { x: number; y: number } {
    const pitch = cam.pitch(this.play);
    return { x: this.play.x + this.play.w / 2 + (x + 0.5 - cam.cx) * pitch, y: this.play.y + this.play.h / 2 + (y + 0.5 - cam.cy) * pitch };
  }

  get size() {
    return { w: this.cssW, h: this.cssH };
  }
}
