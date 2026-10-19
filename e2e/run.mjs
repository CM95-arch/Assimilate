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
const cells = (page) => G(page, () => window.__assimilate.game.world.player.cells);
const energy = (page) => G(page, () => window.__assimilate.game.world.player.energy);
const setEnergy = (page, v) => G(page, (v) => { const p = window.__assimilate.game.world.player; p.energy = v; p.earned = Math.max(p.earned, v); }, v);
async function dismissTip(page) {
  const b = page.locator('#tip:not([hidden]) button');
  if (await b.count()) await b.click();
}
/** Run simulation ticks instantly (keeps tests fast and deterministic in length). */
const ticks = (page, n) => G(page, (n) => { const g = window.__assimilate.game; for (let i = 0; i < n && !g.world.ended; i++) g.world.step(); }, n);
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

// ---------- first launch and core loop ----------
{
  const { ctx, page } = await newPage();
  await page.goto(APP_URL);
  await page.waitForTimeout(600);

  await test('first launch: a 5–9 cell black cluster, two rivals, starting energy, intro tip', async () => {
    const s = await G(page, () => {
      const w = window.__assimilate.game.world;
      return { cells: w.player.cells, factions: w.factions.size, energy: w.player.energy };
    });
    assert(s.cells >= 5 && s.cells <= 12, `player starts with ${s.cells} cells`);
    assert(s.factions === 3, `expected 2 rivals, got ${s.factions - 1}`);
    assert(s.energy >= 8, 'not enough energy for a first upgrade');
    assert(await page.locator('#tip').isVisible(), 'intro tip not shown');
    assert(await page.locator('#tabs [data-tab="upgrades"] .dot').isVisible(), 'upgrades badge not shown with affordable upgrade');
    await shot(page, '01-first-launch');
  });

  await test('territory expands about once every three seconds and the HUD tracks it', async () => {
    const a = await cells(page);
    await page.waitForTimeout(9000);
    const b = await cells(page);
    assert(b - a >= 1 && b - a <= 7, `expected ~3 captures in 9s, got ${b - a}`);
    assert(Number((await text(page, '#stat-territory [data-v]')).replace(/\D/g, '')) >= a, 'HUD territory not updating');
  });

  await test('intro tip dismisses and stays dismissed', async () => {
    await page.locator('#tip button').click();
    assert(await page.locator('#tip').isHidden(), 'tip still visible');
    assert(await G(page, () => window.__assimilate.game.settings.introSeen), 'introSeen not set');
  });

  await test('layout: HUD, controls and tabs do not overlap; touch targets are large enough', async () => {
    await noOverlap(page, ['#hud', '#controls .seg', '#pause-btn', '#tabs']);
    for (const b of await page.locator('#tabs button, #controls button:visible').all()) {
      const box = await b.boundingBox();
      assert(box.height >= 38 && box.width >= 38, `touch target too small: ${box.width}×${box.height}`);
    }
  });

  await test('pause stops the world; resume restarts it', async () => {
    await page.locator('#pause-btn').click();
    const t0 = await G(page, () => window.__assimilate.game.world.tick);
    await page.waitForTimeout(700);
    assert(t0 === (await G(page, () => window.__assimilate.game.world.tick)), 'ticks advanced while paused');
    assert((await text(page, '#stat-status [data-v]')) === 'Paused', 'status not Paused');
    await page.locator('#pause-btn').click();
    await page.waitForTimeout(500);
    assert((await G(page, () => window.__assimilate.game.world.tick)) > t0, 'did not resume');
  });

  await test('speed buttons change tick rate (1× ≈ 10/s, 4× ≈ 40/s)', async () => {
    const rate = async () => {
      const a = await G(page, () => window.__assimilate.game.world.tick);
      await page.waitForTimeout(1500);
      return ((await G(page, () => window.__assimilate.game.world.tick)) - a) / 1.5;
    };
    await page.locator('#speed [data-speed="1"]').click();
    const r1 = await rate();
    await page.locator('#speed [data-speed="4"]').click();
    const r4 = await rate();
    assert(r1 > 6 && r1 < 14, `1× rate ${r1}`);
    assert(r4 > 25, `4× rate ${r4}`);
    await page.locator('#speed [data-speed="1"]').click();
  });

  await test('buying an upgrade: spends energy, raises level and stats, updates the card', async () => {
    // Freeze the world so energy can't trickle in between setting it and clicking.
    await G(page, () => { window.__assimilate.game.paused = true; });
    await page.locator('#tabs [data-tab="upgrades"]').click();
    await setEnergy(page, 100);
    await page.waitForTimeout(300);
    const before = await G(page, () => window.__assimilate.game.world.player.stats.rate);
    const e0 = await energy(page);
    await page.locator('[data-buy="rate"]').click();
    const s = await G(page, () => ({ lv: window.__assimilate.game.world.player.levels.rate, rate: window.__assimilate.game.world.player.stats.rate }));
    assert(s.lv === 1, `level ${s.lv}`);
    assert(s.rate > before, 'stat did not change');
    assert((await energy(page)) < e0, 'energy not spent');
    assert(/Lv 1/.test(await text(page, '[data-upgrade="rate"] .lv')), 'card level not updated');
    await shot(page, '02-upgrades');
  });

  await test('unaffordable purchase is refused with a reason and costs nothing', async () => {
    await page.locator('.chip[data-cat="combat"]').click();
    await setEnergy(page, 0);
    await page.waitForTimeout(300);
    assert((await page.locator('[data-buy="power"]').getAttribute('aria-disabled')) === 'true', 'button not marked disabled');
    assert(/Need/.test(await text(page, '[data-buy="power"]')), 'no "Need N more" hint');
    // A person can still tap a greyed-out button; force past Playwright's aria-disabled wait.
    await page.locator('[data-buy="power"]').click({ force: true });
    assert(/Need .* more energy/.test(await text(page, '#toasts')), 'no refusal toast');
    assert(!(await G(page, () => window.__assimilate.game.world.player.levels.power)), 'bought anyway');
  });

  await test('×10 and Max buy several levels at once', async () => {
    await setEnergy(page, 1e6);
    await page.locator('.seg button', { hasText: /^×10$/ }).click();
    await page.waitForTimeout(250);
    assert(/Buy 10/.test(await text(page, '[data-buy="power"]')), '×10 not quoted');
    await page.locator('[data-buy="power"]').click();
    assert((await G(page, () => window.__assimilate.game.world.player.levels.power)) === 10, '×10 did not buy 10');
    await setEnergy(page, 500);
    await page.locator('.seg button:has-text("Max")').click();
    await page.locator('.chip[data-cat="defense"]').click();
    await page.locator('[data-buy="resistance"]').click();
    const lv = await G(page, () => window.__assimilate.game.world.player.levels.resistance);
    assert(lv > 1, `Max bought ${lv}`);
    assert((await energy(page)) >= 0, 'energy went negative');
    await page.locator('.seg button', { hasText: /^×1$/ }).click();
    await G(page, () => { window.__assimilate.game.paused = false; });
  });

  await test('categories switch; locked upgrades say how to unlock them', async () => {
    await G(page, () => { const p = window.__assimilate.game.world.player; p.earned = 0; });
    for (const c of ['combat', 'defense', 'economy', 'expansion']) {
      await page.locator(`.chip[data-cat="${c}"]`).click();
      assert((await page.locator(`.chip[data-cat="${c}"]`).getAttribute('aria-pressed')) === 'true', `${c} chip not active`);
      assert((await page.locator('[data-upgrade]').count()) > 0, `${c}: no cards`);
    }
    await page.locator('.chip[data-cat="defense"]').click();
    assert(/Unlocks after earning/.test(await text(page, '#sheet-body')), 'no unlock hint');
    await G(page, () => { const p = window.__assimilate.game.world.player; p.earned = 1e6; });
    await page.waitForTimeout(400);
    assert((await page.locator('.card.locked').count()) === 0, 'cards did not unlock live');
    await page.keyboard.press('Escape');
  });

  await test('every tab opens its panel and closes (same tab, ✕, Escape)', async () => {
    for (const t of ['territory', 'upgrades', 'prestige', 'stats', 'settings']) {
      await page.locator(`#tabs [data-tab="${t}"]`).click();
      assert(await page.locator(`#sheet-body [data-panel="${t}"]`).count(), `${t}: wrong panel`);
      await shot(page, `03-panel-${t}`);
    }
    await page.locator('#tabs [data-tab="settings"]').click();
    assert(await page.locator('#sheet').isHidden(), 'same tab did not close');
    await page.locator('#tabs [data-tab="stats"]').click();
    await page.locator('#sheet-close').click();
    assert(await page.locator('#sheet').isHidden(), '✕ did not close');
    await page.locator('#tabs [data-tab="stats"]').click();
    await page.keyboard.press('Escape');
    assert(await page.locator('#sheet').isHidden(), 'Escape did not close');
  });

  await test('prestige is an honest preview with no fake controls', async () => {
    await page.locator('#tabs [data-tab="prestige"]').click();
    assert(/later update/.test(await text(page, '#sheet-body')), 'no preview note');
    assert((await page.locator('#sheet-body button').count()) === 0, 'has buttons');
    await page.keyboard.press('Escape');
  });

  await test('opening a panel keeps the zoom and keeps your territory in view', async () => {
    // Compare the zoom reference rather than the pitch: an automatic scale step may happen meanwhile.
    const before = await G(page, () => window.__assimilate.renderer.refSize);
    await page.locator('#tabs [data-tab="territory"]').click();
    await page.waitForTimeout(600);
    const after = await G(page, () => window.__assimilate.renderer.refSize);
    assert(Math.abs(before - after) < 0.5, `zoom reference changed (${before} → ${after})`);
    const inView = await G(page, () => {
      const a = window.__assimilate;
      const p = a.game.world.player;
      const c = a.renderer.cellToScreen(a.game.camera, (p.minX + p.maxX) / 2, (p.minY + p.maxY) / 2);
      return c.y < document.getElementById('sheet').getBoundingClientRect().top && c.y > 0;
    });
    assert(inView, 'territory hidden behind the panel');
    await page.keyboard.press('Escape');
  });

  await test('territory panel lists rivals with their profile and build, live', async () => {
    await page.locator('#tabs [data-tab="territory"]').click();
    assert((await page.locator('[data-rival]').count()) === 2, 'rivals not listed');
    assert(/Rapid Expander|Fortress|Conqueror|Opportunist|Balanced/.test(await text(page, '.rivals')), 'no profile names');
    const a = await text(page, '#sheet-body');
    await ticks(page, 60);
    await page.waitForTimeout(400);
    assert(a !== (await text(page, '#sheet-body')), 'panel not updating');
    await page.keyboard.press('Escape');
  });

  await test('behaviour sliders: all four present, change priorities live, persist, and centre again', async () => {
    await page.locator('#tabs [data-tab="territory"]').click();
    for (const k of ['focus', 'shape', 'reach', 'posture']) assert(await page.locator(`input[data-slider="${k}"]`).count(), `${k} slider missing`);
    const before = await G(page, () => window.__assimilate.game.world.player.stats.aggression);
    await page.locator('input[data-slider="focus"]').fill('1');
    await page.locator('input[data-slider="shape"]').fill('-0.6');
    const after = await G(page, () => ({ b: window.__assimilate.game.world.player.behavior, aggr: window.__assimilate.game.world.player.stats.aggression }));
    assert(after.b.focus === 1 && after.b.shape === -0.6, `sliders not applied ${JSON.stringify(after.b)}`);
    assert(after.aggr > before, 'focus did not change attack preference');
    assert(/Strongly attack/.test(await text(page, '[data-k="b-focus"]')), 'slider label not updated');
    assert(/Style:/.test(await text(page, '.rivals')), 'rival styles missing');
    await shot(page, '03b-behavior');
    await page.keyboard.press('Escape');
    await G(page, () => window.__assimilate.save());
    await page.reload();
    await page.waitForTimeout(400);
    const kept = await G(page, () => window.__assimilate.game.world.player.behavior);
    assert(kept.focus === 1 && kept.shape === -0.6, `sliders not saved ${JSON.stringify(kept)}`);
    await page.locator('#tabs [data-tab="territory"]').click();
    await page.locator('[data-action="reset-behavior"]').click();
    const centred = await G(page, () => window.__assimilate.game.world.player.behavior);
    assert(Object.values(centred).every((v) => v === 0), 'centre all did not reset');
    assert((await page.locator('input[data-slider="focus"]').inputValue()) === '0', 'slider UI not reset');
    await page.keyboard.press('Escape');
  });

  await test('drag pans the map, the re-centre button appears and restores following', async () => {
    assert(await page.locator('#recenter-btn').isHidden(), 're-centre visible too early');
    const box = await page.locator('#field').boundingBox();
    await page.mouse.move(box.width / 2, box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.width / 2 + 120, box.height / 2 + 60, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert(!(await G(page, () => window.__assimilate.game.camera.follow)), 'drag did not pan');
    assert(await page.locator('#recenter-btn').isVisible(), 're-centre button missing');
    await page.locator('#recenter-btn').click();
    await page.waitForTimeout(300);
    assert(await G(page, () => window.__assimilate.game.camera.follow), 'did not resume following');
    assert(await page.locator('#recenter-btn').isHidden(), 're-centre button stayed');
  });

  await test('tapping the map plants the rally flag; tapping it again takes it down', async () => {
    const at = await G(page, () => { const r = window.__assimilate.renderer.play; return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; });
    // Far enough out to be open ground, not your own territory.
    await page.touchscreen.tap(at.x + 150, at.y - 40);
    await page.waitForTimeout(250);
    const flag = await G(page, () => window.__assimilate.game.world.player.flag);
    assert(flag, 'no flag after tap');
    assert(await G(page, (f) => window.__assimilate.game.world.grid.owner(f.x, f.y) !== 1, flag), 'flag planted on own ground');
    assert(await G(page, () => window.__assimilate.game.camera.follow), 'a tap must not pan the camera');
    assert(/Flag planted/.test(await page.locator('#toasts').innerText()), 'no toast');
    await page.locator('#tabs button[data-tab="territory"]').click();
    assert(/beyond your border/.test(await text(page, '[data-k="flag"]')), 'territory tab does not show the flag');
    await page.locator('#sheet-close').click();
    await page.waitForTimeout(200);
    const spot = await G(page, (f) => { const a = window.__assimilate; return a.renderer.cellToScreen(a.game.camera, f.x, f.y); }, flag);
    await page.touchscreen.tap(spot.x, spot.y);
    await page.waitForTimeout(250);
    assert((await G(page, () => window.__assimilate.game.world.player.flag)) === null, 'tapping the flag did not remove it');
    await shot(page, '05b-flag');
  });

  await test('mouse wheel zooms in and out within limits', async () => {
    const box = await page.locator('#field').boundingBox();
    await page.mouse.move(box.width / 2, box.height / 2);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(100);
    const zin = await G(page, () => window.__assimilate.game.camera.manual);
    assert(zin > 1.5, `zoom in ${zin}`);
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(100);
    const zout = await G(page, () => window.__assimilate.game.camera.manual);
    assert(zout >= 0.25 && zout < 0.3, `zoom out clamp ${zout}`);
    await page.locator('#recenter-btn').click();
  });

  await test('first contact with a rival is announced and the status changes', async () => {
    for (let i = 0; i < 240 && !(await G(page, () => window.__assimilate.game.world.contacts().length)); i++) await ticks(page, 50);
    await page.waitForTimeout(800);
    assert(await G(page, () => window.__assimilate.game.world.contacts().length > 0), 'never met a rival');
    assert(/Contact/.test(await text(page, '#toasts')) || /At war|Losing/.test(await text(page, '#stat-status [data-v]')), 'contact not shown');
    await shot(page, '04-contact');
  });

  await test('scale milestones zoom out smoothly with a banner', async () => {
    const lv0 = await G(page, () => window.__assimilate.game.camera.level);
    await G(page, () => { const p = window.__assimilate.game.world.player; p.levels.rate = 30; p.stats.rate = 20; });
    for (let i = 0; i < 30 && (await G(page, () => window.__assimilate.game.camera.level)) === lv0; i++) {
      await ticks(page, 40);
      await page.waitForTimeout(60);
    }
    const st = await G(page, () => ({ level: window.__assimilate.game.camera.level, zooming: window.__assimilate.game.camera.zooming }));
    assert(st.level > lv0, 'no zoom-out');
    assert(st.zooming, 'zoom snapped instead of animating');
    assert(/Scale/.test(await text(page, '#banner')), 'no banner');
  });

  await test('settings persist after reload; diagnostics overlay works', async () => {
    await page.locator('#tabs [data-tab="settings"]').click();
    await page.locator('button[role=switch][aria-label="Sound"]').click();
    await page.locator('button[role=switch][aria-label="Diagnostics"]').click();
    await page.waitForTimeout(400);
    assert(/border/.test(await text(page, '#diag')), 'diagnostics empty');
    await page.reload();
    await page.waitForTimeout(500);
    const s = await G(page, () => window.__assimilate.game.settings);
    assert(s.sound === false && s.diagnostics === true, `settings lost ${JSON.stringify(s)}`);
    await page.locator('#tabs [data-tab="settings"]').click();
    await page.locator('button[role=switch][aria-label="Diagnostics"]').click();
    await page.locator('button[role=switch][aria-label="Sound"]').click();
    await page.keyboard.press('Escape');
  });

  await test('progress survives reload: territory, upgrades, rivals', async () => {
    const before = await G(page, () => {
      const w = window.__assimilate.game.world;
      window.__assimilate.save();
      return { seed: w.seed, power: w.player.levels.power, factions: w.factions.size, cells: w.player.cells };
    });
    await page.reload();
    await page.waitForTimeout(300);
    const after = await G(page, () => {
      const w = window.__assimilate.game.world;
      return { seed: w.seed, power: w.player.levels.power, factions: w.factions.size, cells: w.player.cells, audit: w.audit() };
    });
    assert(after.seed === before.seed && after.power === before.power && after.factions === before.factions, `lost: ${JSON.stringify([before, after])}`);
    assert(after.cells > before.cells * 0.8, 'territory lost');
    assert(after.audit.length === 0, after.audit.join('; '));
  });

  await test('new run: cancel and backdrop keep the run; confirm starts fresh', async () => {
    const seed = await G(page, () => window.__assimilate.game.world.seed);
    await page.locator('#tabs [data-tab="settings"]').click();
    await page.locator('[data-action="new-run"]').click();
    await page.locator('[data-id="confirm-new"] [data-action="cancel"]').click();
    await page.locator('[data-action="new-run"]').click();
    await page.mouse.click(5, 5);
    assert((await page.locator('.modal').count()) === 0, 'backdrop did not dismiss');
    assert((await G(page, () => window.__assimilate.game.world.seed)) === seed, 'cancel changed the run');
    await page.locator('[data-action="new-run"]').click();
    await page.locator('[data-id="confirm-new"] [data-action="confirm"]').click();
    const r = await G(page, () => ({ seed: window.__assimilate.game.world.seed, cells: window.__assimilate.game.world.player.cells, levels: Object.keys(window.__assimilate.game.world.player.levels).length, runs: window.__assimilate.game.stats.runsStarted }));
    assert(r.seed !== seed && r.cells <= 12 && r.levels === 0, `not a fresh run ${JSON.stringify(r)}`);
    assert(r.runs >= 2, 'runs not counted');
  });

  await test('defeat: the run ends with a summary that cannot be dismissed by accident; new run works', async () => {
    await G(page, () => {
      const a = window.__assimilate;
      for (const f of a.game.world.factions.values()) if (!f.isPlayer) { f.behavior.focus = 1; a.grant(f.id, { power: 60, rate: 40 }); }
      a.game.world.player.stats.rate = 0;
      a.game.world.player.stats.resistance = 0.01;
    });
    for (let i = 0; i < 60 && !(await G(page, () => window.__assimilate.game.world.ended)); i++) await ticks(page, 100);
    await page.waitForTimeout(600);
    assert(await page.locator('[data-id="defeat"]').isVisible(), 'no defeat dialog');
    await shot(page, '05-defeat');
    await page.mouse.click(5, 5);
    assert(await page.locator('[data-id="defeat"]').isVisible(), 'defeat dialog dismissed by backdrop');
    await page.locator('[data-id="defeat"] [data-action="new"]').click();
    assert(!(await G(page, () => window.__assimilate.game.world.ended)), 'run still ended');
    assert((await page.locator('.modal').count()) === 0, 'dialog stayed');
  });

  await test('reset requires the checkbox; confirm wipes everything', async () => {
    await page.locator('#tabs [data-tab="settings"]').click();
    await page.locator('[data-action="reset"]').click();
    const del = page.locator('[data-id="confirm-reset"] [data-action="confirm"]');
    assert(await del.isDisabled(), 'delete enabled without checkbox');
    await page.locator('#reset-check').check();
    await Promise.all([page.waitForNavigation(), del.click()]);
    await page.waitForTimeout(400);
    const s = await G(page, () => ({ runs: window.__assimilate.game.stats.runsStarted, intro: window.__assimilate.game.settings.introSeen }));
    assert(s.runs === 1 && !s.intro, `not reset ${JSON.stringify(s)}`);
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
    await G(page, () => {
      const g = window.__assimilate.game;
      const orig = g.update.bind(g);
      let once = true;
      g.update = (...a) => { if (once) { once = false; throw new Error('test failure'); } return orig(...a); };
    });
    await page.waitForTimeout(500);
    assert(await page.locator('.error-card').isVisible(), 'no error card');
    assert(/test failure/.test(await text(page, '.error-card code')), 'error text missing');
    const t0 = await G(page, () => window.__assimilate.game.world.tick);
    await page.waitForTimeout(600);
    assert((await G(page, () => window.__assimilate.game.world.tick)) > t0, 'loop stopped after the error');
    await page.locator('.error-card button:has-text("Dismiss")').click();
    assert((await page.locator('.error-card').count()) === 0, 'error card did not dismiss');
    consoleErrors.length = errorsBefore;
  });
  await ctx.close();
}

// ---------- old and corrupted saves ----------
for (const [name, value, expect] of [
  ['corrupted save', '{broken', /unreadable/i],
  ['save from the old biology design', JSON.stringify({ version: 1, world: { seed: 1, cells: '' } }), /redesigned/i],
]) {
  const { ctx, page } = await newPage();
  await ctx.addInitScript((v) => {
    if (!sessionStorage.getItem('planted')) {
      sessionStorage.setItem('planted', '1');
      localStorage.setItem('assimilate.save', v);
    }
  }, value);
  await page.goto(APP_URL);
  await page.waitForTimeout(400);
  await test(`${name}: starts fresh with a clear message, no crash`, async () => {
    assert((await cells(page)) >= 5, 'no territory');
    assert(expect.test(await text(page, '#toasts')), `message missing: ${await text(page, '#toasts')}`);
  });
  await ctx.close();
}

// ---------- small phone ----------
{
  const { ctx, page } = await newPage({ width: 320, height: 568 });
  await page.goto(APP_URL);
  await page.waitForTimeout(500);
  await test('small phone (320×568): no overlaps, readable, panels scroll to every control', async () => {
    await dismissTip(page);
    await noOverlap(page, ['#hud', '#controls .seg', '#pause-btn', '#tabs']);
    for (const s of ['#stat-energy', '#stat-territory', '#stat-status']) {
      const fs = await page.locator(`${s} .stat-label`).evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
      assert(fs >= 9.5, `${s} label too small (${fs}px)`);
    }
    await page.locator('#tabs [data-tab="upgrades"]').click();
    await shot(page, '06-small-upgrades');
    await page.locator('#tabs [data-tab="settings"]').click();
    await page.locator('#sheet-body').evaluate((e) => (e.scrollTop = e.scrollHeight));
    assert(await page.locator('[data-action="reset"]').isVisible(), 'reset not reachable');
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
  await test('large battles stay responsive (simulation + drawing budget)', async () => {
    await dismissTip(page);
    const r = await G(page, async () => {
      const a = window.__assimilate;
      // A fixed world, so the battle is the same every run.
      a.game.newRun(3);
      const w = a.game.world;
      for (const f of w.factions.values()) a.grant(f.id, { rate: 60, resistance: 10 });
      const t0 = performance.now();
      let n = 0;
      while (w.player.cells < 6000 && n < 14000 && !w.ended) { w.step(); n++; }
      const simMs = (performance.now() - t0) / n;
      await new Promise((res) => setTimeout(res, 3500));
      const samples = [];
      for (let i = 0; i < 30; i++) {
        await new Promise((res) => requestAnimationFrame(res));
        samples.push(a.renderer.info.drawMs);
      }
      samples.sort((x, y) => x - y);
      let total = 0;
      for (const f of w.factions.values()) total += f.cells;
      return { you: w.player.cells, total, factions: w.factions.size, simMs, drawMs: samples[15], level: a.game.camera.level };
    });
    console.log(`      you ${r.you} cells, ${r.total} total in ${r.factions} factions, ${r.simMs.toFixed(2)} ms/tick, draw ${r.drawMs.toFixed(1)} ms, scale ${r.level + 1}`);
    assert(r.total > 15000, 'battle did not grow large');
    assert(r.simMs < 8, `ticks too slow: ${r.simMs} ms`);
    assert(r.drawMs < 14, `drawing too slow: ${r.drawMs} ms`);
    await shot(page, '08-large-battle');
  });
  await ctx.close();
}

// ---------- late game on a phone (regression: lag and heat around scale 10) ----------
{
  const { ctx, page } = await newPage();
  await page.goto(APP_URL);
  await page.waitForTimeout(300);
  await test('scale 10 battle on a phone: 60 fps, cheap frames, and unchanged frames are skipped', async () => {
    await dismissTip(page);
    const setup = await G(page, () => {
      const a = window.__assimilate;
      a.game.newRun(3);
      const w = a.game.world;
      for (const f of w.factions.values()) a.grant(f.id, { rate: 60, resistance: 20, power: 20 });
      // A player strong enough to survive, so the map keeps changing during the measurement.
      a.grant(1, { resistance: 90, power: 80, reinforcement: 30, entrenchment: 10, capital: 10, counter: 8 });
      let n = 0;
      while (a.game.camera.level < 9 && n < 30000 && !w.ended) {
        w.step();
        n++;
        if (n % 50 === 0) a.game.update(0.016, performance.now());
      }
      w.events.length = 0;
      let total = 0;
      for (const f of w.factions.values()) total += f.cells;
      return { level: a.game.camera.level, total, ended: w.ended };
    });
    assert(setup.level >= 8 && !setup.ended, `setup failed ${JSON.stringify(setup)}`);
    await page.waitForTimeout(3500);
    const r = await G(page, async () => {
      const a = window.__assimilate;
      const t = [];
      const d = [];
      const f0 = a.renderer.frames;
      const s0 = performance.now();
      let last = s0;
      for (let i = 0; i < 90; i++) {
        await new Promise((res) => requestAnimationFrame(res));
        const n = performance.now();
        t.push(n - last);
        last = n;
        d.push(a.renderer.info.drawMs);
      }
      const redraws = (a.renderer.frames - f0) / ((performance.now() - s0) / 1000);
      t.sort((x, y) => x - y);
      d.sort((x, y) => x - y);
      return { frame: t[45], slow: t[81], draw: d[45], redraws };
    });
    console.log(`      ${setup.total} cells on the map; frame ${r.frame.toFixed(1)} ms (90th pct ${r.slow.toFixed(1)}), draw ${r.draw.toFixed(1)} ms, ${r.redraws.toFixed(0)} redraws/s`);
    assert(r.slow < 34, `frequent hitches: 90th percentile ${r.slow} ms`);
    assert(r.frame < 22, `slow frames: ${r.frame} ms`);
    assert(r.draw < 5, `expensive draws: ${r.draw} ms`);
    assert(r.redraws < 30, `redrawing unchanged frames (${r.redraws}/s)`);
    await shot(page, '09-scale-10');
  });
  await ctx.close();
}

// ---------- desktop smoothness (regression: lag after ~30 s on large screens) ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  currentPage = page;
  await page.goto(APP_URL);
  await page.waitForTimeout(400);
  await test('large high-density screen stays at ~60 fps two minutes in and while zooming', async () => {
    const frames = async () => G(page, async () => {
      const t = [];
      let last = performance.now();
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const n = performance.now();
        t.push(n - last);
        last = n;
      }
      t.sort((a, b) => a - b);
      return t[20];
    });
    await G(page, () => { const g = window.__assimilate.game; g.newRun(3); while (g.world.time < 120) g.world.step(); g.world.events.length = 0; });
    await page.waitForTimeout(3000);
    const rest = await frames();
    await G(page, () => window.__assimilate.game.camera.zoomTo(4, 2.4));
    const zoom = await frames();
    console.log(`      median frame ${rest.toFixed(1)} ms at rest, ${zoom.toFixed(1)} ms while zooming`);
    assert(rest < 22, `slow at rest: ${rest} ms`);
    assert(zoom < 22, `slow while zooming: ${zoom} ms`);
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
