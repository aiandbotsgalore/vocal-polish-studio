/**
 * Multi-band dynamic EQ. Each band applies peaking cut only when
 * sidechain energy exceeds threshold in that band.
 */
import { Plugin } from "../Plugin";
import type { DynamicEQParams, DynamicEQBand, PluginId } from "../types";
import {
  peaking, bandpass, createBiquadState, processBiquadSample,
  type BiquadCoefficients, type BiquadState,
} from "../biquad";

interface BandState {
  scCoeffs: BiquadCoefficients; // sidechain bandpass
  scStates: BiquadState[]; // per channel
  eqCoeffs: BiquadCoefficients; // cut filter
  eqStates: BiquadState[]; // per channel
  envelope: number;
  attackCoeff: number;
  releaseCoeff: number;
  thresholdLin: number;
  maxCutDb: number;
}

export class DynamicEQ extends Plugin<DynamicEQParams> {
  readonly id: PluginId = "dynamicEQ";
  private bandStates: BandState[] = [];

  protected onConfigure(): void {
    const sr = this.ctx.sampleRate;
    this.bandStates = this.params.bands.map((b) => ({
      scCoeffs: bandpass(b.frequencyHz, sr, b.Q),
      scStates: [createBiquadState(), createBiquadState()],
      eqCoeffs: peaking(b.frequencyHz, sr, b.maxCutDb, b.Q),
      eqStates: [createBiquadState(), createBiquadState()],
      envelope: 0,
      attackCoeff: Math.exp(-1 / (sr * b.attackMs / 1000)),
      releaseCoeff: Math.exp(-1 / (sr * b.releaseMs / 1000)),
      thresholdLin: Math.pow(10, b.thresholdDb / 20),
      maxCutDb: b.maxCutDb,
    }));
  }

  reset(): void {
    for (const bs of this.bandStates) {
      bs.envelope = 0;
      bs.scStates = [createBiquadState(), createBiquadState()];
      bs.eqStates = [createBiquadState(), createBiquadState()];
    }
  }

  process(channels: Float32Array[]): void {
    const len = channels[0].length;

    for (const bs of this.bandStates) {
      for (let i = 0; i < len; i++) {
        // Sidechain detection (channel 0)
        const scSample = processBiquadSample(channels[0][i], bs.scCoeffs, bs.scStates[0]);
        const rectified = Math.abs(scSample);
        const coeff = rectified > bs.envelope ? bs.attackCoeff : bs.releaseCoeff;
        bs.envelope = coeff * bs.envelope + (1 - coeff) * rectified;

        // Compute dynamic gain: 0 (no cut) to 1 (full cut)
        let amount = 0;
        if (bs.envelope > bs.thresholdLin) {
          amount = Math.min((bs.envelope - bs.thresholdLin) / bs.thresholdLin, 1);
        }

        // Apply cut via crossfade between dry and EQ'd signal
        for (let ch = 0; ch < channels.length; ch++) {
          const dry = channels[ch][i];
          const wet = processBiquadSample(dry, bs.eqCoeffs, bs.eqStates[ch]);
          channels[ch][i] = dry * (1 - amount) + wet * amount;
        }
      }
    }
  }
}
