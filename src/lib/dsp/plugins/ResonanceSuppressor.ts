/**
 * Detects persistent spectral resonances and applies narrow notch filters.
 * Now uses shared radix-2 FFT instead of naive O(n²) DFT.
 */
import { Plugin } from "../Plugin";
import type { ResonanceSuppressorParams, PluginId } from "../types";
import { notch, createBiquadState, processBiquadBlock, type BiquadCoefficients, type BiquadState } from "../biquad";
import { getHannWindow, forwardFFT, computeMagnitudes } from "../fft";

interface DetectedResonance {
  frequencyHz: number;
  magnitude: number;
  persistCount: number;
}

export class ResonanceSuppressor extends Plugin<ResonanceSuppressorParams> {
  readonly id: PluginId = "resonanceSuppressor";
  private notchCoeffs: BiquadCoefficients[] = [];
  private notchStates: BiquadState[][] = [];
  private resonances: DetectedResonance[] = [];

  protected onConfigure(): void {}

  reset(): void {
    this.notchCoeffs = [];
    this.notchStates = [];
    this.resonances = [];
  }

  analyseAndConfigure(monoData: Float32Array, sampleRate: number): void {
    const fftSize = 2048;
    const hopSize = 512;
    const numBins = fftSize / 2 + 1;
    const freqPerBin = sampleRate / fftSize;
    const hann = getHannWindow(fftSize);

    const peakBins = new Map<number, number>();

    for (let pos = 0; pos + fftSize <= monoData.length; pos += hopSize) {
      const re = new Float32Array(fftSize);
      const im = new Float32Array(fftSize);
      for (let n = 0; n < fftSize; n++) {
        re[n] = monoData[pos + n] * hann[n];
      }
      forwardFFT(re, im);
      const magnitudes = computeMagnitudes(re, im, numBins);

      const smoothed = this.medianSmooth(magnitudes, 5);

      for (let k = 2; k < numBins - 2; k++) {
        if (smoothed[k] > smoothed[k - 1] && smoothed[k] > smoothed[k + 1] &&
            smoothed[k] > smoothed[k - 2] && smoothed[k] > smoothed[k + 2]) {
          const localAvg = (smoothed[k - 2] + smoothed[k - 1] + smoothed[k + 1] + smoothed[k + 2]) / 4;
          if (smoothed[k] > localAvg * 2) {
            peakBins.set(k, (peakBins.get(k) || 0) + 1);
          }
        }
      }
    }

    const minPersistence = Math.max(this.params.persistenceFrames, 8);
    const persistent: DetectedResonance[] = [];
    for (const [bin, count] of peakBins) {
      if (count >= minPersistence) {
        persistent.push({ frequencyHz: bin * freqPerBin, magnitude: count, persistCount: count });
      }
    }

    persistent.sort((a, b) => b.persistCount - a.persistCount);

    const maxNotches = Math.min(persistent.length, this.params.maxNotches);
    this.resonances = persistent.slice(0, maxNotches);

    this.notchCoeffs = [];
    this.notchStates = [];
    for (const res of this.resonances) {
      this.notchCoeffs.push(notch(res.frequencyHz, sampleRate, 8));
      this.notchStates.push([createBiquadState(), createBiquadState()]);
    }
  }

  private medianSmooth(data: Float32Array, windowSize: number): Float32Array {
    const result = new Float32Array(data.length);
    const half = Math.floor(windowSize / 2);
    const buf: number[] = new Array(windowSize);
    for (let i = 0; i < data.length; i++) {
      let count = 0;
      for (let j = -half; j <= half; j++) {
        const idx = i + j;
        if (idx >= 0 && idx < data.length) buf[count++] = data[idx];
      }
      const slice = buf.slice(0, count).sort((a, b) => a - b);
      result[i] = slice[Math.floor(count / 2)];
    }
    return result;
  }

  process(channels: Float32Array[]): void {
    for (let n = 0; n < this.notchCoeffs.length; n++) {
      const coeffs = this.notchCoeffs[n];
      for (let ch = 0; ch < channels.length; ch++) {
        const state = this.notchStates[n][ch] || (this.notchStates[n][ch] = createBiquadState());
        processBiquadBlock(channels[ch], coeffs, state);
      }
    }
  }
}
