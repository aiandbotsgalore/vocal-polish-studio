/**
 * ScoringEngine — evaluates processed audio quality using normalized 0-1 metrics.
 *
 * Fix 8: All metrics normalized to 0-1 before weighting.
 * Fix 10: Uses AnalysisCache to avoid redundant FFT computation.
 *
 * Scores:
 *  - LUFS accuracy (closeness to target)
 *  - Spectral balance (band ratios vs. reference)
 *  - Sibilance reduction
 *  - Harshness reduction
 *  - Brightness preservation
 *  - Artifact risk (dullness, lispiness proxies)
 */

import { computeIntegratedLUFS } from "./loudness";
import { getOrComputeAnalysis, type CachedAnalysis } from "./AnalysisCache";
import { BANDS, type BandName } from "./frequencyBands";
import type { StyleProfile } from "./types";

export interface ScoringResult {
  /** Overall quality score 0-100 */
  overallScore: number;
  /** Individual normalized metrics (all 0-1) */
  metrics: {
    lufsAccuracy: number;
    spectralBalance: number;
    sibilanceReduction: number;
    harshnessReduction: number;
    brightnessPreservation: number;
    artifactRisk: number;
  };
  /** Integrated LUFS of processed buffer */
  processedLufs: number;
  /** Deviation from style reference (0 = perfect match) */
  referenceDeviation: number;
}

/** Weights for final scoring */
const WEIGHTS = {
  lufsAccuracy: 0.15,
  spectralBalance: 0.20,
  sibilanceReduction: 0.15,
  harshnessReduction: 0.20,
  brightnessPreservation: 0.15,
  artifactRisk: 0.15,
};

// ── Normalization helpers ─────────────────────────────────────

/** Normalize a dB value to 0-1 given expected range [minDb, maxDb] */
function normalizeDb(valueDb: number, minDb: number, maxDb: number): number {
  if (!isFinite(valueDb)) return 0;
  return Math.max(0, Math.min(1, (valueDb - minDb) / (maxDb - minDb)));
}

/** Normalize a percentage (0-100) to 0-1, clamped */
function normalizePct(pct: number): number {
  return Math.max(0, Math.min(1, pct / 100));
}

/** Clamp a ratio to 0-1 */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ── Metric computation ────────────────────────────────────────

function computeLufsAccuracy(processedLufs: number, targetLufs: number): number {
  // Perfect = within 0.5 LU, worst = >6 LU away
  const diffLU = Math.abs(processedLufs - targetLufs);
  return clamp01(1 - diffLU / 6);
}

function computeSpectralBalance(
  originalAnalysis: CachedAnalysis,
  processedAnalysis: CachedAnalysis,
  styleProfile?: StyleProfile
): { balance: number; deviation: number } {
  // Compute band energy ratios for processed
  const totalProcessed = Object.values(processedAnalysis.bandEnergies).reduce(
    (sum, v) => sum + Math.pow(10, v / 10), 0
  );
  const processedRatios: Partial<Record<BandName, number>> = {};
  for (const band of Object.keys(BANDS) as BandName[]) {
    const linearE = Math.pow(10, processedAnalysis.bandEnergies[band] / 10);
    processedRatios[band] = totalProcessed > 0 ? linearE / totalProcessed : 0;
  }

  // Compare against style reference if available
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

  // Balance: check that presence and lowMid bands are reasonable relative to each other
  const presenceRatio = processedRatios.presence ?? 0;
  const mudRatio = processedRatios.mud ?? 0;
  const airRatio = processedRatios.air ?? 0;

  // Good balance: presence > mud, air > 0.01
  let balanceScore = 0.5;
  if (presenceRatio > mudRatio * 0.8) balanceScore += 0.25;
  if (airRatio > 0.005) balanceScore += 0.25;

  // Penalty for reference deviation
  const deviationPenalty = Math.min(0.3, deviation * 2);
  balanceScore = clamp01(balanceScore - deviationPenalty);

  return { balance: balanceScore, deviation };
}

function computeSibilanceReduction(
  original: CachedAnalysis,
  processed: CachedAnalysis
): number {
  const origSibDb = original.bandEnergies.sibilance;
  const procSibDb = processed.bandEnergies.sibilance;
  // Positive reduction is good (lower sibilance in processed)
  const reductionDb = origSibDb - procSibDb;
  // Normalize: 0dB reduction = 0.5, 6dB reduction = 1.0, -3dB (increase) = 0
  return clamp01(0.5 + reductionDb / 12);
}

