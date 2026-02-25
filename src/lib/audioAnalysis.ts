import type { LayerOneAnalysis, SegmentMetrics } from "@/types/gemini";

/**
 * Layer 1: Deterministic Audio Analysis
 * Segment-level FFT analysis with comprehensive metrics.
 */

const FFT_SIZE = 4096;
const SEGMENT_DURATION = 0.5; // seconds

function getEnergy(freqData: Float32Array, binHz: number, lowHz: number, highHz: number): number {
  const lowBin = Math.floor(lowHz / binHz);
  const highBin = Math.min(Math.ceil(highHz / binHz), freqData.length - 1);
  let sum = 0;
  let count = 0;
  for (let i = lowBin; i <= highBin; i++) {
    sum += Math.pow(10, freqData[i] / 20);
    count++;
  }
  return count > 0 ? sum / count : 0;
}

function findPeakFreq(freqData: Float32Array, binHz: number, lowHz: number, highHz: number): number {
  const lowBin = Math.floor(lowHz / binHz);
  const highBin = Math.min(Math.ceil(highHz / binHz), freqData.length - 1);
  let peakBin = lowBin;
  let peakVal = -Infinity;
  for (let i = lowBin; i <= highBin; i++) {
    if (freqData[i] > peakVal) {
      peakVal = freqData[i];
      peakBin = i;
    }
  }
  return peakBin * binHz;
}

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

function analyzeSegmentFFT(
  channelData: Float32Array,
  sampleRate: number,
  startSample: number,
  endSample: number
): { harshness: number; sibilance: number } {
  const length = endSample - startSample;
  const fftSize = Math.min(FFT_SIZE, length);
  
  // Use a simple periodogram approach with windowed data
  const segment = channelData.slice(startSample, startSample + fftSize);
  
  // Apply Hann window
  for (let i = 0; i < segment.length; i++) {
    segment[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (segment.length - 1)));
  }
  
  // Compute power spectrum via DFT for key bands only (approximate with band energy)
  const binHz = sampleRate / fftSize;
  
  // Compute band energies directly from time domain correlation (simplified)
  // For accuracy we use a small offline context
  const lowMid = bandEnergy(segment, sampleRate, 200, 1000);
  const upperMid = bandEnergy(segment, sampleRate, 2000, 5000);
  const high = bandEnergy(segment, sampleRate, 5000, 10000);
  
  const harshnessRatio = lowMid > 0 ? upperMid / lowMid : 0.5;
  const sibilanceRatio = lowMid > 0 ? high / lowMid : 0.3;
  
  return {
    harshness: Math.min(100, Math.max(0, Math.round(harshnessRatio * 45))),
    sibilance: Math.min(100, Math.max(0, Math.round(sibilanceRatio * 55))),
  };
}

function bandEnergy(samples: Float32Array, sampleRate: number, lowHz: number, highHz: number): number {
  // Simple bandpass energy using Goertzel-like approach
  const N = samples.length;
  let energy = 0;
  const numFreqs = 8; // sample a few frequencies in range
  const step = (highHz - lowHz) / numFreqs;
  
  for (let f = lowHz; f <= highHz; f += step) {
    const w = (2 * Math.PI * f) / sampleRate;
    let realSum = 0, imagSum = 0;
    for (let n = 0; n < N; n++) {
      realSum += samples[n] * Math.cos(w * n);
      imagSum += samples[n] * Math.sin(w * n);
    }
    energy += (realSum * realSum + imagSum * imagSum) / (N * N);
  }
  
  return energy / numFreqs;
}

