// Prestige isn't built yet: an honest preview instead of fake controls.

import type { Panel } from '../context';
import { h } from '../dom';

export const prestigePanel: Panel = {
  title: 'Prestige',
  render: () =>
    h('div', { 'data-locked-panel': 'prestige' },
      h('span', { class: 'phase-badge', text: 'Arrives in a later update' }),
      h('p', { class: 'note', text: 'When a run ends, whether you are wiped out or choose to start over, you will earn permanent points based on how far you got. They buy bonuses that carry into every future run.' }),
      h('div', { class: 'preview' },
        h('div', { class: 'item' }, h('h3', { text: 'Permanent upgrades' }), h('p', { text: 'Start faster, stronger or richer every run.' })),
        h('div', { class: 'item' }, h('h3', { text: 'Starting builds' }), h('p', { text: 'Begin each run with a chosen behaviour already in place.' })),
        h('div', { class: 'item' }, h('h3', { text: 'Tougher worlds' }), h('p', { text: 'Rivals that start stronger, for bigger rewards.' })),
      ),
    ),
};
