// Boot: load (or recover) the save, start the loop, autosave, pause when hidden.

import './styles.css';
import { SAVE } from './config/balance';
import { Game } from './game';
import { load, save, wipe, type StorageLike } from './persist/save';
import { Renderer } from './render/renderer';
import { refreshStats } from './sim/faction';
import { createSettings } from './state';
import { App } from './ui/app';
import { installGlobalHandlers, reportError } from './ui/errors';

function storage(): StorageLike {
  try {
    const s = window.localStorage;
    const k = '__assimilate_probe';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    // Private mode / blocked storage: keep the game playable in memory.
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
  }
}

function boot() {
  const store = storage();
  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const loaded = load(store);
  const snap = loaded.snapshot;
  const game = new Game(snap?.world ?? null, snap?.scale ?? 0, snap?.settings ?? createSettings(prefersReduced), snap?.stats);

  let lastSaved = 0;
  // Set while wiping progress, so the unload handler can't write the old game back.
  let resetting = false;
  const doSave = () => {
    if (resetting) return false;
    const ok = save(store, { world: game.world, scale: game.camera.level, settings: game.settings, stats: game.stats }, Date.now());
    if (ok) lastSaved = Date.now();
    return ok;
  };

  const canvas = document.getElementById('field') as HTMLCanvasElement;
  const renderer = new Renderer(canvas);
  const applySettings = () => {
    const st = game.settings;
    game.audio.setVolume(st.volume, !st.sound);
    document.documentElement.classList.toggle('reduced-motion', st.reducedMotion);
  };

  const app = new App(game, renderer, {
    save: doSave,
    lastSavedAt: () => lastSaved,
    applySettings,
    newRun: () => {
      game.newRun();
      doSave();
    },
    reset: () => {
      resetting = true;
      wipe(store);
      window.location.reload();
    },
  });
  applySettings();
  app.layout(true);
  window.addEventListener('resize', () => app.layout(true));
  app.refreshHud();

  if (loaded.source === 'backup') app.toasts.show('Recovered progress from backup save', 'good');
  else if (loaded.corrupt) app.toasts.show('Save was unreadable — started fresh', 'bad');
  else if (loaded.outdated) app.toasts.show('Assimilate was redesigned — your old game couldn\u2019t carry over');
  if (game.world.ended) app.onDefeat();
  app.showIntro();
  doSave();

  // Audio can only start after a user gesture.
  const unlockAudio = () => game.audio.unlock();
  window.addEventListener('pointerdown', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio);

  let last = performance.now();
  let saveTimer = 0;
  let hidden = false;
  const frame = (now: number) => {
    // Schedule the next frame first, so one failure can never freeze the game.
    requestAnimationFrame(frame);
    const raw = (now - last) / 1000;
    last = now;
    if (hidden) return;
    try {
      // Clamp long stalls: the run just resumes (offline progress comes later).
      const dt = Math.min(0.1, raw);
      game.update(dt, now);
      app.frame(dt);
      renderer.draw(game.camera, game.world, game.anims, now, game.simTime());
      saveTimer += dt;
      if (saveTimer >= SAVE.autosaveSeconds) {
        saveTimer = 0;
        doSave();
      }
    } catch (err) {
      reportError(err, 'Frame');
    }
  };
  requestAnimationFrame(frame);

  const onHide = () => {
    if (hidden) return;
    hidden = true;
    doSave();
    game.audio.suspend();
  };
  const onShow = () => {
    if (!hidden) return;
    hidden = false;
    last = performance.now();
    game.audio.resume();
  };
  document.addEventListener('visibilitychange', () => (document.hidden ? onHide() : onShow()));
  window.addEventListener('pagehide', onHide);
  window.addEventListener('pageshow', (e) => { if ((e as PageTransitionEvent).persisted) onShow(); });

  // Test hooks (only with ?debug in the URL).
  if (new URLSearchParams(location.search).has('debug')) {
    // grant(factionId, levels): set upgrade levels directly, for tests and experiments.
    const grant = (id: number, levels: Record<string, number>) => {
      const f = game.world.factions.get(id);
      if (!f) return;
      f.levels = { ...f.levels, ...levels };
      refreshStats(f);
    };
    (window as unknown as Record<string, unknown>).__assimilate = { game, app, renderer, save: doSave, store, grant };
  }
}

installGlobalHandlers();
try {
  boot();
} catch (err) {
  console.error(err);
  const div = document.createElement('div');
  div.className = 'fatal';
  div.textContent = 'Assimilate could not start on this device. Please try another browser.';
  document.body.append(div);
}
