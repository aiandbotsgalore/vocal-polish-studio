/**
 * LRU analysis cache keyed by RawAudioData.id (string UUID).
 * Max 4 entries (~208 MB worst-case for 5-min stereo at 44.1 kHz).
 * Evicts least-recently-used entry on insert when at capacity.
 */

import { BANDS, type BandName } from "./frequencyBands";
import { getHannWindow, forwardFFT, computeMagnitudes } from "./fft";
import type { RawAudioData } from "./types";

export interface CachedAnalysis {
  fftFrames: Float32Array[];
  bandEnergies: Record<BandName, number>;
  spectralCentroid: number;
  sampleRate: number;
  fftSize: number;
}

const MAX_CACHE_SIZE = 4;

/** LRU order — most-recently-used at the end */
const lruOrder: string[] = [];
const cache = new Map<string, CachedAnalysis>();

function touchLru(id: string): void {
  const idx = lruOrder.indexOf(id);
  if (idx !== -1) lruOrder.splice(idx, 1);
  lruOrder.push(id);
}

function evictIfNeeded(): void {
  while (lruOrder.length > MAX_CACHE_SIZE) {
    const evictId = lruOrder.shift()!;
    cache.delete(evictId);
  }
}

export function getOrComputeAnalysis(
  raw: RawAudioData,
  fftSize = 2048
): CachedAnalysis {
  const existing = cache.get(raw.id);
  if (existing && existing.fftSize === fftSize) {
    touchLru(raw.id);
    return existing;
  }

  const analysis = computeAnalysis(raw, fftSize);
  cache.set(raw.id, analysis);
  touchLru(raw.id);
  evictIfNeeded();
  return analysis;
}

export function hasCachedAnalysis(id: string): boolean {
  return cache.has(id);
}

export function invalidateCache(id: string): void {
  cache.delete(id);
  const idx = lruOrder.indexOf(id);
  if (idx !== -1) lruOrder.splice(idx, 1);
}

/** Flush all entries — used on worker crash cleanup */
export function flushCache(): void {
  cache.clear();
  lruOrder.length = 0;
}

function computeAnalysis(raw: RawAudioData, fftSize: number): CachedAnalysis {
  const { sampleRate, numberOfChannels, length, channels } = raw;

  // Equal-power mono downmix
  const mono = new Float32Array(length);
  const scale = 1 / Math.sqrt(numberOfChannels);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const chanData = channels[ch];
    for (let i = 0; i < length; i++) {
      mono[i] += chanData[i] * scale;
    }
  }

  const hopSize = fftSize / 4;
  const numFrames = Math.floor((length - fftSize) / hopSize) + 1;
  const fftFrames: Float32Array[] = [];
  const hann = getHannWindow(fftSize);
  const numBins = fftSize / 2 + 1;
  const freqPerBin = sampleRate / fftSize;

  const bandEnergyAccum: Record<BandName, number> = {
    rumble: 0, plosive: 0, mud: 0, lowMid: 0,
    presence: 0, harshness: 0, sibilance: 0, air: 0,
  };
  let centroidNum = 0;
  let centroidDen = 0;

  for (let frame = 0; frame < numFrames; frame++) {
    const start = frame * hopSize;
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      re[i] = mono[start + i] * hann[i];
    }

    forwardFFT(re, im);
    const magnitudes = computeMagnitudes(re, im, numBins);
    for (let k = 0; k < numBins; k++) magnitudes[k] /= fftSize;

    fftFrames.push(magnitudes);

    for (let bin = 0; bin < numBins; bin++) {
      const freq = bin * freqPerBin;
      const mag = magnitudes[bin];
      const magSq = mag * mag;
      centroidNum += freq * magSq;
      centroidDen += magSq;

      for (const bandName of Object.keys(BANDS) as BandName[]) {
        const band = BANDS[bandName];
        if (freq >= band.low && freq < band.high) {
          bandEnergyAccum[bandName] += magSq;
        }
      }
    }
  }

  const bandEnergies: Record<BandName, number> = {} as Record<BandName, number>;
  for (const bandName of Object.keys(bandEnergyAccum) as BandName[]) {
    const avg = numFrames > 0 ? bandEnergyAccum[bandName] / numFrames : 0;
    bandEnergies[bandName] = avg > 0 ? 10 * Math.log10(avg) : -96;
  }

  const spectralCentroid = centroidDen > 0 ? centroidNum / centroidDen : 0;

  return { fftFrames, bandEnergies, spectralCentroid, sampleRate, fftSize };
}
