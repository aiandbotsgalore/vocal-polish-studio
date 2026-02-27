import { Plugin } from "../Plugin";
import type { DePlosiveParams, PluginId } from "../types";
import { lowpass, createBiquadState, processBiquadSample, type BiquadCoefficients, type BiquadState } from "../biquad";

/**
 * Detects plosive bursts (low-frequency transients) and attenuates them.
 * Uses a sidechain low-pass to detect energy, then applies fast gain reduction.
 */
export class DePlosive extends Plugin<DePlosiveParams> {
  readonly id: PluginId = "dePlosive";
  private lpCoeffs!: BiquadCoefficients;
  private lpStates: BiquadState[] = [];
  private envelope = 0;
  private thresholdLin = 0;

  protected onConfigure(): void {
    this.lpCoeffs = lowpass(this.params.frequencyHz, this.ctx.sampleRate);
    this.lpStates = [createBiquadState(), createBiquadState()];
    this.thresholdLin = Math.pow(10, this.params.sensitivityDb / 20);
  }

  reset(): void {
    this.lpStates = [createBiquadState(), createBiquadState()];
    this.envelope = 0;
  }

  process(channels: Float32Array[]): void {
    const len = channels[0].length;
    const attackCoeff = Math.exp(-1 / (this.ctx.sampleRate * 0.0005)); // 0.5ms attack
    const releaseCoeff = Math.exp(-1 / (this.ctx.sampleRate * 0.020)); // 20ms release

    for (let i = 0; i < len; i++) {
      // Sidechain: LP filter on first channel to detect low-freq energy
      const scInput = channels[0][i];
      const lpOut = Math.abs(processBiquadSample(scInput, this.lpCoeffs, this.lpStates[0]));

      // Envelope follower
      const coeff = lpOut > this.envelope ? attackCoeff : releaseCoeff;
      this.envelope = coeff * this.envelope + (1 - coeff) * lpOut;

      // Gain reduction when plosive detected
      let gain = 1;
      if (this.envelope > this.thresholdLin) {
        gain = this.thresholdLin / this.envelope;
        gain = Math.max(gain, 0.1); // Max 20dB reduction
      }

      for (const ch of channels) ch[i] *= gain;
    }
  }
}
