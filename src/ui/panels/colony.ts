// Colony panel: live facts about the organism, the rules it follows, and world controls.

import { TIME } from '../../config/balance';
import { fmt, fmtDuration, fmtPct } from '../../util/format';
import type { Panel, UiContext } from '../context';
import { h, setText } from '../dom';

function rows(ctx: UiContext): [string, string, string][] {
  const { sim } = ctx.game;
  const c = sim.player;
  const young = sim.youngCount();
  return [
    ['pop', 'Living cells', fmt(c.population)],
    ['young', 'Maturing (can’t divide yet)', fmt(young)],
    ['frontier', 'Frontier cells (still able to grow)', fmt(sim.world.activeCount)],
    ['territory', 'Territory of open ground', fmtPct(sim.territoryFraction())],
    ['rate', 'New cells per second', sim.birthRate().toFixed(1)],
    ['age', 'Colony age', fmtDuration(sim.tick / TIME.ticksPerSecond)],
  ];
}

export const colonyPanel: Panel = {
  title: 'Colony',
  render(ctx) {
    const kv = h('dl', { class: 'kv' });
    for (const [id, label, value] of rows(ctx)) kv.append(h('dt', { text: label }), h('dd', { 'data-k': id, text: value }));
    const t = ctx.game.sim.player.traits;
    const branchWord = t.branching > 0.5 ? 'prefers open ground, so it reaches out in fingers' : t.branching < -0.5 ? 'prefers gaps, so it stays compact' : 'has no strong preference for open or crowded ground';
    return h(
      'div',
      {},
      kv,
      h('p', { class: 'section-title', text: 'How it grows' }),
      h(
        'ul',
        { class: 'rules' },
        h('li', {}, h('strong', { text: 'Every cell decides alone. ' }), 'It only looks at the cells right next to it. Nothing steers the colony as a whole.'),
        h('li', {}, h('strong', { text: 'It divides into an empty neighbour ' }), `about every ${(t.interval / TIME.ticksPerSecond).toFixed(1)}s, once it has matured for ${(t.maturation / TIME.ticksPerSecond).toFixed(1)}s.`),
        h('li', {}, h('strong', { text: 'Darker soil is richer. ' }), 'Cells favour it and succeed more often there, so growth follows fertile veins.'),
        h('li', {}, h('strong', { text: 'This colony ' }), `${branchWord}, and tends to keep growing the way it was born.`),
        h('li', {}, h('strong', { text: 'Grey blocks are rock. ' }), 'Nothing grows through them; the colony flows around.'),
      ),
      h('p', { class: 'note', text: 'Upgrades (next build) change these preferences, and you’ll see the shape of the colony change with them.' }),
      h('p', { class: 'section-title', text: `World · seed ${ctx.game.sim.seed}` }),
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', 'data-action': 'replay', text: 'Replay world', on: { click: () => ctx.confirmReplay() } }),
        h('button', { class: 'btn primary', type: 'button', 'data-action': 'new-world', text: 'New world', on: { click: () => ctx.confirmNewWorld() } }),
      ),
    );
  },
  refresh(ctx, root) {
    for (const [id, , value] of rows(ctx)) {
      const el = root.querySelector(`[data-k="${id}"]`);
      if (el) setText(el, value);
    }
  },
};
