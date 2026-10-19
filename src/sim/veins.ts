// Veins: a supply network from a faction's capital to its busiest fronts.
//
// Territory is viewed as a coarse grid of 4×4 blocks (larger for huge territories). A block is passable if the faction holds
// most of it. A breadth-first search from the capital's block finds a route to each chosen front,
// and the union of those routes forms a tree: thick trunks near home, thin branches at the edges.
// Cells in a vein block fight harder. When the territory is cut, the next re-route goes around
// the break, or a front loses its vein if nothing connects it any more. Because routing is per
// block, a cut has to be roughly a block thick to sever a vein; thinner slivers are bridged.

import { SPECIAL } from '../config/balance';
import type { Faction } from './faction';
import { cellKey, DX, DY, keyX, keyY, NEUTRAL, type Grid } from './grid';
import { hash2 } from './rng';

/** One route from home to a front, smoothed for drawing. */
export interface VeinRoute {
  /** Points in cell coordinates, home first: x0, y0, x1, y1, … */
  pts: number[];
  /** How many routes share the trunk at each point (thicker where higher). */
  flow: number[];
}

export interface VeinNet {
  /** Block key → how many routes pass through it (trunks carry more). */
  blocks: Map<number, number>;
  routes: VeinRoute[];
  /** Block width in cells this network was routed on (larger for huge territories). */
  size: number;
}

/** Chaikin corner-cutting: turns a stepped route into a smooth curve. */
function smooth(pts: number[], flow: number[], rounds: number): { pts: number[]; flow: number[] } {
  for (let r = 0; r < rounds; r++) {
    if (pts.length < 6) break;
    const np = [pts[0], pts[1]];
    const nf = [flow[0]];
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const [ax, ay, bx, by] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
      const fa = flow[i / 2];
      const fb = flow[i / 2 + 1];
      np.push(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by, 0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by);
      nf.push(0.75 * fa + 0.25 * fb, 0.25 * fa + 0.75 * fb);
    }
    np.push(pts[pts.length - 2], pts[pts.length - 1]);
    nf.push(flow[flow.length - 1]);
    pts = np;
    flow = nf;
  }
  return { pts, flow };
}

const BASE = SPECIAL.veinBlock;

/** Keep a faction's per-block tallies current; called by World.transfer on every change. */
export function adjustBlock(f: Faction, x: number, y: number, delta: 1 | -1) {
  const k = cellKey(Math.floor(x / BASE), Math.floor(y / BASE));
  const s = f.blockStats.get(k);
  if (!s) {
    if (delta > 0) f.blockStats.set(k, [1, x, y]);
    return;
  }
  s[0] += delta;
  s[1] += delta * x;
  s[2] += delta * y;
  if (s[0] <= 0) f.blockStats.delete(k);
}

/** Is (x, y) on one of `f`'s veins? */
export function onVein(f: Faction, x: number, y: number): boolean {
  const net = f.veins;
  return !!net && net.blocks.has(cellKey(Math.floor(x / net.size), Math.floor(y / net.size)));
}

