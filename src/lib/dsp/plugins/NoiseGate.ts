import { Plugin } from "../Plugin";
import type { NoiseGateParams, PluginId } from "../types";

export class NoiseGate extends Plugin<NoiseGateParams> {
  readonly id: PluginId = "noiseGate";
  private envelope = 0;
  private holdCounter = 0;
  private attackCoeff = 0;
  private releaseCoeff = 0;
  private holdSamples = 0;
  private thresholdLin = 0;

  protected onConfigure(): void {
    const sr = this.ctx.sampleRate;
    this.attackCoeff = Math.exp(-1 / (sr * this.params.attackMs / 1000));
    this.releaseCoeff = Math.exp(-1 / (sr * this.params.releaseMs / 1000));
    this.holdSamples = Math.round(sr * this.params.holdMs / 1000);
    this.thresholdLin = Math.pow(10, this.params.thresholdDb / 20);
  }

  reset(): void {
    this.envelope = 0;
    this.holdCounter = 0;
  }

  process(channels: Float32Array[]): void {
    const len = channels[0].length;
    for (let i = 0; i < len; i++) {
      // Peak detect across channels
      let peak = 0;
      for (const ch of channels) peak = Math.max(peak, Math.abs(ch[i]));

      let gateGain: number;
      if (peak > this.thresholdLin) {
        this.holdCounter = this.holdSamples;
        this.envelope = this.attackCoeff * this.envelope + (1 - this.attackCoeff);
        gateGain = this.envelope;
      } else if (this.holdCounter > 0) {
        this.holdCounter--;
        gateGain = this.envelope;
      } else {
        this.envelope = this.releaseCoeff * this.envelope;
        gateGain = this.envelope;
      }

      for (const ch of channels) ch[i] *= gateGain;
    }
  }
}
