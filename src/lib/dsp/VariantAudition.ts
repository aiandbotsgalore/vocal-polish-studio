/**
 * VariantAudition — renders multiple chain variants + Safe Baseline,
 * scores them, and returns ranked results.
 *
 * Fix 6: Safe Baseline includes DynamicEQ mud band (250Hz, Q=1.2, max -3dB).
 * Fix 9: MAX_VARIANTS = 4; excess variants are truncated.
 */

import { renderOffline, type RenderResult } from "./OfflineRenderEngine";
import { scoreProcessedAudio, type ScoringResult } from "./ScoringEngine";
import { validateAndCorrect, type SafetyReport } from "./SafetyRails";
import type { ChainSlot, StyleProfile } from "./types";

/** Maximum variant chains to render (excluding Safe Baseline) */
const MAX_VARIANTS = 4;

/**
 * The Safe Baseline chain — conservative, always-works processing.
 * HPF 80Hz → DynamicEQ (mud band) → ResonanceSuppressor → DeEsser → Compressor → Limiter → OutputStage
 */
function buildSafeBaselineSlots(targetLufs: number): ChainSlot[] {
  return [
    {
      id: "preGain",
      bypass: true,
      params: { gainDb: 0 },
    },
    {
      id: "highPass",
      bypass: false,
      params: { frequencyHz: 80, order: 2 as const },
    },
    {
      id: "denoiseLite",
      bypass: true,
      params: { reductionAmount: 0 },
    },
    {
      id: "noiseGate",
      bypass: true,
      params: { thresholdDb: -60, attackMs: 1, releaseMs: 50, holdMs: 50 },
    },
    {
      id: "dePlosive",
      bypass: true,
      params: { sensitivityDb: -10, frequencyHz: 120 },
    },
    {
      id: "resonanceSuppressor",
      bypass: false,
      params: { maxNotches: 2, maxCutDb: -3, persistenceFrames: 8 },
    },
    {
      // Fix 6: DynamicEQ mud band in Safe Baseline
      id: "dynamicEQ",
      bypass: false,
      params: {
        bands: [
          {
            frequencyHz: 250,
            Q: 1.2,
            thresholdDb: -30,
            maxCutDb: -3,
            attackMs: 10,
            releaseMs: 100,
          },
        ],
      },
    },
    {
      id: "deEsser",
      bypass: false,
      params: { frequencyHz: 6500, thresholdDb: -25, maxReductionDb: -3, Q: 2 },
    },
    {
      id: "compressor",
      bypass: false,
      params: {
        thresholdDb: -20,
        ratio: 2,
        attackMs: 10,
        releaseMs: 100,
        kneeDb: 6,
        makeupGainDb: 2,
      },
    },
    {
      id: "limiter",
      bypass: false,
      params: { ceilingDb: -1, releaseMs: 50, lookaheadMs: 1, oversample: false },
    },
    {
      id: "presenceShaper",
      bypass: true,
      params: { frequencyHz: 3500, gainDb: 0, Q: 1 },
    },
    {
      id: "harmonicEnhancer",
      bypass: true,
      params: { driveAmount: 0, mixPct: 0, toneHz: 3000 },
    },
    {
      id: "gainRider",
      bypass: true,
      params: { targetDb: -18, maxBoostDb: 6, maxCutDb: -6, minSnrForBoostDb: 10 },
    },
    {
      id: "outputStage",
      bypass: false,
      params: { targetLufsDb: targetLufs },
    },
  ];
}

export interface VariantResult {
  /** Variant label (e.g. "Safe Baseline", "Variant 1") */
  label: string;
  /** The chain slots used */
  slots: ChainSlot[];
  /** Rendered audio buffer */
  buffer: AudioBuffer;
  /** Scoring result */
  score: ScoringResult;
  /** Safety validation report */
  safety: SafetyReport;
  /** Whether this is the safe baseline */
  isSafeBaseline: boolean;
}

export interface AuditionResult {
  /** All variants, sorted by score descending */
  variants: VariantResult[];
  /** Index of the recommended variant */
  recommendedIndex: number;
}

/**
 * Render and score multiple chain variants plus the Safe Baseline.
 *
 * @param sourceBuffer - Original audio buffer
 * @param variantSlots - Array of chain configurations from Gemini
 * @param targetLufs - Target loudness
 * @param styleProfile - Optional style reference for scoring
 * @param onProgress - Progress callback (0-1)
 */
export async function auditionVariants(
  sourceBuffer: AudioBuffer,
  variantSlots: ChainSlot[][],
  targetLufs: number,
  styleProfile?: StyleProfile,
  onProgress?: (pct: number) => void,
): Promise<AuditionResult> {
  // Fix 9: Cap at MAX_VARIANTS
  const capped = variantSlots.slice(0, MAX_VARIANTS);

  // Build full list: Safe Baseline + capped variants
  const allChains: { label: string; slots: ChainSlot[]; isSafeBaseline: boolean }[] = [
    { label: "Safe Baseline", slots: buildSafeBaselineSlots(targetLufs), isSafeBaseline: true },
    ...capped.map((slots, i) => ({
      label: `Variant ${i + 1}`,
      slots,
      isSafeBaseline: false,
    })),
  ];

  const totalChains = allChains.length;
  const results: VariantResult[] = [];

  for (let i = 0; i < totalChains; i++) {
    const { label, slots, isSafeBaseline } = allChains[i];

    // Render
    const renderResult: RenderResult = await renderOffline(
      sourceBuffer,
      slots,
      (p) => onProgress?.((i + p) / totalChains),
    );

    // If chain was invalid, renderOffline returns unprocessed copy
    // Still score it for comparison

    // Safety validation (in-place corrections)
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < renderResult.buffer.numberOfChannels; ch++) {
      channels.push(renderResult.buffer.getChannelData(ch));
    }
    const safety = validateAndCorrect(channels, renderResult.buffer.sampleRate);

    // Score
    const score = scoreProcessedAudio(
      sourceBuffer,
      renderResult.buffer,
      targetLufs,
      styleProfile,
    );

    results.push({ label, slots, buffer: renderResult.buffer, score, safety, isSafeBaseline });
  }

  // Sort by overall score descending
  results.sort((a, b) => b.score.overallScore - a.score.overallScore);

  // Recommended = highest scoring that passed safety
  let recommendedIndex = results.findIndex((r) => r.safety.passed);
  if (recommendedIndex === -1) {
    // Fallback to safe baseline
    recommendedIndex = results.findIndex((r) => r.isSafeBaseline);
    if (recommendedIndex === -1) recommendedIndex = 0;
  }

  return { variants: results, recommendedIndex };
}

export { buildSafeBaselineSlots, MAX_VARIANTS };
