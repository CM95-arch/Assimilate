// Visible error reporting. A silent exception used to freeze the screen with no explanation;
// now the game keeps running and shows what failed, with Reload and Dismiss buttons.

import { h } from './dom';

const shown = new Set<string>();

export function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

/** Show a dismissible error card (once per distinct message). Never throws. */
export function reportError(err: unknown, where: string) {
  try {
    console.error(`[${where}]`, err);
    const msg = `${where} — ${describe(err)}`;
    if (shown.has(msg)) return;
    shown.add(msg);
    const card = h(
      'div',
      { class: 'error-card', role: 'alert' },
      h('strong', { text: 'Something went wrong' }),
      h('p', { text: 'The game is still running. If something looks stuck, tap Reload. Please send this message to the developer:' }),
      h('code', { text: msg }),
      h(
        'div',
        { class: 'error-actions' },
        h('button', { class: 'btn primary', type: 'button', text: 'Reload', on: { click: () => location.reload() } }),
        h('button', { class: 'btn', type: 'button', text: 'Dismiss', on: { click: () => card.remove() } }),
      ),
    );
    document.body.append(card);
  } catch {
    /* reporting must never cause a second failure */
  }
}

export function installGlobalHandlers() {
  window.addEventListener('error', (e) => reportError(e.error ?? e.message, 'Page'));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'Page'));
}
