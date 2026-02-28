import type { LayerOneAnalysis, SegmentMetrics } from "@/types/gemini";
import { getHannWindow, forwardFFT, computeMagnitudes } from "@/lib/dsp/fft";
import { startTimer } from "@/lib/perfTimer";

/**
 * Layer 1: Deterministic Audio Analysis
 * Uses shared radix-2 FFT. Removed redundant realtime analyzer path.
 */

const FFT_SIZE = 4096;
const SEGMENT_DURATION = 0.5;

function computeRMS(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}

function computePeak(data: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

/**
 * Compute band energy using shared FFT (replaces Goertzel loops).
 */
function computeBandEnergiesFFT(
  segment: Float32Array,
  sampleRate: number,
  fftSize: number
): {
  lowMidEnergy: number;
  energy2kTo5k: number;
  energy5kTo9k: number;
  sibilanceBand: number;
  presenceEnergy: number;
  brillianceEnergy: number;
  freqData: Float32Array;
  binHz: number;
} {
  const N = fftSize;
  const hann = getHannWindow(N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const len = Math.min(segment.length, N);
  for (let i = 0; i < len; i++) re[i] = segment[i] * hann[i];

  forwardFFT(re, im);
  const numBins = N / 2 + 1;
  const mags = computeMagnitudes(re, im, numBins);
  const binHz = sampleRate / N;

  // Convert to dB-like for compat with old getEnergy
  const freqData = new Float32Array(numBins);
  for (let i = 0; i < numBins; i++) {
    freqData[i] = mags[i] > 0 ? 20 * Math.log10(mags[i] / N) : -120;
  }

  function getEnergy(lowHz: number, highHz: number): number {
    const lowBin = Math.floor(lowHz / binHz);
    const highBin = Math.min(Math.ceil(highHz / binHz), numBins - 1);
    let sum = 0, count = 0;
    for (let i = lowBin; i <= highBin; i++) {
      sum += Math.pow(10, freqData[i] / 20);
      count++;
    }
    return count > 0 ? sum / count : 0;
  }

  function findPeakFreq(lowHz: number, highHz: number): number {
    const lowBin = Math.floor(lowHz / binHz);
    const highBin = Math.min(Math.ceil(highHz / binHz), numBins - 1);
    let peakBin = lowBin, peakVal = -Infinity;
    for (let i = lowBin; i <= highBin; i++) {
      if (freqData[i] > peakVal) { peakVal = freqData[i]; peakBin = i; }
    }
    return peakBin * binHz;
  }

  return {
    lowMidEnergy: getEnergy(200, 1000),
    energy2kTo5k: getEnergy(2000, 5000),
    energy5kTo9k: getEnergy(5000, 9000),
    sibilanceBand: getEnergy(5000, 10000),
    presenceEnergy: getEnergy(3000, 6000),
    brillianceEnergy: getEnergy(8000, 12000),
    freqData,
    binHz,
  };
}

function analyzeSegmentFFT(
  channelData: Float32Array,
  sampleRate: number,
  startSample: number,
  endSample: number
): { harshness: number; sibilance: number } {
  const length = endSample - startSample;
  const fftSize = Math.min(FFT_SIZE, length);
  // Ensure power of 2
  let N = 1;
  while (N < fftSize) N <<= 1;

  const segment = new Float32Array(N);
  const copyLen = Math.min(fftSize, channelData.length - startSample);
  for (let i = 0; i < copyLen; i++) segment[i] = channelData[startSample + i];

  const bands = computeBandEnergiesFFT(segment, sampleRate, N);
  const harshnessRatio = bands.lowMidEnergy > 0 ? bands.energy2kTo5k / bands.lowMidEnergy : 0.5;
  const sibilanceRatio = bands.lowMidEnergy > 0 ? bands.sibilanceBand / bands.lowMidEnergy : 0.3;

  return {
    harshness: Math.min(100, Math.max(0, Math.round(harshnessRatio * 45))),
    sibilance: Math.min(100, Math.max(0, Math.round(sibilanceRatio * 55))),
  };
}

function findPeakFreqFromData(freqData: Float32Array, binHz: number, lowHz: number, highHz: number): number {
  const lowBin = Math.floor(lowHz / binHz);
  const highBin = Math.min(Math.ceil(highHz / binHz), freqData.length - 1);
  let peakBin = lowBin, peakVal = -Infinity;
  for (let i = lowBin; i <= highBin; i++) {
    if (freqData[i] > peakVal) { peakVal = freqData[i]; peakBin = i; }
  }
  return peakBin * binHz;
}

export async function analyzeAudio(file: File): Promise<LayerOneAnalysis> {
  const endTimer = startTimer("analyzeAudio");
  const audioContext = new AudioContext();
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  audioContext.close();

  const peakLevel = computePeak(channelData);
  const rmsLoudness = computeRMS(channelData);

  const samplesPerSegment = Math.floor(sampleRate * SEGMENT_DURATION);
  const numSegments = Math.floor(channelData.length / samplesPerSegment);

  let minSegmentRMS = Infinity;
  const segments: SegmentMetrics[] = [];
  const segmentHarshnesses: number[] = [];
  const segmentSibilances: number[] = [];

  for (let s = 0; s < numSegments; s++) {
    const start = s * samplesPerSegment;
    const end = Math.min(start + samplesPerSegment, channelData.length);
    const segData = channelData.slice(start, end);
    const segRMS = computeRMS(segData);
    if (segRMS < minSegmentRMS) minSegmentRMS = segRMS;
    const { harshness, sibilance } = analyzeSegmentFFT(channelData, sampleRate, start, end);
    segmentHarshnesses.push(harshness);
    segmentSibilances.push(sibilance);
    segments.push({ startTime: start / sampleRate, endTime: end / sampleRate, harshness, sibilance });
  }

  // Global FFT using shared utility (replaces realtime analyzer)
  const globalSegment = channelData.slice(0, Math.min(FFT_SIZE, channelData.length));
  let N = 1;
  while (N < FFT_SIZE) N <<= 1;
  const padded = new Float32Array(N);
  padded.set(globalSegment);
  const bands = computeBandEnergiesFFT(padded, sampleRate, N);
  const { lowMidEnergy, energy2kTo5k, energy5kTo9k, sibilanceBand, presenceEnergy, brillianceEnergy, freqData, binHz } = bands;

  const energyRatio2kTo5k = lowMidEnergy > 0 ? energy2kTo5k / lowMidEnergy : 0.5;
  const energyRatio5kTo9k = lowMidEnergy > 0 ? energy5kTo9k / lowMidEnergy : 0.3;
  const sibilanceBand5kTo10k = lowMidEnergy > 0 ? sibilanceBand / lowMidEnergy : 0.3;

  const harshnessRatio = lowMidEnergy > 0 ? (energy2kTo5k + presenceEnergy) / (2 * lowMidEnergy) : 0.5;
  const globalHarshness = Math.min(100, Math.max(0, Math.round(harshnessRatio * 45)));
  const sibilanceRatio = lowMidEnergy > 0 ? (sibilanceBand + brillianceEnergy) / (2 * lowMidEnergy) : 0.3;
  const globalSibilance = Math.min(100, Math.max(0, Math.round(sibilanceRatio * 55)));

  const totalEnergy = lowMidEnergy + energy2kTo5k + energy5kTo9k;
  const voiceBrightness = totalEnergy > 0 ? ((energy2kTo5k + energy5kTo9k) / totalEnergy) * 100 : 50;

  const estimatedHarshnessCenterHz = findPeakFreqFromData(freqData, binHz, 2000, 8000);
  const estimatedSibilanceCenterHz = findPeakFreqFromData(freqData, binHz, 5000, 12000);

  const avgSib = segmentSibilances.reduce((a, b) => a + b, 0) / (segmentSibilances.length || 1);
  const sibVariance = segmentSibilances.reduce((a, b) => a + (b - avgSib) ** 2, 0) / (segmentSibilances.length || 1);
  const burstinessScore = Math.min(100, Math.round(Math.sqrt(sibVariance) * 3));

  const avgHarsh = segmentHarshnesses.reduce((a, b) => a + b, 0) / (segmentHarshnesses.length || 1);
  const harshVariance = segmentHarshnesses.reduce((a, b) => a + (b - avgHarsh) ** 2, 0) / (segmentHarshnesses.length || 1);
  const brightnessConsistency = Math.max(0, 100 - Math.round(Math.sqrt(harshVariance) * 3));

  let peakBurstScore = 0, peakBurstSegmentIndex = 0;
  segmentSibilances.forEach((s, i) => { if (s > peakBurstScore) { peakBurstScore = s; peakBurstSegmentIndex = i; } });

  const snr = rmsLoudness > 0 ? 20 * Math.log10(peakLevel / (minSegmentRMS || 0.0001)) : 0;
  const noiseFloorDb = minSegmentRMS > 0 ? 20 * Math.log10(minSegmentRMS) : -96;

  endTimer();

  return {
    peakLevel: Math.round(20 * Math.log10(peakLevel || 0.0001) * 10) / 10,
    rmsLoudness: Math.round(20 * Math.log10(rmsLoudness || 0.0001) * 10) / 10,
    globalHarshness, globalSibilance,
    voiceBrightness: Math.round(voiceBrightness * 10) / 10,
    noiseFloorEstimate: Math.round(noiseFloorDb * 10) / 10,
    confidenceEstimate: Math.min(100, Math.max(20, Math.round(snr * 2))),
    estimatedHarshnessCenterHz: Math.round(estimatedHarshnessCenterHz),
    estimatedSibilanceCenterHz: Math.round(estimatedSibilanceCenterHz),
    energyRatio2kTo5k: Math.round(energyRatio2kTo5k * 1000) / 1000,
    energyRatio5kTo9k: Math.round(energyRatio5kTo9k * 1000) / 1000,
    sibilanceBand5kTo10k: Math.round(sibilanceBand5kTo10k * 1000) / 1000,
    segments, burstinessScore, brightnessConsistency, peakBurstSegmentIndex, peakBurstScore,
    harshnessSeverity: globalHarshness > 60 ? "high" : globalHarshness > 35 ? "moderate" : "low",
    sibilanceSeverity: globalSibilance > 60 ? "high" : globalSibilance > 35 ? "moderate" : "low",
    sampleRate, durationSeconds: Math.round(duration * 100) / 100,
  };
}

/** Re-analyze an AudioBuffer (for post-render validation) */
export async function analyzeBuffer(buffer: AudioBuffer): Promise<LayerOneAnalysis> {
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const duration = buffer.duration;

  const peakLevel = computePeak(channelData);
  const rmsLoudness = computeRMS(channelData);

  const samplesPerSegment = Math.floor(sampleRate * SEGMENT_DURATION);
  const numSegments = Math.floor(channelData.length / samplesPerSegment);

  let minSegmentRMS = Infinity;
  const segments: SegmentMetrics[] = [];
  const segmentHarshnesses: number[] = [];
  const segmentSibilances: number[] = [];

  for (let s = 0; s < numSegments; s++) {
    const start = s * samplesPerSegment;
    const end = Math.min(start + samplesPerSegment, channelData.length);
    const segData = channelData.slice(start, end);
    const segRMS = computeRMS(segData);
    if (segRMS < minSegmentRMS) minSegmentRMS = segRMS;
    const { harshness, sibilance } = analyzeSegmentFFT(channelData, sampleRate, start, end);
    segmentHarshnesses.push(harshness);
    segmentSibilances.push(sibilance);
    segments.push({ startTime: start / sampleRate, endTime: end / sampleRate, harshness, sibilance });
  }

  // Band energies via shared FFT
  let N = 1;
  while (N < FFT_SIZE) N <<= 1;
  const padded = new Float32Array(N);
  const copyLen = Math.min(N, channelData.length);
  for (let i = 0; i < copyLen; i++) padded[i] = channelData[i];
  const bands = computeBandEnergiesFFT(padded, sampleRate, N);

  const energyRatio2kTo5k = bands.lowMidEnergy > 0 ? bands.energy2kTo5k / bands.lowMidEnergy : 0.5;
  const energyRatio5kTo9k = bands.lowMidEnergy > 0 ? bands.energy5kTo9k / bands.lowMidEnergy : 0.3;
  const sibilanceBand5kTo10k = bands.lowMidEnergy > 0 ? bands.sibilanceBand / bands.lowMidEnergy : 0.3;

  const harshnessRatio = bands.lowMidEnergy > 0 ? (bands.energy2kTo5k + bands.presenceEnergy) / (2 * bands.lowMidEnergy) : 0.5;
  const globalHarshness = Math.min(100, Math.max(0, Math.round(harshnessRatio * 45)));
  const sibilanceRatio = bands.lowMidEnergy > 0 ? (bands.sibilanceBand + bands.brillianceEnergy) / (2 * bands.lowMidEnergy) : 0.3;
  const globalSibilance = Math.min(100, Math.max(0, Math.round(sibilanceRatio * 55)));

  const totalEnergy = bands.lowMidEnergy + bands.energy2kTo5k + bands.energy5kTo9k;
  const voiceBrightness = totalEnergy > 0 ? ((bands.energy2kTo5k + bands.energy5kTo9k) / totalEnergy) * 100 : 50;

  const avgSib = segmentSibilances.reduce((a, b) => a + b, 0) / (segmentSibilances.length || 1);
  const sibVariance = segmentSibilances.reduce((a, b) => a + (b - avgSib) ** 2, 0) / (segmentSibilances.length || 1);
  const burstinessScore = Math.min(100, Math.round(Math.sqrt(sibVariance) * 3));

  const avgHarsh = segmentHarshnesses.reduce((a, b) => a + b, 0) / (segmentHarshnesses.length || 1);
  const harshVariance = segmentHarshnesses.reduce((a, b) => a + (b - avgHarsh) ** 2, 0) / (segmentHarshnesses.length || 1);
  const brightnessConsistency = Math.max(0, 100 - Math.round(Math.sqrt(harshVariance) * 3));

  let peakBurstScore = 0, peakBurstSegmentIndex = 0;
  segmentSibilances.forEach((s, i) => { if (s > peakBurstScore) { peakBurstScore = s; peakBurstSegmentIndex = i; } });

  const snr = rmsLoudness > 0 ? 20 * Math.log10(peakLevel / (minSegmentRMS || 0.0001)) : 0;
  const noiseFloorDb = minSegmentRMS > 0 ? 20 * Math.log10(minSegmentRMS) : -96;

  return {
    peakLevel: Math.round(20 * Math.log10(peakLevel || 0.0001) * 10) / 10,
    rmsLoudness: Math.round(20 * Math.log10(rmsLoudness || 0.0001) * 10) / 10,
    globalHarshness, globalSibilance,
    voiceBrightness: Math.round(voiceBrightness * 10) / 10,
    noiseFloorEstimate: Math.round(noiseFloorDb * 10) / 10,
    confidenceEstimate: Math.min(100, Math.max(20, Math.round(snr * 2))),
    estimatedHarshnessCenterHz: 0, estimatedSibilanceCenterHz: 0,
    energyRatio2kTo5k: Math.round(energyRatio2kTo5k * 1000) / 1000,
    energyRatio5kTo9k: Math.round(energyRatio5kTo9k * 1000) / 1000,
    sibilanceBand5kTo10k: Math.round(sibilanceBand5kTo10k * 1000) / 1000,
    segments, burstinessScore, brightnessConsistency, peakBurstSegmentIndex, peakBurstScore,
    harshnessSeverity: globalHarshness > 60 ? "high" : globalHarshness > 35 ? "moderate" : "low",
    sibilanceSeverity: globalSibilance > 60 ? "high" : globalSibilance > 35 ? "moderate" : "low",
    sampleRate, durationSeconds: Math.round(duration * 100) / 100,
  };
}
