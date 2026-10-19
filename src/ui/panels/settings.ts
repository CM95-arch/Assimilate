// Settings: sound, motion, diagnostics, the developer Rule Lab, saving and reset.

import { PLAYER_TRAITS, TRAIT_LIMITS, type GrowthTraits } from '../../config/balance';
import { activeTraits } from '../../state';
import type { Panel, UiContext } from '../context';
import { h, setText, toggle } from '../dom';

function row(label: string, sub: string, control: Node) {
  return h('div', { class: 'row' }, h('div', { class: 'label' }, h('strong', { text: label }), h('span', { text: sub })), control);
}

function fmtTrait(k: keyof GrowthTraits, v: number) {
  return TRAIT_LIMITS[k].step >= 1 ? String(Math.round(v)) : v.toFixed(2).replace(/0$/, '');
}

function ruleLab(ctx: UiContext) {
  const { game } = ctx;
  const traits = activeTraits(game.settings);
  const root = h('div', { 'data-id': 'rule-lab' });
  root.append(h('p', { class: 'note', text: 'Developer tool. Change the local rules and watch the colony’s shape respond. Changes apply immediately and are saved. Upgrades will replace this in the next build.' }));
  for (const k of Object.keys(TRAIT_LIMITS) as (keyof GrowthTraits)[]) {
    const lim = TRAIT_LIMITS[k];
    const out = h('output', { text: fmtTrait(k, traits[k]) });
    const input = h('input', { type: 'range', min: lim.min, max: lim.max, step: lim.step, value: traits[k], 'aria-label': lim.label, 'data-trait': k });
    input.addEventListener('input', () => {
      const v = Number(input.value);
      const next = { ...activeTraits(game.settings), [k]: v };
      game.settings.customTraits = next;
      game.applyTraits();
      setText(out, fmtTrait(k, v));
    });
    root.append(h('div', { class: 'lab-row' }, h('div', { class: 'label' }, h('strong', { text: lim.label }), h('span', { text: lim.hint })), out, input));
  }
  root.append(
    h('div', { class: 'btn-row' }, h('button', {
      class: 'btn', type: 'button', 'data-action': 'reset-rules', text: 'Restore default rules',
      on: {
        click: () => {
          game.settings.customTraits = null;
          game.sim.setTraits(1, { ...PLAYER_TRAITS });
          ctx.save();
          ctx.toasts.show('Default rules restored');
          ctx.rerender();
        },
      },
    })),
  );
  return root;
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
    let labOpen = false;
    const labWrap = h('div', { hidden: true });
    const labBtn = h('button', { class: 'btn ghost', type: 'button', 'data-action': 'toggle-lab', 'aria-expanded': 'false', text: 'Open Rule Lab' });
    labBtn.addEventListener('click', () => {
      labOpen = !labOpen;
      labBtn.setAttribute('aria-expanded', String(labOpen));
      setText(labBtn, labOpen ? 'Close Rule Lab' : 'Open Rule Lab');
      labWrap.hidden = !labOpen;
      if (labOpen && !labWrap.firstChild) labWrap.append(ruleLab(ctx));
      if (!labOpen) ctx.save();
    });
    const saved = h('span', { 'data-k': 'saved', text: '' });
    return h(
      'div',
      {},
      h('p', { class: 'section-title', text: 'Sound & motion' }),
      row('Sound', 'Soft pops as cells divide', toggle('Sound', st.sound, set(() => { st.sound = !st.sound; vol.disabled = !st.sound; }))),
      row('Volume', '', vol),
      row('Reduce motion', 'Shorter, bounce-free animations', toggle('Reduce motion', st.reducedMotion, set(() => { st.reducedMotion = !st.reducedMotion; game.applyMotion(); }))),
      h('p', { class: 'section-title', text: 'Developer' }),
      row('Diagnostics', 'Tick rate, frontier size, decision weights', toggle('Diagnostics', st.diagnostics, set(() => { st.diagnostics = !st.diagnostics; }))),
      h('div', { class: 'btn-row' }, labBtn),
      labWrap,
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
      h('div', { class: 'btn-row' }, h('button', { class: 'btn danger', type: 'button', 'data-action': 'reset', text: 'Reset all progress…', on: { click: () => ctx.confirmReset() } })),
      h('p', { class: 'note', style: 'margin-top:14px', text: 'Assimilate · build 0.1.0 (Phase 1: Living Grid)' }),
    );
  },
  refresh(ctx, root) {
    const el = root.querySelector('[data-k="saved"]');
    const t = ctx.lastSavedAt();
    if (el) setText(el, t ? `${Math.max(0, Math.round((Date.now() - t) / 1000))}s ago` : 'Not yet');
  },
};
