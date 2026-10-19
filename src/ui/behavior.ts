// Behaviour sliders: free, reversible choices about what your territory prefers.
// They are deliberately not upgrades: moving one way always gives up the other.

import { BEHAVIOR_KEYS, type Behavior } from '../config/upgrades';
import { refreshStats, type Faction } from '../sim/faction';
import type { UiContext } from './context';
import { h, setText } from './dom';

export const SLIDERS: Record<keyof Behavior, { name: string; low: string; high: string; lowHint: string; highHint: string }> = {
  focus: {
    name: 'Focus', low: 'Claim land', high: 'Attack',
    lowHint: 'Prefers open ground; avoids fights it doesn’t need.',
    highHint: 'Prefers enemy cells over open ground.',
  },
  shape: {
    name: 'Shape', low: 'Compact', high: 'Branching',
    lowHint: 'Fills gaps first: a solid mass that is hard to cut.',
    highHint: 'Reaches into open space in fingers: fast, but easy to sever.',
  },
  reach: {
    name: 'Reach', low: 'Even', high: 'Spearheads',
    lowHint: 'Grows evenly all round.',
    highHint: 'Pushes hardest at its outermost tips.',
  },
  posture: {
    name: 'Posture', low: 'Defend', high: 'Exploit',
    lowHint: 'Reinforces where it’s attacked and retakes lost cells.',
    highHint: 'Hunts weak points: thin enemy cells it already half-surrounds.',
  },
};

/** One-line description of a slider position. */
export function sliderWords(k: keyof Behavior, v: number): string {
  const s = SLIDERS[k];
  if (Math.abs(v) < 0.15) return 'Balanced';
  const strength = Math.abs(v) > 0.7 ? 'Strongly ' : Math.abs(v) > 0.35 ? '' : 'Slightly ';
  const word = v < 0 ? s.low : s.high;
  return strength ? `${strength}${word.toLowerCase()}` : word;
}

/** Short style summary for a rival, from its slider positions. */
export function styleSummary(f: Faction): string {
  const parts: string[] = [];
  for (const k of BEHAVIOR_KEYS) {
    const v = f.behavior[k];
    if (Math.abs(v) >= 0.35) parts.push((v < 0 ? SLIDERS[k].low : SLIDERS[k].high).toLowerCase());
  }
  return parts.length ? `Style: ${parts.join(' · ')}` : 'Style: balanced';
}

export function behaviorControls(ctx: UiContext): HTMLElement {
  const f = ctx.game.world.player;
  const root = h('div', { class: 'behavior', 'data-behavior': '' });
  for (const k of BEHAVIOR_KEYS) {
    const s = SLIDERS[k];
    const value = h('span', { class: 'b-value', 'data-k': `b-${k}`, text: sliderWords(k, f.behavior[k]) });
    const hint = h('p', { class: 'b-hint', 'data-k': `bh-${k}` });
    const input = h('input', { type: 'range', id: `behavior-${k}`, min: -1, max: 1, step: 0.05, value: f.behavior[k], 'aria-label': `${s.name}: ${s.low} to ${s.high}`, 'data-slider': k });
    const setHint = (v: number) => setText(hint, Math.abs(v) < 0.15 ? 'No preference either way.' : v < 0 ? s.lowHint : s.highHint);
    setHint(f.behavior[k]);
    input.addEventListener('input', () => {
      const p = ctx.game.world.player;
      let v = Number(input.value);
      if (Math.abs(v) < 0.08) v = 0; // a gentle snap to the centre notch
      p.behavior[k] = v;
      refreshStats(p);
      setText(value, sliderWords(k, v));
      setHint(v);
    });
    input.addEventListener('change', () => ctx.save());
    root.append(h('div', { class: 'b-row' },
      h('div', { class: 'b-head' }, h('strong', { text: s.name }), value),
      h('div', { class: 'slider-wrap' }, h('span', { class: 'notch', 'aria-hidden': 'true' }), input),
      h('div', { class: 'b-ends', 'aria-hidden': 'true' }, h('span', { text: s.low }), h('span', { text: s.high })),
      hint,
    ));
  }
  root.append(h('div', { class: 'btn-row' }, h('button', {
    class: 'btn ghost', type: 'button', 'data-action': 'reset-behavior', text: 'Centre all sliders',
    on: {
      click: () => {
        const p = ctx.game.world.player;
        for (const k of BEHAVIOR_KEYS) p.behavior[k] = 0;
        refreshStats(p);
        ctx.save();
        ctx.rerender();
      },
    },
  })));
  return root;
}
