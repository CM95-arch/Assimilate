// The grid itself: flat typed arrays (one entry per cell) so large worlds stay fast.
// No rendering or UI here — this module is shared by live play, tests and scripts.

export const EMPTY = 0;
export const ROCK = 255;
export const PLAYER = 1;

/**
 * Direction codes 0..3 = up, right, down, left (the four cardinal neighbours);
 * 4..7 = the diagonals, used only by colonies with diagonal growth. 8 = none (founding cell).
 */
export const DX = [0, 1, 0, -1, 1, 1, -1, -1] as const;
export const DY = [-1, 0, 1, 0, -1, 1, 1, -1] as const;
export const NO_DIR = 8;

export class World {
  readonly width: number;
  readonly height: number;
  readonly size: number;
  /** 0 empty, 1..254 colony id, 255 rock. */
  readonly owner: Uint8Array;
  /** Direction the cell was born in (its parent → it), for persistence. */
  readonly dir: Uint8Array;
  /** Soil fertility 0..1. Static for a world. */
  readonly fertility: Float32Array;
  /** Tick the cell was born. */
  readonly bornAt: Uint32Array;
  /** Tick of the cell's next decision. */
  readonly nextAct: Uint32Array;

  /**
   * Active cells: living cells that may still have an empty neighbour. Interior cells drop
   * out, so cost scales with the colony's edge, not its area (§21.4 frontier updates).
   */
  readonly active: Int32Array;
  activeCount = 0;
  /** Position of each cell inside `active`, or -1. */
  readonly activePos: Int32Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.owner = new Uint8Array(this.size);
    this.dir = new Uint8Array(this.size);
    this.fertility = new Float32Array(this.size);
    this.bornAt = new Uint32Array(this.size);
    this.nextAct = new Uint32Array(this.size);
    this.active = new Int32Array(this.size);
    this.activePos = new Int32Array(this.size).fill(-1);
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  /** Neighbour index in direction d, or -1 off the edge. */
  neighbor(i: number, d: number): number {
    const x = (i % this.width) + DX[d];
    const y = ((i / this.width) | 0) + DY[d];
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1;
    return y * this.width + x;
  }

  /** Cells of `colony` among the 8 surrounding cells of i (used as local density). */
  crowding(i: number, colony: number): number {
    const w = this.width;
    const x = i % w;
    const y = (i / w) | 0;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= this.height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        if (this.owner[yy * w + xx] === colony) n++;
      }
    }
    return n;
  }

  activate(i: number) {
    if (this.activePos[i] !== -1) return;
    this.activePos[i] = this.activeCount;
    this.active[this.activeCount++] = i;
  }

  deactivate(i: number) {
    const p = this.activePos[i];
    if (p === -1) return;
    const last = this.active[--this.activeCount];
    this.active[p] = last;
    this.activePos[last] = p;
    this.activePos[i] = -1;
  }

  /** Any empty cell among the 4 (or 8, with diagonals) neighbours. */
  hasEmptyNeighbor(i: number, diagonals = false): boolean {
    const n8 = diagonals ? 8 : 4;
    for (let d = 0; d < n8; d++) {
      const n = this.neighbor(i, d);
      if (n !== -1 && this.owner[n] === EMPTY) return true;
    }
    return false;
  }
}
