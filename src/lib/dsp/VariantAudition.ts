/**
 * VariantAudition — renders multiple chain variants + Safe Baseline,
 * scores them, and returns ranked results.
 *
 * Uses RawAudioData internally (worker-safe).
 * Accepts AudioBuffer at the public API boundary for main-thread callers.
 */

import { renderOffline, type RenderResult } from "./OfflineRenderEngine";
import { scoreProcessedAudio, type ScoringResult } from "./ScoringEngine";
import { validateAndCorrect, type SafetyReport } from "./SafetyRails";
import type { ChainSlot, StyleProfile, RawAudioData } from "./types";
import { createRawAudioData } from "./types";

const MAX_VARIANTS = 4;

function buildSafeBaselineSlots(targetLufs: number): ChainSlot[] {
  return [
    { id: "preGain", bypass: true, params: { gainDb: 0 } },
    { id: "highPass", bypass: false, params: { frequencyHz: 80, order: 2 as const } },
    { id: "denoiseLite", bypass: true, params: { reductionAmount: 0 } },
    { id: "noiseGate", bypass: true, params: { thresholdDb: -60, attackMs: 1, releaseMs: 50, holdMs: 50 } },
    { id: "dePlosive", bypass: true, params: { sensitivityDb: -10, frequencyHz: 120 } },
    { id: "resonanceSuppressor", bypass: false, params: { maxNotches: 2, maxCutDb: -3, persistenceFrames: 8 } },
    {
      id: "dynamicEQ", bypass: false,
      params: { bands: [{ frequencyHz: 250, Q: 1.2, thresholdDb: -30, maxCutDb: -3, attackMs: 10, releaseMs: 100 }] },
    },
    { id: "deEsser", bypass: false, params: { frequencyHz: 6500, thresholdDb: -25, maxReductionDb: -3, Q: 2 } },
    { id: "compressor", bypass: false, params: { thresholdDb: -20, ratio: 2, attackMs: 10, releaseMs: 100, kneeDb: 6, makeupGainDb: 2 } },
    { id: "limiter", bypass: false, params: { ceilingDb: -1, releaseMs: 50, lookaheadMs: 1, oversample: false } },
    { id: "presenceShaper", bypass: true, params: { frequencyHz: 3500, gainDb: 0, Q: 1 } },
    { id: "harmonicEnhancer", bypass: true, params: { driveAmount: 0, mixPct: 0, toneHz: 3000 } },
    { id: "gainRider", bypass: true, params: { targetDb: -18, maxBoostDb: 6, maxCutDb: -6, minSnrForBoostDb: 10 } },
    { id: "outputStage", bypass: false, params: { targetLufsDb: targetLufs } },
  ];
}

export interface VariantResult {
  label: string;
  slots: ChainSlot[];
  /** Rendered audio as RawAudioData */
  raw: RawAudioData;
  score: ScoringResult;
  safety: SafetyReport;
  isSafeBaseline: boolean;
}

export interface AuditionResult {
  variants: VariantResult[];
  recommendedIndex: number;
}

/**
 * Render and score multiple chain variants plus the Safe Baseline.
 * Accepts RawAudioData directly (worker-safe).
 */
export async function auditionVariants(
  source: RawAudioData,
  variantSlots: ChainSlot[][],
  targetLufs: number,
  styleProfile?: StyleProfile,
  onProgress?: (pct: number) => void,
): Promise<AuditionResult> {
  const capped = variantSlots.slice(0, MAX_VARIANTS);

  const allChains: { label: string; slots: ChainSlot[]; isSafeBaseline: boolean }[] = [
    { label: "Safe Baseline", slots: buildSafeBaselineSlots(targetLufs), isSafeBaseline: true },
    ...capped.map((slots, i) => ({ label: `Variant ${i + 1}`, slots, isSafeBaseline: false })),
  ];

  const totalChains = allChains.length;
  const results: VariantResult[] = [];

  for (let i = 0; i < totalChains; i++) {
    const { label, slots, isSafeBaseline } = allChains[i];

    const renderResult: RenderResult = await renderOffline(
      source,
      slots,
      (p) => onProgress?.((i + p) / totalChains),
    );

    // Safety validation (in-place)
    const safety = validateAndCorrect(renderResult.raw.channels, renderResult.raw.sampleRate);

    // Score
    const score = scoreProcessedAudio(source, renderResult.raw, targetLufs, styleProfile);

    results.push({ label, slots, raw: renderResult.raw, score, safety, isSafeBaseline });
  }

  results.sort((a, b) => b.score.overallScore - a.score.overallScore);

  let recommendedIndex = results.findIndex((r) => r.safety.passed);
  if (recommendedIndex === -1) {
    recommendedIndex = results.findIndex((r) => r.isSafeBaseline);
    if (recommendedIndex === -1) recommendedIndex = 0;
  }

  return { variants: results, recommendedIndex };
}

export { buildSafeBaselineSlots, MAX_VARIANTS };
