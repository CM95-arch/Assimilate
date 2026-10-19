// App shell: HUD, simulation controls, tabs + sheet panels, dialogs and the diagnostics overlay.

import type { Game } from '../game';
import type { Rect } from '../render/camera';
import type { Renderer } from '../render/renderer';
import { fmt, fmtPct } from '../util/format';
import type { Panel, UiContext } from './context';
import { h, setAttr, setText, svg } from './dom';
import { reportError } from './errors';
import { Banner, closeTopModal, modalOpen, openModal, Tip, Toasts } from './overlay';
import { colonyPanel } from './panels/colony';
import { evolutionPanel, mutationsPanel, upgradesPanel } from './panels/locked';
import { settingsPanel } from './panels/settings';
import { statsPanel } from './panels/stats';

const PANELS: Record<string, Panel> = {
  colony: colonyPanel,
  upgrades: upgradesPanel,
  mutations: mutationsPanel,
  evolution: evolutionPanel,
  stats: statsPanel,
  settings: settingsPanel,
};

const ICON_PAUSE = '<rect x="6.5" y="5" width="3.5" height="14" rx="1" class="fill"/><rect x="14" y="5" width="3.5" height="14" rx="1" class="fill"/>';
const ICON_PLAY = '<path d="M8 5.5v13l10.5-6.5z" class="fill"/>';
const DIRS = ['↑', '→', '↓', '←', '↗', '↘', '↙', '↖'];

export interface AppHooks {
  save: () => boolean;
  lastSavedAt: () => number;
  applySettings: () => void;
  newWorld: (seed?: number) => void;
  reset: () => void;
}

export class App {
  readonly toasts = new Toasts(document.getElementById('toasts')!);
  private readonly banner = new Banner(document.getElementById('banner')!);
  private readonly tip = new Tip(document.getElementById('tip')!);
  private readonly sheet = document.getElementById('sheet')!;
  private readonly sheetBody = document.getElementById('sheet-body')!;
  private readonly sheetTitle = document.getElementById('sheet-title')!;
  private readonly tabs = [...document.querySelectorAll<HTMLButtonElement>('#tabs button')];
  private readonly pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
  private readonly speedBtns = [...document.querySelectorAll<HTMLButtonElement>('#speed button')];
  private readonly diag = document.getElementById('diag')!;
  private readonly hud = {
    popV: document.querySelector('#stat-pop [data-v]')!,
    popR: document.querySelector('#stat-pop [data-r]')!,
    terV: document.querySelector('#stat-territory [data-v]')!,
    terR: document.querySelector('#stat-territory [data-r]')!,
    status: document.getElementById('stat-status')!,
    stV: document.querySelector('#stat-status [data-v]')!,
    stR: document.querySelector('#stat-status [data-r]')!,
  };
  private openTab: string | null = null;
  private refreshTimer = 0;
  private fps = 60;
  /** Smoothly animated playfield rect (it shrinks when a panel opens). */
  private play: Rect = { x: 0, y: 0, w: 1, h: 1 };
  private playTarget: Rect = { x: 0, y: 0, w: 1, h: 1 };
  readonly ctx: UiContext;

