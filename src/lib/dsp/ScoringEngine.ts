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
  };
  processedLufs: number;
  referenceDeviation: number;
}

const WEIGHTS = {
  lufsAccuracy: 0.15,
  spectralBalance: 0.20,
  sibilanceReduction: 0.15,
  harshnessReduction: 0.20,
  brightnessPreservation: 0.15,
  artifactRisk: 0.15,
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
 * Score processed audio against the original.
 * Accepts RawAudioData — worker-safe, no AudioBuffer.
 * Early-returns zero score for zero-length buffers.
 */
export function scoreProcessedAudio(
  original: RawAudioData,
  processed: RawAudioData,
  targetLufs: number,
  styleProfile?: StyleProfile
): ScoringResult {
  // Zero-length guard
  if (processed.length === 0 || original.length === 0) {
    return {
      overallScore: 0,
      metrics: {
        lufsAccuracy: 0, spectralBalance: 0, sibilanceReduction: 0,
        harshnessReduction: 0, brightnessPreservation: 0, artifactRisk: 0,
      },
      processedLufs: -Infinity,
      referenceDeviation: 1,
    };
  }

  const originalAnalysis = getOrComputeAnalysis(original);
  const processedAnalysis = getOrComputeAnalysis(processed);

  const processedLufs = computeIntegratedLUFS(processed.channels, processed.sampleRate);

  const lufsAccuracy = computeLufsAccuracy(processedLufs, targetLufs);
  const { balance: spectralBalance, deviation: referenceDeviation } =
    computeSpectralBalance(originalAnalysis, processedAnalysis, styleProfile);
  const sibilanceReduction = computeSibilanceReduction(originalAnalysis, processedAnalysis);
  const harshnessReduction = computeHarshnessReduction(originalAnalysis, processedAnalysis);
  const brightnessPreservation = computeBrightnessPreservation(originalAnalysis, processedAnalysis);
  const artifactRisk = computeArtifactRisk(originalAnalysis, processedAnalysis);

  const metrics = {
    lufsAccuracy, spectralBalance, sibilanceReduction,
    harshnessReduction, brightnessPreservation, artifactRisk,
  };

  const weightedSum =
    metrics.lufsAccuracy * WEIGHTS.lufsAccuracy +
    metrics.spectralBalance * WEIGHTS.spectralBalance +
    metrics.sibilanceReduction * WEIGHTS.sibilanceReduction +
    metrics.harshnessReduction * WEIGHTS.harshnessReduction +
    metrics.brightnessPreservation * WEIGHTS.brightnessPreservation +
    metrics.artifactRisk * WEIGHTS.artifactRisk;

  const deviationPenalty = Math.min(15, referenceDeviation * 100);
  const overallScore = Math.round(Math.max(0, Math.min(100, weightedSum * 100 - deviationPenalty)));

  return { overallScore, metrics, processedLufs, referenceDeviation };
}
