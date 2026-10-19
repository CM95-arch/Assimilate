// Rival personalities: how much each kind of rival values each upgrade.
// Every rival also gets its own random twist on these weights, so no two play alike.

export interface Profile {
  id: string;
  name: string;
  summary: string;
  /** Relative appetite for each upgrade id (missing = 0.3). */
  weights: Record<string, number>;
}

export const PROFILES: Profile[] = [
  {
    id: 'expander', name: 'Rapid Expander', summary: 'Fast growth, weak conversions, low resistance.',
    weights: { rate: 3, branching: 1.6, momentum: 1.4, yield: 1.6, targeting: 0.8, power: 0.4, resistance: 0.3, consolidation: 0.1 },
  },
  {
    id: 'fortress', name: 'Fortress', summary: 'Slow growth, high resistance, strong reinforcement.',
    weights: { resistance: 3, reinforcement: 2.2, entrenchment: 2, consolidation: 1.8, recovery: 1, threat: 1, rate: 0.6, branching: 0.05, aggression: 0.1 },
  },
  {
    id: 'conqueror', name: 'Conqueror', summary: 'Strong conversions and aggressive pushes, weaker economy.',
    weights: { power: 3, aggression: 2, pressure: 1.8, conquestBonus: 1.6, flanking: 0.8, rate: 1, yield: 0.3, efficiency: 0.1 },
  },
  {
    id: 'opportunist', name: 'Opportunist', summary: 'Moderate strength; hunts weak points and exposed borders.',
    weights: { flanking: 2.6, targeting: 1.8, threat: 1, power: 1.4, rate: 1.4, recovery: 1, pressure: 1 },
  },
  {
    id: 'balanced', name: 'Balanced', summary: 'No extreme specialisation; generally reliable.',
    weights: { rate: 1.6, power: 1.4, resistance: 1.4, yield: 1.2, reinforcement: 0.8, conquestBonus: 0.7, consolidation: 0.6, threat: 0.6 },
  },
];

export const PROFILE_BY_ID: Record<string, Profile> = Object.fromEntries(PROFILES.map((p) => [p.id, p]));
