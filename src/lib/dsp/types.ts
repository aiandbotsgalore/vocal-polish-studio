/**
 * Core DSP type definitions for the plugin engine.
 * All plugins, the SignalChain, and the render engine share these types.
 */

import type { BandName } from "./frequencyBands";

// ── Plugin identifiers (fixed order) ──────────────────────────────
export const PLUGIN_ORDER = [
  "preGain",
  "highPass",
  "denoiseLite",
  "noiseGate",
  "dePlosive",
  "resonanceSuppressor",
  "dynamicEQ",
  "deEsser",
  "compressor",
  "limiter",
  "presenceShaper",
  "harmonicEnhancer",
  "gainRider",
  "outputStage",
] as const;

export type PluginId = (typeof PLUGIN_ORDER)[number];

// ── Processing context passed to every plugin ─────────────────────
export interface ProcessContext {
  sampleRate: number;
  blockSize: number;
  /** Noise profile captured from original buffer pre-chain */
  noiseProfile?: NoiseProfile;
}

export interface NoiseProfile {
  /** Noise floor in dBFS */
  floorDb: number;
  /** Spectral flatness 0-1 (1 = pure broadband) */
  flatness: number;
  /** Per-bin average noise magnitude (fftSize / 2 + 1 bins) */
  spectrum: Float32Array;
}

// ── Per-plugin parameter interfaces ───────────────────────────────

export interface PreGainParams {
  gainDb: number; // -12 to +12
}

export interface HighPassParams {
  frequencyHz: number; // 20 to 300
  order: 2 | 4; // 2nd or 4th order Butterworth
}

export interface DenoiseLiteParams {
  reductionAmount: number; // 0 to 1
  /** Internal activation requires noiseFloor > -58 AND flatness > 0.6 */
}

export interface NoiseGateParams {
  thresholdDb: number; // -80 to -20
  attackMs: number; // 0.1 to 50
  releaseMs: number; // 10 to 500
  holdMs: number; // 0 to 200
}

export interface DePlosiveParams {
  sensitivityDb: number; // -20 to 0
  frequencyHz: number; // 60 to 200
}

export interface ResonanceSuppressorParams {
  maxNotches: number; // 1 to 4
  maxCutDb: number; // -1 to -6
  /** Persistence frames required before notching (minimum 8) */
  persistenceFrames: number;
}

export interface DynamicEQBand {
  frequencyHz: number;
  Q: number;
  thresholdDb: number;
  maxCutDb: number; // negative
  attackMs: number;
  releaseMs: number;
}

export interface DynamicEQParams {
  bands: DynamicEQBand[];
}

export interface DeEsserParams {
  frequencyHz: number; // 4000 to 10000
  thresholdDb: number; // -40 to 0
  maxReductionDb: number; // -1 to -8
  Q: number; // 0.5 to 4
}

export interface CompressorParams {
  thresholdDb: number; // -40 to 0
  ratio: number; // 1 to 20
  attackMs: number; // 0.1 to 100
  releaseMs: number; // 10 to 1000
  kneeDb: number; // 0 to 12
  makeupGainDb: number; // 0 to 12
}

export interface LimiterParams {
  ceilingDb: number; // -3.0 to -0.5
  releaseMs: number; // 10 to 200
  lookaheadMs: number; // 0 to 5
  oversample: boolean;
}

export interface PresenceShaperParams {
  frequencyHz: number; // 2000 to 6000
  gainDb: number; // -3 to +4
  Q: number; // 0.5 to 2
}

export interface HarmonicEnhancerParams {
  driveAmount: number; // 0 to 1
  mixPct: number; // 0 to 100
  toneHz: number; // 1000 to 8000
}

export interface GainRiderParams {
  targetDb: number; // -24 to -6
  maxBoostDb: number; // 0 to 12
  maxCutDb: number; // -12 to 0
  /** Min SNR required before boosting (dB). Default 10. */
  minSnrForBoostDb: number;
}

export interface OutputStageParams {
  targetLufsDb: number; // -24 to -10
}

// ── Union of all params ───────────────────────────────────────────
export type PluginParams = {
  preGain: PreGainParams;
  highPass: HighPassParams;
  denoiseLite: DenoiseLiteParams;
  noiseGate: NoiseGateParams;
  dePlosive: DePlosiveParams;
  resonanceSuppressor: ResonanceSuppressorParams;
  dynamicEQ: DynamicEQParams;
  deEsser: DeEsserParams;
  compressor: CompressorParams;
  limiter: LimiterParams;
  presenceShaper: PresenceShaperParams;
  harmonicEnhancer: HarmonicEnhancerParams;
  gainRider: GainRiderParams;
  outputStage: OutputStageParams;
};

// ── Chain slot (what Gemini returns per plugin) ───────────────────
export interface ChainSlot<K extends PluginId = PluginId> {
  id: K;
  bypass: boolean;
  params: PluginParams[K];
}

// ── Style profile reference data ──────────────────────────────────
export interface StyleProfile {
  name: string;
  referenceBandRatios: Partial<Record<BandName, number>>;
  referenceCentroidRange: [number, number]; // [min, max] Hz
  noiseTolerance: number; // 0-1 scale
  targetLufs: number;
}

// ── Worker-safe audio data (no AudioBuffer dependency) ────────

export interface RawAudioData {
  /** UUID for cache keying — thread-safe across workers/tabs */
  id: string;
  channels: Float32Array[];
  sampleRate: number;
  length: number;
  numberOfChannels: number;
}

/**
 * Factory for RawAudioData with validation.
 * - Throws on channel length mismatch
 * - Throws on zero-length or empty channels
 */
export function createRawAudioData(
  channels: Float32Array[],
  sampleRate: number
): RawAudioData {
  if (channels.length === 0) {
    throw new Error("createRawAudioData: channels array is empty");
  }
  const length = channels[0].length;
  if (length === 0) {
    throw new Error("createRawAudioData: channel length is 0");
  }
  if (channels.some((ch) => ch.length !== length)) {
    throw new Error("createRawAudioData: channel length mismatch across channels");
  }
  return {
    id: crypto.randomUUID(),
    channels,
    sampleRate,
    length,
    numberOfChannels: channels.length,
  };
}
