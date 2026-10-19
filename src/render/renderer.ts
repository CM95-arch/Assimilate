// Canvas drawing for the infinite grid. Everything is procedural: flat rounded blocks.
// Only chunks that hold territory are visited; open ground is drawn cheaply in bulk.

import { ANIM, COLORS, GRID } from '../config/balance';
import { cellKey, NEUTRAL } from '../sim/grid';
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
  /** Battlefield: the area between the HUD and the bottom controls (CSS px). */
  play: Rect = { x: 0, y: 0, w: 1, h: 1 };
  /** Narrow side of the battlefield with no panel open; sets the zoom (see Camera.pitch). */
  refSize = 1;
  info: FrameInfo = { drawMs: 0, cellsDrawn: 0 };

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  resize(cssW: number, cssH: number, play: Rect, refSize: number) {
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
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
    const pitchCss = cam.pitch(this.refSize);
    const pitch = pitchCss * d;
    const ox = (this.play.x + this.play.w / 2) * d - cam.cx * pitch;
    const oy = (this.play.y + this.play.h / 2) * d - cam.cy * pitch;
    const gapCss = pitchCss < ANIM.noGapBelowPx ? 0 : Math.min(ANIM.gapMaxPx, Math.max(ANIM.gapMinPx, pitchCss * ANIM.gapFraction));
    const radius = pitchCss >= ANIM.roundAbovePx && hasRoundRect ? pitch * ANIM.cornerFraction : 0;
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

  private drawNeutral(g: Geometry) {
    const ctx = this.ctx;
    const pitchCss = g.pitch / this.dpr;
    if (pitchCss < ANIM.neutralHidePx) return;
    const cols = g.x1 - g.x0 + 1;
    const rows = g.y1 - g.y0 + 1;
    ctx.fillStyle = COLORS.neutral;
    if (cols * rows <= 9000 && g.radius > 0) {
      const p = new Path2D();
      for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x1; x++) this.block(p, g, x, y);
      ctx.fill(p);
      return;
    }
    // Many small cells: one fill, then cut the gaps as background-coloured grid lines.
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (g.gap <= 0) return;
    ctx.fillStyle = COLORS.background;
    for (let x = g.x0; x <= g.x1 + 1; x++) {
      const gx = Math.round(g.ox + x * g.pitch - g.gap / 2);
      ctx.fillRect(gx, 0, Math.max(1, Math.round(g.gap)), this.canvas.height);
    }
    for (let y = g.y0; y <= g.y1 + 1; y++) {
      const gy = Math.round(g.oy + y * g.pitch - g.gap / 2);
      ctx.fillRect(0, gy, this.canvas.width, Math.max(1, Math.round(g.gap)));
    }
  }

  draw(cam: Camera, world: World, anims: Anims, now: number) {
    const t0 = performance.now();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const g = this.geometry(cam);
    this.drawNeutral(g);

    // Owned cells, batched into one path per faction. Only chunks that exist are visited.
    const CS = GRID.chunk;
    const paths = new Map<number, Path2D>();
    let drawn = 0;
    const cx0 = Math.floor(g.x0 / CS);
    const cx1 = Math.floor(g.x1 / CS);
    const cy0 = Math.floor(g.y0 / CS);
    const cy1 = Math.floor(g.y1 / CS);
    const visibleChunks = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
    const chunks = visibleChunks < world.grid.chunks.size ? null : world.grid.chunks.values();
    const visit = (c: { cx: number; cy: number; count: number; owner: Uint8Array }) => {
      if (c.count === 0 || c.cx < cx0 || c.cx > cx1 || c.cy < cy0 || c.cy > cy1) return;
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
    };
    if (chunks) for (const c of chunks) visit(c);
    else {
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const c = world.grid.chunks.get(cellKey(cx, cy));
          if (c) visit(c);
        }
      }
    }
    for (const [id, p] of paths) {
      ctx.fillStyle = world.factions.get(id)?.color ?? COLORS.player;
      ctx.fill(p);
    }

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
      } else fill(a.toColor, k);
      drawn++;
    });

    this.info = { drawMs: performance.now() - t0, cellsDrawn: drawn };
  }
}
