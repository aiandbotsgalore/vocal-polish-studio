/**
 * OfflineRenderEngine — renders a ChainSlot[] config against RawAudioData.
 *
 * Worker-safe: no AudioBuffer dependency.
 * Uses time-budgeted yielding (8 ms budget) for UI responsiveness.
 * Uses shared radix-2 FFT for noise profiling.
 */

import { SignalChain } from "./SignalChain";
import {
  PLUGIN_ORDER,
  type ChainSlot,
  type ProcessContext,
  type NoiseProfile,
  type RawAudioData,
  createRawAudioData,
} from "./types";
import { DenoiseLite } from "./plugins/DenoiseLite";
import { getHannWindow, forwardFFT, computeMagnitudes } from "./fft";
import { startTimer } from "../perfTimer";

const RENDER_CHUNK = 8192;
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
 * Pre-pass noise profiling using shared FFT. Accepts RawAudioData.
 */
export function computeNoiseProfile(
  raw: RawAudioData,
  fftSize = 2048
): NoiseProfile {
  const { sampleRate, numberOfChannels, channels } = raw;
  const analysisLength = Math.min(Math.round(sampleRate * 0.5), raw.length);

  const mono = new Float32Array(analysisLength);
  const scale = 1 / Math.sqrt(numberOfChannels);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const data = channels[ch];
    for (let i = 0; i < analysisLength; i++) {
      mono[i] += data[i] * scale;
    }
  }

  let sumSq = 0;
  for (let i = 0; i < analysisLength; i++) sumSq += mono[i] * mono[i];
  const rms = Math.sqrt(sumSq / analysisLength);
  const floorDb = rms > 0 ? 20 * Math.log10(rms) : -96;

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
  raw: RawAudioData;
  chainValid: boolean;
  noiseProfile: NoiseProfile;
}

/**
 * Render a chain configuration against RawAudioData.
 * Uses time-budgeted yielding for UI responsiveness.
 * Supports cancellation via AbortSignal.
 */
export async function renderOffline(
  source: RawAudioData,
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
      raw: copyRaw(source),
      chainValid: false,
      noiseProfile: { floorDb: -96, flatness: 0, spectrum: new Float32Array(0) },
    };
  }

  const noiseProfile = computeNoiseProfile(source);

  const ctx: ProcessContext = {
    sampleRate: source.sampleRate,
    blockSize: RENDER_CHUNK,
    noiseProfile,
  };

  const chain = new SignalChain();
  chain.configure(slots, ctx);

  const denoise = chain.getPlugin<DenoiseLite>("denoiseLite");
  if (denoise && "setNoiseProfile" in denoise) {
    (denoise as DenoiseLite).setNoiseProfile(noiseProfile);
  }

  const { numberOfChannels, length, channels: srcChannels } = source;
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const copy = new Float32Array(srcChannels[ch].length);
    copy.set(srcChannels[ch]);
    channels.push(copy);
  }

  let processed = 0;
  let lastYield = performance.now();

  while (processed < length) {
    if (signal?.aborted) {
      endTimer();
      throw new DOMException("Render cancelled", "AbortError");
    }

    const end = Math.min(processed + RENDER_CHUNK, length);
    const chunkChannels = channels.map((ch) => ch.subarray(processed, end));
    chain.process(chunkChannels);
    processed = end;

    if (onProgress) onProgress(processed / length);

    const now = performance.now();
    if (now - lastYield > YIELD_BUDGET_MS) {
      await yieldToEventLoop();
      lastYield = performance.now();
    }
  }

  const outRaw = createRawAudioData(channels, source.sampleRate);

  endTimer();
  return { raw: outRaw, chainValid: true, noiseProfile };
}

function copyRaw(src: RawAudioData): RawAudioData {
  const channels = src.channels.map((ch) => {
    const copy = new Float32Array(ch.length);
    copy.set(ch);
    return copy;
  });
  return createRawAudioData(channels, src.sampleRate);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