export async function analyzeAudio(file: File): Promise<LayerOneAnalysis> {
  const audioContext = new AudioContext();
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  
  // Global metrics
  const peakLevel = computePeak(channelData);
  const rmsLoudness = computeRMS(channelData);
  
  // Noise floor estimate (lowest RMS in 500ms windows)
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
    
    segments.push({
      startTime: start / sampleRate,
      endTime: end / sampleRate,
      harshness,
      sibilance,
    });
  }
  
  // Global FFT via real-time analyser for accurate frequency data
  const rtCtx = new AudioContext();
  const rtAnalyser = rtCtx.createAnalyser();
  rtAnalyser.fftSize = FFT_SIZE;
  const rtSource = rtCtx.createBufferSource();
  const rtBuf = rtCtx.createBuffer(1, channelData.length, sampleRate);
  rtBuf.copyToChannel(channelData, 0);
  rtSource.buffer = rtBuf;
  rtSource.connect(rtAnalyser);
  rtAnalyser.connect(rtCtx.destination);
  rtSource.start();
  await new Promise(r => setTimeout(r, 150));
  
  const freqData = new Float32Array(rtAnalyser.frequencyBinCount);
  rtAnalyser.getFloatFrequencyData(freqData);
  rtCtx.close();
  audioContext.close();
  
  const binHz = sampleRate / FFT_SIZE;
  
  // Band energies
  const lowMidEnergy = getEnergy(freqData, binHz, 200, 1000);
  const energy2kTo5k = getEnergy(freqData, binHz, 2000, 5000);
  const energy5kTo9k = getEnergy(freqData, binHz, 5000, 9000);
  const sibilanceBand = getEnergy(freqData, binHz, 5000, 10000);
  const presenceEnergy = getEnergy(freqData, binHz, 3000, 6000);
  const brillianceEnergy = getEnergy(freqData, binHz, 8000, 12000);
  
  // Ratios
  const energyRatio2kTo5k = lowMidEnergy > 0 ? energy2kTo5k / lowMidEnergy : 0.5;
  const energyRatio5kTo9k = lowMidEnergy > 0 ? energy5kTo9k / lowMidEnergy : 0.3;
  const sibilanceBand5kTo10k = lowMidEnergy > 0 ? sibilanceBand / lowMidEnergy : 0.3;
  
  // Global scores
  const harshnessRatio = lowMidEnergy > 0 ? (energy2kTo5k + presenceEnergy) / (2 * lowMidEnergy) : 0.5;
  const globalHarshness = Math.min(100, Math.max(0, Math.round(harshnessRatio * 45)));
  
  const sibilanceRatio = lowMidEnergy > 0 ? (sibilanceBand + brillianceEnergy) / (2 * lowMidEnergy) : 0.3;
  const globalSibilance = Math.min(100, Math.max(0, Math.round(sibilanceRatio * 55)));
  
  // Voice brightness
  const totalEnergy = lowMidEnergy + energy2kTo5k + energy5kTo9k;
  const voiceBrightness = totalEnergy > 0 ? ((energy2kTo5k + energy5kTo9k) / totalEnergy) * 100 : 50;
  
  // Peak frequencies
  const estimatedHarshnessCenterHz = findPeakFreq(freqData, binHz, 2000, 8000);
  const estimatedSibilanceCenterHz = findPeakFreq(freqData, binHz, 5000, 12000);
  
  // Burstiness: std dev of segment sibilance scores
  const avgSib = segmentSibilances.reduce((a, b) => a + b, 0) / (segmentSibilances.length || 1);
  const sibVariance = segmentSibilances.reduce((a, b) => a + (b - avgSib) ** 2, 0) / (segmentSibilances.length || 1);
  const burstinessScore = Math.min(100, Math.round(Math.sqrt(sibVariance) * 3));
  
  // Brightness consistency
  const avgHarsh = segmentHarshnesses.reduce((a, b) => a + b, 0) / (segmentHarshnesses.length || 1);
  const harshVariance = segmentHarshnesses.reduce((a, b) => a + (b - avgHarsh) ** 2, 0) / (segmentHarshnesses.length || 1);
  const brightnessConsistency = Math.max(0, 100 - Math.round(Math.sqrt(harshVariance) * 3));
  
  // Peak burst
  let peakBurstScore = 0;
  let peakBurstSegmentIndex = 0;
  segmentSibilances.forEach((s, i) => {
    if (s > peakBurstScore) {
      peakBurstScore = s;
      peakBurstSegmentIndex = i;
    }
  });
  
  // Severity classifications
  const harshnessSeverity = globalHarshness > 60 ? "high" : globalHarshness > 35 ? "moderate" : "low";
  const sibilanceSeverity = globalSibilance > 60 ? "high" : globalSibilance > 35 ? "moderate" : "low";
  
  // Confidence estimate based on signal quality
  const snr = rmsLoudness > 0 ? 20 * Math.log10(peakLevel / (minSegmentRMS || 0.0001)) : 0;
  const confidenceEstimate = Math.min(100, Math.max(20, Math.round(snr * 2)));
  
  const noiseFloorDb = minSegmentRMS > 0 ? 20 * Math.log10(minSegmentRMS) : -96;
  
  return {
    peakLevel: Math.round(20 * Math.log10(peakLevel || 0.0001) * 10) / 10,
    rmsLoudness: Math.round(20 * Math.log10(rmsLoudness || 0.0001) * 10) / 10,
    globalHarshness,
    globalSibilance,
    voiceBrightness: Math.round(voiceBrightness * 10) / 10,
    noiseFloorEstimate: Math.round(noiseFloorDb * 10) / 10,
    confidenceEstimate,
    estimatedHarshnessCenterHz: Math.round(estimatedHarshnessCenterHz),
    estimatedSibilanceCenterHz: Math.round(estimatedSibilanceCenterHz),
    energyRatio2kTo5k: Math.round(energyRatio2kTo5k * 1000) / 1000,
    energyRatio5kTo9k: Math.round(energyRatio5kTo9k * 1000) / 1000,
    sibilanceBand5kTo10k: Math.round(sibilanceBand5kTo10k * 1000) / 1000,
    segments,
    burstinessScore,
    brightnessConsistency,
    peakBurstSegmentIndex,
    peakBurstScore,
    harshnessSeverity,
    sibilanceSeverity,
    sampleRate,
    durationSeconds: Math.round(duration * 100) / 100,
  };
}

