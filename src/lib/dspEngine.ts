import type { GeminiDecision, SliderOverrides } from "@/types/gemini";

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = buffer.length * blockAlign;
  const headerSize = 44;
  const ab = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(ab);

  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  ws(8, "WAVE"); ws(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  ws(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch));
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

export async function renderWithDecision(
  file: File,
  decision: GeminiDecision
): Promise<{ blob: Blob; buffer: AudioBuffer }> {
  const audioContext = new AudioContext();
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  audioContext.close();

  const { sampleRate, length, numberOfChannels } = audioBuffer;
  const offlineCtx = new OfflineAudioContext(numberOfChannels, length, sampleRate);

  const source = offlineCtx.createBufferSource();
  const buf = offlineCtx.createBuffer(numberOfChannels, length, sampleRate);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    buf.copyToChannel(audioBuffer.getChannelData(ch), ch);
  }
  source.buffer = buf;

  // Build chain
  let lastNode: AudioNode = source;

  // 1. Bell EQ harshness cut
  const bell1 = offlineCtx.createBiquadFilter();
  bell1.type = "peaking";
  bell1.frequency.value = decision.eqBellCenterHz;
  bell1.Q.value = decision.eqBellQ;
  bell1.gain.value = decision.eqBellCutDb;
  lastNode.connect(bell1);
  lastNode = bell1;

  // 2. Optional second bell
  if (decision.optionalSecondEqBellCenterHz && decision.optionalSecondEqBellCutDb) {
    const bell2 = offlineCtx.createBiquadFilter();
    bell2.type = "peaking";
    bell2.frequency.value = decision.optionalSecondEqBellCenterHz;
    bell2.Q.value = decision.optionalSecondEqBellQ || 1.5;
    bell2.gain.value = decision.optionalSecondEqBellCutDb;
    lastNode.connect(bell2);
    lastNode = bell2;
  }

  // 3. De-esser (peaking cut)
  const deEss = offlineCtx.createBiquadFilter();
  deEss.type = "peaking";
  deEss.frequency.value = decision.deEssCenterHz;
  deEss.Q.value = 2.0;
  deEss.gain.value = decision.deEssReductionDb;
  lastNode.connect(deEss);
  lastNode = deEss;

  // 4. Optional high shelf
  if (decision.optionalHighShelfCutDb && decision.optionalHighShelfCutDb < 0) {
    const shelf = offlineCtx.createBiquadFilter();
    shelf.type = "highshelf";
    shelf.frequency.value = 8000;
    shelf.gain.value = decision.optionalHighShelfCutDb;
    lastNode.connect(shelf);
    lastNode = shelf;
  }

  // 5. Optional presence compensation
  if (decision.optionalPresenceCompensationDb && decision.optionalPresenceCompensationDb > 0) {
    const presComp = offlineCtx.createBiquadFilter();
    presComp.type = "peaking";
    presComp.frequency.value = 4000;
    presComp.Q.value = 0.8;
    presComp.gain.value = decision.optionalPresenceCompensationDb;
    lastNode.connect(presComp);
    lastNode = presComp;
  }

  // 6. Output trim
  const gain = offlineCtx.createGain();
  gain.gain.value = Math.pow(10, (decision.outputTrimDb || 0) / 20);
  lastNode.connect(gain);
  gain.connect(offlineCtx.destination);

  source.start();
  const rendered = await offlineCtx.startRendering();
  return { blob: audioBufferToWav(rendered), buffer: rendered };
}

export async function renderWithOverrides(
  file: File,
  decision: GeminiDecision,
  overrides: SliderOverrides
): Promise<{ blob: Blob; buffer: AudioBuffer }> {
  const tweaked: GeminiDecision = {
    ...decision,
    eqBellCutDb: decision.eqBellCutDb * (overrides.harshnessPct / 100),
    optionalSecondEqBellCutDb: decision.optionalSecondEqBellCutDb
      ? decision.optionalSecondEqBellCutDb * (overrides.harshnessPct / 100)
      : undefined,
    deEssReductionDb: decision.deEssReductionDb * (overrides.sibilancePct / 100),
    optionalHighShelfCutDb: overrides.brightnessDb !== 0 ? overrides.brightnessDb : undefined,
    outputTrimDb: overrides.outputDb,
  };
  return renderWithDecision(file, tweaked);
}
