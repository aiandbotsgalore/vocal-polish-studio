/**
 * DSP Web Worker — runs renderOffline, auditionVariants, and scoring
 * entirely off the main thread. Communicates via structured messages
 * with Transferable Float32Array channels for zero-copy.
 */

import { renderOffline, computeNoiseProfile } from "@/lib/dsp/OfflineRenderEngine";
import { scoreProcessedAudio } from "@/lib/dsp/ScoringEngine";
import { validateAndCorrect } from "@/lib/dsp/SafetyRails";
import { decisionToSlots } from "@/lib/dsp/decisionToSlots";
import { exportToWav } from "@/lib/dsp/WavExporter";
import type { ChainSlot, StyleProfile } from "@/lib/dsp/types";
import type { ScoringResult } from "@/lib/dsp/ScoringEngine";
import type { SafetyReport } from "@/lib/dsp/SafetyRails";

// ── Message types ────────────────────────────────────────────

export interface AuditionRequest {
  type: "audition";
  id: string;
  channels: Float32Array[];
  sampleRate: number;
  variantSlots: ChainSlot[][];
  targetLufs: number;
  styleProfile?: StyleProfile;
}

export interface RenderRequest {
  type: "render";
  id: string;
  channels: Float32Array[];
  sampleRate: number;
  slots: ChainSlot[];
}

export interface CancelRequest {
  type: "cancel";
  id: string;
}

export type WorkerRequest = AuditionRequest | RenderRequest | CancelRequest;

export interface SerializedVariant {
  label: string;
  slots: ChainSlot[];
  channels: Float32Array[];
  sampleRate: number;
  score: ScoringResult;
  safety: SafetyReport;
  isSafeBaseline: boolean;
}

export interface AuditionResponse {
  type: "auditionResult";
  id: string;
  variants: SerializedVariant[];
  recommendedIndex: number;
}

export interface RenderResponse {
  type: "renderResult";
  id: string;
  channels: Float32Array[];
  sampleRate: number;
}

export interface ProgressResponse {
  type: "progress";
  id: string;
  pct: number;
}

export interface ErrorResponse {
  type: "error";
  id: string;
  message: string;
}

export type WorkerResponse = AuditionResponse | RenderResponse | ProgressResponse | ErrorResponse;

// ── Helpers ──────────────────────────────────────────────────

function reconstructBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  const buf = new AudioBuffer({
    numberOfChannels: channels.length,
    length,
    sampleRate,
  });
  for (let ch = 0; ch < channels.length; ch++) {
    buf.copyToChannel(channels[ch] as Float32Array<ArrayBuffer>, ch);
  }
  return buf;
}

function extractChannels(buf: AudioBuffer): Float32Array<ArrayBuffer>[] {
  const out: Float32Array<ArrayBuffer>[] = [];
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch);
    const copy = new Float32Array(src.length);
    copy.set(src);
    out.push(copy);
  }
  return out;
}

// ── Safe Baseline builder (duplicated from VariantAudition to avoid circular dep) ──

function buildSafeBaselineSlots(targetLufs: number): ChainSlot[] {
  return [
    { id: "preGain", bypass: true, params: { gainDb: 0 } },
    { id: "highPass", bypass: false, params: { frequencyHz: 80, order: 2 as const } },
    { id: "denoiseLite", bypass: true, params: { reductionAmount: 0 } },
    { id: "noiseGate", bypass: true, params: { thresholdDb: -60, attackMs: 1, releaseMs: 50, holdMs: 50 } },
    { id: "dePlosive", bypass: true, params: { sensitivityDb: -10, frequencyHz: 120 } },
    { id: "resonanceSuppressor", bypass: false, params: { maxNotches: 2, maxCutDb: -3, persistenceFrames: 8 } },
    { id: "dynamicEQ", bypass: false, params: { bands: [{ frequencyHz: 250, Q: 1.2, thresholdDb: -30, maxCutDb: -3, attackMs: 10, releaseMs: 100 }] } },
    { id: "deEsser", bypass: false, params: { frequencyHz: 6500, thresholdDb: -25, maxReductionDb: -3, Q: 2 } },
    { id: "compressor", bypass: false, params: { thresholdDb: -20, ratio: 2, attackMs: 10, releaseMs: 100, kneeDb: 6, makeupGainDb: 2 } },
    { id: "limiter", bypass: false, params: { ceilingDb: -1, releaseMs: 50, lookaheadMs: 1, oversample: false } },
    { id: "presenceShaper", bypass: true, params: { frequencyHz: 3500, gainDb: 0, Q: 1 } },
    { id: "harmonicEnhancer", bypass: true, params: { driveAmount: 0, mixPct: 0, toneHz: 3000 } },
    { id: "gainRider", bypass: true, params: { targetDb: -18, maxBoostDb: 6, maxCutDb: -6, minSnrForBoostDb: 10 } },
    { id: "outputStage", bypass: false, params: { targetLufsDb: targetLufs } },
  ];
}

