// Headless look at what the growth rules produce. Prints an ASCII map of the colony and a few
// shape metrics for several trait presets, so balance changes can be judged without a phone.
//   npm run patterns                 default seed, all presets
//   SEED=42 TICKS=900 npm run patterns
//   PRESET=branchy npm run patterns  one preset only

import { PLAYER_TRAITS, type GrowthTraits } from '../src/config/balance';
import { Simulation } from '../src/sim/sim';
import { shapeMetrics } from '../src/sim/metrics';
import { PLAYER, ROCK } from '../src/sim/world';

const SEED = Number(process.env.SEED ?? 7);
const TICKS = Number(process.env.TICKS ?? 700);
const VIEW = Number(process.env.VIEW ?? 70);

export const PRESETS: Record<string, Partial<GrowthTraits>> = {
  compact: { branching: -2, crowdRefusal: 0, persistence: 0, fertilityPreference: 0.5 },
  default: {},
  branchy: { branching: 3.5, crowdRefusal: 2.5, persistence: 1.8 },
  soil: { fertilityPreference: 4.5, barrenFloor: 0.05 },
};

for (const [name, p] of Object.entries(PRESETS)) {
  if (process.env.PRESET && process.env.PRESET !== name) continue;
  const sim = new Simulation(SEED, { ...PLAYER_TRAITS, ...p });
  sim.seedPlayer();
  let tPop1000: number | null = null;
  for (let t = 0; t < TICKS; t++) {
    sim.step();
    if (tPop1000 === null && sim.player.population >= 1000) tPop1000 = sim.tick;
  }
  const m = shapeMetrics(sim);
  console.log(`\n=== ${name} (seed ${SEED}, ${TICKS} ticks = ${TICKS / 10}s) ===`);
  console.log(`population ${sim.player.population} | frontier ${sim.world.activeCount} | 1000 cells @ ${tPop1000 === null ? '—' : `${tPop1000 / 10}s`}`);
  console.log(`edge ratio ${m.edgeRatio.toFixed(2)} | tips ${m.tips} | fill ${(m.fill * 100).toFixed(0)}% of bbox | holes ${m.enclosedEmpty}`);
  const w = sim.world;
  const cx = w.width >> 1;
  const cy = w.height >> 1;
  const half = VIEW >> 1;
  for (let y = cy - half; y < cy + half; y += 2) {
    let line = '';
    for (let x = cx - half; x < cx + half; x++) {
      const a = w.owner[w.index(x, y)];
      const b = w.owner[w.index(x, y + 1)];
      const pa = a === PLAYER;
      const pb = b === PLAYER;
      if (pa && pb) line += '█';
      else if (pa) line += '▀';
      else if (pb) line += '▄';
      else if (a === ROCK || b === ROCK) line += '░';
      else line += ' ';
    }
    console.log(line);
  }
}
