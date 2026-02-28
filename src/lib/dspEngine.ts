/**
 * dspEngine.ts — bridges slider overrides to the modular DSP pipeline.
 *
 * renderWithOverrides now builds a full ChainSlot[] via decisionToSlots,
 * applies slider tweaks, then renders through OfflineRenderEngine.
 */

import type { GeminiDecision, SliderOverrides } from "@/types/gemini";
import { decisionToSlots } from "./dsp/decisionToSlots";
import { renderOffline } from "./dsp/OfflineRenderEngine";
import { exportToWav } from "./dsp/WavExporter";
import { getStyleProfile } from "./dsp/StyleProfiles";
import type { ChainSlot } from "./dsp/types";

/**
 * Apply slider overrides to the Gemini decision, then render through
 * the full modular DSP chain.
 */
export async function renderWithOverrides(
  file: File,
  decision: GeminiDecision,
  overrides: SliderOverrides,
  styleTargetKey: string = "natural"
): Promise<{ blob: Blob; buffer: AudioBuffer }> {
  // Decode source
  const ac = new AudioContext();
  const ab = await file.arrayBuffer();
  const sourceBuffer = await ac.decodeAudioData(ab);
  ac.close();

  // Build tweaked decision from overrides
  const tweaked: GeminiDecision = {
    ...decision,
    eqBellCutDb: decision.eqBellCutDb * (overrides.harshnessPct / 100),
    optionalSecondEqBellCutDb: decision.optionalSecondEqBellCutDb
      ? decision.optionalSecondEqBellCutDb * (overrides.harshnessPct / 100)
      : undefined,
    deEssReductionDb: decision.deEssReductionDb * (overrides.sibilancePct / 100),
    outputTrimDb: overrides.outputDb,
  };

  // Resolve style profile for target LUFS
  const profile = getStyleProfile(styleTargetKey as any);
  const targetLufs = profile.targetLufs;

  // Build chain slots from tweaked decision
  const slots = decisionToSlots(tweaked, targetLufs);

  // Apply brightness override: adjust presenceShaper
  applyBrightnessOverride(slots, overrides.brightnessDb);

  // Render through modular pipeline
  const result = await renderOffline(sourceBuffer, slots);
  const blob = exportToWav(result.buffer, { bitDepth: 24 });

  return { blob, buffer: result.buffer };
}

/**
 * Modify presenceShaper slot to apply brightness/air adjustment.
 */
function applyBrightnessOverride(slots: ChainSlot[], brightnessDb: number) {
  const presenceSlot = slots.find((s) => s.id === "presenceShaper");
  if (!presenceSlot) return;

  if (brightnessDb !== 0) {
    presenceSlot.bypass = false;
    const existing = presenceSlot.params as { gainDb?: number; frequencyHz?: number; Q?: number };
    presenceSlot.params = {
      frequencyHz: 10000,
      gainDb: (existing.gainDb ?? 0) + brightnessDb,
      Q: 0.5,
    } as any;
  }
}
