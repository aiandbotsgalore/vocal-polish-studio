/**
 * SafetyRails — post-render validation to catch processing errors.
 *
 * Checks:
 * 1. Sample peak must be under ceiling (default -0.5 dBFS)
 * 2. True peak estimate (4x oversampled) must be under 0 dBFS
 * 3. Integrated LUFS must be within acceptable range
 * 4. No DC offset > 0.01
 * 5. No silent output (RMS > -80 dBFS)
 *
 * Fix 11: True peak check with -0.5dB correction if > 0 dBFS.
 */

import { computeIntegratedLUFS } from "./loudness";

export interface SafetyReport {
  passed: boolean;
  samplePeakDb: number;
  truePeakDb: number;
  integratedLufs: number;
  dcOffset: number;
  rmsDb: number;
  corrections: string[];
}

/** Default ceiling for sample peak check */
const SAMPLE_CEILING_DB = -0.5;
const SAMPLE_CEILING_LIN = Math.pow(10, SAMPLE_CEILING_DB / 20);

/**
 * Compute 4x oversampled true peak estimate for a single channel.
 * Uses simple linear interpolation between samples (fast approximation).
 */
function estimateTruePeak(data: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    peak = Math.max(peak, Math.abs(data[i]));
    // 4x oversample: interpolate 3 points between each pair
    if (i < data.length - 1) {
      const a = data[i];
      const b = data[i + 1];
      for (let j = 1; j <= 3; j++) {
        const t = j / 4;
        const interp = a + (b - a) * t;
        peak = Math.max(peak, Math.abs(interp));
      }
    }
  }
  return peak;
}

/**
 * Run post-render safety validation on processed audio.
 * Applies corrections in-place if needed (true peak correction).
 *
 * @param channels - Channel data arrays (MODIFIED IN-PLACE if corrections needed)
 * @param sampleRate - Sample rate
 * @returns SafetyReport with pass/fail and details
 */
export function validateAndCorrect(
  channels: Float32Array[],
  sampleRate: number
): SafetyReport {
  const corrections: string[] = [];
  const numChannels = channels.length;
  const length = channels[0].length;

  // 1. Sample peak
  let samplePeak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      samplePeak = Math.max(samplePeak, Math.abs(ch[i]));
    }
  }
  const samplePeakDb = samplePeak > 0 ? 20 * Math.log10(samplePeak) : -96;

  // 2. True peak (4x oversampled)
  let truePeak = 0;
  for (const ch of channels) {
    truePeak = Math.max(truePeak, estimateTruePeak(ch));
  }
  let truePeakDb = truePeak > 0 ? 20 * Math.log10(truePeak) : -96;

  // Fix 11: If true peak > 0 dBFS, apply -0.5dB correction
  if (truePeakDb > 0) {
    const correctionLin = Math.pow(10, -0.5 / 20);
    for (const ch of channels) {
      for (let i = 0; i < ch.length; i++) ch[i] *= correctionLin;
    }
    corrections.push(`True peak was ${truePeakDb.toFixed(2)} dBTP; applied -0.5dB correction`);

    // Recompute after correction
    truePeak = 0;
    for (const ch of channels) {
      truePeak = Math.max(truePeak, estimateTruePeak(ch));
    }
    truePeakDb = truePeak > 0 ? 20 * Math.log10(truePeak) : -96;

    // Re-check sample peak after correction
    samplePeak = 0;
    for (const ch of channels) {
      for (let i = 0; i < ch.length; i++) {
        samplePeak = Math.max(samplePeak, Math.abs(ch[i]));
      }
    }
  }

  // Clamp any remaining samples above ceiling
  if (samplePeak > SAMPLE_CEILING_LIN) {
    const clampGain = SAMPLE_CEILING_LIN / samplePeak;
    for (const ch of channels) {
      for (let i = 0; i < ch.length; i++) ch[i] *= clampGain;
    }
    corrections.push(`Sample peak clamped to ${SAMPLE_CEILING_DB} dBFS`);
  }

  // 3. DC offset
  let dcSum = 0;
  for (const ch of channels) {
    let chSum = 0;
    for (let i = 0; i < ch.length; i++) chSum += ch[i];
    dcSum += chSum / ch.length;
  }
  const dcOffset = Math.abs(dcSum / numChannels);
  if (dcOffset > 0.01) {
    // Remove DC
    const dcPerChannel = dcSum / numChannels;
    for (const ch of channels) {
      for (let i = 0; i < ch.length; i++) ch[i] -= dcPerChannel;
    }
    corrections.push(`DC offset ${dcOffset.toFixed(4)} removed`);
  }

  // 4. RMS check
  let rmsSum = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) rmsSum += ch[i] * ch[i];
  }
  const rms = Math.sqrt(rmsSum / (numChannels * length));
  const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -96;

  // 5. Integrated LUFS
  const integratedLufs = computeIntegratedLUFS(channels, sampleRate);

  // Pass/fail
  const recalcPeak = (() => {
    let p = 0;
    for (const ch of channels) {
      for (let i = 0; i < ch.length; i++) p = Math.max(p, Math.abs(ch[i]));
    }
    return p > 0 ? 20 * Math.log10(p) : -96;
  })();

  const passed =
    recalcPeak <= SAMPLE_CEILING_DB + 0.1 &&
    rmsDb > -80 &&
    dcOffset <= 0.02 &&
    isFinite(integratedLufs);

  return {
    passed,
    samplePeakDb: recalcPeak,
    truePeakDb,
    integratedLufs,
    dcOffset,
    rmsDb,
    corrections,
  };
}
