import { Plugin } from "../Plugin";
import type { PreGainParams, PluginId } from "../types";

export class PreGain extends Plugin<PreGainParams> {
  readonly id: PluginId = "preGain";
  private linearGain = 1;

  protected onConfigure(): void {
    this.linearGain = Math.pow(10, this.params.gainDb / 20);
  }

  reset(): void {}

  process(channels: Float32Array[]): void {
    const g = this.linearGain;
    for (const ch of channels) {
      for (let i = 0; i < ch.length; i++) ch[i] *= g;
    }
  }
}
