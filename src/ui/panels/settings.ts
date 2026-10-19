// Settings: sound, motion, diagnostics, saving, new run and reset.

import type { Panel } from '../context';
import { h, setText, toggle } from '../dom';

function row(label: string, sub: string, control: Node) {
  return h('div', { class: 'row' }, h('div', { class: 'label' }, h('strong', { text: label }), h('span', { text: sub })), control);
}

export const settingsPanel: Panel = {
  title: 'Settings',
  render(ctx) {
    const { game } = ctx;
    const st = game.settings;
    const vol = h('input', { type: 'range', class: 'small', min: 0, max: 1, step: 0.05, value: st.volume, 'aria-label': 'Volume', disabled: !st.sound });
    vol.addEventListener('input', () => {
      st.volume = Number(vol.value);
      ctx.applySettings();
    });
    vol.addEventListener('change', () => ctx.save());
    const set = (fn: () => void) => () => {
      fn();
      ctx.applySettings();
      ctx.save();
    };
    const saved = h('span', { 'data-k': 'saved', text: '' });
    return h(
      'div',
      {},
      h('p', { class: 'section-title', text: 'Sound & motion' }),
      row('Sound', 'Soft pops as you claim and convert cells', toggle('Sound', st.sound, set(() => { st.sound = !st.sound; vol.disabled = !st.sound; }))),
      row('Volume', '', vol),
      row('Reduce motion', 'Shorter, bounce-free animations', toggle('Reduce motion', st.reducedMotion, set(() => { st.reducedMotion = !st.reducedMotion; game.applyMotion(); }))),
      h('p', { class: 'section-title', text: 'Developer' }),
      row('Diagnostics', 'Frame and tick timing, border sizes, rivals', toggle('Diagnostics', st.diagnostics, set(() => { st.diagnostics = !st.diagnostics; }))),
      h('p', { class: 'section-title', text: 'Progress' }),
      row('Saving', 'Automatic every 10 seconds and when you leave', h('button', {
        class: 'btn', type: 'button', 'data-action': 'save-now', text: 'Save now',
        on: {
          click: () => {
            const ok = ctx.save();
            ctx.toasts.show(ok ? 'Saved' : 'Could not save on this device', ok ? 'good' : 'bad');
          },
        },
      })),
      h('div', { class: 'row' }, h('div', { class: 'label' }, h('strong', { text: 'Last saved' }), saved)),
      h('p', { class: 'section-title', text: 'Run' }),
      row('New run', 'Start over in a new world. Lifetime statistics are kept.', h('button', { class: 'btn', type: 'button', 'data-action': 'new-run', text: 'New run…', on: { click: () => ctx.confirmNewRun() } })),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn danger', type: 'button', 'data-action': 'reset', text: 'Reset all progress…', on: { click: () => ctx.confirmReset() } })),
      h('p', { class: 'note', style: 'margin-top:14px', text: 'Assimilate · build 0.2.7' }),
    );
  },
  refresh(ctx, root) {
    const el = root.querySelector('[data-k="saved"]');
    const t = ctx.lastSavedAt();
    if (el) setText(el, t ? `${Math.max(0, Math.round((Date.now() - t) / 1000))}s ago` : 'Not yet');
  },
};
