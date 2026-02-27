/**
 * Shared biquad filter coefficient generator and processor.
 * Based on Robert Bristow-Johnson's Audio EQ Cookbook.
 * Used by all EQ-style plugins: HighPass, DynamicEQ, DeEsser,
 * PresenceShaper, ResonanceSuppressor, HarmonicEnhancer tone filter,
 * and the BS.1770 loudness pre-filters.
 */

export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export interface BiquadState {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

export function createBiquadState(): BiquadState {
  return { x1: 0, x2: 0, y1: 0, y2: 0 };
}

/**
 * Process a single sample through a biquad filter.
 * Coefficients are pre-normalized (a0 = 1).
 */
export function processBiquadSample(
  x: number,
  coeffs: BiquadCoefficients,
  state: BiquadState
): number {
  const y = coeffs.b0 * x + coeffs.b1 * state.x1 + coeffs.b2 * state.x2
            - coeffs.a1 * state.y1 - coeffs.a2 * state.y2;
  state.x2 = state.x1;
  state.x1 = x;
  state.y2 = state.y1;
  state.y1 = y;
  return y;
}

/**
 * Process an entire Float32Array in-place through a biquad filter.
 */
export function processBiquadBlock(
  data: Float32Array,
  coeffs: BiquadCoefficients,
  state: BiquadState
): void {
  for (let i = 0; i < data.length; i++) {
    data[i] = processBiquadSample(data[i], coeffs, state);
  }
}

// --- Coefficient generators (RBJ Audio EQ Cookbook) ---

function normalize(
  b0: number, b1: number, b2: number,
  a0: number, a1: number, a2: number
): BiquadCoefficients {
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

/** 2nd-order Butterworth high-pass filter */
export function highpass(freqHz: number, sampleRate: number, Q = Math.SQRT1_2): BiquadCoefficients {
  const w0 = (2 * Math.PI * freqHz) / sampleRate;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  return normalize(
    (1 + cosW0) / 2,
    -(1 + cosW0),
    (1 + cosW0) / 2,
    1 + alpha,
    -2 * cosW0,
    1 - alpha
  );
}

/** 2nd-order Butterworth low-pass filter */
export function lowpass(freqHz: number, sampleRate: number, Q = Math.SQRT1_2): BiquadCoefficients {
  const w0 = (2 * Math.PI * freqHz) / sampleRate;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  return normalize(
    (1 - cosW0) / 2,
    1 - cosW0,
    (1 - cosW0) / 2,
    1 + alpha,
    -2 * cosW0,
    1 - alpha
  );
}

/** Peaking EQ filter (bell) */
export function peaking(
  freqHz: number,
  sampleRate: number,
  gainDb: number,
  Q: number
): BiquadCoefficients {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * freqHz) / sampleRate;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  return normalize(
    1 + alpha * A,
    -2 * cosW0,
    1 - alpha * A,
    1 + alpha / A,
    -2 * cosW0,
    1 - alpha / A
  );
}

/** High-shelf filter */
export function highShelf(
  freqHz: number,
  sampleRate: number,
  gainDb: number,
  S = 1.0
): BiquadCoefficients {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * freqHz) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = (sinW0 / 2) * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
  const sqrtA2alpha = 2 * Math.sqrt(A) * alpha;

  return normalize(
    A * ((A + 1) + (A - 1) * cosW0 + sqrtA2alpha),
    -2 * A * ((A - 1) + (A + 1) * cosW0),
    A * ((A + 1) + (A - 1) * cosW0 - sqrtA2alpha),
    (A + 1) - (A - 1) * cosW0 + sqrtA2alpha,
    2 * ((A - 1) - (A + 1) * cosW0),
    (A + 1) - (A - 1) * cosW0 - sqrtA2alpha
  );
}

/** Low-shelf filter */
export function lowShelf(
  freqHz: number,
  sampleRate: number,
  gainDb: number,
  S = 1.0
): BiquadCoefficients {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * freqHz) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = (sinW0 / 2) * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
  const sqrtA2alpha = 2 * Math.sqrt(A) * alpha;

  return normalize(
    A * ((A + 1) - (A - 1) * cosW0 + sqrtA2alpha),
    2 * A * ((A - 1) - (A + 1) * cosW0),
    A * ((A + 1) - (A - 1) * cosW0 - sqrtA2alpha),
    (A + 1) + (A - 1) * cosW0 + sqrtA2alpha,
    -2 * ((A - 1) + (A + 1) * cosW0),
    (A + 1) + (A - 1) * cosW0 - sqrtA2alpha
  );
}

/** Notch (band-reject) filter */
export function notch(freqHz: number, sampleRate: number, Q: number): BiquadCoefficients {
  const w0 = (2 * Math.PI * freqHz) / sampleRate;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  return normalize(
    1,
    -2 * cosW0,
    1,
    1 + alpha,
    -2 * cosW0,
    1 - alpha
  );
}

/** Band-pass filter (constant skirt gain, peak gain = Q) */
export function bandpass(freqHz: number, sampleRate: number, Q: number): BiquadCoefficients {
  const w0 = (2 * Math.PI * freqHz) / sampleRate;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  return normalize(
    alpha,
    0,
    -alpha,
    1 + alpha,
    -2 * cosW0,
    1 - alpha
  );
}

// --- BS.1770-4 specific filters ---

/**
 * BS.1770-4 Stage 1: Head-related high-shelf pre-filter.
 * +3.999843 dB gain at 1681.974450 Hz, Q derived from spec.
 */
export function bs1770PreFilter(sampleRate: number): BiquadCoefficients {
  return highShelf(1681.974450, sampleRate, 3.999843, 0.7071752369554196);
}

/**
 * BS.1770-4 Stage 2: RLB (Revised Low-frequency B-weighting) high-pass filter.
 * High-pass at 38.13547087602444 Hz.
 */
export function bs1770RlbFilter(sampleRate: number): BiquadCoefficients {
  return highpass(38.13547087602444, sampleRate, 0.5003270373238773);
}
