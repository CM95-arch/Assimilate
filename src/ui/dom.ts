type Attrs = Record<string, unknown> & {
  class?: string;
  text?: string;
  html?: string;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
};

/** Tiny element builder. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k === 'on') for (const [ev, fn] of Object.entries(v as object)) el.addEventListener(ev, fn as EventListener);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Set text only when it changed (avoids layout churn in 5 Hz refreshes). */
export function setText(el: Element, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

export function setAttr(el: Element, name: string, value: string | null) {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

export function svg(markup: string, cls = ''): SVGElement {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" class="${cls}">${markup}</svg>`;
  return wrap.firstElementChild as SVGElement;
}

export const ICON = {
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  energy: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  research: '<path d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9z"/><path d="M12 8v8M8.5 10l7 4M15.5 10l-7 4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
};

export function flash(el: HTMLElement, cls: 'flash' | 'shake' | 'bump') {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), 450);
}

/** Accessible on/off switch. */
export function toggle(label: string, checked: boolean, onChange: (v: boolean) => void, disabled = false): HTMLButtonElement {
  const b = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(checked), 'aria-label': label, disabled });
  b.addEventListener('click', () => {
    const v = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(v));
    onChange(v);
  });
  return b;
}

/** Segmented control. */
export function segmented<T extends string>(options: { value: T; label: string; disabled?: boolean }[], value: T, onChange: (v: T) => void, label: string) {
  const root = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  const buttons = options.map((o) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(o.value === value), disabled: !!o.disabled, text: o.label });
    b.addEventListener('click', () => {
      for (const x of buttons) x.setAttribute('aria-pressed', String(x === b));
      onChange(o.value);
    });
    root.append(b);
    return b;
  });
  return root;
}
