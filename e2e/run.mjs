// End-to-end UI checks in a real (headless) mobile browser: every button, panel and dialog.
// Usage: npm run build && npm run e2e   (starts `vite preview` itself)
// Screenshots for visual review are written to e2e/screenshots/.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 4181;
const APP_URL = `http://localhost:${PORT}/?debug`;
const SHOTS = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const exe = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => p && existsSync(p));
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const results = [];
const consoleErrors = [];
let currentPage = null;

async function newPage(viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.location().url.endsWith('favicon.ico')) consoleErrors.push(`${m.text()} ${m.location().url}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  currentPage = page;
  return { ctx, page };
}

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    await currentPage?.screenshot({ path: `${SHOTS}FAIL-${name.replace(/[^a-z0-9]+/gi, '-')}.png` }).catch(() => {});
    results.push({ name, ok: false, err: e.message });
    console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const G = (page, fn, arg) => page.evaluate(fn, arg);
const shot = (page, name) => page.screenshot({ path: `${SHOTS}${name}.png` });
const text = (page, sel) => page.locator(sel).first().innerText();
const pop = (page) => G(page, () => window.__assimilate.game.sim.player.population);
async function dismissTip(page) {
  const b = page.locator('#tip:not([hidden]) button');
  if (await b.count()) await b.click();
}
/** Run simulation ticks instantly (keeps tests fast and deterministic in length). */
const ticks = (page, n) => G(page, (n) => { const g = window.__assimilate.game; for (let i = 0; i < n; i++) g.sim.step(); }, n);
/** Elements must not overlap each other or leave the viewport. */
async function noOverlap(page, sels) {
  const boxes = [];
  for (const s of sels) {
    const b = await page.locator(s).first().boundingBox();
    assert(b, `${s} not visible`);
    boxes.push([s, b]);
  }
  const vp = page.viewportSize();
  for (const [s, b] of boxes) assert(b.x >= -1 && b.y >= -1 && b.x + b.width <= vp.width + 1 && b.y + b.height <= vp.height + 1, `${s} leaves the viewport`);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [sa, a] = boxes[i];
      const [sb, b] = boxes[j];
      const ov = a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
      assert(!ov, `${sa} overlaps ${sb}`);
    }
  }
}

console.log('Assimilate e2e');

// ---------- first launch ----------
{
  const { ctx, page } = await newPage();
  await page.goto(APP_URL);
  await page.waitForTimeout(600);

  await test('first launch: one black cell, intro tip, HUD at 1', async () => {
    assert((await pop(page)) >= 1, 'no starting cell');
    assert(await page.locator('#tip').isVisible(), 'intro tip not shown');
    assert((await text(page, '#stat-pop [data-v]')).trim().length > 0, 'population empty');
    await shot(page, '01-first-launch');
  });

  await test('the colony grows on its own and HUD updates', async () => {
    const a = await pop(page);
    await page.waitForTimeout(4000);
    const b = await pop(page);
    assert(b > a, `population did not grow (${a} → ${b})`);
    assert((await text(page, '#stat-pop [data-v]')) === String(b) || Number(await text(page, '#stat-pop [data-v]')) >= a, 'HUD not tracking population');
  });

  await test('intro tip dismisses and stays dismissed', async () => {
    await page.locator('#tip button').click();
    assert(await page.locator('#tip').isHidden(), 'tip still visible');
    assert(await G(page, () => window.__assimilate.game.settings.introSeen), 'introSeen not set');
  });

  await test('layout: HUD, controls and tabs do not overlap (390×844)', async () => {
    await noOverlap(page, ['#hud', '#controls .seg', '#pause-btn', '#tabs']);
    for (const b of await page.locator('#tabs button, #controls button').all()) {
      const box = await b.boundingBox();
      assert(box.height >= 38 && box.width >= 38, `touch target too small: ${await b.innerText()} ${box.width}×${box.height}`);
    }
  });

  await test('pause stops growth; resume restarts it', async () => {
    await page.locator('#pause-btn').click();
    assert((await page.locator('#pause-btn').getAttribute('aria-label')) === 'Resume', 'pause label');
    const t0 = await G(page, () => window.__assimilate.game.sim.tick);
    await page.waitForTimeout(800);
    const t1 = await G(page, () => window.__assimilate.game.sim.tick);
    assert(t0 === t1, `ticks advanced while paused (${t0} → ${t1})`);
    assert((await text(page, '#stat-status [data-v]')) === 'Paused', 'status not Paused');
    await page.locator('#pause-btn').click();
    await page.waitForTimeout(600);
    assert((await G(page, () => window.__assimilate.game.sim.tick)) > t1, 'did not resume');
  });

  await test('speed buttons change tick rate (1× ≈ 10/s, 4× ≈ 40/s)', async () => {
    const rate = async () => {
      const a = await G(page, () => window.__assimilate.game.sim.tick);
      await page.waitForTimeout(1500);
      return ((await G(page, () => window.__assimilate.game.sim.tick)) - a) / 1.5;
    };
    await page.locator('#speed [data-speed="1"]').click();
    const r1 = await rate();
    await page.locator('#speed [data-speed="4"]').click();
    assert((await page.locator('#speed [data-speed="4"]').getAttribute('aria-pressed')) === 'true', '4× not pressed');
    const r4 = await rate();
    assert(r1 > 6 && r1 < 14, `1× rate ${r1}`);
    assert(r4 > 25, `4× rate ${r4}`);
    await page.locator('#speed [data-speed="1"]').click();
  });

  await test('speed button while paused also resumes', async () => {
    await page.locator('#pause-btn').click();
    await page.locator('#speed [data-speed="2"]').click();
    assert(!(await G(page, () => window.__assimilate.game.paused)), 'still paused');
    await page.locator('#speed [data-speed="1"]').click();
  });

  await test('every tab opens its panel and closes again (tab, ✕ and Escape)', async () => {
    const tabs = ['colony', 'upgrades', 'mutations', 'evolution', 'stats', 'settings'];
    for (const t of tabs) {
      await page.locator(`#tabs [data-tab="${t}"]`).click();
      assert(await page.locator('#sheet').isVisible(), `${t}: sheet hidden`);
      assert(await page.locator(`#sheet-body [data-panel="${t}"]`).count(), `${t}: wrong panel`);
      assert((await page.locator(`#tabs [data-tab="${t}"]`).getAttribute('aria-current')) === 'page', `${t}: tab not current`);
      await shot(page, `02-panel-${t}`);
    }
    await page.locator('#tabs [data-tab="settings"]').click();
    assert(await page.locator('#sheet').isHidden(), 'tapping the open tab did not close');
    await page.locator('#tabs [data-tab="stats"]').click();
    await page.locator('#sheet-close').click();
    assert(await page.locator('#sheet').isHidden(), '✕ did not close');
    await page.locator('#tabs [data-tab="stats"]').click();
    await page.keyboard.press('Escape');
    assert(await page.locator('#sheet').isHidden(), 'Escape did not close');
  });

  await test('locked tabs explain what arrives later (no fake controls)', async () => {
    for (const t of ['upgrades', 'mutations', 'evolution']) {
      await page.locator(`#tabs [data-tab="${t}"]`).click();
      const body = await text(page, '#sheet-body');
      assert(/Arrives in Phase/.test(body), `${t}: no phase note`);
      assert((await page.locator('#sheet-body button').count()) === 0, `${t}: has buttons`);
    }
    await page.keyboard.press('Escape');
  });

  await test('panel open: controls hide and the colony stays visible above the sheet', async () => {
    await page.locator('#tabs [data-tab="colony"]').click();
    await page.waitForTimeout(500);
    assert(await page.locator('#controls').isHidden(), 'controls still visible over the sheet');
    const r = await G(page, () => {
      const a = window.__assimilate;
      const s = a.game.sim;
      const p = a.renderer.cellToScreen(a.game.camera, s.startCell % s.world.width, (s.startCell / s.world.width) | 0);
      return { y: p.y, sheetTop: document.getElementById('sheet').getBoundingClientRect().top };
    });
    assert(r.y < r.sheetTop, `start cell (${r.y}) hidden behind sheet (${r.sheetTop})`);
    await page.keyboard.press('Escape');
  });

  await test('colony panel values update live', async () => {
    await page.locator('#tabs [data-tab="colony"]').click();
    const a = await text(page, '[data-k="pop"]');
    await ticks(page, 80);
    await page.waitForTimeout(400);
    const b = await text(page, '[data-k="pop"]');
    assert(a !== b, `living cells did not update (${a})`);
    await page.keyboard.press('Escape');
  });

  await test('zoom milestone: scale changes smoothly and shows a banner', async () => {
    const lv0 = await G(page, () => window.__assimilate.game.camera.level);
    await ticks(page, 400);
    await page.waitForTimeout(300);
    const st = await G(page, () => ({ level: window.__assimilate.game.camera.level, animating: window.__assimilate.game.camera.animating }));
    assert(st.level > lv0, 'no zoom after growth');
    assert(st.animating, 'zoom snapped instead of animating');
    assert(/Scale/.test(await text(page, '#banner')), 'no scale banner');
    await page.waitForTimeout(3000);
    assert(!(await G(page, () => window.__assimilate.game.camera.animating)), 'zoom never finished');
    await shot(page, '03-after-zoom');
  });

  await test('settings: toggles persist after reload', async () => {
    await page.locator('#tabs [data-tab="settings"]').click();
    await page.locator('button[role=switch][aria-label="Sound"]').click();
    await page.locator('button[role=switch][aria-label="Reduce motion"]').click();
    await page.locator('button[role=switch][aria-label="Diagnostics"]').click();
    await page.waitForTimeout(400);
    assert(await page.locator('#diag').isVisible(), 'diagnostics overlay not shown');
    assert(/frontier/.test(await text(page, '#diag')), 'diagnostics empty');
    await page.reload();
    await page.waitForTimeout(500);
    const s = await G(page, () => window.__assimilate.game.settings);
    assert(s.sound === false && s.reducedMotion === true && s.diagnostics === true, `settings lost: ${JSON.stringify(s)}`);
    assert(await page.locator('#tip').isHidden(), 'intro reappeared after reload');
    await shot(page, '04-diagnostics');
    await page.locator('#tabs [data-tab="settings"]').click();
    await page.locator('button[role=switch][aria-label="Diagnostics"]').click();
    await page.locator('button[role=switch][aria-label="Sound"]').click();
    await page.locator('button[role=switch][aria-label="Reduce motion"]').click();
    assert(await page.locator('#diag').isHidden(), 'diagnostics did not hide');
  });

  await test('progress survives reload (population, seed, scale)', async () => {
    await ticks(page, 50);
    const before = await G(page, () => ({ pop: window.__assimilate.game.sim.player.population, seed: window.__assimilate.game.sim.seed, level: window.__assimilate.game.camera.level }));
    await G(page, () => window.__assimilate.save());
    await page.reload();
    await page.waitForTimeout(300);
    const after = await G(page, () => ({ pop: window.__assimilate.game.sim.player.population, seed: window.__assimilate.game.sim.seed, level: window.__assimilate.game.camera.level }));
    assert(after.seed === before.seed, 'seed changed');
    assert(after.pop >= before.pop, `population lost (${before.pop} → ${after.pop})`);
    // The colony keeps growing until the page unloads, so the scale can only stay or rise.
    assert(after.level >= before.level, 'scale lost');
  });

  await test('Rule Lab: sliders change the live rules, persist, and restore', async () => {
    await page.locator('#tabs [data-tab="settings"]').click();
    await page.locator('[data-action="toggle-lab"]').click();
    const slider = page.locator('input[data-trait="branching"]');
    await slider.fill('3');
    assert((await G(page, () => window.__assimilate.game.sim.player.traits.branching)) === 3, 'trait not applied');
    await page.locator('[data-action="toggle-lab"]').click();
    await page.reload();
    await page.waitForTimeout(300);
    assert((await G(page, () => window.__assimilate.game.sim.player.traits.branching)) === 3, 'trait not persisted');
    await page.locator('#tabs [data-tab="settings"]').click();
    await page.locator('[data-action="toggle-lab"]').click();
    await page.locator('[data-action="reset-rules"]').click();
    const def = await G(page, () => [window.__assimilate.game.sim.player.traits.branching, window.__assimilate.game.settings.customTraits]);
    assert(def[0] !== 3 && def[1] === null, 'rules not restored');
    await page.keyboard.press('Escape');
  });

  await test('replay world: cancel keeps the colony; confirm restarts same seed from one cell', async () => {
    await page.locator('#tabs [data-tab="colony"]').click();
    const seed = await G(page, () => window.__assimilate.game.sim.seed);
    const p0 = await pop(page);
    await page.locator('[data-action="replay"]').click();
    await page.locator('[data-id="confirm-replay"] [data-action="cancel"]').click();
    assert((await pop(page)) >= p0, 'cancel changed the colony');
    assert(await page.locator('#sheet').isVisible(), 'cancel closed the panel');
    await page.locator('[data-action="replay"]').click();
    await page.locator('[data-id="confirm-replay"] [data-action="confirm"]').click();
    const r = await G(page, () => ({ seed: window.__assimilate.game.sim.seed, pop: window.__assimilate.game.sim.player.population, level: window.__assimilate.game.camera.level }));
    assert(r.seed === seed, 'replay changed the seed');
    assert(r.pop <= 3 && r.level === 0, `replay did not restart (${r.pop}, scale ${r.level})`);
    assert(await page.locator('#sheet').isHidden(), 'sheet still open');
  });

  await test('new world: tapping outside the dialog dismisses; confirm makes a new seed', async () => {
    const seed = await G(page, () => window.__assimilate.game.sim.seed);
    await page.locator('#tabs [data-tab="colony"]').click();
    await page.locator('[data-action="new-world"]').click();
    await page.mouse.click(10, 10);
    assert((await page.locator('.modal').count()) === 0, 'backdrop did not dismiss');
    await page.locator('[data-action="new-world"]').click();
    await page.locator('[data-id="confirm-new"] [data-action="confirm"]').click();
    assert((await G(page, () => window.__assimilate.game.sim.seed)) !== seed, 'seed unchanged');
    const st = await G(page, () => window.__assimilate.game.stats.worldsStarted);
    assert(st >= 3, `worlds started not counted (${st})`);
  });

  await test('filled world shows a dismissible dialog with working actions', async () => {
    await G(page, () => window.__assimilate.game.events.push({ type: 'filled' }));
    await page.waitForTimeout(300);
    assert(await page.locator('[data-id="filled"]').isVisible(), 'filled dialog missing');
    await shot(page, '05-filled');
    await page.locator('[data-id="filled"] [data-action="stay"]').click();
    assert((await page.locator('.modal').count()) === 0, 'dialog did not close');
    assert(await page.locator('#tabs [data-tab="colony"] .dot').isVisible(), 'colony tab badge missing');
  });

  await test('stats panel shows and updates numbers', async () => {
    await page.locator('#tabs [data-tab="stats"]').click();
    const a = await text(page, '[data-k="born"]');
    await ticks(page, 120);
    await page.waitForTimeout(400);
    assert(a !== (await text(page, '[data-k="born"]')), 'stats not updating');
    assert(Number.parseInt(await text(page, '[data-k="worlds"]')) >= 3, 'worlds stat wrong');
    await page.keyboard.press('Escape');
  });

  await test('reset requires the checkbox, cancel keeps progress, confirm wipes everything', async () => {
    await page.locator('#tabs [data-tab="settings"]').click();
    await page.locator('[data-action="reset"]').click();
    const del = page.locator('[data-id="confirm-reset"] [data-action="confirm"]');
    assert(await del.isDisabled(), 'delete enabled without checkbox');
    await page.locator('[data-id="confirm-reset"] [data-action="cancel"]').click();
    const worlds = await G(page, () => window.__assimilate.game.stats.worldsStarted);
    assert(worlds >= 3, 'cancel reset progress');
    await page.locator('[data-action="reset"]').click();
    await page.locator('#reset-check').check();
    assert(await del.isEnabled(), 'delete still disabled');
    await Promise.all([page.waitForNavigation(), del.click()]);
    await page.waitForTimeout(400);
    const s = await G(page, () => ({ worlds: window.__assimilate.game.stats.worldsStarted, intro: window.__assimilate.game.settings.introSeen }));
    assert(s.worlds === 1 && !s.intro, `not reset: ${JSON.stringify(s)}`);
    assert(await page.locator('#tip').isVisible(), 'intro tip should return after reset');
  });

  await ctx.close();
}