export function computeVeins(grid: Grid, f: Faction): VeinNet {
  // 1. How much of each block the faction holds, from its running tallies. Huge territories are
  //    routed on doubled blocks (8×8, 16×16, …) so the search stays a few thousand steps.
  let scale = 1;
  while (f.blockStats.size / (scale * scale) > SPECIAL.veinMaxBlocks) scale *= 2;
  const B = BASE * scale;
  const blockOf = (v: number) => Math.floor(v / B);
  const net: VeinNet = { blocks: new Map(), routes: [], size: B };
  if (f.cells === 0) return net;
  const counts = new Map<number, number>();
  // Sum of the faction's own cell positions per block, so drawn routes stay on its territory.
  const sums = new Map<number, [number, number]>();
  for (const [k, [n, sx, sy]] of f.blockStats) {
    const key = scale === 1 ? k : cellKey(Math.floor(keyX(k) / scale), Math.floor(keyY(k) / scale));
    counts.set(key, (counts.get(key) ?? 0) + n);
    const sum = sums.get(key);
    if (sum) {
      sum[0] += sx;
      sum[1] += sy;
    } else sums.set(key, [sx, sy]);
  }
  const passable = (k: number) => (counts.get(k) ?? 0) >= SPECIAL.veinBlockMin * scale * scale;

  // 2. Root: the capital's block if still held, else the held block nearest the centre.
  let root = cellKey(blockOf(f.homeX), blockOf(f.homeY));
  if (!passable(root)) {
    const cx = f.sumX / f.cells / B;
    const cy = f.sumY / f.cells / B;
    let best = Infinity;
    root = -1;
    for (const [k] of counts) {
      if (!passable(k)) continue;
      const d = (keyX(k) - cx) ** 2 + (keyY(k) - cy) ** 2;
      if (d < best) {
        best = d;
        root = k;
      }
    }
    if (root < 0) return net;
  }

  // 3. Cheapest routes from the root (Dijkstra, 8 directions). Fully held blocks are cheaper
  //    than thinly held ones, so veins keep to the interior; a fixed per-faction irregularity
  //    makes them meander like veins instead of running in ruler-straight lines.
  const full = B * B;
  const stepCost = (k: number, diag: boolean) => {
    const held = Math.min(1, (counts.get(k) ?? 0) / full);
    const wobble = 0.75 + 0.5 * hash2(keyX(k), keyY(k), f.id * 7919);
    return (diag ? Math.SQRT2 : 1) * (1 + 2 * (1 - held)) * wobble;
  };
  const parent = new Map<number, number>([[root, root]]);
  const cost = new Map<number, number>([[root, 0]]);
  const heap: [number, number][] = [[0, root]];
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [c, k] = pop();
    if (c > (cost.get(k) ?? Infinity)) continue;
    // Thinly held blocks can be reached (as endpoints) but routes don't pass through them.
    if (k !== root && !passable(k)) continue;
    const bx = keyX(k);
    const by = keyY(k);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const n = cellKey(bx + dx, by + dy);
        if (!counts.has(n)) continue;
        const nc = c + stepCost(n, dx !== 0 && dy !== 0);
        if (nc >= (cost.get(n) ?? Infinity)) continue;
        cost.set(n, nc);
        parent.set(n, k);
        push([nc, n]);
      }
    }
  }

  // 4. Fronts: blocks holding border cells that touch an enemy; if none, the outermost tips.
  const fronts = new Set<number>();
  const border = f.frontier.values();
  // Large borders are sampled evenly rather than read in full.
  const stride = Math.max(1, Math.floor(border.length / SPECIAL.veinFrontSample));
  for (let bi = 0; bi < border.length; bi += stride) {
    const key = border[bi];
    const x = keyX(key);
    const y = keyY(key);
    for (let d = 0; d < 4; d++) {
      const o = grid.owner(x + DX[d], y + DY[d]);
      if (o !== NEUTRAL && o !== f.id) {
        fronts.add(cellKey(blockOf(x), blockOf(y)));
        break;
      }
    }
  }
  if (fronts.size === 0) for (let bi = 0; bi < border.length; bi += stride) fronts.add(cellKey(blockOf(keyX(border[bi])), blockOf(keyY(border[bi]))));
  const reachable = [...fronts].filter((k) => parent.has(k) && k !== root);
  // Spread the chosen fronts out: repeatedly take the one farthest from everything chosen.
  const chosen: number[] = [];
  const dist = (a: number, b: number) => (keyX(a) - keyX(b)) ** 2 + (keyY(a) - keyY(b)) ** 2;
  while (chosen.length < SPECIAL.veinTargets && chosen.length < reachable.length) {
    let best = -1;
    let bestD = -1;
    for (const k of reachable) {
      let d = dist(k, root) * 0.25;
      for (const c of chosen) d = Math.min(d, dist(k, c));
      if (d > bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best < 0 || bestD <= 0) break;
    chosen.push(best);
  }

  // 5. Routes back to the root; flow counts how many fronts each block feeds.
  net.blocks.set(root, chosen.length);
  const paths: number[][] = [];
  for (const t of chosen) {
    const path = [t];
    let k = t;
    while (k !== root) {
      k = parent.get(k)!;
      path.push(k);
    }
    path.reverse();
    for (let i = 1; i < path.length; i++) net.blocks.set(path[i], (net.blocks.get(path[i]) ?? 0) + 1);
    paths.push(path);
  }
  // The middle of the faction's own cells in the block (not the block's centre), so a vein never
  // pokes into enemy or open ground at a ragged border.
  const centre = (k: number) => {
    const n = counts.get(k) ?? 0;
    const sum = sums.get(k);
    return n && sum ? [sum[0] / n + 0.5, sum[1] / n + 0.5] : [keyX(k) * B + B / 2, keyY(k) * B + B / 2];
  };
  for (const path of paths) {
    const pts: number[] = [];
    const flow: number[] = [];
    for (const k of path) {
      pts.push(...centre(k));
      flow.push(net.blocks.get(k) ?? 1);
    }
    net.routes.push(smooth(pts, flow, 3));
  }
  return net;
}