function computeHarshnessReduction(
  original: CachedAnalysis,
  processed: CachedAnalysis
): number {
  const origDb = original.bandEnergies.harshness;
  const procDb = processed.bandEnergies.harshness;
  const reductionDb = origDb - procDb;
  return clamp01(0.5 + reductionDb / 12);
}

function computeBrightnessPreservation(
  original: CachedAnalysis,
  processed: CachedAnalysis
): number {
  // Spectral centroid should not drop too much
  const origCentroid = original.spectralCentroid;
  const procCentroid = processed.spectralCentroid;

  if (origCentroid <= 0) return 1;

  const ratio = procCentroid / origCentroid;
  // Perfect = 0.9-1.1 ratio. Too low = dull. Too high = harsh.
  if (ratio >= 0.85 && ratio <= 1.15) return 1;
  if (ratio < 0.85) return clamp01(ratio / 0.85);
  return clamp01(2 - ratio / 1.15); // penalize extreme brightness increase
}

function computeArtifactRisk(
  original: CachedAnalysis,
  processed: CachedAnalysis
): number {
  // Artifact risk score: 1 = no risk, 0 = high risk
  let risk = 1;

  // Dullness proxy: air band drops > 12dB
  const airDrop = original.bandEnergies.air - processed.bandEnergies.air;
  if (airDrop > 12) risk -= 0.4;
  else if (airDrop > 6) risk -= 0.2;

  // Lispiness proxy: sibilance band drops > 10dB (over-de-essing)
  const sibDrop = original.bandEnergies.sibilance - processed.bandEnergies.sibilance;
  if (sibDrop > 10) risk -= 0.4;
  else if (sibDrop > 6) risk -= 0.2;

  // Muddiness proxy: mud band increases
  const mudIncrease = processed.bandEnergies.mud - original.bandEnergies.mud;
  if (mudIncrease > 3) risk -= 0.2;

  return clamp01(risk);
}

// ── Main scoring function ─────────────────────────────────────

/**
 * Score a processed buffer against the original.
 * Uses AnalysisCache (Fix 10) and normalizes all metrics to 0-1 (Fix 8).
 */
export function scoreProcessedAudio(
  originalBuffer: AudioBuffer,
  processedBuffer: AudioBuffer,
  targetLufs: number,
  styleProfile?: StyleProfile
): ScoringResult {
  // Get or compute cached analyses (Fix 10)
  const originalAnalysis = getOrComputeAnalysis(originalBuffer);
  const processedAnalysis = getOrComputeAnalysis(processedBuffer);

  // LUFS measurement
  const processedChannels: Float32Array[] = [];
  for (let ch = 0; ch < processedBuffer.numberOfChannels; ch++) {
    processedChannels.push(processedBuffer.getChannelData(ch));
  }
  const processedLufs = computeIntegratedLUFS(processedChannels, processedBuffer.sampleRate);

  // Compute all metrics (normalized 0-1)
  const lufsAccuracy = computeLufsAccuracy(processedLufs, targetLufs);
  const { balance: spectralBalance, deviation: referenceDeviation } =
    computeSpectralBalance(originalAnalysis, processedAnalysis, styleProfile);
  const sibilanceReduction = computeSibilanceReduction(originalAnalysis, processedAnalysis);
  const harshnessReduction = computeHarshnessReduction(originalAnalysis, processedAnalysis);
  const brightnessPreservation = computeBrightnessPreservation(originalAnalysis, processedAnalysis);
  const artifactRisk = computeArtifactRisk(originalAnalysis, processedAnalysis);

  const metrics = {
    lufsAccuracy,
    spectralBalance,
    sibilanceReduction,
    harshnessReduction,
    brightnessPreservation,
    artifactRisk,
  };

  // Weighted sum → 0-100
  const weightedSum =
    metrics.lufsAccuracy * WEIGHTS.lufsAccuracy +
    metrics.spectralBalance * WEIGHTS.spectralBalance +
    metrics.sibilanceReduction * WEIGHTS.sibilanceReduction +
    metrics.harshnessReduction * WEIGHTS.harshnessReduction +
    metrics.brightnessPreservation * WEIGHTS.brightnessPreservation +
    metrics.artifactRisk * WEIGHTS.artifactRisk;

  // Reference deviation penalty (up to -15 points)
  const deviationPenalty = Math.min(15, referenceDeviation * 100);
  const overallScore = Math.round(Math.max(0, Math.min(100, weightedSum * 100 - deviationPenalty)));

  return {
    overallScore,
    metrics,
    processedLufs,
    referenceDeviation,
  };
}
