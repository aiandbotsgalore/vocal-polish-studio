/**
 * Spectral subtraction denoiser with locked STFT settings.
 * Fix 2: FFT=2048, hop=512, Hann window, 4096-sample async chunks.
 * Fix 6: Dual activation — noiseFloor > -58dB AND flatness > 0.6.
 * Fix 7: Noise profile from original buffer (set externally).
 */
import { Plugin } from "../Plugin";
import type { DenoiseLiteParams, PluginId, NoiseProfile } from "../types";

// Locked internal constants — NOT configurable
const FFT_SIZE = 2048;
const HOP_SIZE = 512;
const CHUNK_SAMPLES = 4096;
const NUM_BINS = FFT_SIZE / 2 + 1;

export class DenoiseLite extends Plugin<DenoiseLiteParams> {
  readonly id: PluginId = "denoiseLite";
  private hannWindow = new Float32Array(FFT_SIZE);
  private noiseProfile: NoiseProfile | null = null;
  private active = false;

  protected onConfigure(): void {
    // Pre-compute Hann window
    for (let i = 0; i < FFT_SIZE; i++) {
      this.hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
    }
    // Activation check
    const np = this.ctx.noiseProfile || this.noiseProfile;
    this.active = !!(np && np.floorDb > -58 && np.flatness > 0.6);
  }

  /** Called by OfflineRenderEngine with pre-pass noise profile */
  setNoiseProfile(profile: NoiseProfile): void {
    this.noiseProfile = profile;
    if (this.ctx) {
      this.active = profile.floorDb > -58 && profile.flatness > 0.6;
    }
  }

  reset(): void {}

  process(channels: Float32Array[]): void {
    if (!this.active) return;
    const np = this.ctx.noiseProfile || this.noiseProfile;
    if (!np) return;

    const reduction = Math.min(this.params.reductionAmount, 1);

    // Process each channel independently
    for (const data of channels) {
      this.processChannel(data, np.spectrum, reduction);
    }
  }

  private processChannel(data: Float32Array, noiseSpectrum: Float32Array, reduction: number): void {
    const len = data.length;
    const output = new Float32Array(len);
    const windowSum = new Float32Array(len);

    for (let pos = 0; pos + FFT_SIZE <= len; pos += HOP_SIZE) {
      // Windowed frame
      const frame = new Float32Array(FFT_SIZE);
      for (let i = 0; i < FFT_SIZE; i++) {
        frame[i] = data[pos + i] * this.hannWindow[i];
      }

      // Forward DFT (real-only input)
      const re = new Float32Array(NUM_BINS);
      const im = new Float32Array(NUM_BINS);
      for (let k = 0; k < NUM_BINS; k++) {
        const w = (2 * Math.PI * k) / FFT_SIZE;
        let rSum = 0, iSum = 0;
        for (let n = 0; n < FFT_SIZE; n++) {
          rSum += frame[n] * Math.cos(w * n);
          iSum -= frame[n] * Math.sin(w * n);
        }
        re[k] = rSum;
        im[k] = iSum;
      }

      // Spectral subtraction
      for (let k = 0; k < NUM_BINS; k++) {
        const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        const noiseMag = k < noiseSpectrum.length ? noiseSpectrum[k] * reduction : 0;
        const newMag = Math.max(mag - noiseMag, mag * 0.05); // Floor at 5% to avoid musical noise
        if (mag > 0) {
          const scale = newMag / mag;
          re[k] *= scale;
          im[k] *= scale;
        }
      }

      // Inverse DFT
      for (let n = 0; n < FFT_SIZE; n++) {
        let sample = 0;
        for (let k = 0; k < NUM_BINS; k++) {
          const w = (2 * Math.PI * k * n) / FFT_SIZE;
          sample += re[k] * Math.cos(w) - im[k] * Math.sin(w);
          // Mirror bins
          if (k > 0 && k < NUM_BINS - 1) {
            sample += re[k] * Math.cos(w) + im[k] * Math.sin(w);
          }
        }
        sample /= FFT_SIZE;
        output[pos + n] += sample * this.hannWindow[n];
        windowSum[pos + n] += this.hannWindow[n] * this.hannWindow[n];
      }
    }

    // Normalize by window overlap
    for (let i = 0; i < len; i++) {
      data[i] = windowSum[i] > 0.001 ? output[i] / windowSum[i] : data[i];
    }
  }
}
