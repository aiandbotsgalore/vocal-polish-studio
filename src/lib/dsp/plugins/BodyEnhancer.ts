/**
 * BodyEnhancer — adds warmth and body to thin vocals via low-shelf boost.
 * Uses a low-shelf filter centered around 200-400Hz with configurable gain.
 * Includes a gentle saturation stage to add density without clipping.
 */
import { Plugin } from "../Plugin";
import type { BodyEnhancerParams, PluginId } from "../types";
import {
  lowShelf,
  peaking,
  createBiquadState,
  processBiquadBlock,
  type BiquadCoefficients,
  type BiquadState,
} from "../biquad";

export class BodyEnhancer extends Plugin<BodyEnhancerParams> {
  readonly id: PluginId = "bodyEnhancer";
  private shelfCoeffs!: BiquadCoefficients;
  private shelfStates: BiquadState[] = [];
  private warmthCoeffs!: BiquadCoefficients;
  private warmthStates: BiquadState[] = [];
  private satMix = 0;

  protected onConfigure(): void {
    // Primary low-shelf for body
    this.shelfCoeffs = lowShelf(
      this.params.frequencyHz,
      this.ctx.sampleRate,
      this.params.gainDb
    );
    this.shelfStates = [createBiquadState(), createBiquadState()];

    // Secondary warmth bell at ~300Hz for mid-body fill
    if (this.params.warmthDb !== 0) {
      this.warmthCoeffs = peaking(
        300,
        this.ctx.sampleRate,
        this.params.warmthDb,
        0.8
      );
      this.warmthStates = [createBiquadState(), createBiquadState()];
    }

    // Subtle saturation mix (0-1 maps to 0-15% wet)
    this.satMix = this.params.saturationAmount * 0.15;
  }

  reset(): void {
    this.shelfStates = [createBiquadState(), createBiquadState()];
    this.warmthStates = [createBiquadState(), createBiquadState()];
  }

  process(channels: Float32Array[]): void {
    for (let ch = 0; ch < channels.length; ch++) {
      const data = channels[ch];

      // Low-shelf boost
      const shelfState =
        this.shelfStates[ch] || (this.shelfStates[ch] = createBiquadState());
      processBiquadBlock(data, this.shelfCoeffs, shelfState);

      // Warmth bell
      if (this.params.warmthDb !== 0) {
        const warmthState =
          this.warmthStates[ch] || (this.warmthStates[ch] = createBiquadState());
        processBiquadBlock(data, this.warmthCoeffs, warmthState);
      }

      // Subtle soft-clip saturation for density
      if (this.satMix > 0) {
        for (let i = 0; i < data.length; i++) {
          const dry = data[i];
          const wet = Math.tanh(dry * 1.5);
          data[i] = dry * (1 - this.satMix) + wet * this.satMix;
        }
      }
    }
  }
}
