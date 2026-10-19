// Camera: which part of the world is on screen. Scale changes animate smoothly (§16.2);
// zoom only changes how big cells look, never what the simulation contains (§16.4).

import { CAMERA } from '../config/balance';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class Camera {
  /** Centre of view, in world cell units (cell x+0.5 is the middle of column x). */
  cx = 0;
  cy = 0;
  /** Cells visible across the narrow side of the playfield. */
  cells: number = CAMERA.viewCells[0];
  level = 0;
  private from = { cx: 0, cy: 0, cells: 0 };
  private to = { cx: 0, cy: 0, cells: 0 };
  private t = 1;
  /** Bumps whenever the view changes, so cached layers know to redraw. */
  version = 0;

  get animating(): boolean {
    return this.t < 1;
  }

  snap(level: number, cx: number, cy: number) {
    this.level = Math.max(0, Math.min(CAMERA.viewCells.length - 1, level));
    this.cells = CAMERA.viewCells[this.level];
    this.cx = cx;
    this.cy = cy;
    this.t = 1;
    this.version++;
  }

  zoomTo(level: number, cx: number, cy: number, seconds: number = CAMERA.zoomSeconds) {
    this.level = Math.max(0, Math.min(CAMERA.viewCells.length - 1, level));
    this.from = { cx: this.cx, cy: this.cy, cells: this.cells };
    this.to = { cx, cy, cells: CAMERA.viewCells[this.level] };
    this.t = seconds <= 0 ? 1 : 0;
    if (this.t === 1) this.snap(this.level, cx, cy);
    this.durationS = seconds;
  }

  private durationS = CAMERA.zoomSeconds;

  update(dt: number) {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / this.durationS);
    const k = easeInOut(this.t);
    // Interpolate scale in log space so the zoom speed feels constant.
    this.cells = Math.exp(Math.log(this.from.cells) + (Math.log(this.to.cells) - Math.log(this.from.cells)) * k);
    this.cx = this.from.cx + (this.to.cx - this.from.cx) * k;
    this.cy = this.from.cy + (this.to.cy - this.from.cy) * k;
    this.version++;
  }

  /** CSS pixels per cell for a playfield. */
  pitch(play: Rect): number {
    return Math.min(play.w, play.h) / this.cells;
  }
}
