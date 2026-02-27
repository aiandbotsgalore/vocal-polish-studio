/**
 * SignalChain — assembles and runs the fixed-order plugin chain.
 * Plugins are always instantiated in PLUGIN_ORDER.
 * Only params and bypass toggles vary per chain configuration.
 */

import { Plugin } from "./Plugin";
import {
  PLUGIN_ORDER,
  type PluginId,
  type PluginParams,
  type ChainSlot,
  type ProcessContext,
} from "./types";

// Plugin class imports
import { PreGain } from "./plugins/PreGain";
import { HighPass } from "./plugins/HighPass";
import { DenoiseLite } from "./plugins/DenoiseLite";
import { NoiseGate } from "./plugins/NoiseGate";
import { DePlosive } from "./plugins/DePlosive";
import { ResonanceSuppressor } from "./plugins/ResonanceSuppressor";
import { DynamicEQ } from "./plugins/DynamicEQ";
import { DeEsser } from "./plugins/DeEsser";
import { Compressor } from "./plugins/Compressor";
import { Limiter } from "./plugins/Limiter";
import { PresenceShaper } from "./plugins/PresenceShaper";
import { HarmonicEnhancer } from "./plugins/HarmonicEnhancer";
import { GainRider } from "./plugins/GainRider";
import { OutputStage } from "./plugins/OutputStage";

/** Factory: create a plugin instance by ID */
function createPlugin(id: PluginId): Plugin<any> {
  switch (id) {
    case "preGain": return new PreGain();
    case "highPass": return new HighPass();
    case "denoiseLite": return new DenoiseLite();
    case "noiseGate": return new NoiseGate();
    case "dePlosive": return new DePlosive();
    case "resonanceSuppressor": return new ResonanceSuppressor();
    case "dynamicEQ": return new DynamicEQ();
    case "deEsser": return new DeEsser();
    case "compressor": return new Compressor();
    case "limiter": return new Limiter();
    case "presenceShaper": return new PresenceShaper();
    case "harmonicEnhancer": return new HarmonicEnhancer();
    case "gainRider": return new GainRider();
    case "outputStage": return new OutputStage();
    default: throw new Error(`Unknown plugin ID: ${id}`);
  }
}

export class SignalChain {
  private plugins: Map<PluginId, Plugin<any>> = new Map();
  private bypassed: Set<PluginId> = new Set();
  private ordered: PluginId[] = [];

  constructor() {
    // Instantiate all plugins in fixed order
    for (const id of PLUGIN_ORDER) {
      this.plugins.set(id, createPlugin(id));
      this.ordered.push(id);
    }
  }

  /**
   * Configure the chain from an array of ChainSlots.
   * Slots not present are bypassed. Order is always PLUGIN_ORDER.
   */
  configure(slots: ChainSlot[], ctx: ProcessContext): void {
    this.bypassed.clear();

    // Start with all bypassed
    for (const id of PLUGIN_ORDER) this.bypassed.add(id);

    // Configure provided slots
    for (const slot of slots) {
      const plugin = this.plugins.get(slot.id);
      if (!plugin) continue;

      plugin.configure(slot.params, ctx);
      if (slot.bypass) {
        this.bypassed.add(slot.id);
      } else {
        this.bypassed.delete(slot.id);
      }
    }
  }

  /** Reset all plugin internal state (call between renders). */
  resetAll(): void {
    for (const plugin of this.plugins.values()) plugin.reset();
  }

  /** Get a specific plugin instance (e.g. to set noise profile on DenoiseLite). */
  getPlugin<T extends Plugin<any>>(id: PluginId): T | undefined {
    return this.plugins.get(id) as T | undefined;
  }

  /**
   * Process channel data through the entire chain in-place.
   * Respects bypass flags. Order is always fixed.
   */
  process(channels: Float32Array[]): void {
    for (const id of this.ordered) {
      if (this.bypassed.has(id)) continue;
      const plugin = this.plugins.get(id)!;
      plugin.process(channels);
    }
  }

  /** Get the ordered list of active (non-bypassed) plugin IDs. */
  getActivePlugins(): PluginId[] {
    return this.ordered.filter((id) => !this.bypassed.has(id));
  }
}
