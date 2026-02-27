/**
 * Final output stage — matches integrated loudness to target LUFS.
 * Fix 1: Uses real BS.1770-4 LUFS measurement from shared loudness.ts.
 */
import { Plugin } from "../Plugin";
import type { OutputStageParams, PluginId } from "../types";
import { computeIntegratedLUFS } from "../loudness";

export class OutputStage extends Plugin<OutputStageParams> {
  readonly id: PluginId = "outputStage";

  reset(): void {}

  process(channels: Float32Array[]): void {
    // Measure current integrated loudness
    const currentLufs = computeIntegratedLUFS(channels, this.ctx.sampleRate);

    if (!isFinite(currentLufs)) return; // Silent or too quiet — skip

    const diffDb = this.params.targetLufsDb - currentLufs;

    // Safety clamp: max ±12dB adjustment
    const clampedDiff = Math.max(-12, Math.min(12, diffDb));
    const gainLin = Math.pow(10, clampedDiff / 20);

    for (const ch of channels) {
      for (let i = 0; i < ch.length; i++) ch[i] *= gainLin;
    }
  }
}
