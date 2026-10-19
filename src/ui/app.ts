// App shell: HUD, simulation controls, tabs + sheet panels, dialogs and the diagnostics overlay.

import type { Game } from '../game';
import type { Rect } from '../render/camera';
import type { Renderer } from '../render/renderer';
import { anyAffordable } from '../sim/economy';
import { fmt, fmtDuration } from '../util/format';
import type { Panel, UiContext } from './context';
import { h, setAttr, setText, svg } from './dom';
import { reportError } from './errors';
import { Banner, closeTopModal, modalOpen, openModal, Tip, Toasts } from './overlay';
import { prestigePanel } from './panels/prestige';
import { settingsPanel } from './panels/settings';
import { statsPanel } from './panels/stats';
import { territoryPanel } from './panels/territory';
import { upgradesPanel } from './panels/upgrades';
import { PROFILE_BY_ID } from '../config/profiles';
import { LANDMARK_TYPES } from '../sim/terrain';

const PANELS: Record<string, Panel> = {
  territory: territoryPanel,
  upgrades: upgradesPanel,
  prestige: prestigePanel,
  stats: statsPanel,
  settings: settingsPanel,
};

const ICON_PAUSE = '<rect x="6.5" y="5" width="3.5" height="14" rx="1" class="fill"/><rect x="14" y="5" width="3.5" height="14" rx="1" class="fill"/>';
const ICON_PLAY = '<path d="M8 5.5v13l10.5-6.5z" class="fill"/>';