// ---------- error resilience ----------
{
  const { ctx, page } = await newPage();
  await page.goto(APP_URL);
  await page.waitForTimeout(400);
  await test('an error never freezes the game: it is shown, dismissible, and the loop keeps running', async () => {
    const errorsBefore = consoleErrors.length;
    await dismissTip(page);
    // Make the next frame throw once.
    await G(page, () => {
      const g = window.__assimilate.game;
      const orig = g.update.bind(g);
      let once = true;
      g.update = (...a) => { if (once) { once = false; throw new Error('test failure'); } return orig(...a); };
    });
    await page.waitForTimeout(500);
    assert(await page.locator('.error-card').isVisible(), 'no error card');
    assert(/test failure/.test(await text(page, '.error-card code')), 'error text missing');
    const t0 = await G(page, () => window.__assimilate.game.sim.tick);
    await page.waitForTimeout(600);
    assert((await G(page, () => window.__assimilate.game.sim.tick)) > t0, 'loop stopped after the error');
    await page.locator('#tabs [data-tab="settings"]').click();
    assert(await page.locator('#sheet').isVisible(), 'tabs stopped working');
    await page.locator('.error-card button:has-text("Dismiss")').click();
    assert((await page.locator('.error-card').count()) === 0, 'error card did not dismiss');
    consoleErrors.length = errorsBefore;
  });
  await ctx.close();
}

