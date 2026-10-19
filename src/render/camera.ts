// Camera: follows your territory, widens smoothly at scale milestones, and can be panned and
// zoomed by hand. Zoom only changes how big cells look, never what the simulation contains.

import { CAMERA } from '../config/balance';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class Camera {
  /** Centre of view in cell units (cell x spans x..x+1). */
  cx = 0.5;
  cy = 0.5;
  /** Automatic scale level and its animated cell count across the narrow side. */
  level = 0;
  private autoCells: number = CAMERA.viewCells[0];
  private from = CAMERA.viewCells[0];
  private to = CAMERA.viewCells[0];
  private t = 1;
  private duration = CAMERA.zoomSeconds;
  /** Manual zoom factor (>1 = closer). */
  manual = 1;
  /** When false the player has panned away; the camera stops following until re-centred. */
  follow = true;

  get cells(): number {
    return this.autoCells / this.manual;
  }

  get zooming(): boolean {
    return this.t < 1;
  }

  /** True when the view is not the automatic one (show a re-centre button). */
  get adjusted(): boolean {
    return !this.follow || Math.abs(this.manual - 1) > 0.02;
  }

  snap(level: number, cx: number, cy: number) {
    this.level = Math.max(0, Math.min(CAMERA.viewCells.length - 1, level));
    this.autoCells = this.from = this.to = CAMERA.viewCells[this.level];
    this.t = 1;
    this.cx = cx;
    this.cy = cy;
  }

  /** Smoothly change the automatic scale level. */
  zoomTo(level: number, seconds: number = CAMERA.zoomSeconds) {
    this.level = Math.max(0, Math.min(CAMERA.viewCells.length - 1, level));
    this.from = this.autoCells;
    this.to = CAMERA.viewCells[this.level];
    this.duration = Math.max(0.01, seconds);
    this.t = 0;
  }

  /** Advance animations and, when following, drift toward (tx, ty). */
  update(dt: number, tx: number, ty: number) {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.duration);
      const k = easeInOut(this.t);
      this.autoCells = Math.exp(Math.log(this.from) + (Math.log(this.to) - Math.log(this.from)) * k);
    }
    if (this.follow) {
      const a = 1 - Math.exp(-dt * CAMERA.followRate);
      this.cx += (tx - this.cx) * a;
      this.cy += (ty - this.cy) * a;
    }
  }

  panBy(dxCells: number, dyCells: number) {
    this.follow = false;
    this.cx += dxCells;
    this.cy += dyCells;
  }

  /** Zoom by `factor` keeping the world point (wx, wy) under the same screen position. */
  zoomAround(factor: number, wx: number, wy: number) {
    const next = Math.min(CAMERA.manualMax, Math.max(CAMERA.manualMin, this.manual * factor));
    // While following, zoom about the centre so the follow target stays put.
    if (!this.follow) {
      const k = this.manual / next;
      this.cx = wx + (this.cx - wx) * k;
      this.cy = wy + (this.cy - wy) * k;
    }
    this.manual = next;
  }

  recenter() {
    this.follow = true;
    this.manual = 1;
  }

  /**
   * CSS pixels per cell. `ref` is a stable reference length (the battlefield's narrow side with
   * no panel open), so opening a panel shortens the view instead of zooming it.
   */
  pitch(ref: number): number {
    return ref / this.cells;
  }
}
