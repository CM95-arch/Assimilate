// Upgrades: categories, live prices, current → next effect, ×1 / ×10 / Max buying.

import { UPGRADE_CATEGORIES, UPGRADES, type UpgradeCategory, type UpgradeDef } from '../../config/upgrades';
import { buy, isUnlocked, quote, type BuyAmount } from '../../sim/economy';
import { fmt } from '../../util/format';
import type { Panel, UiContext } from '../context';
import { flash, h, ICON, segmented, setAttr, setText, svg } from '../dom';

interface CardRefs {
  def: UpgradeDef;
  card: HTMLElement;
  lv: HTMLElement;
  effect: HTMLElement;
  why: HTMLElement;
  btn: HTMLButtonElement;
  main: HTMLElement;
  sub: HTMLElement;
}

/** Card references and the unlock signature for each rendered panel. */
const views = new WeakMap<HTMLElement, { refs: CardRefs[]; sig: string }>();

const amountOf = (v: string | undefined): BuyAmount => (v === '10' ? 10 : v === 'max' ? 'max' : 1);

export const upgradesPanel: Panel = {
  title: 'Upgrades',
  render(ctx) {
    const root = h('div', { 'data-upgrades': '' });
    const cat = (ctx.memory.upgradeCat as UpgradeCategory) || 'expansion';
    const chips = h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Upgrade categories' });
    for (const c of UPGRADE_CATEGORIES) {
      const b = h('button', { class: 'chip', type: 'button', role: 'tab', 'aria-pressed': String(c.id === cat), 'data-cat': c.id, text: c.label });
      b.addEventListener('click', () => {
        ctx.memory.upgradeCat = c.id;
        ctx.rerender();
      });
      chips.append(b);
    }
    const toolbar = h('div', { class: 'toolbar' },
      h('span', { text: 'Upgrades last for this run.' }),
      segmented([{ value: '1', label: '×1' }, { value: '10', label: '×10' }, { value: 'max', label: 'Max' }], ctx.memory.buyAmount ?? '1', (v) => {
        ctx.memory.buyAmount = v;
        refreshCards(ctx, root);
      }, 'Buy amount'),
    );
    const list = h('div', { class: 'cards' });
    const p = ctx.game.world.player;
    const defs = UPGRADES.filter((u) => u.category === cat);
    const unlocked = defs.filter((d) => isUnlocked(d, p));
    // Show what's available plus the next locked items, so the list never becomes a wall of locks.
    const locked = defs.filter((d) => !isUnlocked(d, p)).sort((a, b) => a.unlockEarned - b.unlockEarned).slice(0, 2);
    const refs: CardRefs[] = [];
    for (const def of [...unlocked, ...locked]) {
      const lv = h('span', { class: 'lv num' });
      const effect = h('div', { class: 'effect' });
      const why = h('div', { class: 'why' });
      const main = h('span', { class: 'num' });
      const sub = h('small');
      const btn = h('button', { class: 'btn buy primary', type: 'button', 'data-buy': def.id }, main, sub);
      const card = h('div', { class: 'card', 'data-upgrade': def.id },
        h('div', { class: 'info' }, h('h3', {}, def.name, lv), h('p', { text: def.blurb }), effect, why),
        btn,
      );
      btn.addEventListener('click', () => {
        const res = buy(ctx.game.world.player, def.id, amountOf(ctx.memory.buyAmount));
        if (res.ok) {
          if (ctx.game.settings.sound) ctx.game.audio.purchase();
          flash(btn, 'flash');
          flash(card, 'bump');
          if (res.bought > 1) ctx.toasts.show(`${def.name} +${res.bought} levels`, 'good');
        } else {
          if (ctx.game.settings.sound) ctx.game.audio.deny();
          flash(btn, 'shake');
          ctx.toasts.show(res.reason ?? 'Can’t buy that yet', 'bad');
        }
        refreshCards(ctx, root);
      });
      list.append(card);
      refs.push({ def, card, lv, effect, why, btn, main, sub });
    }
    views.set(root, { refs, sig: signature(ctx) });
    root.append(chips, toolbar, list);
    refreshCards(ctx, root);
    return root;
  },
  refresh(ctx, root) {
    const el = root.querySelector<HTMLElement>('[data-upgrades]');
    if (!el) return;
    // Rebuild when an upgrade unlocks; otherwise just update numbers.
    if (views.get(el)?.sig !== signature(ctx)) ctx.rerender();
    else refreshCards(ctx, el);
  },
};

function signature(ctx: UiContext): string {
  const p = ctx.game.world.player;
  return UPGRADES.map((d) => (isUnlocked(d, p) ? 1 : 0)).join('') + (ctx.memory.upgradeCat ?? '');
}

function refreshCards(ctx: UiContext, root: HTMLElement) {
  const refs = views.get(root)?.refs ?? [];
  const p = ctx.game.world.player;
  const amount = amountOf(ctx.memory.buyAmount);
  for (const c of refs) {
    const level = p.levels[c.def.id] ?? 0;
    const maxed = level >= c.def.maxLevel;
    const unlocked = isUnlocked(c.def, p);
    setText(c.lv, maxed ? `Lv ${level} · Max` : `Lv ${level}`);
    c.card.classList.toggle('locked', !unlocked);
    if (!unlocked) {
      setText(c.effect, `First level: ${c.def.effect(1)}`);
      c.why.replaceChildren(svg(ICON.lock), h('span', { text: `Unlocks after earning ${fmt(c.def.unlockEarned)} energy this run (${fmt(p.earned)} so far)` }));
      setText(c.main, 'Locked');
      setText(c.sub, '');
      setAttr(c.btn, 'aria-disabled', 'true');
      c.btn.classList.remove('primary');
      continue;
    }
    c.why.replaceChildren();
    if (maxed) {
      setText(c.effect, `Now: ${c.def.effect(level)}`);
      setText(c.main, 'Maxed');
      setText(c.sub, '');
      setAttr(c.btn, 'aria-disabled', 'true');
      c.btn.classList.remove('primary');
      continue;
    }
    const q = quote(p, c.def.id, amount);
    c.effect.replaceChildren(
      h('span', { text: level === 0 ? 'Not owned' : c.def.effect(level) }),
      h('span', { class: 'arrow', text: '→' }),
      h('span', { text: c.def.effect(level + q.count) }),
    );
    const ok = q.count > 0 && q.cost <= p.energy && p.alive;
    setText(c.main, `${fmt(q.cost)} energy`);
    setText(c.sub, !p.alive ? 'Run ended' : ok ? (q.count > 1 ? `Buy ${q.count}` : 'Buy') : `Need ${fmt(Math.ceil(q.cost - p.energy))} more`);
    setAttr(c.btn, 'aria-disabled', String(!ok));
    setAttr(c.btn, 'aria-label', `Buy ${c.def.name}${q.count > 1 ? ` ×${q.count}` : ''} for ${fmt(q.cost)} energy`);
    c.btn.classList.toggle('primary', ok);
  }
}
