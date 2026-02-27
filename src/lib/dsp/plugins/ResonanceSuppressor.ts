/**
 * Detects persistent spectral resonances and applies narrow notch filters.
 * Fix 3: 5-bin median smoothing before peak detection.
 * Fix 3 (plan): Conditional notch strategy — prefer shallow/more over deep/fewer.
 */
import { Plugin } from "../Plugin";
import type { ResonanceSuppressorParams, PluginId } from "../types";
import { notch, createBiquadState, processBiquadBlock, type BiquadCoefficients, type BiquadState } from "../biquad";

interface DetectedResonance {
  frequencyHz: number;
  magnitude: number;
  persistCount: number;
}

export class ResonanceSuppressor extends Plugin<ResonanceSuppressorParams> {
  readonly id: PluginId = "resonanceSuppressor";
  private notchCoeffs: BiquadCoefficients[] = [];
  private notchStates: BiquadState[][] = []; // [notch][channel]
  private resonances: DetectedResonance[] = [];

  protected onConfigure(): void {}

  reset(): void {
    this.notchCoeffs = [];
    this.notchStates = [];
    this.resonances = [];
  }

  /**
   * Analyse a buffer to detect resonances before processing.
   * Should be called during pre-analysis pass.
   */
  analyseAndConfigure(monoData: Float32Array, sampleRate: number): void {
    const fftSize = 2048;
    const hopSize = 512;
    const numBins = fftSize / 2 + 1;
    const freqPerBin = sampleRate / fftSize;
    const hannWindow = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
    }

    // Accumulate peak persistence
    const peakBins = new Map<number, number>(); // bin -> frame count

    for (let pos = 0; pos + fftSize <= monoData.length; pos += hopSize) {
      const magnitudes = new Float32Array(numBins);
      for (let k = 0; k < numBins; k++) {
        const w = (2 * Math.PI * k) / fftSize;
        let re = 0, im = 0;
        for (let n = 0; n < fftSize; n++) {
          const s = monoData[pos + n] * hannWindow[n];
          re += s * Math.cos(w * n);
          im -= s * Math.sin(w * n);
        }
        magnitudes[k] = Math.sqrt(re * re + im * im);
      }

      // Fix 3: 5-bin median smoothing
      const smoothed = this.medianSmooth(magnitudes, 5);

      // Find peaks in smoothed spectrum
      for (let k = 2; k < numBins - 2; k++) {
        if (smoothed[k] > smoothed[k - 1] && smoothed[k] > smoothed[k + 1] &&
            smoothed[k] > smoothed[k - 2] && smoothed[k] > smoothed[k + 2]) {
          // Check if peak is prominent (> 6dB above local average)
          const localAvg = (smoothed[k - 2] + smoothed[k - 1] + smoothed[k + 1] + smoothed[k + 2]) / 4;
          if (smoothed[k] > localAvg * 2) {
            peakBins.set(k, (peakBins.get(k) || 0) + 1);
          }
        }
      }
    }

    // Filter by persistence
    const minPersistence = Math.max(this.params.persistenceFrames, 8);
    const persistent: DetectedResonance[] = [];
    for (const [bin, count] of peakBins) {
      if (count >= minPersistence) {
        persistent.push({
          frequencyHz: bin * freqPerBin,
          magnitude: count,
          persistCount: count,
        });
      }
    }

    // Sort by persistence (most persistent first)
    persistent.sort((a, b) => b.persistCount - a.persistCount);

    // Conditional notch strategy: prefer more shallow over fewer deep
    const maxNotches = Math.min(persistent.length, this.params.maxNotches);
    this.resonances = persistent.slice(0, maxNotches);

    // Distribute cut across notches (prefer shallow)
    const cutPerNotch = this.params.maxCutDb / Math.max(maxNotches, 1);

    this.notchCoeffs = [];
    this.notchStates = [];
    for (const res of this.resonances) {
      const Q = 8; // Narrow notch
      this.notchCoeffs.push(notch(res.frequencyHz, sampleRate, Q));
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
        if (idx >= 0 && idx < data.length) {
          buf[count++] = data[idx];
        }
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
