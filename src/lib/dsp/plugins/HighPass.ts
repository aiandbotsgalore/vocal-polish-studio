import { Plugin } from "../Plugin";
import type { HighPassParams, PluginId } from "../types";
import { highpass, createBiquadState, processBiquadSample, type BiquadCoefficients, type BiquadState } from "../biquad";

export class HighPass extends Plugin<HighPassParams> {
  readonly id: PluginId = "highPass";
  private coeffs: BiquadCoefficients[] = [];
  private states: BiquadState[][] = []; // [stage][channel]

  protected onConfigure(): void {
    const stages = this.params.order === 4 ? 2 : 1;
    this.coeffs = [];
    for (let s = 0; s < stages; s++) {
      this.coeffs.push(highpass(this.params.frequencyHz, this.ctx.sampleRate));
    }
    this.resetStates();
  }

  private resetStates(): void {
    const stages = this.coeffs.length;
    this.states = [];
    for (let s = 0; s < stages; s++) {
      this.states.push([createBiquadState(), createBiquadState()]);
    }
  }

  reset(): void {
    this.resetStates();
  }

  process(channels: Float32Array[]): void {
    for (let ch = 0; ch < channels.length; ch++) {
      const data = channels[ch];
      for (let s = 0; s < this.coeffs.length; s++) {
        const c = this.coeffs[s];
        const st = this.states[s][ch] || (this.states[s][ch] = createBiquadState());
        for (let i = 0; i < data.length; i++) {
          data[i] = processBiquadSample(data[i], c, st);
        }
      }
    }
  }
}
