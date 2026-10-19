import type { Game } from '../game';
import type { Toasts } from './overlay';

/** What panels may use. Keeps panels independent of the app shell. */
export interface UiContext {
  game: Game;
  toasts: Toasts;
  save: () => boolean;
  lastSavedAt: () => number;
  applySettings: () => void;
  confirmNewRun: () => void;
  confirmReset: () => void;
  /** Re-render the open panel (after structural changes). */
  rerender: () => void;
  /** Small per-session UI memory (selected category, buy amount). */
  memory: Record<string, string>;
}

export interface Panel {
  title: string;
  render: (ctx: UiContext) => HTMLElement;
  /** Called ~5×/s while the panel is open, for live numbers. */
  refresh?: (ctx: UiContext, root: HTMLElement) => void;
}