// ── Active abort controllers ─────────────────────────────────
const abortControllers = new Map<string, AbortController>();

// ── Message handler ──────────────────────────────────────────

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  if (msg.type === "cancel") {
    const ac = abortControllers.get(msg.id);
    if (ac) {
      ac.abort();
      abortControllers.delete(msg.id);
    }
    return;
  }

  if (msg.type === "render") {
    await handleRender(msg);
    return;
  }

  if (msg.type === "audition") {
    await handleAudition(msg);
    return;
  }
};

async function handleRender(msg: RenderRequest) {
  const ac = new AbortController();
  abortControllers.set(msg.id, ac);

  try {
    const sourceBuffer = reconstructBuffer(msg.channels, msg.sampleRate);
    const result = await renderOffline(sourceBuffer, msg.slots, undefined, ac.signal);
    const outChannels = extractChannels(result.buffer);

    const response: RenderResponse = {
      type: "renderResult",
      id: msg.id,
      channels: outChannels,
      sampleRate: result.buffer.sampleRate,
    };

    const transferables = outChannels.map((ch) => ch.buffer);
    (self as unknown as Worker).postMessage(response, transferables);
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    const response: ErrorResponse = {
      type: "error",
      id: msg.id,
      message: (err as Error)?.message ?? "Worker render failed",
    };
    (self as unknown as Worker).postMessage(response);
  } finally {
    abortControllers.delete(msg.id);
  }
}

async function handleAudition(msg: AuditionRequest) {
  const ac = new AbortController();
  abortControllers.set(msg.id, ac);

  try {
    const sourceBuffer = reconstructBuffer(msg.channels, msg.sampleRate);
    const MAX_VARIANTS = 4;
    const capped = msg.variantSlots.slice(0, MAX_VARIANTS);

    const allChains: { label: string; slots: ChainSlot[]; isSafeBaseline: boolean }[] = [
      { label: "Safe Baseline", slots: buildSafeBaselineSlots(msg.targetLufs), isSafeBaseline: true },
      ...capped.map((slots, i) => ({ label: `Variant ${i + 1}`, slots, isSafeBaseline: false })),
    ];

    const totalChains = allChains.length;
    const variants: SerializedVariant[] = [];

    for (let i = 0; i < totalChains; i++) {
      if (ac.signal.aborted) throw new DOMException("Cancelled", "AbortError");

      const { label, slots, isSafeBaseline } = allChains[i];

      const renderResult = await renderOffline(
        sourceBuffer,
        slots,
        (p) => {
          const pct = (i + p) / totalChains;
          const progress: ProgressResponse = { type: "progress", id: msg.id, pct };
          (self as unknown as Worker).postMessage(progress);
        },
        ac.signal,
      );

      // Safety validation (in-place)
      const channels: Float32Array[] = [];
      for (let ch = 0; ch < renderResult.buffer.numberOfChannels; ch++) {
        channels.push(renderResult.buffer.getChannelData(ch));
      }
      const safety = validateAndCorrect(channels, renderResult.buffer.sampleRate);

      // Score
      const score = scoreProcessedAudio(sourceBuffer, renderResult.buffer, msg.targetLufs, msg.styleProfile);

      const outChannels = extractChannels(renderResult.buffer);
      variants.push({ label, slots, channels: outChannels, sampleRate: renderResult.buffer.sampleRate, score, safety, isSafeBaseline });
    }

    // Sort by score descending
    variants.sort((a, b) => b.score.overallScore - a.score.overallScore);

    let recommendedIndex = variants.findIndex((r) => r.safety.passed);
    if (recommendedIndex === -1) {
      recommendedIndex = variants.findIndex((r) => r.isSafeBaseline);
      if (recommendedIndex === -1) recommendedIndex = 0;
    }

    const response: AuditionResponse = {
      type: "auditionResult",
      id: msg.id,
      variants,
      recommendedIndex,
    };

    // Transfer all channel arrays for zero-copy
    const transferables = variants.flatMap((v) => v.channels.map((ch) => ch.buffer));
    (self as unknown as Worker).postMessage(response, transferables);
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    const response: ErrorResponse = {
      type: "error",
      id: msg.id,
      message: (err as Error)?.message ?? "Worker audition failed",
    };
    (self as unknown as Worker).postMessage(response);
  } finally {
    abortControllers.delete(msg.id);
  }
}
