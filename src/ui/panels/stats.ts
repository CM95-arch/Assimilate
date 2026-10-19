import { fmt, fmtDuration } from '../../util/format';
import type { Panel, UiContext } from '../context';
import { h, setText } from '../dom';

function sections(ctx: UiContext): [string, [string, string, string][]][] {
  const { world, stats, camera } = ctx.game;
  const p = world.player;
  const rivals = [...world.factions.values()].filter((f) => !f.isPlayer);
  return [
    [
      'This run',
      [
        ['cells', 'Territory', `${fmt(p.cells)} cells`],
        ['peak', 'Largest territory', `${fmt(p.peakCells)} cells`],
        ['claimed', 'Open cells claimed', fmt(p.claimed)],
        ['converted', 'Enemy cells converted', fmt(p.converted)],
        ['lost', 'Cells lost', fmt(p.lost)],
        ['earned', 'Energy earned', fmt(p.earned)],
        ['rivals', 'Rivals met · eliminated', `${rivals.length} · ${rivals.filter((f) => !f.alive).length}`],
        ['scale', 'Scale', String(camera.level + 1)],
        ['age', 'Run time', fmtDuration(world.time)],
      ],
    ],
    [
      'Lifetime',
      [
        ['best', 'Largest territory ever', `${fmt(stats.bestTerritory)} cells`],
        ['l-claimed', 'Open cells claimed', fmt(stats.cellsClaimed)],
        ['l-converted', 'Enemy cells converted', fmt(stats.cellsConverted)],
        ['l-lost', 'Cells lost', fmt(stats.cellsLost)],
        ['l-elim', 'Rivals you eliminated', fmt(stats.rivalsEliminated)],
        ['l-energy', 'Energy earned', fmt(stats.energyEarned)],
        ['l-scale', 'Highest scale', String(stats.highestScale)],
        ['runs', 'Runs started', fmt(stats.runsStarted)],
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
