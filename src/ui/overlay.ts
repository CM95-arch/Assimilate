// Modals, toasts, banner and tips: every layer can always be dismissed (§20.6).

import { h } from './dom';

export interface ModalAction {
  label: string;
  sub?: string;
  kind?: 'primary' | 'danger' | 'ghost';
  onClick?: () => void;
  /** Keep the modal open after the action (default: close). */
  keepOpen?: boolean;
  disabled?: boolean;
  id?: string;
}

export interface ModalOptions {
  id: string;
  title: string;
  lead?: string;
  body?: Node[];
  actions: ModalAction[];
  /** Tapping outside or pressing Escape closes it (default true). */
  dismissible?: boolean;
  onClose?: () => void;
}

export interface ModalHandle {
  el: HTMLElement;
  close: () => void;
  button: (id: string) => HTMLButtonElement | null;
}

const stack: { handle: ModalHandle; dismissible: boolean }[] = [];

export function openModal(o: ModalOptions): ModalHandle {
  const root = document.getElementById('modal-root')!;
  const dialog = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `${o.id}-title`, 'data-id': o.id });
  dialog.append(h('h2', { id: `${o.id}-title`, text: o.title }));
  if (o.lead) dialog.append(h('p', { class: 'lead', text: o.lead }));
  for (const n of o.body ?? []) dialog.append(n);
  const actions = h('div', { class: 'actions' });
  const backdrop = h('div', { class: 'modal-backdrop' }, dialog);
  let closed = false;
  const handle: ModalHandle = {
    el: dialog,
    close: () => {
      if (closed) return;
      closed = true;
      backdrop.remove();
      const k = stack.findIndex((e) => e.handle === handle);
      if (k >= 0) stack.splice(k, 1);
      o.onClose?.();
    },
    button: (id) => dialog.querySelector(`[data-action="${id}"]`),
  };
  for (const a of o.actions) {
    const b = h('button', { class: `btn ${a.kind ?? ''}`, type: 'button', 'data-action': a.id ?? a.label, disabled: !!a.disabled }, a.label, a.sub ? h('small', { text: a.sub }) : null);
    b.addEventListener('click', () => {
      if (b.disabled) return;
      a.onClick?.();
      if (!a.keepOpen) handle.close();
    });
    actions.append(b);
  }
  dialog.append(actions);
  if (o.dismissible !== false) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) handle.close();
    });
  }
  root.append(backdrop);
  stack.push({ handle, dismissible: o.dismissible !== false });
  (actions.querySelector('button:not([disabled])') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  return handle;
}

/** Close the top-most dismissible modal. Returns true if one was closed. */
export function closeTopModal(): boolean {
  const top = stack[stack.length - 1];
  if (!top || !top.dismissible) return false;
  top.handle.close();
  return true;
}

export function modalOpen(): boolean {
  return stack.length > 0;
}

export class Toasts {
  constructor(private readonly root: HTMLElement) {}

  show(text: string, kind: 'info' | 'good' | 'bad' = 'info', ms = 2600) {
    const t = h('div', { class: `toast ${kind === 'info' ? '' : kind}`, text });
    this.root.append(t);
    while (this.root.children.length > 3) this.root.firstElementChild?.remove();
    window.setTimeout(() => t.remove(), ms);
  }
}

export class Banner {
  private timer = 0;
  constructor(private readonly root: HTMLElement) {}

  show(title: string, sub: string, ms = 2600) {
    this.root.replaceChildren(h('strong', { text: title }), h('span', { text: sub }));
    this.root.classList.add('show');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.root.classList.remove('show'), ms);
  }
}

export class Tip {
  constructor(private readonly root: HTMLElement) {}

  show(text: string, onDismiss: () => void) {
    const btn = h('button', { type: 'button', text: 'Got it' });
    btn.addEventListener('click', () => {
      this.hide();
      onDismiss();
    });
    this.root.replaceChildren(h('p', { text }), btn);
    this.root.hidden = false;
  }

  hide() {
    this.root.hidden = true;
  }

  get visible() {
    return !this.root.hidden;
  }
}
