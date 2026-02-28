/**
 * Main-thread-only AudioBuffer ↔ RawAudioData conversion.
 *
 * ⚠️  NEVER import this file from src/workers/ or src/lib/dsp/.
 * AudioBuffer only exists on the main thread.
 */

import { createRawAudioData, type RawAudioData } from "@/lib/dsp/types";

/**
 * Convert an AudioBuffer to RawAudioData by **copying** channel data.
 * The original AudioBuffer remains intact (safe for post-transfer reads).
 */
export function audioBufferToRaw(buf: AudioBuffer): RawAudioData {
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch);
    const copy = new Float32Array(src.length);
    copy.set(src);
    channels.push(copy);
  }
  return createRawAudioData(channels, buf.sampleRate);
}

/**
 * Reconstruct an AudioBuffer from RawAudioData.
 * Only callable on the main thread.
 */
export function rawToAudioBuffer(raw: RawAudioData): AudioBuffer {
  const buf = new AudioBuffer({
    numberOfChannels: raw.numberOfChannels,
    length: raw.length,
    sampleRate: raw.sampleRate,
  });
  for (let ch = 0; ch < raw.numberOfChannels; ch++) {
    buf.copyToChannel(new Float32Array(raw.channels[ch]), ch);
  }
  return buf;
}
