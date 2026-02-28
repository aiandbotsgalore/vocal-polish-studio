/**
 * dspEngine.ts — bridges slider overrides to the modular DSP pipeline.
 * Perf: Accepts pre-decoded AudioBuffer to avoid redundant decoding.
 */

import type { GeminiDecision, SliderOverrides } from "@/types/gemini";
import { decisionToSlots } from "./dsp/decisionToSlots";
import { renderOffline } from "./dsp/OfflineRenderEngine";
import { exportToWav } from "./dsp/WavExporter";
import { getStyleProfile } from "./dsp/StyleProfiles";
import type { ChainSlot } from "./dsp/types";
import { startTimer } from "./perfTimer";

/**
 * Apply slider overrides to the Gemini decision, then render through
 * the full modular DSP chain.
 * Accepts either a File or a pre-decoded AudioBuffer to avoid redundant decoding.
 */
export async function renderWithOverrides(
  source: File | AudioBuffer,
  decision: GeminiDecision,
  overrides: SliderOverrides,
  styleTargetKey: string = "natural",
  signal?: AbortSignal
): Promise<{ blob: Blob; buffer: AudioBuffer }> {
  const endTimer = startTimer("renderWithOverrides");

  let sourceBuffer: AudioBuffer;
  if (source instanceof AudioBuffer) {
    sourceBuffer = source;
  } else {
    const ac = new AudioContext();
    const ab = await source.arrayBuffer();
    sourceBuffer = await ac.decodeAudioData(ab);
    ac.close();
  }

  const tweaked: GeminiDecision = {
    ...decision,
    eqBellCutDb: decision.eqBellCutDb * (overrides.harshnessPct / 100),
    optionalSecondEqBellCutDb: decision.optionalSecondEqBellCutDb
      ? decision.optionalSecondEqBellCutDb * (overrides.harshnessPct / 100)
      : undefined,
    deEssReductionDb: decision.deEssReductionDb * (overrides.sibilancePct / 100),
    outputTrimDb: overrides.outputDb,
  };

  const profile = getStyleProfile(styleTargetKey as any);
  const targetLufs = profile.targetLufs;
  const slots = decisionToSlots(tweaked, targetLufs);
  applyBrightnessOverride(slots, overrides.brightnessDb);

  const result = await renderOffline(sourceBuffer, slots, undefined, signal);
  const blob = exportToWav(result.buffer, { bitDepth: 24 });

  endTimer();
  return { blob, buffer: result.buffer };
}

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