/**
 * Re-analyze an AudioBuffer (for post-render validation)
 */
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
  
  // Simplified global FFT via Goertzel for buffer analysis
  const binHz = sampleRate / FFT_SIZE;
  const lowMidEnergy = bandEnergy(channelData.slice(0, Math.min(FFT_SIZE, channelData.length)), sampleRate, 200, 1000);
  const energy2kTo5k = bandEnergy(channelData.slice(0, Math.min(FFT_SIZE, channelData.length)), sampleRate, 2000, 5000);
  const energy5kTo9k = bandEnergy(channelData.slice(0, Math.min(FFT_SIZE, channelData.length)), sampleRate, 5000, 9000);
  const sibilanceBand = bandEnergy(channelData.slice(0, Math.min(FFT_SIZE, channelData.length)), sampleRate, 5000, 10000);
  const presenceEnergy = bandEnergy(channelData.slice(0, Math.min(FFT_SIZE, channelData.length)), sampleRate, 3000, 6000);
  const brillianceEnergy = bandEnergy(channelData.slice(0, Math.min(FFT_SIZE, channelData.length)), sampleRate, 8000, 12000);
  
  const energyRatio2kTo5k = lowMidEnergy > 0 ? energy2kTo5k / lowMidEnergy : 0.5;
  const energyRatio5kTo9k = lowMidEnergy > 0 ? energy5kTo9k / lowMidEnergy : 0.3;
  const sibilanceBand5kTo10k = lowMidEnergy > 0 ? sibilanceBand / lowMidEnergy : 0.3;
  
  const harshnessRatio = lowMidEnergy > 0 ? (energy2kTo5k + presenceEnergy) / (2 * lowMidEnergy) : 0.5;
  const globalHarshness = Math.min(100, Math.max(0, Math.round(harshnessRatio * 45)));
  const sibilanceRatio = lowMidEnergy > 0 ? (sibilanceBand + brillianceEnergy) / (2 * lowMidEnergy) : 0.3;
  const globalSibilance = Math.min(100, Math.max(0, Math.round(sibilanceRatio * 55)));
  
  const totalEnergy = lowMidEnergy + energy2kTo5k + energy5kTo9k;
  const voiceBrightness = totalEnergy > 0 ? ((energy2kTo5k + energy5kTo9k) / totalEnergy) * 100 : 50;
  
  const avgSib = segmentSibilances.reduce((a, b) => a + b, 0) / (segmentSibilances.length || 1);
  const sibVariance = segmentSibilances.reduce((a, b) => a + (b - avgSib) ** 2, 0) / (segmentSibilances.length || 1);
  const burstinessScore = Math.min(100, Math.round(Math.sqrt(sibVariance) * 3));
  
  const avgHarsh = segmentHarshnesses.reduce((a, b) => a + b, 0) / (segmentHarshnesses.length || 1);
  const harshVariance = segmentHarshnesses.reduce((a, b) => a + (b - avgHarsh) ** 2, 0) / (segmentHarshnesses.length || 1);
  const brightnessConsistency = Math.max(0, 100 - Math.round(Math.sqrt(harshVariance) * 3));
  
  let peakBurstScore = 0;
  let peakBurstSegmentIndex = 0;
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
    estimatedHarshnessCenterHz: 0, estimatedSibilanceCenterHz: 0, // Not computed for buffer analysis
    energyRatio2kTo5k: Math.round(energyRatio2kTo5k * 1000) / 1000,
    energyRatio5kTo9k: Math.round(energyRatio5kTo9k * 1000) / 1000,
    sibilanceBand5kTo10k: Math.round(sibilanceBand5kTo10k * 1000) / 1000,
    segments, burstinessScore, brightnessConsistency, peakBurstSegmentIndex, peakBurstScore,
    harshnessSeverity: globalHarshness > 60 ? "high" : globalHarshness > 35 ? "moderate" : "low",
    sibilanceSeverity: globalSibilance > 60 ? "high" : globalSibilance > 35 ? "moderate" : "low",
    sampleRate, durationSeconds: Math.round(duration * 100) / 100,
  };
}