// ---------- corrupted save ----------
{
  const { ctx, page } = await newPage();
  // Plant the broken save before the app's first script runs (a reload would save over it).
  await ctx.addInitScript(() => {
    if (!sessionStorage.getItem('planted')) {
      sessionStorage.setItem('planted', '1');
      localStorage.setItem('assimilate.save', '{broken');
    }
  });
  await page.goto(APP_URL);
  await page.waitForTimeout(400);
  await test('corrupted save: starts fresh with a message, no crash', async () => {
    assert((await pop(page)) >= 1, 'no colony');
    assert(/unreadable/i.test(await text(page, '#toasts')), 'no corruption message');
  });
  await ctx.close();
}

// ---------- small phone ----------
{
  const { ctx, page } = await newPage({ width: 320, height: 568 });
  await page.goto(APP_URL);
  await page.waitForTimeout(500);
  await test('small phone (320×568): no overlaps, readable, panels scroll', async () => {
    await dismissTip(page);
    await noOverlap(page, ['#hud', '#controls .seg', '#pause-btn', '#tabs']);
    for (const s of ['#stat-pop', '#stat-territory', '#stat-status']) {
      const fs = await page.locator(`${s} .stat-label`).evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
      assert(fs >= 9.5, `${s} label too small (${fs}px)`);
    }
    await page.locator('#tabs [data-tab="settings"]').click();
    const scrollable = await page.locator('#sheet-body').evaluate((e) => e.scrollHeight > e.clientHeight);
    assert(scrollable, 'settings should scroll on a small phone');
    await page.locator('#sheet-body').evaluate((e) => (e.scrollTop = e.scrollHeight));
    assert(await page.locator('[data-action="reset"]').isVisible(), 'reset not reachable by scrolling');
    await shot(page, '06-small-settings');
    await page.locator('#sheet-close').click();
    await shot(page, '07-small-phone');
  });
  await ctx.close();
}

