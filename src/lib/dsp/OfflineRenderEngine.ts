/**
 * OfflineRenderEngine — renders a ChainSlot[] config against an AudioBuffer.
 *
 * Fix 12: Validates plugin order before rendering; rejects mismatched chains.
 * Perf: Time-budgeted yielding (8ms budget) instead of yield-every-chunk.
 * Perf: Uses shared radix-2 FFT for noise profiling.
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
import { getHannWindow, forwardFFT, computeMagnitudes } from "./fft";
import { startTimer } from "../perfTimer";

/** Chunk size for offline render */
const RENDER_CHUNK = 8192;

/** Time budget per JS task before yielding (ms) */
const YIELD_BUDGET_MS = 8;

export function validatePluginOrder(slots: ChainSlot[]): boolean {
  const activeIds = slots.filter((s) => !s.bypass).map((s) => s.id);
  if (activeIds.length === 0) return true;
  let lastIndex = -1;
  for (const id of activeIds) {
    const idx = PLUGIN_ORDER.indexOf(id);
    if (idx === -1) return false;
    if (idx <= lastIndex) return false;
    lastIndex = idx;
  }
  return true;
}

/**
 * Pre-pass noise profiling using shared FFT.
 */
export function computeNoiseProfile(
  buffer: AudioBuffer,
  fftSize = 2048
): NoiseProfile {
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const analysisLength = Math.min(Math.round(sampleRate * 0.5), buffer.length);

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

  // Spectral analysis with shared FFT
  const numBins = fftSize / 2 + 1;
  const hopSize = fftSize / 2;
  const numFrames = Math.max(1, Math.floor((analysisLength - fftSize) / hopSize) + 1);
  const hann = getHannWindow(fftSize);
  const avgSpectrum = new Float32Array(numBins);
  let totalMag = 0;
  let geometricLogSum = 0;
  let binCount = 0;

  for (let frame = 0; frame < numFrames; frame++) {
    const start = frame * hopSize;
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    const available = Math.min(fftSize, analysisLength - start);
    for (let n = 0; n < available; n++) {
      re[n] = mono[start + n] * hann[n];
    }
    forwardFFT(re, im);
    const mags = computeMagnitudes(re, im, numBins);

    for (let k = 0; k < numBins; k++) {
      const mag = mags[k] / fftSize;
      avgSpectrum[k] += mag;
      if (mag > 1e-12) {
        totalMag += mag;
        geometricLogSum += Math.log(mag);
        binCount++;
      }
    }
  }

  for (let k = 0; k < numBins; k++) avgSpectrum[k] /= numFrames;

  let flatness = 0;
  if (binCount > 0 && totalMag > 0) {
    const arithmeticMean = totalMag / binCount;
    const geometricMean = Math.exp(geometricLogSum / binCount);
    flatness = Math.min(1, geometricMean / arithmeticMean);
  }

  return { floorDb, flatness, spectrum: avgSpectrum };
}

export interface RenderResult {
  buffer: AudioBuffer;
  chainValid: boolean;
  noiseProfile: NoiseProfile;
}

/**
 * Render a chain configuration against an AudioBuffer.
 * Uses time-budgeted yielding for UI responsiveness.
 * Supports cancellation via AbortSignal.
 */
export async function renderOffline(
  sourceBuffer: AudioBuffer,
  slots: ChainSlot[],
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<RenderResult> {
  const endTimer = startTimer("renderOffline");

  const chainValid = validatePluginOrder(slots);
  if (!chainValid) {
    console.error("[OfflineRenderEngine] Plugin order mismatch — rejecting chain.");
    endTimer();
    return {
      buffer: copyBuffer(sourceBuffer),
      chainValid: false,
      noiseProfile: { floorDb: -96, flatness: 0, spectrum: new Float32Array(0) },
    };
  }

  const noiseProfile = computeNoiseProfile(sourceBuffer);

  const ctx: ProcessContext = {
    sampleRate: sourceBuffer.sampleRate,
    blockSize: RENDER_CHUNK,
    noiseProfile,
  };

  const chain = new SignalChain();
  chain.configure(slots, ctx);

  const denoise = chain.getPlugin<DenoiseLite>("denoiseLite");
  if (denoise && "setNoiseProfile" in denoise) {
    (denoise as DenoiseLite).setNoiseProfile(noiseProfile);
  }

  const numChannels = sourceBuffer.numberOfChannels;
  const length = sourceBuffer.length;
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(new Float32Array(sourceBuffer.getChannelData(ch)));
  }

  // Time-budgeted chunk processing
  let processed = 0;
  let lastYield = performance.now();

  while (processed < length) {
    // Check cancellation
    if (signal?.aborted) {
      endTimer();
      throw new DOMException("Render cancelled", "AbortError");
    }

    const end = Math.min(processed + RENDER_CHUNK, length);
    const chunkChannels = channels.map((ch) => ch.subarray(processed, end));
    chain.process(chunkChannels);
    processed = end;

    if (onProgress) onProgress(processed / length);

    // Yield only when time budget exceeded
    const now = performance.now();
    if (now - lastYield > YIELD_BUDGET_MS) {
      await yieldToEventLoop();
      lastYield = performance.now();
    }
  }

  const outBuffer = new AudioBuffer({
    numberOfChannels: numChannels,
    length,
    sampleRate: sourceBuffer.sampleRate,
  });
  for (let ch = 0; ch < numChannels; ch++) {
    outBuffer.copyToChannel(new Float32Array(channels[ch]), ch);
  }

  endTimer();
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
