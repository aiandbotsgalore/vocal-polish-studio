/**
 * Spectral subtraction denoiser with locked STFT settings.
 * Now uses shared radix-2 FFT instead of naive O(n²) DFT.
 */
import { Plugin } from "../Plugin";
import type { DenoiseLiteParams, PluginId, NoiseProfile } from "../types";
import { getHannWindow, forwardFFT, inverseFFT, computeMagnitudes } from "../fft";

const FFT_SIZE = 2048;
const HOP_SIZE = 512;
const NUM_BINS = FFT_SIZE / 2 + 1;

export class DenoiseLite extends Plugin<DenoiseLiteParams> {
  readonly id: PluginId = "denoiseLite";
  private noiseProfile: NoiseProfile | null = null;
  private active = false;

  protected onConfigure(): void {
    const np = this.ctx.noiseProfile || this.noiseProfile;
    this.active = !!(np && np.floorDb > -58 && np.flatness > 0.6);
  }

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
    for (const data of channels) {
      this.processChannel(data, np.spectrum, reduction);
    }
  }

  private processChannel(data: Float32Array, noiseSpectrum: Float32Array, reduction: number): void {
    const len = data.length;
    const output = new Float32Array(len);
    const windowSum = new Float32Array(len);
    const hann = getHannWindow(FFT_SIZE);

    for (let pos = 0; pos + FFT_SIZE <= len; pos += HOP_SIZE) {
      const re = new Float32Array(FFT_SIZE);
      const im = new Float32Array(FFT_SIZE);
      for (let i = 0; i < FFT_SIZE; i++) {
        re[i] = data[pos + i] * hann[i];
      }

      forwardFFT(re, im);

      // Spectral subtraction
      for (let k = 0; k < NUM_BINS; k++) {
        const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        const noiseMag = k < noiseSpectrum.length ? noiseSpectrum[k] * reduction : 0;
        const newMag = Math.max(mag - noiseMag, mag * 0.05);
        if (mag > 0) {
          const scale = newMag / mag;
          re[k] *= scale;
          im[k] *= scale;
          // Mirror conjugate bins
          if (k > 0 && k < NUM_BINS - 1) {
            re[FFT_SIZE - k] = re[k];
            im[FFT_SIZE - k] = -im[k];
          }
        }
      }

      inverseFFT(re, im);

      for (let n = 0; n < FFT_SIZE; n++) {
        output[pos + n] += re[n] * hann[n];
        windowSum[pos + n] += hann[n] * hann[n];
      }
    }

    for (let i = 0; i < len; i++) {
      data[i] = windowSum[i] > 0.001 ? output[i] / windowSum[i] : data[i];
    }
  }
}
