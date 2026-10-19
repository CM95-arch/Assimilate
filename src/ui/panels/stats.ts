import { TIME } from '../../config/balance';
import { fmt, fmtDuration, fmtPct } from '../../util/format';
import type { Panel, UiContext } from '../context';
import { h, setText } from '../dom';

function sections(ctx: UiContext): [string, [string, string, string][]][] {
  const { sim, stats, camera } = ctx.game;
  const c = sim.player;
  return [
    [
      'This world',
      [
        ['cur-pop', 'Current population', fmt(c.population)],
        ['peak-pop', 'Peak population', fmt(c.peakPopulation)],
        ['born', 'Total cells produced', fmt(c.totalBorn)],
        ['terr', 'Territory controlled', `${fmt(c.population)} cells · ${fmtPct(sim.territoryFraction())}`],
        ['scale', 'Scale reached', String(camera.level + 1)],
        ['age', 'Colony age', fmtDuration(sim.tick / TIME.ticksPerSecond)],
      ],
    ],
    [
      'Lifetime',
      [
        ['best', 'Largest colony', fmt(stats.bestPopulation)],
        ['grown', 'Cells grown', fmt(stats.cellsGrown)],
        ['worlds', 'Worlds started', fmt(stats.worldsStarted)],
        ['hscale', 'Highest scale', String(stats.highestScale)],
        ['play', 'Playtime', fmtDuration(stats.playSeconds)],
      ],
    ],
  ];
}

export const statsPanel: Panel = {
  title: 'Statistics',
  render(ctx) {
    const root = h('div', {});
    for (const [title, items] of sections(ctx)) {
      root.append(h('p', { class: 'section-title', text: title }));
      const kv = h('dl', { class: 'kv' });
      for (const [id, label, value] of items) kv.append(h('dt', { text: label }), h('dd', { 'data-k': id, text: value }));
      root.append(kv);
    }
    root.append(h('p', { class: 'note', style: 'margin-top:14px', text: 'Combat, rivals and generations will add their own statistics as they arrive.' }));
    return root;
  },
  refresh(ctx, root) {
    for (const [, items] of sections(ctx)) {
      for (const [id, , value] of items) {
        const el = root.querySelector(`[data-k="${id}"]`);
        if (el) setText(el, value);
      }
    }
  },
};
