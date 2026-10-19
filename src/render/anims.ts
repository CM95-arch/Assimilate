// Short visual effects keyed by cell: captures pop in over the old colour, failed attacks make
// the defending cell flinch. Visual only; the simulation has already decided the outcome.

import { ANIM } from '../config/balance';
import { cellKey } from '../sim/grid';

export interface Anim {
  x: number;
  y: number;
  kind: 'capture' | 'hit';
  start: number;
  fromColor: string;
  toColor: string;
}

const easeOutBack = (t: number, c1: number) => 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2;

/** An expanding square outline, e.g. where an outpost lands. */
export interface Ring {
  x: number;
  y: number;
  start: number;
  color: string;
}

export class Anims {
  private map = new Map<number, Anim>();
  private rings: Ring[] = [];
  reduced = false;
  /** Cap so a huge battle can never flood the frame. */
  max = 600;
  /** Off when cells are too small on screen for the effect to be visible. */
  enabled = true;

  add(a: Anim) {
    if (!this.enabled || this.map.size >= this.max) return;
    const k = cellKey(a.x, a.y);
    const old = this.map.get(k);
    // A capture always replaces a flinch; a flinch never interrupts a capture.
    if (old && old.kind === 'capture' && a.kind === 'hit') return;
    this.map.set(k, a);
  }

  addRing(r: Ring) {
    if (this.enabled && this.rings.length < 40) this.rings.push(r);
  }

  /** Rings as (cell, progress 0..1); finished ones are dropped. */
  forEachRing(now: number, fn: (r: Ring, t: number) => void) {
    const d = ANIM.ringMs * (this.reduced ? 0.6 : 1);
    this.rings = this.rings.filter((r) => now < r.start + d);
    for (const r of this.rings) {
      const t = (now - r.start) / d;
      if (t >= 0) fn(r, t);
    }
  }

  private duration(a: Anim) {
    const d = a.kind === 'capture' ? ANIM.captureMs : ANIM.hitMs;
    return this.reduced ? d * 0.5 : d;
  }

  /** True while the static pass must skip this cell (the effect draws it instead). */
  hides(x: number, y: number, now: number): boolean {
    if (this.map.size === 0) return false;
    const a = this.map.get(cellKey(x, y));
    return !!a && now < a.start + this.duration(a);
  }

  forEachActive(now: number, fn: (a: Anim, scale: number) => void) {
    for (const [k, a] of this.map) {
      const t = (now - a.start) / this.duration(a);
      if (t >= 1) {
        this.map.delete(k);
        continue;
      }
      if (t < 0) {
        fn(a, a.kind === 'capture' ? 0 : 1);
        continue;
      }
      if (a.kind === 'capture') {
        const e = this.reduced ? t : easeOutBack(t, ANIM.overshoot);
        fn(a, ANIM.captureStartScale + (1 - ANIM.captureStartScale) * e);
      } else {
        // Dip then return: 1 → hitScale → 1.
        fn(a, 1 - (1 - ANIM.hitScale) * Math.sin(Math.PI * t));
      }
    }
  }

  get count() {
    return this.map.size + this.rings.length;
  }

  clear() {
    this.map.clear();
    this.rings = [];
  }
}