// ---------- performance ----------
{
  const { ctx, page } = await newPage();
  await page.goto(APP_URL);
  await page.waitForTimeout(300);
  await test('large colony stays responsive (simulation + drawing budget)', async () => {
    await dismissTip(page);
    const r = await G(page, async () => {
      const a = window.__assimilate;
      const s = a.game.sim;
      const t0 = performance.now();
      while (s.player.population < 15000 && s.tick < 20000) s.step();
      const simMs = (performance.now() - t0) / s.tick;
      await new Promise((res) => setTimeout(res, 3500));
      const samples = [];
      for (let i = 0; i < 30; i++) {
        await new Promise((res) => requestAnimationFrame(res));
        samples.push(a.renderer.info.drawMs);
      }
      samples.sort((x, y) => x - y);
      return { pop: s.player.population, simMs, drawMs: samples[15], level: a.game.camera.level };
    });
    console.log(`      population ${r.pop}, ${r.simMs.toFixed(2)} ms/tick, draw ${r.drawMs.toFixed(1)} ms (median), scale ${r.level + 1}`);
    assert(r.pop >= 15000, 'did not grow large');
    assert(r.simMs < 4, `ticks too slow: ${r.simMs} ms`);
    assert(r.drawMs < 12, `drawing too slow: ${r.drawMs} ms`);
    await shot(page, '08-large-colony');
  });
  await ctx.close();
}

await test('no console errors', async () => {
  assert(consoleErrors.length === 0, consoleErrors.join('\n'));
});

await browser.close();
server.kill();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
