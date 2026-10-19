import type { Game } from '../game';
import type { Toasts } from './overlay';

/** What panels may use. Keeps panels independent of the app shell. */
export interface UiContext {
  game: Game;
  toasts: Toasts;
  save: () => boolean;
  lastSavedAt: () => number;
  applySettings: () => void;
  /** Start a new world (fresh seed) after confirming. */
  confirmNewWorld: () => void;
  /** Restart the current world from its first cell after confirming. */
  confirmReplay: () => void;
  confirmReset: () => void;
  /** Re-render the open panel (after structural changes). */
  rerender: () => void;
}

export interface Panel {
  title: string;
  render: (ctx: UiContext) => HTMLElement;
  /** Called ~4×/s while the panel is open, for live numbers. */
  refresh?: (ctx: UiContext, root: HTMLElement) => void;
}
