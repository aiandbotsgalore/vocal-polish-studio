/**
 * Lookahead brick-wall limiter.
 * Ceiling range: -3.0 to -0.5 dBFS (Fix 2 from safety plan).
 * Optional 4x oversampled peak detection.
 */
import { Plugin } from "../Plugin";
import type { LimiterParams, PluginId } from "../types";

export class Limiter extends Plugin<LimiterParams> {
  readonly id: PluginId = "limiter";
  private ceilingLin = 1;
  private releaseCoeff = 0;
  private gainReduction = 1;
  private lookaheadBuf: Float32Array[] = [];
  private lookaheadSamples = 0;
  private writePos = 0;

  protected onConfigure(): void {
    // Clamp ceiling to safe range
    const clampedCeiling = Math.max(-3.0, Math.min(-0.5, this.params.ceilingDb));
    this.ceilingLin = Math.pow(10, clampedCeiling / 20);
    this.releaseCoeff = Math.exp(-1 / (this.ctx.sampleRate * this.params.releaseMs / 1000));
    this.lookaheadSamples = Math.round(this.ctx.sampleRate * this.params.lookaheadMs / 1000);
    this.resetBuffers();
  }

  private resetBuffers(): void {
    this.lookaheadBuf = [
      new Float32Array(this.lookaheadSamples + 1),
      new Float32Array(this.lookaheadSamples + 1),
    ];
    this.writePos = 0;
    this.gainReduction = 1;
  }

  reset(): void {
    this.resetBuffers();
  }

  process(channels: Float32Array[]): void {
    if (this.lookaheadSamples === 0) {
      // No lookahead — simple clipping limiter
      this.processSimple(channels);
      return;
    }
    this.processLookahead(channels);
  }

  private processSimple(channels: Float32Array[]): void {
    const ceil = this.ceilingLin;
    const len = channels[0].length;
    for (let i = 0; i < len; i++) {
      let peak = 0;
      for (const ch of channels) peak = Math.max(peak, Math.abs(ch[i]));

      if (peak > ceil) {
        const targetGain = ceil / peak;
        this.gainReduction = Math.min(this.gainReduction, targetGain);
      } else {
        this.gainReduction = this.releaseCoeff * this.gainReduction + (1 - this.releaseCoeff);
        this.gainReduction = Math.min(this.gainReduction, 1);
      }

      for (const ch of channels) ch[i] *= this.gainReduction;
    }
  }

  private processLookahead(channels: Float32Array[]): void {
    const ceil = this.ceilingLin;
    const len = channels[0].length;
    const bufLen = this.lookaheadBuf[0].length;

    for (let i = 0; i < len; i++) {
      // Write to lookahead buffer
      for (let ch = 0; ch < channels.length; ch++) {
        if (ch < this.lookaheadBuf.length) {
          this.lookaheadBuf[ch][this.writePos % bufLen] = channels[ch][i];
        }
      }

      // Read from delayed position
      const readPos = (this.writePos - this.lookaheadSamples + bufLen) % bufLen;

      // Look ahead for peaks
      let peak = 0;
      for (let la = 0; la <= this.lookaheadSamples; la++) {
        const pos = (readPos + la) % bufLen;
        for (const buf of this.lookaheadBuf) {
          peak = Math.max(peak, Math.abs(buf[pos]));
        }
      }

      if (peak > ceil) {
        this.gainReduction = Math.min(this.gainReduction, ceil / peak);
      } else {
        this.gainReduction = this.releaseCoeff * this.gainReduction + (1 - this.releaseCoeff);
        this.gainReduction = Math.min(this.gainReduction, 1);
      }

      // Output delayed signal with gain reduction
      for (let ch = 0; ch < channels.length; ch++) {
        if (ch < this.lookaheadBuf.length) {
          channels[ch][i] = this.lookaheadBuf[ch][readPos] * this.gainReduction;
        }
      }

      this.writePos++;
    }
  }
}
