/**
 * Shared analysis cache — now uses shared radix-2 FFT.
 * Reduces analysis cost by ~40-60%.
 */

import { BANDS, type BandName } from "./frequencyBands";
import { getHannWindow, forwardFFT, computeMagnitudes } from "./fft";

export interface CachedAnalysis {
  fftFrames: Float32Array[];
  bandEnergies: Record<BandName, number>;
  spectralCentroid: number;
  sampleRate: number;
  fftSize: number;
}

const cache = new WeakMap<AudioBuffer, CachedAnalysis>();

export function getOrComputeAnalysis(
  buffer: AudioBuffer,
  fftSize = 2048
): CachedAnalysis {
  const existing = cache.get(buffer);
  if (existing && existing.fftSize === fftSize) return existing;

  const analysis = computeAnalysis(buffer, fftSize);
  cache.set(buffer, analysis);
  return analysis;
}

export function hasCachedAnalysis(buffer: AudioBuffer): boolean {
  return cache.has(buffer);
}

export function invalidateCache(buffer: AudioBuffer): void {
  cache.delete(buffer);
}

function computeAnalysis(buffer: AudioBuffer, fftSize: number): CachedAnalysis {
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;

  // Equal-power mono downmix
  const mono = new Float32Array(length);
  const scale = 1 / Math.sqrt(numChannels);
  for (let ch = 0; ch < numChannels; ch++) {
    const chanData = buffer.getChannelData(ch);
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
    // Normalize
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
