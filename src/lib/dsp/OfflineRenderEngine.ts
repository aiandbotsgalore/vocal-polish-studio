/**
 * OfflineRenderEngine — renders a ChainSlot[] config against an AudioBuffer.
 *
 * Fix 12: Validates plugin order before rendering; rejects mismatched chains.
 * Includes pre-pass noise profiling and chunk-based processing.
 */

import { SignalChain } from "./SignalChain";
import {
  PLUGIN_ORDER,
  type ChainSlot,
  type ProcessContext,
  type NoiseProfile,
  type PluginId,
} from "./types";
import { DenoiseLite } from "./plugins/DenoiseLite";

/** Chunk size for yielding to the event loop during offline render */
const RENDER_CHUNK = 8192;

/**
 * Validate that a chain's plugin IDs follow the fixed PLUGIN_ORDER.
 * Returns true if valid, false if order is wrong.
 */
export function validatePluginOrder(slots: ChainSlot[]): boolean {
  const activeIds = slots.filter((s) => !s.bypass).map((s) => s.id);
  if (activeIds.length === 0) return true;

  // Each active plugin must appear in PLUGIN_ORDER, and in the correct relative order
  let lastIndex = -1;
  for (const id of activeIds) {
    const idx = PLUGIN_ORDER.indexOf(id);
    if (idx === -1) return false; // Unknown plugin
    if (idx <= lastIndex) return false; // Out of order
    lastIndex = idx;
  }
  return true;
}

/**
 * Pre-pass noise profiling: analyze the first 0.5s of audio to estimate
 * noise floor, spectral flatness, and per-bin noise spectrum.
 */
export function computeNoiseProfile(
  buffer: AudioBuffer,
  fftSize = 2048
): NoiseProfile {
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const analysisLength = Math.min(
    Math.round(sampleRate * 0.5),
    buffer.length
  );

  // Mono downmix of analysis region
  const mono = new Float32Array(analysisLength);
  const scale = 1 / Math.sqrt(numChannels);
  for (let ch = 0; ch < numChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < analysisLength; i++) {
      mono[i] += data[i] * scale;
    }
  }

  // RMS noise floor
  let sumSq = 0;
  for (let i = 0; i < analysisLength; i++) sumSq += mono[i] * mono[i];
  const rms = Math.sqrt(sumSq / analysisLength);
  const floorDb = rms > 0 ? 20 * Math.log10(rms) : -96;

  // Spectral analysis
  const numBins = fftSize / 2 + 1;
  const hopSize = fftSize / 2;
  const numFrames = Math.max(1, Math.floor((analysisLength - fftSize) / hopSize) + 1);

  const hannWindow = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  const avgSpectrum = new Float32Array(numBins);
  let totalMag = 0;
  let geometricLogSum = 0;
  let binCount = 0;

  for (let frame = 0; frame < numFrames; frame++) {
    const start = frame * hopSize;
    for (let k = 0; k < numBins; k++) {
      const w = (2 * Math.PI * k) / fftSize;
      let re = 0, im = 0;
      for (let n = 0; n < fftSize && start + n < analysisLength; n++) {
        const s = mono[start + n] * hannWindow[n];
        re += s * Math.cos(w * n);
        im -= s * Math.sin(w * n);
      }
      const mag = Math.sqrt(re * re + im * im) / fftSize;
      avgSpectrum[k] += mag;
      if (mag > 1e-12) {
        totalMag += mag;
        geometricLogSum += Math.log(mag);
        binCount++;
      }
    }
  }

  // Average across frames
  for (let k = 0; k < numBins; k++) avgSpectrum[k] /= numFrames;

  // Spectral flatness: geometric mean / arithmetic mean
  let flatness = 0;
  if (binCount > 0 && totalMag > 0) {
    const arithmeticMean = totalMag / binCount;
    const geometricMean = Math.exp(geometricLogSum / binCount);
    flatness = Math.min(1, geometricMean / arithmeticMean);
  }

  return { floorDb, flatness, spectrum: avgSpectrum };
}

export interface RenderResult {
  /** Processed audio buffer */
  buffer: AudioBuffer;
  /** Whether the chain was valid */
  chainValid: boolean;
  /** Noise profile computed from pre-pass */
  noiseProfile: NoiseProfile;
}

/**
 * Render a chain configuration against an AudioBuffer.
 * Async to allow yielding during chunk processing.
 */
export async function renderOffline(
  sourceBuffer: AudioBuffer,
  slots: ChainSlot[],
  onProgress?: (pct: number) => void
): Promise<RenderResult> {
  // Fix 12: Validate plugin order
  const chainValid = validatePluginOrder(slots);
  if (!chainValid) {
    console.error(
      "[OfflineRenderEngine] Plugin order mismatch — rejecting chain. " +
      "Expected order subset of:", PLUGIN_ORDER,
      "Got:", slots.map((s) => s.id)
    );
    // Return unprocessed copy
    return {
      buffer: copyBuffer(sourceBuffer),
      chainValid: false,
      noiseProfile: { floorDb: -96, flatness: 0, spectrum: new Float32Array(0) },
    };
  }

  // Pre-pass: compute noise profile
  const noiseProfile = computeNoiseProfile(sourceBuffer);

  // Build process context
  const ctx: ProcessContext = {
    sampleRate: sourceBuffer.sampleRate,
    blockSize: RENDER_CHUNK,
    noiseProfile,
  };

  // Build and configure chain
  const chain = new SignalChain();
  chain.configure(slots, ctx);

  // Inject noise profile into DenoiseLite if present
  const denoise = chain.getPlugin<DenoiseLite>("denoiseLite");
  if (denoise && "setNoiseProfile" in denoise) {
    (denoise as DenoiseLite).setNoiseProfile(noiseProfile);
  }

  // Copy source buffer data
  const numChannels = sourceBuffer.numberOfChannels;
  const length = sourceBuffer.length;
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(new Float32Array(sourceBuffer.getChannelData(ch)));
  }

  // Chunk-based processing with async yields
  let processed = 0;
  while (processed < length) {
    const end = Math.min(processed + RENDER_CHUNK, length);
    const chunkChannels = channels.map((ch) => ch.subarray(processed, end));
    chain.process(chunkChannels);
    processed = end;

    if (onProgress) onProgress(processed / length);

    // Yield to event loop every chunk
    await yieldToEventLoop();
  }

  // Build output AudioBuffer
  const outBuffer = new AudioBuffer({
    numberOfChannels: numChannels,
    length,
    sampleRate: sourceBuffer.sampleRate,
  });
  for (let ch = 0; ch < numChannels; ch++) {
    outBuffer.copyToChannel(new Float32Array(channels[ch]), ch);
  }

  return { buffer: outBuffer, chainValid: true, noiseProfile };
}

function copyBuffer(src: AudioBuffer): AudioBuffer {
  const out = new AudioBuffer({
    numberOfChannels: src.numberOfChannels,
    length: src.length,
    sampleRate: src.sampleRate,
  });
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    out.copyToChannel(src.getChannelData(ch), ch);
  }
  return out;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
