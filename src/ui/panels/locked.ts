// Honest placeholders for systems that arrive in later phases: what they will do, not fake UI.

import type { Panel } from '../context';
import { h } from '../dom';

function preview(title: string, phase: string, lead: string, items: [string, string][]): Panel {
  return {
    title,
    render: () =>
      h(
        'div',
        { 'data-locked-panel': title },
        h('span', { class: 'phase-badge', text: phase }),
        h('p', { class: 'note', text: lead }),
        h('div', { class: 'preview' }, ...items.map(([t, p]) => h('div', { class: 'item' }, h('h3', { text: t }), h('p', { text: p })))),
      ),
  };
}

export const upgradesPanel = preview(
  'Upgrades',
  'Arrives in Phase 2 · Biomass economy',
  'Cells will produce and consume biomass. You spend the surplus here to change the rules your colony follows.',
  [
    ['Reproduction Rate', 'Shorter time between division attempts.'],
    ['Growth Efficiency', 'Cheaper new cells.'],
    ['Cell Maturation', 'Newborns become useful sooner.'],
    ['Branching Tendency', 'More reaching, finger-like growth toward open ground.'],
    ['Biomass Production · Metabolic Efficiency', 'More income, lower upkeep — the balance between growth and survival.'],
  ],
);

export const mutationsPanel = preview(
  'Mutations',
  'Arrives in Phase 6',
  'Every so often you’ll choose one of three mutations that change how the colony behaves for the rest of the generation.',
  [
    ['Branching Growth', 'Thin exploratory tendrils — fast, but easy to sever.'],
    ['Infectious Division', 'Attacks occasionally convert enemy cells outright.'],
    ['Spore Burst', 'Seeds distant colonies that must survive alone.'],
    ['Independent Cores', 'Cut-off regions can grow their own core and live on.'],
  ],
);

export const evolutionPanel = preview(
  'Evolution',
  'Arrives in Phase 7',
  'When a generation ends you’ll earn genetic research and begin again stronger. Research is permanent.',
  [
    ['Generations', 'End a run voluntarily or through extinction; rewards scale with how far you got.'],
    ['Genetic research', 'Permanent bonuses to growth, metabolism, combat and behaviour.'],
    ['Larger worlds', 'Bigger maps and more rival colonies as you progress.'],
  ],
);
