import { useState, useCallback } from "react";

export type Severity = "low" | "moderate" | "high";
export type FixStrength = "light" | "medium" | "strong";
export type AppStatus = "idle" | "analyzing" | "fixing" | "ready";

export interface AnalysisResults {
  harshnessScore: number; // 0-100
  sibilanceScore: number; // 0-100
  harshnessBandCenter: number; // Hz
  severity: Severity;
  fixStrength: FixStrength;
  reportText: string;
  fixParams: {
    deEsserFreq: number;
    deEsserGain: number;
    harshEqFreq: number;
    harshEqGain: number;
    harshEqQ: number;
  };
}

function generateReport(harshness: number, sibilance: number, centerFreq: number, severity: Severity, strength: FixStrength): string {
  const freqLabel = centerFreq < 3500 ? "upper midrange" : centerFreq < 6000 ? "presence region" : "brilliance range";
  
  const severityText: Record<Severity, string> = {
    low: "The vocal is relatively smooth with only minor harshness detected.",
    moderate: "There is noticeable harshness that could cause listener fatigue over time.",
    high: "Significant harshness was detected that would benefit from corrective processing.",
  };

  const sibilanceText = sibilance > 60
    ? `Sibilance is prominent (score: ${sibilance}/100) — "S" and "T" sounds are cutting through aggressively.`
    : sibilance > 35
    ? `Moderate sibilance detected (score: ${sibilance}/100) — some de-essing would help smooth things out.`
    : `Sibilance levels are acceptable (score: ${sibilance}/100) — minimal de-essing needed.`;

  return `${severityText[severity]} The harshness is centered around ${centerFreq.toFixed(0)} Hz in the ${freqLabel}, with a score of ${harshness}/100.\n\n${sibilanceText}\n\nRecommended fix strength: ${strength}. The auto-fix will apply a gentle bell EQ cut at ${centerFreq.toFixed(0)} Hz and a de-esser targeting the ${(centerFreq * 1.5).toFixed(0)}–${(centerFreq * 2.2).toFixed(0)} Hz range.`;
}

async function analyzeAudio(file: File): Promise<AnalysisResults> {
  const audioContext = new AudioContext();
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  
  // FFT analysis - use 4096 point FFT
  const fftSize = 4096;
  const offlineCtx = new OfflineAudioContext(1, channelData.length, sampleRate);
  const source = offlineCtx.createBufferSource();
  const analyser = offlineCtx.createAnalyser();
  analyser.fftSize = fftSize;
  
  const buf = offlineCtx.createBuffer(1, channelData.length, sampleRate);
  buf.copyToChannel(channelData, 0);
  source.buffer = buf;
  source.connect(analyser);
  analyser.connect(offlineCtx.destination);
  source.start();
  
  await offlineCtx.startRendering();
  
  // Get frequency data from a real-time context for analysis
  const rtCtx = new AudioContext();
  const rtSource = rtCtx.createBufferSource();
  const rtAnalyser = rtCtx.createAnalyser();
  rtAnalyser.fftSize = fftSize;
  
  const rtBuf = rtCtx.createBuffer(1, channelData.length, sampleRate);
  rtBuf.copyToChannel(channelData, 0);
  rtSource.buffer = rtBuf;
  rtSource.connect(rtAnalyser);
  rtAnalyser.connect(rtCtx.destination);
  rtSource.start();
  
  // Wait a tiny bit for analyser to fill
  await new Promise(r => setTimeout(r, 100));
  
  const freqData = new Float32Array(rtAnalyser.frequencyBinCount);
  rtAnalyser.getFloatFrequencyData(freqData);
  
  rtCtx.close();
  audioContext.close();
  
  const binHz = sampleRate / fftSize;
  
  // Calculate band energies
  const getEnergy = (lowHz: number, highHz: number) => {
    const lowBin = Math.floor(lowHz / binHz);
    const highBin = Math.min(Math.ceil(highHz / binHz), freqData.length - 1);
    let sum = 0;
    let count = 0;
    for (let i = lowBin; i <= highBin; i++) {
      sum += Math.pow(10, freqData[i] / 20); // Convert dB to linear
      count++;
    }
    return count > 0 ? sum / count : 0;
  };
  
  const lowMidEnergy = getEnergy(200, 1000);
  const upperMidEnergy = getEnergy(2000, 5000);
  const presenceEnergy = getEnergy(3000, 6000);
  const highEnergy = getEnergy(5000, 10000);
  const brillianceEnergy = getEnergy(8000, 12000);
  
  // Harshness: ratio of upper-mid/presence to low-mid
  const harshnessRatio = lowMidEnergy > 0 ? (upperMidEnergy + presenceEnergy) / (2 * lowMidEnergy) : 0.5;
  const harshnessScore = Math.min(100, Math.max(0, Math.round(harshnessRatio * 45)));
  
  // Sibilance: high frequency energy relative to overall
  const sibilanceRatio = lowMidEnergy > 0 ? (highEnergy + brillianceEnergy) / (2 * lowMidEnergy) : 0.3;
  const sibilanceScore = Math.min(100, Math.max(0, Math.round(sibilanceRatio * 55)));
  
  // Find harshness center frequency (peak in 2k-8k range)
  const searchLow = Math.floor(2000 / binHz);
  const searchHigh = Math.min(Math.ceil(8000 / binHz), freqData.length - 1);
  let peakBin = searchLow;
  let peakVal = -Infinity;
  for (let i = searchLow; i <= searchHigh; i++) {
    if (freqData[i] > peakVal) {
      peakVal = freqData[i];
      peakBin = i;
    }
  }
  const harshnessBandCenter = peakBin * binHz;
  
  // Classify
  const severity: Severity = harshnessScore > 60 ? "high" : harshnessScore > 35 ? "moderate" : "low";
  const fixStrength: FixStrength = harshnessScore > 60 ? "strong" : harshnessScore > 35 ? "medium" : "light";
  
  const gainMap: Record<FixStrength, number> = { light: -2, medium: -4, strong: -6.5 };
  const deEsserGainMap: Record<FixStrength, number> = { light: -3, medium: -5.5, strong: -8 };
  
  return {
    harshnessScore,
    sibilanceScore,
    harshnessBandCenter,
    severity,
    fixStrength,
    reportText: generateReport(harshnessScore, sibilanceScore, harshnessBandCenter, severity, fixStrength),
    fixParams: {
      deEsserFreq: Math.min(harshnessBandCenter * 1.8, 9000),
      deEsserGain: deEsserGainMap[fixStrength],
      harshEqFreq: harshnessBandCenter,
      harshEqGain: gainMap[fixStrength],
      harshEqQ: 1.5,
    },
  };
}

