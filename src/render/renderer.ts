// Canvas drawing for the infinite grid. Everything is procedural: flat rounded blocks.
// Only chunks that hold territory are visited; open ground is drawn cheaply in bulk.

import { ANIM, COLORS, GRID } from '../config/balance';
import { cellKey, NEUTRAL, type Chunk } from '../sim/grid';
import { WATER, type Landmark } from '../sim/terrain';
import type { World } from '../sim/world';
import type { Anims } from './anims';
import type { Camera, Rect } from './camera';

const hasRoundRect =
  typeof Path2D !== 'undefined' && 'roundRect' in Path2D.prototype &&
  typeof CanvasRenderingContext2D !== 'undefined' && 'roundRect' in CanvasRenderingContext2D.prototype;

/** Colour of an empty cell: open ground, or water (drawn as the white background). */
export function groundColor(type: number): string {
  return type === WATER ? COLORS.background : COLORS.neutral;
}

/** Terrain is cached as images of this many cells square (one pixel per cell, or per 4 far out). */
const TERRAIN_TILE = 128;

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
  /** Terrain images by "lod:tx:ty"; built a few per frame so a big zoom-out never stalls. */
  private terrainTiles = new Map<string, HTMLCanvasElement>();
  private terrainPending = false;
  private readonly landmarkList: Landmark[] = [];
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
   * Open ground: terrain blitted from cached images (opaque, so no separate fill is needed), then
   * the gaps between cells cut on top: at rest by a repeating tile that is background colour
   * except for a rounded hole (pitch is snapped to whole pixels at rest), mid-zoom by thin lines.
   * Drawing thousands of separate rounded shapes every frame was the main cause of lag once the
   * view zoomed out.
   */
  private drawGround(world: World, g: Geometry, budgetEnd: number) {
    this.paintGround(this.ctx, world, g, this.canvas.width, this.canvas.height, budgetEnd);
  }

  /** Paint terrain and gaps into `t`. Returns false if some terrain images aren't built yet. */
  private paintGround(t: CanvasRenderingContext2D, world: World, g: Geometry, W: number, H: number, budgetEnd: number): boolean {
    const showPlain = g.pitch / this.dpr >= ANIM.neutralHidePx;
    let complete = true;
    if (world.terrain.enabled) complete = this.drawTerrain(t, world, g, W, H, budgetEnd, showPlain);
    else {
      t.fillStyle = showPlain ? COLORS.neutral : COLORS.neutralFar;
      t.fillRect(0, 0, W, H);
    }
    if (!showPlain || g.gap <= 0) return complete;
    if (!Number.isInteger(g.pitch)) {
      t.fillStyle = COLORS.background;
      const gw = Math.max(1, Math.round(g.gap));
      for (let x = g.x0; x <= g.x1 + 1; x++) t.fillRect(Math.round(g.ox + x * g.pitch - g.gap / 2), 0, gw, H);
      for (let y = g.y0; y <= g.y1 + 1; y++) t.fillRect(0, Math.round(g.oy + y * g.pitch - g.gap / 2), W, gw);
      return complete;
    }
    const size = g.pitch;
    const key = `${size}|${g.gap}|${g.radius > 0}`;
    if (key !== this.tileKey || !this.pattern) {
      this.tileKey = key;
      this.tile.width = this.tile.height = size;
      const c = this.tile.getContext('2d')!;
      c.clearRect(0, 0, size, size);
      c.fillStyle = COLORS.background;
      c.fillRect(0, 0, size, size);
      c.globalCompositeOperation = 'destination-out';
      const gap = g.gap;
      c.beginPath();
      if (g.radius > 0) c.roundRect(gap / 2, gap / 2, size - gap, size - gap, g.radius);
      else c.rect(gap / 2, gap / 2, size - gap, size - gap);
      c.fill();
      c.globalCompositeOperation = 'source-over';
      this.pattern = t.createPattern(this.tile, 'repeat');
    }
    if (!this.pattern) return complete;
    this.pattern.setTransform(new DOMMatrix([1, 0, 0, 1, g.ox, g.oy]));
    t.fillStyle = this.pattern;
    t.fillRect(0, 0, W, H);
    return complete;
  }

  /**
   * Blit the terrain images covering the view, building missing ones until the time budget runs
   * out (the rest follow on the next frames). Returns false if any were missing.
   */
  private drawTerrain(t: CanvasRenderingContext2D, world: World, g: Geometry, W: number, H: number, budgetEnd: number, showPlain: boolean): boolean {
    // Far out, one pixel stands for 4×4 cells (sampled), so the number of images stays small.
    const step = g.pitch < 0.5 ? 4 : 1;
    const span = TERRAIN_TILE * step;
    const tiles: [HTMLCanvasElement, number, number][] = [];
    let complete = true;
    for (let ty = Math.floor(g.y0 / span); ty <= Math.floor(g.y1 / span); ty++) {
      for (let tx = Math.floor(g.x0 / span); tx <= Math.floor(g.x1 / span); tx++) {
        const k = `${step}:${showPlain}:${tx}:${ty}`;
        let img = this.terrainTiles.get(k);
        if (!img) {
          if (performance.now() > budgetEnd) {
            complete = false;
            this.terrainPending = true;
            continue;
          }
          img = this.buildTerrainTile(world, tx * span, ty * span, step, showPlain);
          if (this.terrainTiles.size > 400) this.terrainTiles.delete(this.terrainTiles.keys().next().value!);
          this.terrainTiles.set(k, img);
        }
        tiles.push([img, tx, ty]);
      }
    }
    // Tiles are opaque, so the plain fill is only needed under ones still being built.
    if (!complete) {
      t.fillStyle = showPlain ? COLORS.neutral : COLORS.neutralFar;
      t.fillRect(0, 0, W, H);
    }
    t.imageSmoothingEnabled = false;
    for (const [img, tx, ty] of tiles) {
      const x0 = Math.round(g.ox + tx * span * g.pitch);
      const y0 = Math.round(g.oy + ty * span * g.pitch);
      const x1 = Math.round(g.ox + (tx + 1) * span * g.pitch);
      const y1 = Math.round(g.oy + (ty + 1) * span * g.pitch);
      t.drawImage(img, x0, y0, x1 - x0, y1 - y0);
    }
    t.imageSmoothingEnabled = true;
    return complete;
  }

  /** One terrain image: a pixel per cell (or per `step` cells), plain ground in its own colour. */
  private buildTerrainTile(world: World, x0: number, y0: number, step: number, showPlain: boolean): HTMLCanvasElement {
    const N = TERRAIN_TILE;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = N;
    const cx = canvas.getContext('2d')!;
    const data = cx.createImageData(N, N);
    const px = new Uint32Array(data.data.buffer);
    const colors = [this.packHex(showPlain ? COLORS.neutral : COLORS.neutralFar), this.packHex(COLORS.background)];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) px[j * N + i] = colors[world.terrain.sample(x0 + i * step, y0 + j * step)];
    cx.putImageData(data, 0, 0);
    return canvas;
  }

  private packHex(hex: string): number {
    const r = parseInt(hex.slice(1, 3), 16);
    const gr = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return ((255 << 24) | (b << 16) | (gr << 8) | r) >>> 0;
  }

  /** Packed RGBA (little-endian ABGR) for a faction id, for chunk images. */
  private rgba(world: World, id: number): number {
    let v = this.colorCache.get(id);
    if (v === undefined) {
      v = this.packHex(world.factions.get(id)?.color ?? COLORS.player);
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
      this.terrainTiles.clear();
    }
    const sig = `${world.tick}|${world.flagVersion}|${g.pitch}|${g.ox}|${g.oy}|${this.canvas.width}x${this.canvas.height}|${this.play.y}|${this.play.h}`;
    if (sig === this.lastSig && anims.count === 0 && !this.terrainPending) return;
    this.terrainPending = false;
    this.lastSig = sig;
    this.frames++;

    const t0 = performance.now();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawGround(world, g, t0 + 6);
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
        if (bitmap) fill(groundColor(world.terrain.at(a.x, a.y)), 1);
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
    this.drawLandmarks(world, g);
    this.drawFlags(world, g);
    this.lastDrawn = drawn;
    this.info = { drawMs: performance.now() - t0, cellsDrawn: drawn };
  }

  /**
   * Landmarks: a gold symbol (its shape says which kind) with a soft halo, kept a readable size
   * however far out the view is. On held ground the symbol is cut out of the owner's colour.
   */
  private drawLandmarks(world: World, g: Geometry) {
    if (!world.terrain.enabled) return;
    const list = world.terrain.landmarksIn(g.x0 - 1, g.y0 - 1, g.x1 + 1, g.y1 + 1, this.landmarkList);
    if (!list.length || list.length > 3000) return;
    const ctx = this.ctx;
    const d = this.dpr;
    const r = Math.max(g.pitch * 0.34, 2.6 * d);
    const halo = new Path2D();
    const gold = new Path2D();
    const cut = new Path2D();
    for (const l of list) {
      const cx = g.ox + (l.x + 0.5) * g.pitch;
      const cy = g.oy + (l.y + 0.5) * g.pitch;
      halo.moveTo(cx + r * 2.4, cy);
      halo.arc(cx, cy, r * 2.4, 0, Math.PI * 2);
      const owned = world.grid.owner(l.x, l.y) !== NEUTRAL;
      this.glyph(owned ? cut : gold, l.type, cx, cy, r);
      // Held: a gold ring around the cut-out symbol, so it still reads as a landmark.
      if (owned) {
        gold.moveTo(cx + r * 1.55, cy);
        gold.arc(cx, cy, r * 1.55, 0, Math.PI * 2);
        gold.moveTo(cx + r * 1.2, cy);
        gold.arc(cx, cy, r * 1.2, 0, Math.PI * 2, true);
      }
    }
    ctx.fillStyle = COLORS.landmark;
    ctx.globalAlpha = 0.16;
    ctx.fill(halo);
    ctx.globalAlpha = 1;
    ctx.fill(gold, 'nonzero');
    ctx.fillStyle = COLORS.background;
    ctx.fill(cut);
  }

  /** Landmark symbols: Spring ●, Watchtower ▲, War Camp ◆, Crossroads ✚, Forge ■. */
  private glyph(p: Path2D, type: number, cx: number, cy: number, r: number) {
    switch (type) {
      case 0:
        p.moveTo(cx + r, cy);
        p.arc(cx, cy, r, 0, Math.PI * 2);
        break;
      case 1:
        p.moveTo(cx, cy - r * 1.1);
        p.lineTo(cx + r, cy + r * 0.8);
        p.lineTo(cx - r, cy + r * 0.8);
        p.closePath();
        break;
      case 2:
        p.moveTo(cx, cy - r * 1.15);
        p.lineTo(cx + r * 1.15, cy);
        p.lineTo(cx, cy + r * 1.15);
        p.lineTo(cx - r * 1.15, cy);
        p.closePath();
        break;
      case 3: {
        const t = r * 0.38;
        p.rect(cx - r, cy - t, r * 2, t * 2);
        p.rect(cx - t, cy - r, t * 2, r * 2);
        break;
      }
      default:
        p.rect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7);
    }
  }

  /** Rally flags: a pennant on a pole at the flag's cell. Yours is black; rivals' are smaller. */
  private drawFlags(world: World, g: Geometry) {
    const ctx = this.ctx;
    const d = this.dpr;
    for (const f of world.factions.values()) {
      if (!f.alive || !f.flag) continue;
      const { x, y } = f.flag;
      if (x < g.x0 - 2 || x > g.x1 + 2 || y < g.y0 - 2 || y > g.y1 + 2) continue;
      const k = f.isPlayer ? 1 : 0.7;
      const h = Math.max(g.pitch * 1.5, 18 * d) * k;
      const bx = g.ox + (x + 0.5) * g.pitch;
      const by = g.oy + (y + 0.5) * g.pitch;
      const pole = Math.max(1.5 * d, h * 0.08);
      // A white outline keeps the flag readable over your own black territory.
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3 * d;
      ctx.strokeStyle = COLORS.background;
      const path = new Path2D();
      path.rect(bx - pole / 2, by - h, pole, h);
      path.moveTo(bx + pole / 2, by - h);
      path.lineTo(bx + pole / 2 + h * 0.62, by - h * 0.78);
      path.lineTo(bx + pole / 2, by - h * 0.56);
      path.closePath();
      ctx.stroke(path);
      ctx.fillStyle = f.color;
      ctx.fill(path);
      // A small base dot marks the exact cell.
      ctx.beginPath();
      ctx.arc(bx, by, Math.max(2 * d, h * 0.1), 0, Math.PI * 2);
      ctx.fill();
    }
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
