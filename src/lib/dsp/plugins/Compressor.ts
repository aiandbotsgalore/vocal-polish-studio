/**
 * Feed-forward compressor with soft knee.
 * Fix 4: Internal -12dB gain reduction hard clamp.
 */
import { Plugin } from "../Plugin";
import type { CompressorParams, PluginId } from "../types";

/** Hard internal clamp: maximum gain reduction regardless of settings */
const MAX_GR_DB = -12;
const MAX_GR_LIN = Math.pow(10, MAX_GR_DB / 20);

export class Compressor extends Plugin<CompressorParams> {
  readonly id: PluginId = "compressor";
  private envelope = 0;
  private attackCoeff = 0;
  private releaseCoeff = 0;
  private makeupLin = 1;

  protected onConfigure(): void {
    const sr = this.ctx.sampleRate;
    this.attackCoeff = Math.exp(-1 / (sr * this.params.attackMs / 1000));
    this.releaseCoeff = Math.exp(-1 / (sr * this.params.releaseMs / 1000));
    this.makeupLin = Math.pow(10, this.params.makeupGainDb / 20);
  }

  reset(): void {
    this.envelope = 0;
  }

  process(channels: Float32Array[]): void {
    const len = channels[0].length;
    const threshDb = this.params.thresholdDb;
    const ratio = this.params.ratio;
    const kneeDb = this.params.kneeDb;
    const halfKnee = kneeDb / 2;

    for (let i = 0; i < len; i++) {
      // Peak detection across channels
      let peak = 0;
      for (const ch of channels) peak = Math.max(peak, Math.abs(ch[i]));

      // Envelope follower
      const coeff = peak > this.envelope ? this.attackCoeff : this.releaseCoeff;
      this.envelope = coeff * this.envelope + (1 - coeff) * peak;

      // Compute gain in dB
      const envDb = this.envelope > 0 ? 20 * Math.log10(this.envelope) : -96;
      let grDb = 0;

      if (kneeDb > 0 && envDb > threshDb - halfKnee && envDb < threshDb + halfKnee) {
        // Soft knee region
        const x = envDb - threshDb + halfKnee;
        grDb = -(x * x) / (2 * kneeDb) * (1 - 1 / ratio);
      } else if (envDb > threshDb) {
        grDb = -(envDb - threshDb) * (1 - 1 / ratio);
      }

      // Fix 4: Hard clamp at -12dB
      grDb = Math.max(grDb, MAX_GR_DB);
      const gainLin = Math.pow(10, grDb / 20) * this.makeupLin;

      for (const ch of channels) ch[i] *= gainLin;
    }
  }
}
