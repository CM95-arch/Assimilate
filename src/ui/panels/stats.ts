import { fmt, fmtDuration } from '../../util/format';
import type { Panel, UiContext } from '../context';
import { h, setText } from '../dom';

function sections(ctx: UiContext): [string, [string, string, string][]][] {
  const { world, stats, progress } = ctx.game;
  const p = world.player;
  const rivals = [...world.factions.values()].filter((f) => !f.isPlayer);
  return [
    [
      `This match · League ${world.league}`,
      [
        ['cells', 'Territory', `${fmt(p.cells)} cells`],
        ['peak', 'Largest territory', `${fmt(p.peakCells)} cells`],
        ['claimed', 'Open cells claimed', fmt(p.claimed)],
        ['converted', 'Enemy cells converted', fmt(p.converted)],
        ['lost', 'Cells lost', fmt(p.lost)],
        ['earned', 'Energy earned', fmt(p.earned)],
        ['rivals', 'Rivals · eliminated', `${rivals.length} · ${rivals.filter((f) => !f.alive).length}`],
        ['age', 'Match time', fmtDuration(world.time)],
      ],
    ],
    [
      'Lifetime',
      [
        ['record', 'Matches won · lost', `${fmt(progress.wins)} · ${fmt(progress.losses)}`],
        ['league', 'Highest league open', String(progress.unlocked)],
        ['l-claimed', 'Open cells claimed', fmt(stats.cellsClaimed)],
        ['l-converted', 'Enemy cells converted', fmt(stats.cellsConverted)],
        ['l-lost', 'Cells lost', fmt(stats.cellsLost)],
        ['l-elim', 'Rivals you eliminated', fmt(stats.rivalsEliminated)],
        ['l-energy', 'Energy earned', fmt(stats.energyEarned)],
        ['runs', 'Matches started', fmt(stats.runsStarted)],
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
