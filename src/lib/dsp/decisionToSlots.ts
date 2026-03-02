/**
 * decisionToSlots — converts a GeminiDecision into a ChainSlot[] for the modular DSP pipeline.
 *
 * Maps the high-level EQ/de-ess/output parameters AND additive body/harmonic
 * parameters from Gemini into the fixed 15-plugin chain slot configuration.
 */

import type { GeminiDecision } from "@/types/gemini";
import type { ChainSlot } from "./types";

/**
 * Convert a GeminiDecision into a full 15-slot ChainSlot array.
 * Unmapped plugins are bypassed with sensible defaults.
 */
export function decisionToSlots(
  decision: GeminiDecision,
  targetLufs: number
): ChainSlot[] {
  // Determine which optional features are active
  const hasSecondEq =
    decision.optionalSecondEqBellCenterHz != null &&
    decision.optionalSecondEqBellCutDb != null &&
    decision.optionalSecondEqBellCutDb !== 0;

  const hasHighShelf =
    decision.optionalHighShelfCutDb != null &&
    decision.optionalHighShelfCutDb < 0;

  const hasPresenceComp =
    decision.optionalPresenceCompensationDb != null &&
    decision.optionalPresenceCompensationDb > 0;

  // Additive: body enhancement
  const hasBody =
    (decision.bodyBoostDb != null && decision.bodyBoostDb > 0) ||
    (decision.warmthDb != null && decision.warmthDb > 0);

  // Additive: harmonic saturation
  const hasHarmonics =
    decision.harmonicDriveAmount != null &&
    decision.harmonicDriveAmount > 0 &&
    decision.harmonicMixPct != null &&
    decision.harmonicMixPct > 0;

  // Build DynamicEQ bands from the decision's EQ parameters
  const dynBands: Array<{
    frequencyHz: number;
    Q: number;
    thresholdDb: number;
    maxCutDb: number;
    attackMs: number;
    releaseMs: number;
  }> = [];

  // Primary harshness bell → DynamicEQ band
  if (decision.eqBellCutDb < 0) {
    dynBands.push({
      frequencyHz: decision.eqBellCenterHz,
      Q: decision.eqBellQ,
      thresholdDb: -25,
      maxCutDb: decision.eqBellCutDb,
      attackMs: 5,
      releaseMs: 80,
    });
  }

  // Secondary EQ bell → DynamicEQ band
  if (hasSecondEq) {
    dynBands.push({
      frequencyHz: decision.optionalSecondEqBellCenterHz!,
      Q: decision.optionalSecondEqBellQ ?? 1.5,
      thresholdDb: -25,
      maxCutDb: decision.optionalSecondEqBellCutDb!,
      attackMs: 5,
      releaseMs: 80,
    });
  }

  // High shelf → broad DynamicEQ band at 8kHz
  if (hasHighShelf) {
    dynBands.push({
      frequencyHz: 8000,
      Q: 0.5,
      thresholdDb: -20,
      maxCutDb: decision.optionalHighShelfCutDb!,
      attackMs: 10,
      releaseMs: 100,
    });
  }

  const hasDynEq = dynBands.length > 0;

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
      params: { maxNotches: 3, maxCutDb: -4, persistenceFrames: 8 },
    },
    {
      id: "dynamicEQ",
      bypass: !hasDynEq,
      params: { bands: hasDynEq ? dynBands : [] },
    },
    {
      id: "bodyEnhancer",
      bypass: !hasBody,
      params: {
        frequencyHz: decision.bodyFrequencyHz ?? 250,
        gainDb: hasBody ? (decision.bodyBoostDb ?? 0) : 0,
        warmthDb: hasBody ? (decision.warmthDb ?? 0) : 0,
        saturationAmount: hasBody ? (decision.bodySaturation ?? 0) : 0,
      },
    },
    {
      id: "deEsser",
      bypass: decision.deEssReductionDb === 0,
      params: {
        frequencyHz: decision.deEssCenterHz,
        thresholdDb: -25,
        maxReductionDb: decision.deEssReductionDb,
        Q: 2,
      },
    },
    {
      id: "compressor",
      bypass: false,
      params: {
        thresholdDb: -20,
        ratio: 2.5,
        attackMs: 8,
        releaseMs: 80,
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
      bypass: !hasPresenceComp,
      params: {
        frequencyHz: 4000,
        gainDb: hasPresenceComp ? decision.optionalPresenceCompensationDb! : 0,
        Q: 0.8,
      },
    },
    {
      id: "harmonicEnhancer",
      bypass: !hasHarmonics,
      params: {
        driveAmount: hasHarmonics ? decision.harmonicDriveAmount! : 0,
        mixPct: hasHarmonics ? decision.harmonicMixPct! : 0,
        toneHz: decision.harmonicToneHz ?? 3000,
      },
    },
    {
      id: "gainRider",
      bypass: true,
      params: { targetDb: -18, maxBoostDb: 6, maxCutDb: -6, minSnrForBoostDb: 10 },
    },
    {
      id: "outputStage",
      bypass: false,
      params: { targetLufsDb: targetLufs + (decision.outputTrimDb || 0) },
    },
  ];
}
