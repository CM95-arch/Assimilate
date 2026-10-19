// Canvas drawing for the infinite grid. Everything is procedural: flat rounded blocks.
// Only chunks that hold territory are visited; open ground is drawn cheaply in bulk.

import { ANIM, COLORS, GRID } from '../config/balance';
import { cellKey, NEUTRAL, type Chunk } from '../sim/grid';
import type { World } from '../sim/world';
import type { Anims } from './anims';
import type { Camera, Rect } from './camera';

const hasRoundRect =
  typeof Path2D !== 'undefined' && 'roundRect' in Path2D.prototype &&
  typeof CanvasRenderingContext2D !== 'undefined' && 'roundRect' in CanvasRenderingContext2D.prototype;

export interface FrameInfo {
  drawMs: number;
  cellsDrawn: number;
}

export interface Geometry {
  pitch: number;
  ox: number;
  oy: number;
  gap: number;
  radius: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  /** Repeating tile for empty ground (see drawNeutral). */
  private readonly tile = document.createElement('canvas');
  private pattern: CanvasPattern | null = null;
  private tileKey = '';
  /** Owned cells drawn last frame; many cells switch to cheaper square corners. */
  private lastDrawn = 0;
  /** Cached per-chunk images for the far view (see chunkImage). */
  private chunkImages = new WeakMap<Chunk, { canvas: HTMLCanvasElement; cx: CanvasRenderingContext2D; data: ImageData; px: Uint32Array; version: number }>();
  private colorCache = new Map<number, number>();
  private lastWorld: World | null = null;
  /** What the last frame showed; an identical frame is skipped. */
  private lastSig = '';
  /** Frames actually drawn (diagnostics). */
  frames = 0;
  /** Battlefield: the area between the HUD and the bottom controls (CSS px). */
  play: Rect = { x: 0, y: 0, w: 1, h: 1 };
  /** Narrow side of the battlefield with no panel open; sets the zoom (see Camera.pitch). */
  refSize = 1;
  info: FrameInfo = { drawMs: 0, cellsDrawn: 0 };

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  resize(cssW: number, cssH: number, play: Rect, refSize: number) {
    // Above 2× the extra sharpness is invisible on squares but quadruples the pixels to fill.
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.play = play;
    this.refSize = Math.max(1, refSize);
    const w = Math.max(1, Math.round(cssW * this.dpr));
    const h = Math.max(1, Math.round(cssH * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
  }

  /** Cell → device-pixel mapping for the current camera. */
  geometry(cam: Camera): Geometry {
    const d = this.dpr;
    let pitch = cam.pitch(this.refSize) * d;
    // At rest, snap to whole device pixels: blocks line up exactly and the ground tile is a
    // plain copy instead of a resampled stretch (much cheaper on large, dense screens).
    if (!cam.zooming && pitch >= 4) pitch = Math.round(pitch);
    const pitchCss = pitch / d;
    const ox = Math.round((this.play.x + this.play.w / 2) * d - cam.cx * pitch);
    const oy = Math.round((this.play.y + this.play.h / 2) * d - cam.cy * pitch);
    const gapCss = pitchCss < ANIM.noGapBelowPx ? 0 : Math.min(ANIM.gapMaxPx, Math.max(ANIM.gapMinPx, pitchCss * ANIM.gapFraction));
    const radius = pitchCss >= ANIM.roundAbovePx && hasRoundRect && this.lastDrawn < ANIM.roundMaxCells ? pitch * ANIM.cornerFraction : 0;
    return {
      pitch, ox, oy, gap: gapCss * d, radius,
      x0: Math.floor(-ox / pitch), y0: Math.floor(-oy / pitch),
      x1: Math.ceil((this.canvas.width - ox) / pitch), y1: Math.ceil((this.canvas.height - oy) / pitch),
    };
  }

  /** Screen (CSS px) → world cell coordinates (fractional). */
  screenToCell(cam: Camera, sx: number, sy: number): { x: number; y: number } {
    const pitch = cam.pitch(this.refSize);
    return { x: cam.cx + (sx - this.play.x - this.play.w / 2) / pitch, y: cam.cy + (sy - this.play.y - this.play.h / 2) / pitch };
  }

  cellToScreen(cam: Camera, x: number, y: number): { x: number; y: number } {
    const pitch = cam.pitch(this.refSize);
    return { x: this.play.x + this.play.w / 2 + (x + 0.5 - cam.cx) * pitch, y: this.play.y + this.play.h / 2 + (y + 0.5 - cam.cy) * pitch };
  }

  private block(p: Path2D, g: Geometry, x: number, y: number) {
    const left = Math.round(g.ox + x * g.pitch + g.gap / 2);
    const top = Math.round(g.oy + y * g.pitch + g.gap / 2);
    const w = Math.max(1, Math.round(g.ox + (x + 1) * g.pitch - g.gap / 2) - left);
    const h = Math.max(1, Math.round(g.oy + (y + 1) * g.pitch - g.gap / 2) - top);
    if (g.radius > 0) p.roundRect(left, top, w, h, g.radius);
    else p.rect(left, top, w, h);
  }

  /**
   * Empty ground: one rounded block is drawn into a small tile once (pitch is snapped to whole
   * pixels at rest), then repeated across the screen with a single fill. Drawing thousands of
   * separate rounded shapes every frame was the main cause of lag once the view zoomed out.
   */
  private drawNeutral(g: Geometry): boolean {
    const ctx = this.ctx;
    if (g.pitch / this.dpr < ANIM.neutralHidePx) return false;
    if (!Number.isInteger(g.pitch)) {
      // Mid-zoom the pitch is fractional and a stretched tile is slow on dense screens: draw a
      // flat fill and cut the gaps as lines instead (square corners for the zoom's duration).
      ctx.fillStyle = COLORS.neutral;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      if (g.gap > 0) {
        ctx.fillStyle = COLORS.background;
        const gw = Math.max(1, Math.round(g.gap));
        for (let x = g.x0; x <= g.x1 + 1; x++) ctx.fillRect(Math.round(g.ox + x * g.pitch - g.gap / 2), 0, gw, this.canvas.height);
        for (let y = g.y0; y <= g.y1 + 1; y++) ctx.fillRect(0, Math.round(g.oy + y * g.pitch - g.gap / 2), this.canvas.width, gw);
      }
      return true;
    }
    const size = g.pitch;
    const key = `${size}|${g.gap > 0}|${g.radius > 0}`;
    if (key !== this.tileKey || !this.pattern) {
      this.tileKey = key;
      this.tile.width = this.tile.height = size;
      const t = this.tile.getContext('2d')!;
      t.fillStyle = COLORS.background;
      t.fillRect(0, 0, size, size);
      t.fillStyle = COLORS.neutral;
      const gap = g.gap;
      t.beginPath();
      if (g.radius > 0) t.roundRect(gap / 2, gap / 2, size - gap, size - gap, g.radius);
      else t.rect(gap / 2, gap / 2, size - gap, size - gap);
      t.fill();
      this.pattern = ctx.createPattern(this.tile, 'repeat');
    }
    if (!this.pattern) return false;
    this.pattern.setTransform(new DOMMatrix([1, 0, 0, 1, g.ox, g.oy]));
    ctx.fillStyle = this.pattern;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    return true;
  }

  /** Packed RGBA (little-endian ABGR) for a faction id, for chunk images. */
  private rgba(world: World, id: number): number {
    let v = this.colorCache.get(id);
    if (v === undefined) {
      const hex = world.factions.get(id)?.color ?? COLORS.player;
      const r = parseInt(hex.slice(1, 3), 16);
      const gr = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      v = ((255 << 24) | (b << 16) | (gr << 8) | r) >>> 0;
      this.colorCache.set(id, v);
    }
    return v;
  }

  /** A chunk's cached 32×32 image (one pixel per cell), refreshed only when the chunk changed. */
  private chunkImage(world: World, c: Chunk): HTMLCanvasElement {
    let img = this.chunkImages.get(c);
    if (!img) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = GRID.chunk;
      const cx = canvas.getContext('2d')!;
      const data = cx.createImageData(GRID.chunk, GRID.chunk);
      img = { canvas, cx, data, px: new Uint32Array(data.data.buffer), version: -1 };
      this.chunkImages.set(c, img);
    }
    if (img.version !== c.version) {
      img.version = c.version;
      for (let i = 0; i < c.owner.length; i++) {
        const o = c.owner[i];
        img.px[i] = o === NEUTRAL ? 0 : this.rgba(world, o);
      }
      img.cx.putImageData(img.data, 0, 0);
    }
    return img.canvas;
  }

  /** Visible chunks that hold territory. */
  private *visibleChunks(world: World, g: Geometry): Generator<Chunk> {
    const CS = GRID.chunk;
    const cx0 = Math.floor(g.x0 / CS);
    const cx1 = Math.floor(g.x1 / CS);
    const cy0 = Math.floor(g.y0 / CS);
    const cy1 = Math.floor(g.y1 / CS);
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) >= world.grid.chunks.size) {
      for (const c of world.grid.chunks.values()) if (c.count > 0 && c.cx >= cx0 && c.cx <= cx1 && c.cy >= cy0 && c.cy <= cy1) yield c;
      return;
    }
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = world.grid.chunks.get(cellKey(cx, cy));
        if (c && c.count > 0) yield c;
      }
    }
  }

  /**
   * Draw a frame. Skipped entirely when nothing visible has changed since the last one (same
   * tick, same view, no effects running), which keeps an idle screen cool.
   */
  draw(cam: Camera, world: World, anims: Anims, now: number) {
    const g = this.geometry(cam);
    const pitchCss = g.pitch / this.dpr;
    anims.enabled = pitchCss >= ANIM.animMinPx;
    if (!anims.enabled && anims.count) anims.clear();
    if (world !== this.lastWorld) {
      this.lastWorld = world;
      this.colorCache.clear();
      this.chunkImages = new WeakMap();
    }
    const sig = `${world.tick}|${g.pitch}|${g.ox}|${g.oy}|${this.canvas.width}x${this.canvas.height}|${this.play.y}|${this.play.h}`;
    if (sig === this.lastSig && anims.count === 0) return;
    this.lastSig = sig;
    this.frames++;

    const t0 = performance.now();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // The ground tile already contains the background, so only clear when it isn't drawn.
    if (!this.drawNeutral(g)) {
      ctx.fillStyle = COLORS.background;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    const drawn = pitchCss < ANIM.bitmapBelowPx ? this.drawTerritoryImages(world, g) : this.drawTerritoryCells(world, g, anims, now);
    const bitmap = pitchCss < ANIM.bitmapBelowPx;

    // Captures pop in over the previous colour; failed attacks make the defender flinch.
    anims.forEachActive(now, (a, k) => {
      if (a.x < g.x0 || a.x > g.x1 || a.y < g.y0 || a.y > g.y1) return;
      const full = g.pitch - g.gap;
      const cx = g.ox + (a.x + 0.5) * g.pitch;
      const cy = g.oy + (a.y + 0.5) * g.pitch;
      const fill = (color: string, scale: number) => {
        const s = full * scale;
        ctx.fillStyle = color;
        ctx.beginPath();
        if (g.radius > 0) ctx.roundRect(cx - s / 2, cy - s / 2, s, s, g.radius * scale);
        else ctx.rect(cx - s / 2, cy - s / 2, s, s);
        ctx.fill();
      };
      if (a.kind === 'capture') {
        fill(a.fromColor, 1);
        fill(a.toColor, k);
      } else {
        // The cached image already shows the full cell; clear it first so the flinch shows.
        if (bitmap) fill(COLORS.neutral, 1);
        fill(a.toColor, k);
      }
    });

    // Outposts: a square outline grows from the new cell and fades.
    anims.forEachRing(now, (r, t) => {
      const cx = g.ox + (r.x + 0.5) * g.pitch;
      const cy = g.oy + (r.y + 0.5) * g.pitch;
      const size = g.pitch * (1 + t * 3);
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = Math.max(1, g.pitch * 0.12);
      ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);
      ctx.globalAlpha = 1;
    });

    this.drawCapitals(world, g);
    this.lastDrawn = drawn;
    this.info = { drawMs: performance.now() - t0, cellsDrawn: drawn };
  }

  /** Capital: a small inset square marks the home cell of any faction that has the upgrade. */
  private drawCapitals(world: World, g: Geometry) {
    if (g.pitch / this.dpr < ANIM.noGapBelowPx) return;
    const ctx = this.ctx;
    for (const f of world.factions.values()) {
      if (!f.alive || f.stats.capital <= 0 || world.grid.owner(f.homeX, f.homeY) !== f.id) continue;
      if (f.homeX < g.x0 || f.homeX > g.x1 || f.homeY < g.y0 || f.homeY > g.y1) continue;
      const s = g.pitch * 0.34;
      const cx = g.ox + (f.homeX + 0.5) * g.pitch;
      const cy = g.oy + (f.homeY + 0.5) * g.pitch;
      ctx.fillStyle = COLORS.background;
      ctx.fillRect(Math.round(cx - s / 2), Math.round(cy - s / 2), Math.round(s), Math.round(s));
    }
  }

  /** Far view: blit each chunk's cached image (nearest-neighbour), then cut the gaps as lines. */
  private drawTerritoryImages(world: World, g: Geometry): number {
    const ctx = this.ctx;
    const CS = GRID.chunk;
    ctx.imageSmoothingEnabled = false;
    let drawn = 0;
    for (const c of this.visibleChunks(world, g)) {
      const x0 = Math.round(g.ox + c.cx * CS * g.pitch);
      const y0 = Math.round(g.oy + c.cy * CS * g.pitch);
      const x1 = Math.round(g.ox + (c.cx + 1) * CS * g.pitch);
      const y1 = Math.round(g.oy + (c.cy + 1) * CS * g.pitch);
      ctx.drawImage(this.chunkImage(world, c), x0, y0, x1 - x0, y1 - y0);
      drawn += c.count;
    }
    ctx.imageSmoothingEnabled = true;
    if (g.gap > 0) {
      ctx.fillStyle = COLORS.background;
      const gw = Math.max(1, Math.round(g.gap));
      for (let x = g.x0; x <= g.x1 + 1; x++) ctx.fillRect(Math.round(g.ox + x * g.pitch - g.gap / 2), 0, gw, this.canvas.height);
      for (let y = g.y0; y <= g.y1 + 1; y++) ctx.fillRect(0, Math.round(g.oy + y * g.pitch - g.gap / 2), this.canvas.width, gw);
    }
    return drawn;
  }

  /** Close view: few cells on screen, so each is drawn as its own (rounded) block. */
  private drawTerritoryCells(world: World, g: Geometry, anims: Anims, now: number): number {
    const CS = GRID.chunk;
    const paths = new Map<number, Path2D>();
    let drawn = 0;
    for (const c of this.visibleChunks(world, g)) {
      const bx = c.cx * CS;
      const by = c.cy * CS;
      for (let i = 0; i < CS * CS; i++) {
        const o = c.owner[i];
        if (o === NEUTRAL) continue;
        const x = bx + (i % CS);
        const y = by + ((i / CS) | 0);
        if (x < g.x0 || x > g.x1 || y < g.y0 || y > g.y1 || anims.hides(x, y, now)) continue;
        let p = paths.get(o);
        if (!p) paths.set(o, (p = new Path2D()));
        this.block(p, g, x, y);
        drawn++;
      }
    }
    for (const [id, p] of paths) {
      this.ctx.fillStyle = world.factions.get(id)?.color ?? COLORS.player;
      this.ctx.fill(p);
    }
    return drawn;
  }
}