async function processAudio(file: File, params: AnalysisResults["fixParams"]): Promise<{ blob: Blob; buffer: AudioBuffer }> {
  const audioContext = new AudioContext();
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  audioContext.close();
  
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const channels = audioBuffer.numberOfChannels;
  
  const offlineCtx = new OfflineAudioContext(channels, length, sampleRate);
  
  const source = offlineCtx.createBufferSource();
  const buf = offlineCtx.createBuffer(channels, length, sampleRate);
  for (let ch = 0; ch < channels; ch++) {
    buf.copyToChannel(audioBuffer.getChannelData(ch), ch);
  }
  source.buffer = buf;
  
  // Harshness EQ - bell cut
  const harshEq = offlineCtx.createBiquadFilter();
  harshEq.type = "peaking";
  harshEq.frequency.value = params.harshEqFreq;
  harshEq.gain.value = params.harshEqGain;
  harshEq.Q.value = params.harshEqQ;
  
  // De-esser - high shelf cut
  const deEsser = offlineCtx.createBiquadFilter();
  deEsser.type = "peaking";
  deEsser.frequency.value = params.deEsserFreq;
  deEsser.gain.value = params.deEsserGain;
  deEsser.Q.value = 2.0;
  
  // Secondary smoothing
  const smooth = offlineCtx.createBiquadFilter();
  smooth.type = "highshelf";
  smooth.frequency.value = params.deEsserFreq * 1.2;
  smooth.gain.value = params.deEsserGain * 0.3;
  
  source.connect(harshEq);
  harshEq.connect(deEsser);
  deEsser.connect(smooth);
  smooth.connect(offlineCtx.destination);
  source.start();
  
  const renderedBuffer = await offlineCtx.startRendering();
  
  // Encode to WAV
  const wavBlob = audioBufferToWav(renderedBuffer);
  
  return { blob: wavBlob, buffer: renderedBuffer };
}

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = buffer.length * blockAlign;
  const headerSize = 44;
  const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(arrayBuffer);
  
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  
  let offset = 44;
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }
  
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }
  
  return new Blob([arrayBuffer], { type: "audio/wav" });
}

export function useAudioEngine() {
  const [status, setStatus] = useState<AppStatus>("idle");
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResults | null>(null);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);

  const loadFile = useCallback((file: File) => {
    // Cleanup old URLs
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (processedUrl) URL.revokeObjectURL(processedUrl);
    
    setOriginalFile(file);
    setOriginalUrl(URL.createObjectURL(file));
    setAnalysisResults(null);
    setProcessedUrl(null);
    setProcessedBlob(null);
    setStatus("idle");
  }, [originalUrl, processedUrl]);

  const analyze = useCallback(async () => {
    if (!originalFile) return;
    setStatus("analyzing");
    try {
      // Small delay so UI updates
      await new Promise(r => setTimeout(r, 300));
      const results = await analyzeAudio(originalFile);
      setAnalysisResults(results);
      setStatus("idle");
    } catch (e) {
      console.error("Analysis failed:", e);
      setStatus("idle");
    }
  }, [originalFile]);

  const autoFix = useCallback(async () => {
    if (!originalFile || !analysisResults) return;
    setStatus("fixing");
    try {
      await new Promise(r => setTimeout(r, 400));
      const { blob } = await processAudio(originalFile, analysisResults.fixParams);
      if (processedUrl) URL.revokeObjectURL(processedUrl);
      setProcessedBlob(blob);
      setProcessedUrl(URL.createObjectURL(blob));
      setStatus("ready");
    } catch (e) {
      console.error("Processing failed:", e);
      setStatus("idle");
    }
  }, [originalFile, analysisResults, processedUrl]);

  const exportFile = useCallback(() => {
    if (!processedBlob || !originalFile) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(processedBlob);
    const baseName = originalFile.name.replace(/\.[^.]+$/, "");
    a.download = `${baseName}_processed.wav`;
    a.click();
  }, [processedBlob, originalFile]);

  return {
    status,
    originalFile,
    originalUrl,
    analysisResults,
    processedUrl,
    loadFile,
    analyze,
    autoFix,
    exportFile,
  };
}
