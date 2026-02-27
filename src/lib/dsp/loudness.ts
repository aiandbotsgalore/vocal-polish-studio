/**
 * ITU-R BS.1770-4 compliant loudness measurement.
 * Full chain: K-weighting (pre-filter + RLB) → energy integration → gating.
 *
 * Shared by ScoringEngine and OutputStage — single source of truth for LUFS.
 */

import {
  bs1770PreFilter,
  bs1770RlbFilter,
  createBiquadState,
  processBiquadBlock,
  type BiquadCoefficients,
  type BiquadState,
} from "./biquad";

/** Block size for gating: 400ms worth of samples */
function blockSamples(sampleRate: number): number {
  return Math.round(sampleRate * 0.4);
}

/** Step size: 100ms overlap */
function stepSamples(sampleRate: number): number {
  return Math.round(sampleRate * 0.1);
}

/**
 * Apply K-weighting filter (Stage 1 + Stage 2) to a mono channel.
 * Returns a new Float32Array (does not mutate input).
 */
function applyKWeighting(
  data: Float32Array,
  sampleRate: number
): Float32Array {
  const output = new Float32Array(data);

  // Stage 1: High-shelf pre-filter (+3.999dB at 1681.97Hz)
  const preCoeffs: BiquadCoefficients = bs1770PreFilter(sampleRate);
  const preState: BiquadState = createBiquadState();
  processBiquadBlock(output, preCoeffs, preState);

  // Stage 2: RLB weighting high-pass (38.135Hz)
  const rlbCoeffs: BiquadCoefficients = bs1770RlbFilter(sampleRate);
  const rlbState: BiquadState = createBiquadState();
  processBiquadBlock(output, rlbCoeffs, rlbState);

  return output;
}

/**
 * Compute per-block mean-square energy for K-weighted channel data.
 * Uses 400ms blocks with 100ms steps per BS.1770-4.
 */
function computeBlockEnergies(
  kWeightedChannels: Float32Array[],
  sampleRate: number
): number[] {
  const bSize = blockSamples(sampleRate);
  const sSize = stepSamples(sampleRate);
  const totalSamples = kWeightedChannels[0].length;
  const energies: number[] = [];

  for (let start = 0; start + bSize <= totalSamples; start += sSize) {
    let blockEnergy = 0;
    // Sum energy across all channels (equal weight for L/R per BS.1770-4)
    for (let ch = 0; ch < kWeightedChannels.length; ch++) {
      const chan = kWeightedChannels[ch];
      let chanEnergy = 0;
      for (let i = start; i < start + bSize; i++) {
        chanEnergy += chan[i] * chan[i];
      }
      blockEnergy += chanEnergy / bSize;
    }
    energies.push(blockEnergy);
  }

  return energies;
}

/**
 * Compute integrated loudness (LUFS) per BS.1770-4 with gating.
 *
 * @param channelData - Array of Float32Array, one per channel
 * @param sampleRate - Sample rate in Hz
 * @returns Integrated loudness in LUFS
 */
export function computeIntegratedLUFS(
  channelData: Float32Array[],
  sampleRate: number
): number {
  if (channelData.length === 0 || channelData[0].length === 0) return -Infinity;

  // Apply K-weighting to each channel
  const kWeighted = channelData.map((ch) => applyKWeighting(ch, sampleRate));

  // Compute block energies
  const blockEnergies = computeBlockEnergies(kWeighted, sampleRate);
  if (blockEnergies.length === 0) return -Infinity;

  // Stage 4a: Absolute gating at -70 LUFS
  const absoluteThreshold = Math.pow(10, (-70 + 0.691) / 10);
  const aboveAbsolute = blockEnergies.filter((e) => e > absoluteThreshold);
  if (aboveAbsolute.length === 0) return -Infinity;

  // Ungated mean of blocks above absolute threshold
  const ungatedMean =
    aboveAbsolute.reduce((sum, e) => sum + e, 0) / aboveAbsolute.length;

  // Stage 4b: Relative gating at -10 LUFS below ungated mean
  const relativeThreshold = ungatedMean * Math.pow(10, -10 / 10);
  const aboveRelative = aboveAbsolute.filter((e) => e > relativeThreshold);
  if (aboveRelative.length === 0) return -Infinity;

  // Gated mean
  const gatedMean =
    aboveRelative.reduce((sum, e) => sum + e, 0) / aboveRelative.length;

  return -0.691 + 10 * Math.log10(gatedMean);
}

/**
 * Compute short-term loudness (3s window, 100ms steps).
 * Returns array of { timeSec, lufs } measurements.
 */
export function computeShortTermLUFS(
  channelData: Float32Array[],
  sampleRate: number
): Array<{ timeSec: number; lufs: number }> {
  if (channelData.length === 0 || channelData[0].length === 0) return [];

  const kWeighted = channelData.map((ch) => applyKWeighting(ch, sampleRate));
  const windowSamples = Math.round(sampleRate * 3); // 3 seconds
  const sSize = stepSamples(sampleRate); // 100ms steps
  const totalSamples = kWeighted[0].length;
  const results: Array<{ timeSec: number; lufs: number }> = [];

  for (let start = 0; start + windowSamples <= totalSamples; start += sSize) {
    let energy = 0;
    for (let ch = 0; ch < kWeighted.length; ch++) {
      const chan = kWeighted[ch];
      let chanEnergy = 0;
      for (let i = start; i < start + windowSamples; i++) {
        chanEnergy += chan[i] * chan[i];
      }
      energy += chanEnergy / windowSamples;
    }

    const lufs = energy > 0 ? -0.691 + 10 * Math.log10(energy) : -Infinity;
    results.push({ timeSec: start / sampleRate, lufs });
  }

  return results;
}

/**
 * Compute momentary loudness (400ms window, 100ms steps).
 * Returns array of { timeSec, lufs } measurements.
 */
export function computeMomentaryLUFS(
  channelData: Float32Array[],
  sampleRate: number
): Array<{ timeSec: number; lufs: number }> {
  if (channelData.length === 0 || channelData[0].length === 0) return [];

  const kWeighted = channelData.map((ch) => applyKWeighting(ch, sampleRate));
  const windowSamples = blockSamples(sampleRate); // 400ms
  const sSize = stepSamples(sampleRate); // 100ms steps
  const totalSamples = kWeighted[0].length;
  const results: Array<{ timeSec: number; lufs: number }> = [];

  for (let start = 0; start + windowSamples <= totalSamples; start += sSize) {
    let energy = 0;
    for (let ch = 0; ch < kWeighted.length; ch++) {
      const chan = kWeighted[ch];
      let chanEnergy = 0;
      for (let i = start; i < start + windowSamples; i++) {
        chanEnergy += chan[i] * chan[i];
      }
      energy += chanEnergy / windowSamples;
    }

    const lufs = energy > 0 ? -0.691 + 10 * Math.log10(energy) : -Infinity;
    results.push({ timeSec: start / sampleRate, lufs });
  }

  return results;
}
