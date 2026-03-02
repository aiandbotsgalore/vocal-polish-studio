/**
 * ScoringEngine — evaluates processed audio quality using normalized 0-1 metrics.
 *
 * Accepts RawAudioData (worker-safe, no AudioBuffer dependency).
 * Uses AnalysisCache with LRU keyed by RawAudioData.id.
 */

import { computeIntegratedLUFS } from "./loudness";
import { getOrComputeAnalysis, type CachedAnalysis } from "./AnalysisCache";
import { BANDS, type BandName } from "./frequencyBands";
import type { StyleProfile, RawAudioData } from "./types";

export interface ScoringResult {
  overallScore: number;
  metrics: {
    lufsAccuracy: number;
    spectralBalance: number;
    sibilanceReduction: number;
    harshnessReduction: number;
    brightnessPreservation: number;
    artifactRisk: number;
    bodyWarmth: number;
    harmonicDensity: number;
    dynamicRange: number;
  };
  /** Raw dB band energies for UI display */
  bandEnergiesDb: {
    original: Record<BandName, number>;
    processed: Record<BandName, number>;
  };
  processedLufs: number;
  originalLufs: number;
  referenceDeviation: number;
}

const WEIGHTS = {
  lufsAccuracy: 0.10,
  spectralBalance: 0.15,
  sibilanceReduction: 0.12,
  harshnessReduction: 0.15,
  brightnessPreservation: 0.13,
  artifactRisk: 0.10,
  bodyWarmth: 0.10,
  harmonicDensity: 0.08,
  dynamicRange: 0.07,
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function computeLufsAccuracy(processedLufs: number, targetLufs: number): number {
  const diffLU = Math.abs(processedLufs - targetLufs);
  return clamp01(1 - diffLU / 6);
}

function computeSpectralBalance(
  originalAnalysis: CachedAnalysis,
  processedAnalysis: CachedAnalysis,
  styleProfile?: StyleProfile
): { balance: number; deviation: number } {
  const totalProcessed = Object.values(processedAnalysis.bandEnergies).reduce(
    (sum, v) => sum + Math.pow(10, v / 10), 0
  );
  const processedRatios: Partial<Record<BandName, number>> = {};
  for (const band of Object.keys(BANDS) as BandName[]) {
    const linearE = Math.pow(10, processedAnalysis.bandEnergies[band] / 10);
    processedRatios[band] = totalProcessed > 0 ? linearE / totalProcessed : 0;
  }

  let deviation = 0;
  if (styleProfile?.referenceBandRatios) {
    let deviationSum = 0;
    let count = 0;
    for (const band of Object.keys(styleProfile.referenceBandRatios) as BandName[]) {
      const ref = styleProfile.referenceBandRatios[band] ?? 0;
      const actual = processedRatios[band] ?? 0;
      deviationSum += Math.abs(ref - actual);
      count++;
    }
    deviation = count > 0 ? deviationSum / count : 0;
  }

  const presenceRatio = processedRatios.presence ?? 0;
  const mudRatio = processedRatios.mud ?? 0;
  const airRatio = processedRatios.air ?? 0;

  let balanceScore = 0.5;
  if (presenceRatio > mudRatio * 0.8) balanceScore += 0.25;
  if (airRatio > 0.005) balanceScore += 0.25;

  const deviationPenalty = Math.min(0.3, deviation * 2);
  balanceScore = clamp01(balanceScore - deviationPenalty);

  return { balance: balanceScore, deviation };
}

function computeSibilanceReduction(original: CachedAnalysis, processed: CachedAnalysis): number {
  const reductionDb = original.bandEnergies.sibilance - processed.bandEnergies.sibilance;
  return clamp01(0.5 + reductionDb / 12);
}

function computeHarshnessReduction(original: CachedAnalysis, processed: CachedAnalysis): number {
  const reductionDb = original.bandEnergies.harshness - processed.bandEnergies.harshness;
  return clamp01(0.5 + reductionDb / 12);
}

function computeBrightnessPreservation(original: CachedAnalysis, processed: CachedAnalysis): number {
  const origCentroid = original.spectralCentroid;
  const procCentroid = processed.spectralCentroid;
  if (origCentroid <= 0) return 1;
  const ratio = procCentroid / origCentroid;
  if (ratio >= 0.85 && ratio <= 1.15) return 1;
  if (ratio < 0.85) return clamp01(ratio / 0.85);
  return clamp01(2 - ratio / 1.15);
}

function computeArtifactRisk(original: CachedAnalysis, processed: CachedAnalysis): number {
  let risk = 1;
  const airDrop = original.bandEnergies.air - processed.bandEnergies.air;
  if (airDrop > 12) risk -= 0.4;
  else if (airDrop > 6) risk -= 0.2;
  const sibDrop = original.bandEnergies.sibilance - processed.bandEnergies.sibilance;
  if (sibDrop > 10) risk -= 0.4;
  else if (sibDrop > 6) risk -= 0.2;
  const mudIncrease = processed.bandEnergies.mud - original.bandEnergies.mud;
  if (mudIncrease > 3) risk -= 0.2;
  return clamp01(risk);
}

/**
 * Body/warmth metric — rewards low-mid energy increase (additive processing).
 * Measures improvement in the mud (200-500Hz) and lowMid (500-2kHz) bands.
 */
function computeBodyWarmth(original: CachedAnalysis, processed: CachedAnalysis): number {
  const mudGain = processed.bandEnergies.mud - original.bandEnergies.mud;
  const lowMidGain = processed.bandEnergies.lowMid - original.bandEnergies.lowMid;

  // Reward moderate gains (2-6 dB), penalize excessive (>10 dB)
  let score = 0.5; // neutral baseline
  const avgGain = (mudGain + lowMidGain) / 2;

  if (avgGain > 0 && avgGain <= 8) {
    score += Math.min(0.5, avgGain / 8 * 0.5);
  } else if (avgGain > 8) {
    score += 0.5 - Math.min(0.5, (avgGain - 8) / 10 * 0.5);
  }
  // Slight penalty if body was lost
  if (avgGain < -2) {
    score -= Math.min(0.3, Math.abs(avgGain) / 10);
  }

  return clamp01(score);
}

/**
 * Harmonic density — measures if the signal gained harmonic content.
 * Uses the ratio of presence+air to lowMid as a proxy for harmonic richness.
 */
function computeHarmonicDensity(original: CachedAnalysis, processed: CachedAnalysis): number {
  const origRatio = (
    Math.pow(10, original.bandEnergies.presence / 10) +
    Math.pow(10, original.bandEnergies.air / 10)
  ) / Math.max(1e-10, Math.pow(10, original.bandEnergies.lowMid / 10));

  const procRatio = (
    Math.pow(10, processed.bandEnergies.presence / 10) +
    Math.pow(10, processed.bandEnergies.air / 10)
  ) / Math.max(1e-10, Math.pow(10, processed.bandEnergies.lowMid / 10));

  // Improvement = ratio got closer to a balanced range
  if (origRatio <= 0) return 0.5;
  const change = procRatio / origRatio;

  // Reward modest enrichment (0.8-1.5x), penalize extreme changes
  if (change >= 0.8 && change <= 1.5) return clamp01(0.5 + (change - 0.8) * 0.7);
  if (change > 1.5) return clamp01(1 - (change - 1.5) * 0.3);
  return clamp01(change / 0.8 * 0.5);
}

/**
 * Dynamic range — measures if crest factor is in a professional range (8-14 dB).
 */
function computeDynamicRange(processed: CachedAnalysis, channels: Float32Array[]): number {
  // Simple peak/RMS crest factor
  let peak = 0;
  let sumSq = 0;
  let count = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const abs = Math.abs(ch[i]);
      if (abs > peak) peak = abs;
      sumSq += ch[i] * ch[i];
      count++;
    }
  }
  if (count === 0 || peak === 0) return 0;
  const rms = Math.sqrt(sumSq / count);
  const crestDb = 20 * Math.log10(peak / Math.max(1e-10, rms));

  // Ideal range 8-14 dB
  if (crestDb >= 8 && crestDb <= 14) return 1;
  if (crestDb < 8) return clamp01(crestDb / 8);
  return clamp01(1 - (crestDb - 14) / 10);
}

