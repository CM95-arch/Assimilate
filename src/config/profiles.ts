// Rival personalities: where each kind of rival sets its behaviour sliders and how much it
// values each upgrade. Every rival also gets its own random twist on both, so no two play alike.

import type { Behavior } from './upgrades';

export interface Profile {
  id: string;
  name: string;
  summary: string;
  /** Behaviour slider positions (−1…+1) before the personal twist. */
  behavior: Behavior;
  /** Relative appetite for each upgrade id (missing = 0.3). */
  weights: Record<string, number>;
}

export const PROFILES: Profile[] = [
  {
    id: 'expander', name: 'Rapid Expander', summary: 'Fast growth, weak conversions, low resistance.',
    behavior: { focus: -0.6, shape: 0.7, reach: 0.6, posture: 0 },
    weights: { rate: 3, yield: 1.8, targeting: 0.8, power: 0.5, resistance: 0.3, efficiency: 0.6 },
  },
  {
    id: 'fortress', name: 'Fortress', summary: 'Slow growth, high resistance, strong reinforcement.',
    behavior: { focus: -0.3, shape: -0.8, reach: -0.5, posture: -0.8 },
    weights: { resistance: 3, reinforcement: 2.2, entrenchment: 2, rate: 0.6, yield: 0.8, power: 0.3 },
  },
  {
    id: 'conqueror', name: 'Conqueror', summary: 'Strong conversions and aggressive pushes, weaker economy.',
    behavior: { focus: 0.8, shape: -0.2, reach: 0.3, posture: 0.4 },
    weights: { power: 3, pressure: 1.8, conquestBonus: 1.6, rate: 1, yield: 0.3, efficiency: 0.1 },
  },
  {
    id: 'opportunist', name: 'Opportunist', summary: 'Moderate strength; hunts weak points and exposed borders.',
    behavior: { focus: 0.3, shape: 0.2, reach: 0, posture: 0.9 },
    weights: { targeting: 2, power: 1.4, rate: 1.4, pressure: 1, conquestBonus: 0.8, yield: 0.8 },
  },
  {
    id: 'balanced', name: 'Balanced', summary: 'No extreme specialisation; generally reliable.',
    behavior: { focus: 0, shape: 0, reach: 0, posture: 0 },
    weights: { rate: 1.6, power: 1.4, resistance: 1.4, yield: 1.2, reinforcement: 0.8, conquestBonus: 0.7 },
  },
];

export const PROFILE_BY_ID: Record<string, Profile> = Object.fromEntries(PROFILES.map((p) => [p.id, p]));
