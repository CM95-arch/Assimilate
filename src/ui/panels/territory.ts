// Territory: your behaviour sliders, your numbers and build, and every rival you know about.

import { PROFILE_BY_ID } from '../../config/profiles';
import { UPGRADE_BY_ID } from '../../config/upgrades';
import { centroid, radius, type Faction } from '../../sim/faction';
import type { World } from '../../sim/world';
import { fmt } from '../../util/format';
import type { Panel, UiContext } from '../context';
import { behaviorControls, styleSummary } from '../behavior';
import { h, setText } from '../dom';

function attemptsPerSecond(w: World, f: Faction) {
  return f.stats.rate * w.tempo() * (1 + f.stats.sizeBonus * Math.sqrt(f.cells));
}

/** Short description of a faction's build: its three most-levelled upgrades. */
export function buildSummary(f: Faction): string {
  const top = Object.entries(f.levels).filter(([, l]) => l > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return top.length ? top.map(([id, l]) => `${UPGRADE_BY_ID[id].name} ${l}`).join(' · ') : 'No upgrades yet';
}

function youRows(w: World): [string, string, string][] {
  const p = w.player;
  return [
    ['cells', 'Cells held', fmt(p.cells)],
    ['border', 'Border cells', fmt(p.frontier.size)],
    ['attempts', 'Expansion attempts', `${attemptsPerSecond(w, p).toFixed(1)}/s`],
    ['tempo', 'World tempo (rises over 12 min)', `×${w.tempo().toFixed(2)}`],
    ['power', 'Conversion power', p.stats.power.toFixed(2)],
    ['resist', 'Resistance', p.stats.resistance.toFixed(2)],
    ['energy', 'Energy income', `+${w.energyRate().toFixed(1)}/s`],
  ];
}

function flagText(w: World): string {
  const p = w.player;
  if (!p.flag) return 'No flag. Tap the map to plant one, and your territory leans that way while still growing everywhere.';
  const c = centroid(p);
  const d = Math.max(0, Math.round(Math.hypot(p.flag.x - c.x, p.flag.y - c.y) - radius(p)));
  return `Planted about ${fmt(d)} cells beyond your border. Tap it on the map to take it down.`;
}

function rivalStatus(w: World, f: Faction, contacts: number[]): string {
  if (!f.alive) return 'Eliminated';
  if (contacts.includes(f.id)) return 'Bordering you';
  const a = centroid(w.player);
  const b = centroid(f);
  // Approximate gap between the two territories' edges, not their centres.
  const gap = Math.max(1, Math.round(Math.hypot(a.x - b.x, a.y - b.y) - radius(w.player) - radius(f)));
  return `About ${fmt(gap)} cells away`;
}

function rivalList(ctx: UiContext): HTMLElement {
  const w = ctx.game.world;
  const contacts = w.contacts();
  const rivals = [...w.factions.values()].filter((f) => !f.isPlayer)
    .sort((a, b) => Number(b.alive) - Number(a.alive) || Number(contacts.includes(b.id)) - Number(contacts.includes(a.id)) || b.cells - a.cells);
  if (!rivals.length) return h('p', { class: 'empty', text: 'No rivals found yet.' });
  const list = h('div', { class: 'rivals' });
  for (const f of rivals) {
    const profile = PROFILE_BY_ID[f.profile];
    list.append(h('div', { class: `rival${f.alive ? '' : ' gone'}`, 'data-rival': f.id },
      h('span', { class: 'swatch', style: `background:${f.color}` }),
      h('div', { class: 'rival-info' },
        h('h3', {}, `${f.name} `, h('span', { class: 'tag', text: profile?.name ?? 'Rival' })),
        h('p', { class: 'rival-style', text: styleSummary(f) }),
        h('p', { class: 'rival-build', 'data-k': `build-${f.id}`, text: f.alive ? buildSummary(f) : profile?.summary ?? '' }),
        h('p', { class: 'rival-status', 'data-k': `status-${f.id}`, text: rivalStatus(w, f, contacts) }),
      ),
      h('div', { class: 'rival-cells' }, h('strong', { 'data-k': `cells-${f.id}`, text: fmt(f.cells) }), h('small', { text: 'cells' })),
    ));
  }
  return list;
}

export const territoryPanel: Panel = {
  title: 'Territory',
  render(ctx) {
    const w = ctx.game.world;
    const kv = h('dl', { class: 'kv' });
    for (const [id, label, value] of youRows(w)) kv.append(h('dt', { text: label }), h('dd', { 'data-k': id, text: value }));
    return h('div', {},
      h('p', { class: 'section-title', text: 'Behavior' }),
      h('p', { class: 'b-intro', text: 'Free to change any time. These decide what your territory goes after; upgrades decide how strong it is.' }),
      behaviorControls(ctx),
      h('p', { class: 'section-title', text: 'Rally flag' }),
      h('p', { class: 'b-intro', 'data-k': 'flag', text: flagText(w) }),
      h('div', { class: 'btn-row', style: 'margin-top:4px' }, h('button', {
        class: 'btn', type: 'button', 'data-action': 'remove-flag', text: 'Take down flag',
        on: { click: () => {
          const world = ctx.game.world;
          if (world.player.flag) world.setFlag(world.player, null);
          ctx.game.audio.click();
        } },
      })),
      h('p', { class: 'section-title', text: 'You' }),
      kv,
      h('p', { class: 'build-line', 'data-k': 'build', text: buildSummary(w.player) }),
      h('p', { class: 'section-title', text: 'Rivals' }),
      h('div', { 'data-k': 'rivals' }, rivalList(ctx)),
      h('p', { class: 'note', style: 'margin-top:12px', text: 'Every rival has earned about as much as you and spent it on its own route. More appear as your territory reaches further out.' }),
    );
  },
  refresh(ctx, root) {
    const w = ctx.game.world;
    for (const [id, , value] of youRows(w)) {
      const el = root.querySelector(`[data-k="${id}"]`);
      if (el) setText(el, value);
    }
    const flag = root.querySelector('[data-k="flag"]');
    if (flag) setText(flag, flagText(w));
    const btn = root.querySelector<HTMLButtonElement>('[data-action="remove-flag"]');
    if (btn) btn.disabled = !w.player.flag;
    const build = root.querySelector('[data-k="build"]');
    if (build) setText(build, buildSummary(w.player));
    const holder = root.querySelector<HTMLElement>('[data-k="rivals"]');
    if (!holder) return;
    const shown = holder.querySelectorAll('[data-rival]').length;
    const known = [...w.factions.values()].filter((f) => !f.isPlayer).length;
    const goneShown = holder.querySelectorAll('.rival.gone').length;
    const goneNow = [...w.factions.values()].filter((f) => !f.isPlayer && !f.alive).length;
    if (shown !== known || goneShown !== goneNow) {
      holder.replaceChildren(rivalList(ctx));
      return;
    }
    const contacts = w.contacts();
    for (const f of w.factions.values()) {
      if (f.isPlayer) continue;
      const c = holder.querySelector(`[data-k="cells-${f.id}"]`);
      if (c) setText(c, fmt(f.cells));
      const s = holder.querySelector(`[data-k="status-${f.id}"]`);
      if (s) setText(s, rivalStatus(w, f, contacts));
      const b = holder.querySelector(`[data-k="build-${f.id}"]`);
      if (b && f.alive) setText(b, buildSummary(f));
    }
  },
};
