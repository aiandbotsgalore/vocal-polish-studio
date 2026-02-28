/**
 * Shared radix-2 Cooley-Tukey FFT with cached Hann windows and twiddle factors.
 * Replaces all naive O(n²) DFT code across the DSP pipeline.
 */

// ── Cached resources ──────────────────────────────────────────────
const hannCache = new Map<number, Float32Array>();
const twiddleCache = new Map<number, { cosTable: Float64Array; sinTable: Float64Array }>();

/** Get or compute a Hann window of the given size. */
export function getHannWindow(size: number): Float32Array {
  let w = hannCache.get(size);
  if (w) return w;
  w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  hannCache.set(size, w);
  return w;
}

function getTwiddles(N: number) {
  let t = twiddleCache.get(N);
  if (t) return t;
  const cosTable = new Float64Array(N / 2);
  const sinTable = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) {
    const angle = (-2 * Math.PI * i) / N;
    cosTable[i] = Math.cos(angle);
    sinTable[i] = Math.sin(angle);
  }
  t = { cosTable, sinTable };
  twiddleCache.set(N, t);
  return t;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * In-place radix-2 Cooley-Tukey FFT.
 * re and im must be the same length and a power of 2.
 */
export function forwardFFT(re: Float32Array, im: Float32Array): void {
  const N = re.length;
  const { cosTable, sinTable } = getTwiddles(N);

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }

  // Butterfly stages
  for (let len = 2; len <= N; len <<= 1) {
    const half = len >> 1;
    const step = N / len;
    for (let i = 0; i < N; i += len) {
      for (let j = 0; j < half; j++) {
        const twIdx = j * step;
        const tRe = cosTable[twIdx] * re[i + j + half] - sinTable[twIdx] * im[i + j + half];
        const tIm = cosTable[twIdx] * im[i + j + half] + sinTable[twIdx] * re[i + j + half];
        re[i + j + half] = re[i + j] - tRe;
        im[i + j + half] = im[i + j] - tIm;
        re[i + j] += tRe;
        im[i + j] += tIm;
      }
    }
  }
}

/**
 * In-place inverse FFT. Conjugate → FFT → conjugate → scale.
 */
export function inverseFFT(re: Float32Array, im: Float32Array): void {
  const N = re.length;
  // Conjugate
  for (let i = 0; i < N; i++) im[i] = -im[i];
  forwardFFT(re, im);
  // Conjugate and scale
  for (let i = 0; i < N; i++) {
    re[i] /= N;
    im[i] = -im[i] / N;
  }
}

/**
 * Compute magnitudes from complex spectrum (first numBins bins).
 */
export function computeMagnitudes(
  re: Float32Array,
  im: Float32Array,
  numBins: number
): Float32Array {
  const mags = new Float32Array(numBins);
  for (let k = 0; k < numBins; k++) {
    mags[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
  }
  return mags;
}

/**
 * Perform a windowed real FFT on a segment of data.
 * Returns real, imaginary, and magnitude arrays.
 * Automatically pads to next power of 2 if needed.
 */
export function realFFT(
  signal: Float32Array,
  offset: number,
  fftSize: number
): { re: Float32Array; im: Float32Array; magnitudes: Float32Array } {
  const N = nextPow2(fftSize);
  const hann = getHannWindow(fftSize);
  const re = new Float32Array(N);
  const im = new Float32Array(N);

  const available = Math.min(fftSize, signal.length - offset);
  for (let i = 0; i < available; i++) {
    re[i] = signal[offset + i] * hann[i];
  }

  forwardFFT(re, im);

  const numBins = N / 2 + 1;
  const magnitudes = computeMagnitudes(re, im, numBins);
  return { re, im, magnitudes };
}
