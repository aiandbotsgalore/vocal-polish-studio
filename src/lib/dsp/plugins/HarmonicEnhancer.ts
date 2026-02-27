/**
 * Soft-clip harmonic saturation with tone filter.
 * Generates even/odd harmonics via tanh waveshaping, then blends with dry signal.
 */
import { Plugin } from "../Plugin";
import type { HarmonicEnhancerParams, PluginId } from "../types";
import { highpass, createBiquadState, processBiquadBlock, type BiquadCoefficients, type BiquadState } from "../biquad";

export class HarmonicEnhancer extends Plugin<HarmonicEnhancerParams> {
  readonly id: PluginId = "harmonicEnhancer";
  private toneCoeffs!: BiquadCoefficients;
  private toneStates: BiquadState[] = [];
  private mix = 0;
  private drive = 1;

  protected onConfigure(): void {
    // Tone filter: HP to control which harmonics pass through
    this.toneCoeffs = highpass(this.params.toneHz, this.ctx.sampleRate);
    this.toneStates = [createBiquadState(), createBiquadState()];
    this.mix = this.params.mixPct / 100;
    this.drive = 1 + this.params.driveAmount * 5; // 1x to 6x drive
  }

  reset(): void {
    this.toneStates = [createBiquadState(), createBiquadState()];
  }

  process(channels: Float32Array[]): void {
    for (let ch = 0; ch < channels.length; ch++) {
      const data = channels[ch];
      // Generate harmonics into temp buffer
      const harmonics = new Float32Array(data.length);
      for (let i = 0; i < data.length; i++) {
        harmonics[i] = Math.tanh(data[i] * this.drive);
      }

      // Tone filter on harmonics only
      const state = this.toneStates[ch] || (this.toneStates[ch] = createBiquadState());
      processBiquadBlock(harmonics, this.toneCoeffs, state);

      // Mix
      for (let i = 0; i < data.length; i++) {
        data[i] = data[i] * (1 - this.mix) + harmonics[i] * this.mix;
      }
    }
  }
}
