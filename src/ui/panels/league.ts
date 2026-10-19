// Leagues: win a match to open the next league, which is bigger, more crowded and has richer
// rivals. Any open league can be played again to beat your best time.

import { leagueInfo, MATCH } from '../../config/balance';
import { fmtDuration } from '../../util/format';
import type { Panel, UiContext } from '../context';
import { h } from '../dom';

function describe(league: number): string {
  const l = leagueInfo(league);
  const richer = l.rivalIncome > 1 ? ` · rivals earn +${Math.round((l.rivalIncome - 1) * 100)}%` : '';
  return `${l.size}×${l.size} arena · ${l.rivals} rivals${richer}`;
}

function rows(ctx: UiContext): HTMLElement {
  const { progress, world } = ctx.game;
  const list = h('div', { class: 'leagues' });
  const last = Math.min(MATCH.maxLeague, progress.unlocked + 1);
  for (let l = 1; l <= last; l++) {
    const open = l <= progress.unlocked;
    const current = l === world.league && !world.ended;
    const best = progress.best[l];
    list.append(h('div', { class: `league-row${open ? '' : ' locked'}`, 'data-league': l },
      h('div', {},
        h('h3', {}, `League ${l}`, current ? h('span', { class: 'tag', text: 'Playing' }) : best ? h('span', { class: 'tag', text: 'Won' }) : ''),
        h('p', { text: describe(l) }),
        h('p', { text: !open ? `Win League ${l - 1} to open` : best ? `Best win: ${fmtDuration(best)}` : 'Not won yet' }),
      ),
      open
        ? h('button', { class: `btn${current ? '' : ' primary'}`, type: 'button', 'data-play': l, text: current ? 'Restart' : 'Play', on: { click: () => ctx.confirmNewRun(l) } })
        : h('span', {}),
    ));
  }
  return list;
}

export const leaguePanel: Panel = {
  title: 'League',
  render(ctx) {
    const p = ctx.game.progress;
    return h('div', {},
      h('p', { class: 'note', text: `Each match: you and your rivals start at the same moment. The first to hold ${Math.round(MATCH.winShare * 100)}% of the arena wins. Rivals gang up on whoever is clearly ahead. Upgrades last for one match.` }),
      h('p', { class: 'section-title', text: `Leagues · ${p.wins} won, ${p.losses} lost` }),
      rows(ctx),
    );
  },
};
