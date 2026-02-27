/**
 * Centralized frequency band definitions used across all DSP modules.
 * All modules (ScoringEngine, IssueMap, ResonanceSuppressor, StyleProfiles, DynamicEQ)
 * MUST import from this single source to prevent drift.
 */

export interface FrequencyBand {
  readonly low: number;
  readonly high: number;
}

export const BANDS = {
  rumble:    { low: 20,    high: 80 }    as FrequencyBand,
  plosive:   { low: 80,    high: 200 }   as FrequencyBand,
  mud:       { low: 200,   high: 500 }   as FrequencyBand,
  lowMid:    { low: 500,   high: 2000 }  as FrequencyBand,
  presence:  { low: 2000,  high: 4000 }  as FrequencyBand,
  harshness: { low: 3000,  high: 5000 }  as FrequencyBand,
  sibilance: { low: 5000,  high: 9000 }  as FrequencyBand,
  air:       { low: 10000, high: 16000 } as FrequencyBand,
} as const;

export type BandName = keyof typeof BANDS;

/** Get the geometric center frequency of a band */
export function bandCenter(name: BandName): number {
  const b = BANDS[name];
  return Math.sqrt(b.low * b.high);
}

/** Check if a frequency falls within a named band */
export function isInBand(freqHz: number, name: BandName): boolean {
  const b = BANDS[name];
  return freqHz >= b.low && freqHz <= b.high;
}