  constructor(private readonly game: Game, private readonly renderer: Renderer, private readonly hooks: AppHooks) {
    this.ctx = {
      game,
      toasts: this.toasts,
      save: hooks.save,
      lastSavedAt: hooks.lastSavedAt,
      applySettings: hooks.applySettings,
      confirmNewWorld: () => this.confirmWorld(false),
      confirmReplay: () => this.confirmWorld(true),
      confirmReset: () => this.confirmReset(),
      rerender: () => this.openTab && this.renderPanel(this.openTab),
    };
    for (const b of this.tabs) {
      if (b.hasAttribute('data-locked')) b.append(svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', 'lockmark'));
      b.addEventListener('click', () => this.toggleTab(b.dataset.tab!));
    }
    document.getElementById('sheet-close')!.addEventListener('click', () => this.closeSheet());
    this.pauseBtn.addEventListener('click', () => {
      game.paused = !game.paused;
      game.audio.click();
      this.syncControls();
    });
    for (const b of this.speedBtns) {
      b.addEventListener('click', () => {
        game.setSpeed(Number(b.dataset.speed) as 1 | 2 | 4);
        if (game.paused) game.paused = false;
        game.audio.click();
        this.syncControls();
        hooks.save();
      });
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!closeTopModal() && this.openTab) this.closeSheet();
      } else if (e.key === ' ' && !modalOpen() && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        this.pauseBtn.click();
      }
    });
    this.syncControls();
  }

  /** Measure the free playfield between HUD and bottom chrome and tell the renderer. */
  layout(snap = false) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const hudB = document.getElementById('hud')!.getBoundingClientRect().bottom;
    const navH = document.getElementById('tabs')!.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--nav-h', `${navH}px`);
    document.documentElement.style.setProperty('--play-top', `${hudB}px`);
    const controlsH = this.openTab ? 0 : document.getElementById('controls')!.getBoundingClientRect().height;
    const sheetH = this.openTab ? this.sheet.getBoundingClientRect().height : 0;
    const bottom = H - navH - Math.max(controlsH, sheetH);
    const pad = 6;
    this.playTarget = { x: pad, y: hudB, w: W - pad * 2, h: Math.max(60, bottom - hudB) };
    if (snap) this.play = { ...this.playTarget };
    this.renderer.resize(W, H, this.play);
  }

  private syncControls() {
    const p = this.game.paused;
    this.pauseBtn.replaceChildren(svg(p ? ICON_PLAY : ICON_PAUSE));
    setAttr(this.pauseBtn, 'aria-label', p ? 'Resume' : 'Pause');
    setAttr(this.pauseBtn, 'aria-pressed', String(p));
    for (const b of this.speedBtns) setAttr(b, 'aria-pressed', String(Number(b.dataset.speed) === this.game.speed && !p));
  }

  toggleTab(tab: string) {
    this.game.audio.click();
    if (this.openTab === tab) this.closeSheet();
    else this.openSheet(tab);
  }

  openSheet(tab: string) {
    this.openTab = tab;
    for (const b of this.tabs) setAttr(b, 'aria-current', b.dataset.tab === tab ? 'page' : null);
    if (tab === 'colony') this.tabs[0].querySelector('.dot')?.setAttribute('hidden', '');
    this.sheet.hidden = false;
    document.body.classList.add('sheet-open');
    this.renderPanel(tab);
    this.layout();
  }

  private renderPanel(tab: string) {
    const panel = PANELS[tab];
    setText(this.sheetTitle, panel.title);
    let body: HTMLElement;
    try {
      body = panel.render(this.ctx);
    } catch (err) {
      reportError(err, `${panel.title} panel`);
      body = h('p', { class: 'note', text: `This panel could not be shown. Close it with ✕ and the game carries on.` });
    }
    body.dataset.panel = tab;
    this.sheetBody.replaceChildren(body);
  }

  closeSheet() {
    if (!this.openTab) return;
    this.openTab = null;
    for (const b of this.tabs) setAttr(b, 'aria-current', null);
    this.sheet.hidden = true;
    document.body.classList.remove('sheet-open');
    this.hooks.save();
    this.layout();
  }

  private confirmWorld(replay: boolean) {
    const seed = this.game.sim.seed;
    openModal({
      id: replay ? 'confirm-replay' : 'confirm-new',
      title: replay ? 'Replay this world?' : 'Start a new world?',
      lead: replay
        ? `Your colony restarts from a single cell on the same terrain (seed ${seed}). Lifetime statistics are kept.`
        : 'A new terrain is generated and your colony restarts from a single cell. Lifetime statistics are kept.',
      actions: [
        { label: replay ? 'Replay' : 'New world', kind: 'primary', id: 'confirm', onClick: () => {
          this.hooks.newWorld(replay ? seed : undefined);
          this.closeSheet();
          this.banner.show(replay ? 'Replaying' : 'New world', `Seed ${this.game.sim.seed}`);
        } },
        { label: 'Cancel', kind: 'ghost', id: 'cancel' },
      ],
    });
  }

  private confirmReset() {
    const check = h('input', { type: 'checkbox', id: 'reset-check' });
    const m = openModal({
      id: 'confirm-reset',
      title: 'Reset all progress?',
      lead: 'This deletes your colony, statistics and settings on this device. It cannot be undone.',
      body: [h('label', { class: 'check', for: 'reset-check' }, check, h('span', { text: 'I understand everything will be deleted' }))],
      actions: [
        { label: 'Delete everything', kind: 'danger', id: 'confirm', disabled: true, onClick: () => this.hooks.reset() },
        { label: 'Cancel', kind: 'ghost', id: 'cancel' },
      ],
    });
    check.addEventListener('change', () => {
      const b = m.button('confirm');
      if (b) b.disabled = !check.checked;
    });
  }

  showIntro() {
    if (this.game.settings.introSeen) return;
    this.tip.show('This is your colony. It grows on its own: every cell follows a few simple local rules. Watch what shapes appear.', () => {
      this.game.settings.introSeen = true;
      this.hooks.save();
    });
  }

  /** Per animation frame. */
  frame(dt: number) {
    this.fps += (1 / Math.max(1e-3, dt) - this.fps) * 0.05;
    // Ease the playfield toward its target (panel open/close) instead of jumping.
    const k = 1 - Math.exp(-dt * 14);
    const p = this.play;
    const t = this.playTarget;
    if (Math.abs(p.h - t.h) > 0.5 || Math.abs(p.y - t.y) > 0.5 || p.w !== t.w) {
      p.x = t.x;
      p.w = t.w;
      p.y += (t.y - p.y) * k;
      p.h += (t.h - p.h) * k;
      if (Math.abs(p.h - t.h) <= 0.5) Object.assign(p, t);
      this.renderer.resize(window.innerWidth, window.innerHeight, p);
    }
    for (const e of this.game.events.splice(0)) {
      if (e.type === 'scale') this.banner.show(`Scale ${e.level + 1}`, 'The world widens');
      else if (e.type === 'filled') this.onFilled();
    }
    this.refreshTimer += dt;
    if (this.refreshTimer < 0.2) return;
    this.refreshTimer = 0;
    this.refreshHud();
    if (this.openTab) {
      try {
        PANELS[this.openTab].refresh?.(this.ctx, this.sheetBody);
      } catch (err) {
        reportError(err, `${PANELS[this.openTab].title} panel`);
      }
    }
    this.refreshDiag();
  }

  private onFilled() {
    this.tabs[0].querySelector('.dot')?.removeAttribute('hidden');
    openModal({
      id: 'filled',
      title: 'Every reachable cell is alive',
      lead: `Your colony filled its world with ${fmt(this.game.sim.player.population)} cells. In later builds, biomass, rivals and evolution give it reasons to stop, fight and change. For now, start a new world to watch another one grow.`,
      actions: [
        { label: 'New world', kind: 'primary', id: 'new', onClick: () => this.hooks.newWorld() },
        { label: 'Keep watching', kind: 'ghost', id: 'stay' },
      ],
    });
  }

  refreshHud() {
    const g = this.game;
    const c = g.sim.player;
    setText(this.hud.popV, fmt(c.population));
    const r = g.sim.birthRate();
    setText(this.hud.popR, `+${r < 10 ? r.toFixed(1) : fmt(r)}/s`);
    const share = g.sim.territoryFraction();
    setText(this.hud.terV, share > 0 && share < 0.01 ? '<1%' : fmtPct(share));
    setText(this.hud.terR, `${fmt(c.population)} of ${fmt(g.sim.openCells)}`);
    const st = g.status();
    setText(this.hud.stV, st);
    setText(this.hud.stR, `Scale ${g.camera.level + 1} · ${g.paused ? 'paused' : `${g.speed}×`}`);
    this.hud.status.classList.toggle('filled', st === 'Filled');
  }

  private refreshDiag() {
    const g = this.game;
    const on = g.settings.diagnostics;
    this.diag.hidden = !on;
    if (!on) return;
    const s = g.sim;
    const w = s.world;
    s.traceNext = true;
    const tr = s.lastTrace;
    let trace = 'decision: —';
    if (tr) {
      const x = tr.cell % w.width;
      const y = (tr.cell / w.width) | 0;
      trace = `decision @${x},${y}: ${tr.success ? 'divided' : 'failed'}\n` +
        tr.options.map((o, k) => ` ${k === tr.chosen ? '▸' : ' '}${DIRS[o.dir]} pick ${(o.weight * 100).toFixed(0).padStart(3)}%  ok ${(o.accept * 100).toFixed(0).padStart(3)}%`).join('\n');
    }
    setText(this.diag, [
      `fps ${this.fps.toFixed(0)}  draw ${this.renderer.info.drawMs.toFixed(1)}ms  cells ${this.renderer.info.cellsDrawn}`,
      `tick ${s.tick}  ${g.tickRate.toFixed(1)}/s  ${g.tickMs.toFixed(2)}ms`,
      `population ${s.player.population}  frontier ${w.activeCount}`,
      `births ${s.birthRate().toFixed(1)}/s  anims ${g.anims.count}`,
      `seed ${s.seed}  view ${g.camera.cells.toFixed(0)} cells`,
      trace,
    ].join('\n'));
  }
}