export interface AppHooks {
  save: () => boolean;
  lastSavedAt: () => number;
  applySettings: () => void;
  newRun: () => void;
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
  private readonly recenterBtn = document.getElementById('recenter-btn') as HTMLButtonElement;
  private readonly diag = document.getElementById('diag')!;
  private readonly hud = {
    enV: document.querySelector('#stat-energy [data-v]')!,
    enR: document.querySelector('#stat-energy [data-r]')!,
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
  private refSize = 1;
  private controlsH = 64;
  readonly ctx: UiContext;

  constructor(private readonly game: Game, private readonly renderer: Renderer, private readonly hooks: AppHooks) {
    this.ctx = {
      game,
      toasts: this.toasts,
      save: hooks.save,
      lastSavedAt: hooks.lastSavedAt,
      applySettings: hooks.applySettings,
      confirmNewRun: () => this.confirmNewRun(),
      confirmReset: () => this.confirmReset(),
      rerender: () => this.openTab && this.renderPanel(this.openTab),
      memory: {},
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
    this.recenterBtn.addEventListener('click', () => {
      game.camera.recenter();
      game.audio.click();
    });
    this.bindCameraGestures();
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
    document.documentElement.style.setProperty('--sheet-px', `${sheetH}px`);
    const bottom = H - navH - Math.max(controlsH, sheetH);
    const pad = 6;
    this.playTarget = { x: pad, y: hudB, w: W - pad * 2, h: Math.max(60, bottom - hudB) };
    if (snap) this.play = { ...this.playTarget };
    // Zoom reference: the battlefield's narrow side as if no panel were open.
    // The controls bar is hidden while a panel is open, so remember its height from when it showed.
    const ctlH = document.getElementById('controls')!.getBoundingClientRect().height;
    if (ctlH > 0) this.controlsH = ctlH;
    const fullH = H - navH - this.controlsH - hudB;
    this.refSize = Math.min(W - pad * 2, Math.max(60, fullH));
    this.renderer.resize(W, H, this.play, this.refSize);
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
    if (tab === 'territory') this.tabs[0].querySelector('.dot')?.setAttribute('hidden', '');
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

  private confirmNewRun() {
    openModal({
      id: 'confirm-new',
      title: 'Start a new run?',
      lead: 'Your territory, energy and upgrades for this run are lost, and a new world begins. Lifetime statistics are kept.',
      actions: [
        { label: 'New run', kind: 'primary', id: 'confirm', onClick: () => this.startNewRun() },
        { label: 'Cancel', kind: 'ghost', id: 'cancel' },
      ],
    });
  }

  private startNewRun() {
    this.hooks.newRun();
    this.closeSheet();
    this.banner.show('New run', 'A fresh world');
    this.refreshHud();
  }

  /**
   * Drag to pan, pinch or scroll to zoom. Any manual move pauses following until re-centred.
   * A quick tap that barely moves plants (or removes) your rally flag.
   */
  private bindCameraGestures() {
    const canvas = document.getElementById('field') as HTMLCanvasElement;
    const pts = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    // The current gesture, while it can still count as a tap.
    let tap: { id: number; x: number; y: number; t: number } | null = null;
    const cam = () => this.game.camera;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture?.(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      tap = pts.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const pitch = cam().pitch(this.renderer.refSize);
      if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10) tap = null;
      if (pts.size === 1 && !tap) {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        if (Math.abs(dx) + Math.abs(dy) > 0) cam().panBy(-dx / pitch, -dy / pitch);
      }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && pinch > 0) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = this.renderer.screenToCell(cam(), (a.x + b.x) / 2, (a.y + b.y) / 2);
        cam().follow = false;
        cam().zoomAround(d / pinch, mid.x, mid.y);
        pinch = d;
      }
    });
    const end = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
    };
    canvas.addEventListener('pointerup', (e) => {
      const t = tap;
      end(e);
      tap = null;
      if (!t || t.id !== e.pointerId || performance.now() - t.t > 500) return;
      const at = this.renderer.screenToCell(cam(), t.x, t.y);
      const pitch = cam().pitch(this.renderer.refSize);
      // Within about 24 px of the flag counts as tapping the flag itself.
      this.game.tapFlag(Math.floor(at.x), Math.floor(at.y), Math.max(1.5, 24 / pitch));
    });
    canvas.addEventListener('pointercancel', (e) => {
      tap = null;
      end(e);
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const at = this.renderer.screenToCell(cam(), e.clientX, e.clientY);
      cam().zoomAround(Math.exp(-e.deltaY * 0.0015), at.x, at.y);
    }, { passive: false });
  }

  private confirmReset() {
    const check = h('input', { type: 'checkbox', id: 'reset-check' });
    const m = openModal({
      id: 'confirm-reset',
      title: 'Reset all progress?',
      lead: 'This deletes your current run, statistics and settings on this device. It cannot be undone.',
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
    this.tip.show('You are black. Your territory expands on its own, and so do your rivals. Tap the map to plant your flag and your territory leans that way. Gold symbols are landmarks worth holding. Spend energy on Upgrades to get stronger.', () => {
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
      this.renderer.resize(window.innerWidth, window.innerHeight, p, this.refSize);
    }
    for (const e of this.game.events.splice(0)) this.onEvent(e);
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

  private onEvent(e: Game['events'][number]) {
    const w = this.game.world;
    const name = (id: number) => {
      const f = w.factions.get(id);
      return f ? `${f.name} (${PROFILE_BY_ID[f.profile]?.name ?? 'Rival'})` : 'A rival';
    };
    switch (e.type) {
      case 'scale':
        this.banner.show(`Scale ${e.level + 1}`, 'The view widens');
        break;
      case 'contact':
        this.toasts.show(`Contact: ${name(e.faction)}`);
        this.tabs[0].querySelector('.dot')?.removeAttribute('hidden');
        break;
      case 'spawn':
        if (w.time > 1) this.toasts.show(`New rival found: ${name(e.faction)}`);
        break;
      case 'eliminated':
        this.toasts.show(`${name(e.faction)} eliminated${e.byPlayer ? ' by you' : ''}`, e.byPlayer ? 'good' : 'info');
        break;
      case 'defeat':
        this.onDefeat();
        break;
      case 'landmark': {
        const l = LANDMARK_TYPES[e.landmark];
        if (e.gained) this.toasts.show(`Captured ${l.name}: ${l.bonus}`, 'good');
        else this.toasts.show(`Lost ${l.name}${e.other ? ` to ${w.factions.get(e.other)?.name ?? 'a rival'}` : ''}`, 'bad');
        break;
      }
      case 'flag-reached':
        this.toasts.show('Flag reached. Tap the map to plant it again');
        break;
      case 'flag': {
        if (e.action !== 'planted') {
          this.toasts.show(e.action === 'removed' ? 'Flag removed' : 'Tap open ground or a rival to plant your flag');
          break;
        }
        const lm = w.terrain.landmarkAt(e.x, e.y);
        this.toasts.show(lm >= 0 ? `Flag planted on ${LANDMARK_TYPES[lm].name} (${LANDMARK_TYPES[lm].bonus})` : 'Flag planted: your territory leans this way');
        break;
      }
    }
  }

  onDefeat() {
    const w = this.game.world;
    const p = w.player;
    openModal({
      id: 'defeat',
      title: 'Your territory has fallen',
      lead: `You held up to ${fmt(p.peakCells)} cells over ${fmtDuration(w.time)}. Prestige rewards for finished runs arrive in a later update; for now, start a new run.`,
      body: [h('dl', { class: 'kv' },
        h('dt', { text: 'Open cells claimed' }), h('dd', { text: fmt(p.claimed) }),
        h('dt', { text: 'Enemy cells converted' }), h('dd', { text: fmt(p.converted) }),
        h('dt', { text: 'Energy earned' }), h('dd', { text: fmt(p.earned) }),
      )],
      dismissible: false,
      actions: [{ label: 'Start a new run', kind: 'primary', id: 'new', onClick: () => this.startNewRun() }],
    });
  }

  refreshHud() {
    const g = this.game;
    const w = g.world;
    const p = w.player;
    setText(this.hud.enV, fmt(p.energy));
    setText(this.hud.enR, `+${fmt(Math.max(0, w.energyRate()))}/s`);
    setText(this.hud.terV, fmt(p.cells));
    const cr = w.cellRate();
    setText(this.hud.terR, `${cr >= 0 ? '+' : '−'}${Math.abs(cr) < 10 ? Math.abs(cr).toFixed(1) : fmt(Math.abs(cr))}/s`);
    const st = g.status();
    setText(this.hud.stV, st);
    const rivals = w.contacts().length;
    setText(this.hud.stR, `${rivals ? `${rivals} front${rivals > 1 ? 's' : ''}` : `Scale ${g.camera.level + 1}`} · ${g.paused ? 'paused' : `${g.speed}×`}`);
    this.hud.status.classList.toggle('war', st === 'At war');
    this.hud.status.classList.toggle('losing', st === 'Losing ground');
    this.hud.status.classList.toggle('defeated', st === 'Defeated');
    this.tabs[1].querySelector('.dot')?.toggleAttribute('hidden', !anyAffordable(p));
    this.recenterBtn.hidden = !g.camera.adjusted;
  }

  private refreshDiag() {
    const g = this.game;
    const on = g.settings.diagnostics;
    this.diag.hidden = !on;
    if (!on) return;
    const w = g.world;
    const lines = [
      `fps ${this.fps.toFixed(0)}  draw ${this.renderer.info.drawMs.toFixed(1)}ms  cells ${this.renderer.info.cellsDrawn}`,
      `tick ${w.tick}  ${g.tickRate.toFixed(1)}/s  ${g.tickMs.toFixed(2)}ms  chunks ${w.grid.chunks.size}`,
      `view ${g.camera.cells.toFixed(0)} cells  anims ${g.anims.count}`,
    ];
    for (const f of w.factions.values()) {
      if (!f.alive) continue;
      lines.push(`${f.name.padEnd(6)} ${String(f.cells).padStart(6)} border ${String(f.frontier.size).padStart(5)} ${w.isDormant(f) ? 'dormant' : ''}`);
    }
    setText(this.diag, lines.join('\n'));
  }
}
