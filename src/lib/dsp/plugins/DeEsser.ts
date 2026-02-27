import { Plugin } from "../Plugin";
import type { DeEsserParams, PluginId } from "../types";
import { bandpass, peaking, createBiquadState, processBiquadSample, type BiquadCoefficients, type BiquadState } from "../biquad";

export class DeEsser extends Plugin<DeEsserParams> {
  readonly id: PluginId = "deEsser";
  private scCoeffs!: BiquadCoefficients;
  private scStates: BiquadState[] = [];
  private eqCoeffs!: BiquadCoefficients;
  private eqStates: BiquadState[] = [];
  private envelope = 0;
  private attackCoeff = 0;
  private releaseCoeff = 0;
  private thresholdLin = 0;

  protected onConfigure(): void {
    const sr = this.ctx.sampleRate;
    this.scCoeffs = bandpass(this.params.frequencyHz, sr, this.params.Q);
    this.eqCoeffs = peaking(this.params.frequencyHz, sr, this.params.maxReductionDb, this.params.Q);
    this.scStates = [createBiquadState(), createBiquadState()];
    this.eqStates = [createBiquadState(), createBiquadState()];
    this.attackCoeff = Math.exp(-1 / (sr * 0.001)); // 1ms attack
    this.releaseCoeff = Math.exp(-1 / (sr * 0.050)); // 50ms release
    this.thresholdLin = Math.pow(10, this.params.thresholdDb / 20);
  }

  reset(): void {
    this.envelope = 0;
    this.scStates = [createBiquadState(), createBiquadState()];
    this.eqStates = [createBiquadState(), createBiquadState()];
  }

  process(channels: Float32Array[]): void {
    const len = channels[0].length;
    for (let i = 0; i < len; i++) {
      const scSample = processBiquadSample(channels[0][i], this.scCoeffs, this.scStates[0]);
      const rect = Math.abs(scSample);
      const coeff = rect > this.envelope ? this.attackCoeff : this.releaseCoeff;
      this.envelope = coeff * this.envelope + (1 - coeff) * rect;

      let amount = 0;
      if (this.envelope > this.thresholdLin) {
        amount = Math.min((this.envelope - this.thresholdLin) / this.thresholdLin, 1);
      }

      for (let ch = 0; ch < channels.length; ch++) {
        const dry = channels[ch][i];
        const wet = processBiquadSample(dry, this.eqCoeffs, this.eqStates[ch]);
        channels[ch][i] = dry * (1 - amount) + wet * amount;
      }
    }
  }
}
