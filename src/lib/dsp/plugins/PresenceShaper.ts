import { Plugin } from "../Plugin";
import type { PresenceShaperParams, PluginId } from "../types";
import { peaking, createBiquadState, processBiquadBlock, type BiquadCoefficients, type BiquadState } from "../biquad";

export class PresenceShaper extends Plugin<PresenceShaperParams> {
  readonly id: PluginId = "presenceShaper";
  private coeffs!: BiquadCoefficients;
  private states: BiquadState[] = [];

  protected onConfigure(): void {
    this.coeffs = peaking(this.params.frequencyHz, this.ctx.sampleRate, this.params.gainDb, this.params.Q);
    this.states = [createBiquadState(), createBiquadState()];
  }

  reset(): void {
    this.states = [createBiquadState(), createBiquadState()];
  }

  process(channels: Float32Array[]): void {
    for (let ch = 0; ch < channels.length; ch++) {
      const state = this.states[ch] || (this.states[ch] = createBiquadState());
      processBiquadBlock(channels[ch], this.coeffs, state);
    }
  }
}
