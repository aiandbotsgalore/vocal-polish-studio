/**
 * WavExporter — encodes an AudioBuffer to a WAV file (Blob).
 *
 * Fix 11: True peak safety — 4x oversampled true peak check.
 * If true peak > 0 dBFS, applies -0.5dB gain correction before encoding.
 * Re-checks sample peak stays under ceiling after correction.
 */

/** Default ceiling for final export */
const EXPORT_CEILING_DB = -0.5;
const EXPORT_CEILING_LIN = Math.pow(10, EXPORT_CEILING_DB / 20);

/**
 * Estimate true peak via 4x linear interpolation for a single channel.
 */
function estimateTruePeak(data: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    peak = Math.max(peak, Math.abs(data[i]));
    if (i < data.length - 1) {
      const a = data[i];
      const b = data[i + 1];
      for (let j = 1; j <= 3; j++) {
        peak = Math.max(peak, Math.abs(a + (b - a) * (j / 4)));
      }
    }
  }
  return peak;
}

/**
 * Apply Fix 11 true peak safety to channel arrays (in-place).
 * Returns true if a correction was applied.
 */
function applyTruePeakSafety(channels: Float32Array[]): boolean {
  // Check true peak across all channels
  let truePeak = 0;
  for (const ch of channels) {
    truePeak = Math.max(truePeak, estimateTruePeak(ch));
  }
  const truePeakDb = truePeak > 0 ? 20 * Math.log10(truePeak) : -96;

  if (truePeakDb > 0) {
    // Apply -0.5dB correction
    const correctionLin = Math.pow(10, -0.5 / 20);
    for (const ch of channels) {
      for (let i = 0; i < ch.length; i++) ch[i] *= correctionLin;
    }

    // Re-check sample peak and hard-clamp if still above ceiling
    let samplePeak = 0;
    for (const ch of channels) {
      for (let i = 0; i < ch.length; i++) {
        samplePeak = Math.max(samplePeak, Math.abs(ch[i]));
      }
    }
    if (samplePeak > EXPORT_CEILING_LIN) {
      const clamp = EXPORT_CEILING_LIN / samplePeak;
      for (const ch of channels) {
        for (let i = 0; i < ch.length; i++) ch[i] *= clamp;
      }
    }

    return true;
  }

  return false;
}

export interface ExportOptions {
  /** Bit depth: 16 or 24 (default 24) */
  bitDepth?: 16 | 24;
  /** Filename for download (default "export.wav") */
  filename?: string;
}

/**
 * Export an AudioBuffer to a WAV Blob.
 * Applies Fix 11 true peak safety before encoding.
 */
export function exportToWav(buffer: AudioBuffer, options: ExportOptions = {}): Blob {
  const bitDepth = options.bitDepth ?? 24;
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;

  // Copy channel data for safety corrections
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(new Float32Array(buffer.getChannelData(ch)));
  }

  // Fix 11: True peak safety
  applyTruePeakSafety(channels);

  // Encode WAV
  const bytesPerSample = bitDepth / 8;
  const dataSize = length * numChannels * bytesPerSample;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, "WAVE");

  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byte rate
  view.setUint16(32, numChannels * bytesPerSample, true); // block align
  view.setUint16(34, bitDepth, true);

  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Interleave and write samples
  let offset = 44;
  if (bitDepth === 16) {
    const maxVal = 32767;
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        view.setInt16(offset, Math.round(sample * maxVal), true);
        offset += 2;
      }
    }
  } else {
    // 24-bit
    const maxVal = 8388607;
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        const intSample = Math.round(sample * maxVal);
        view.setUint8(offset, intSample & 0xff);
        view.setUint8(offset + 1, (intSample >> 8) & 0xff);
        view.setUint8(offset + 2, (intSample >> 16) & 0xff);
        offset += 3;
      }
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

/**
 * Export and trigger a browser download.
 */
export function downloadWav(buffer: AudioBuffer, options: ExportOptions = {}): void {
  const blob = exportToWav(buffer, options);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = options.filename ?? "export.wav";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
