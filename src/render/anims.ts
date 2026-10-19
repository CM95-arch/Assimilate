// Visual birth timing. The simulation creates cells on whole ticks; here each birth gets a
// small random delay inside the tick so growth reads as continuous rather than in pulses.

import { ANIM } from '../config/balance';

/** easeOutBack: overshoots slightly past 1, then settles — the "tiny elastic bounce". */
function easeOutBack(t: number, c1: number): number {
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

export class BirthAnims {
  /** Visual start time per cell (ms, performance clock). 0 = not animating. */
  private readonly start: Float64Array;
  private list: number[] = [];
  durationMs: number = ANIM.birthMs;
  bounce = true;

  constructor(size: number) {
    this.start = new Float64Array(size);
  }

  add(cell: number, startMs: number) {
    if (this.start[cell] === 0) this.list.push(cell);
    this.start[cell] = startMs;
  }

  /** True while the cell should not be drawn by the static pass (not yet born, or growing). */
  hides(cell: number, now: number): boolean {
    const s = this.start[cell];
    return s !== 0 && now < s + this.durationMs;
  }

  forEachActive(now: number, fn: (cell: number, scale: number) => void) {
    let write = 0;
    const d = this.durationMs;
    for (let k = 0; k < this.list.length; k++) {
      const cell = this.list[k];
      const s = this.start[cell];
      const t = (now - s) / d;
      if (t >= 1) {
        this.start[cell] = 0;
        continue;
      }
      this.list[write++] = cell;
      if (t < 0) continue;
      const e = this.bounce ? easeOutBack(t, ANIM.birthOvershoot) : t;
      fn(cell, ANIM.birthStartScale + (1 - ANIM.birthStartScale) * e);
    }
    this.list.length = write;
  }

  get count(): number {
    return this.list.length;
  }

  clear() {
    for (const c of this.list) this.start[c] = 0;
    this.list = [];
  }
}
