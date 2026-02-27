/**
 * Automatic gain rider for level consistency.
 * Fix 5: 6 dB/second max ramp rate to prevent pumping.
 * Fix 8: SNR gate — no boost when local SNR < minSnrForBoostDb.
 */
import { Plugin } from "../Plugin";
import type { GainRiderParams, PluginId } from "../types";

export class GainRider extends Plugin<GainRiderParams> {
  readonly id: PluginId = "gainRider";
  private currentGainDb = 0;
  private maxSlewPerSample = 0;
  private noiseFloorDb = -96;

  protected onConfigure(): void {
    // Fix 5: 6 dB/s max slew rate
    this.maxSlewPerSample = 6.0 / this.ctx.sampleRate;

    // Get noise floor from pre-pass profile
    if (this.ctx.noiseProfile) {
      this.noiseFloorDb = this.ctx.noiseProfile.floorDb;
    }
  }

  reset(): void {
    this.currentGainDb = 0;
  }

  process(channels: Float32Array[]): void {
    const len = channels[0].length;
    const targetDb = this.params.targetDb;
    const maxBoost = this.params.maxBoostDb;
    const maxCut = this.params.maxCutDb;
    const minSnr = this.params.minSnrForBoostDb;

    // Process in short analysis windows (10ms)
    const windowSize = Math.round(this.ctx.sampleRate * 0.01);

    for (let pos = 0; pos < len; pos += windowSize) {
      const end = Math.min(pos + windowSize, len);

      // Measure RMS of this window
      let sumSq = 0;
      for (let i = pos; i < end; i++) {
        for (const ch of channels) sumSq += ch[i] * ch[i];
      }
      const rms = Math.sqrt(sumSq / ((end - pos) * channels.length));
      const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -96;

      // Desired gain
      let desiredGainDb = targetDb - rmsDb;

      // Clamp to allowed range
      desiredGainDb = Math.max(maxCut, Math.min(maxBoost, desiredGainDb));

      // Fix 8: SNR gate — no upward gain if local SNR is too low
      const localSnr = rmsDb - this.noiseFloorDb;
      if (desiredGainDb > 0 && localSnr < minSnr) {
        desiredGainDb = 0; // Don't boost low-SNR sections
      }

      // Apply gain with slew limiting (Fix 5)
      const samplesInWindow = end - pos;
      for (let i = pos; i < end; i++) {
        // Slew limit
        const diff = desiredGainDb - this.currentGainDb;
        if (Math.abs(diff) > this.maxSlewPerSample) {
          this.currentGainDb += Math.sign(diff) * this.maxSlewPerSample;
        } else {
          this.currentGainDb = desiredGainDb;
        }

        const gainLin = Math.pow(10, this.currentGainDb / 20);
        for (const ch of channels) ch[i] *= gainLin;
      }
    }
  }
}
