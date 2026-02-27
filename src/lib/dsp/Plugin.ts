/**
 * Abstract base class for all DSP plugins.
 * Every plugin processes Float32Array channel data in-place.
 */

import type { PluginId, ProcessContext } from "./types";

export abstract class Plugin<P = unknown> {
  abstract readonly id: PluginId;
  protected params!: P;
  protected ctx!: ProcessContext;

  /** Initialise or update parameters */
  configure(params: P, ctx: ProcessContext): void {
    this.params = params;
    this.ctx = ctx;
    this.onConfigure();
  }

  /** Called after params/ctx are set — override to pre-compute coefficients etc. */
  protected onConfigure(): void {}

  /** Reset any internal state (filters, envelopes). Called between renders. */
  abstract reset(): void;

  /**
   * Process channel data in-place.
   * @param channels – array of Float32Array, one per channel
   */
  abstract process(channels: Float32Array[]): void;
}