/**
 * Score processed audio against the original.
 * Accepts RawAudioData — worker-safe, no AudioBuffer.
 */
export function scoreProcessedAudio(
  original: RawAudioData,
  processed: RawAudioData,
  targetLufs: number,
  styleProfile?: StyleProfile
): ScoringResult {
  // Zero-length guard
  if (processed.length === 0 || original.length === 0) {
    const zeroBands = {
      rumble: -96, plosive: -96, mud: -96, lowMid: -96,
      presence: -96, harshness: -96, sibilance: -96, air: -96,
    } as Record<BandName, number>;
    return {
      overallScore: 0,
      metrics: {
        lufsAccuracy: 0, spectralBalance: 0, sibilanceReduction: 0,
        harshnessReduction: 0, brightnessPreservation: 0, artifactRisk: 0,
        bodyWarmth: 0, harmonicDensity: 0, dynamicRange: 0,
      },
      bandEnergiesDb: { original: zeroBands, processed: zeroBands },
      processedLufs: -Infinity,
      originalLufs: -Infinity,
      referenceDeviation: 1,
    };
  }

  const originalAnalysis = getOrComputeAnalysis(original);
  const processedAnalysis = getOrComputeAnalysis(processed);

  const processedLufs = computeIntegratedLUFS(processed.channels, processed.sampleRate);
  const originalLufs = computeIntegratedLUFS(original.channels, original.sampleRate);

  const lufsAccuracy = computeLufsAccuracy(processedLufs, targetLufs);
  const { balance: spectralBalance, deviation: referenceDeviation } =
    computeSpectralBalance(originalAnalysis, processedAnalysis, styleProfile);
  const sibilanceReduction = computeSibilanceReduction(originalAnalysis, processedAnalysis);
  const harshnessReduction = computeHarshnessReduction(originalAnalysis, processedAnalysis);
  const brightnessPreservation = computeBrightnessPreservation(originalAnalysis, processedAnalysis);
  const artifactRisk = computeArtifactRisk(originalAnalysis, processedAnalysis);
  const bodyWarmth = computeBodyWarmth(originalAnalysis, processedAnalysis);
  const harmonicDensity = computeHarmonicDensity(originalAnalysis, processedAnalysis);
  const dynamicRange = computeDynamicRange(processedAnalysis, processed.channels);

  const metrics = {
    lufsAccuracy, spectralBalance, sibilanceReduction,
    harshnessReduction, brightnessPreservation, artifactRisk,
    bodyWarmth, harmonicDensity, dynamicRange,
  };

  const weightedSum =
    metrics.lufsAccuracy * WEIGHTS.lufsAccuracy +
    metrics.spectralBalance * WEIGHTS.spectralBalance +
    metrics.sibilanceReduction * WEIGHTS.sibilanceReduction +
    metrics.harshnessReduction * WEIGHTS.harshnessReduction +
    metrics.brightnessPreservation * WEIGHTS.brightnessPreservation +
    metrics.artifactRisk * WEIGHTS.artifactRisk +
    metrics.bodyWarmth * WEIGHTS.bodyWarmth +
    metrics.harmonicDensity * WEIGHTS.harmonicDensity +
    metrics.dynamicRange * WEIGHTS.dynamicRange;

  const deviationPenalty = Math.min(15, referenceDeviation * 100);
  const overallScore = Math.round(Math.max(0, Math.min(100, weightedSum * 100 - deviationPenalty)));

  return {
    overallScore,
    metrics,
    bandEnergiesDb: {
      original: { ...originalAnalysis.bandEnergies },
      processed: { ...processedAnalysis.bandEnergies },
    },
    processedLufs,
    originalLufs,
    referenceDeviation,
  };
}
