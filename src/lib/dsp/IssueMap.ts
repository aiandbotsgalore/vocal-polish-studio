/**
 * IssueMap — timestamped detection of audio issues.
 * Uses AnalysisCache (Fix 10) for efficient FFT reuse.
 *
 * Detects: plosives, sibilance bursts, resonance spikes, breaths.
 * Returns a timeline of events for UI visualization.
 */

import { getOrComputeAnalysis } from "./AnalysisCache";
import { BANDS, type BandName } from "./frequencyBands";

export type IssueType = "plosive" | "sibilance" | "resonance" | "breath";

export interface IssueEvent {
  /** Issue type */
  type: IssueType;
  /** Start time in seconds */
  startSec: number;
  /** End time in seconds */
  endSec: number;
  /** Severity 0-1 */
  severity: number;
  /** Frequency range involved (Hz) */
  freqRange: [number, number];
  /** Human-readable description */
  description: string;
}

export interface IssueMapResult {
  events: IssueEvent[];
  summary: {
    plosiveCount: number;
    sibilanceCount: number;
    resonanceCount: number;
    breathCount: number;
    totalIssues: number;
  };
}

/**
 * Analyze a buffer and return a timestamped issue map.
 * Leverages AnalysisCache to avoid redundant FFT computation.
 */
export function generateIssueMap(buffer: AudioBuffer): IssueMapResult {
  const analysis = getOrComputeAnalysis(buffer);
  const { fftFrames, sampleRate, fftSize } = analysis;
  const hopSize = fftSize / 4;
  const freqPerBin = sampleRate / fftSize;
  const events: IssueEvent[] = [];

  const numFrames = fftFrames.length;
  if (numFrames === 0) {
    return { events, summary: { plosiveCount: 0, sibilanceCount: 0, resonanceCount: 0, breathCount: 0, totalIssues: 0 } };
  }

  // Compute per-frame band energies
  const frameBandEnergies: Record<BandName, number>[] = [];
  const frameTotalEnergies: number[] = [];

  for (let f = 0; f < numFrames; f++) {
    const mags = fftFrames[f];
    const bandE: Record<BandName, number> = {} as any;
    let total = 0;

    for (const bandName of Object.keys(BANDS) as BandName[]) {
      const band = BANDS[bandName];
      let energy = 0;
      const startBin = Math.floor(band.low / freqPerBin);
      const endBin = Math.min(Math.ceil(band.high / freqPerBin), mags.length - 1);
      for (let k = startBin; k <= endBin; k++) {
        energy += mags[k] * mags[k];
      }
      bandE[bandName] = energy;
      total += energy;
    }

    frameBandEnergies.push(bandE);
    frameTotalEnergies.push(total);
  }

  // Compute running averages for adaptive thresholds
  const windowFrames = Math.max(1, Math.round(0.5 * sampleRate / hopSize)); // ~500ms window

  // ── Plosive detection ──
  // Look for sudden energy spikes in the plosive band (80-200Hz)
  detectBandSpikes(
    frameBandEnergies, frameTotalEnergies, "plosive", "plosive",
    hopSize, sampleRate, windowFrames, 3.0, events,
    "Plosive detected"
  );

  // ── Sibilance detection ──
  // Energy spikes in sibilance band (5000-9000Hz)
  detectBandSpikes(
    frameBandEnergies, frameTotalEnergies, "sibilance", "sibilance",
    hopSize, sampleRate, windowFrames, 2.5, events,
    "Sibilance burst"
  );

  // ── Resonance detection ──
  // Persistent narrow-band energy concentration in harshness/presence regions
  detectResonances(
    fftFrames, freqPerBin, hopSize, sampleRate, events
  );

  // ── Breath detection ──
  // Broadband low-energy sections with relatively flat spectrum
  detectBreaths(
    frameBandEnergies, frameTotalEnergies, hopSize, sampleRate, windowFrames, events
  );

  // Sort by time
  events.sort((a, b) => a.startSec - b.startSec);

  // Merge overlapping events of the same type
  const merged = mergeEvents(events);

  const summary = {
    plosiveCount: merged.filter((e) => e.type === "plosive").length,
    sibilanceCount: merged.filter((e) => e.type === "sibilance").length,
    resonanceCount: merged.filter((e) => e.type === "resonance").length,
    breathCount: merged.filter((e) => e.type === "breath").length,
    totalIssues: merged.length,
  };

  return { events: merged, summary };
}

// ── Helpers ───────────────────────────────────────────────────

function detectBandSpikes(
  frameBandEnergies: Record<BandName, number>[],
  frameTotalEnergies: number[],
  bandName: BandName,
  issueType: IssueType,
  hopSize: number,
  sampleRate: number,
  windowFrames: number,
  thresholdMultiplier: number,
  events: IssueEvent[],
  description: string,
): void {
  const numFrames = frameBandEnergies.length;
  const band = BANDS[bandName];

  // Running average of band energy
  let runningSum = 0;
  let runningCount = 0;

  for (let f = 0; f < numFrames; f++) {
    const bandEnergy = frameBandEnergies[f][bandName];
    runningSum += bandEnergy;
    runningCount++;

    // Remove oldest frame from running average
    if (runningCount > windowFrames) {
      runningSum -= frameBandEnergies[f - windowFrames][bandName];
      runningCount = windowFrames;
    }

    const avg = runningSum / runningCount;

    if (avg > 0 && bandEnergy > avg * thresholdMultiplier && bandEnergy > 1e-10) {
      const severity = Math.min(1, (bandEnergy / avg - 1) / (thresholdMultiplier * 2));
      const startSec = (f * hopSize) / sampleRate;
      const endSec = ((f + 1) * hopSize) / sampleRate;

      events.push({
        type: issueType,
        startSec,
        endSec,
        severity,
        freqRange: [band.low, band.high],
        description,
      });
    }
  }
}

function detectResonances(
  fftFrames: Float32Array[],
  freqPerBin: number,
  hopSize: number,
  sampleRate: number,
  events: IssueEvent[],
): void {
  const numFrames = fftFrames.length;
  if (numFrames < 8) return;

  const presenceLow = BANDS.presence.low;
  const harshHigh = BANDS.harshness.high;
  const startBin = Math.floor(presenceLow / freqPerBin);
  const endBin = Math.min(Math.ceil(harshHigh / freqPerBin), fftFrames[0].length - 1);

  // Track persistent peaks across frames
  const peakPersistence = new Float32Array(endBin - startBin + 1);

  for (let f = 0; f < numFrames; f++) {
    const mags = fftFrames[f];
    // Find local maxima in the presence/harshness region
    for (let k = startBin + 1; k < endBin; k++) {
      const idx = k - startBin;
      if (mags[k] > mags[k - 1] && mags[k] > mags[k + 1]) {
        // Compute local average
        const localAvg = (mags[k - 1] + mags[k + 1]) / 2;
        if (mags[k] > localAvg * 2) {
          peakPersistence[idx]++;
        } else {
          peakPersistence[idx] = Math.max(0, peakPersistence[idx] - 0.5);
        }
      } else {
        peakPersistence[idx] = Math.max(0, peakPersistence[idx] - 0.5);
      }

      // Resonance if persists for 8+ frames
      if (peakPersistence[idx] >= 8) {
        const freqHz = k * freqPerBin;
        const startSec = Math.max(0, ((f - 8) * hopSize) / sampleRate);
        const endSec = (f * hopSize) / sampleRate;
        const severity = Math.min(1, peakPersistence[idx] / 16);

        events.push({
          type: "resonance",
          startSec,
          endSec,
          severity,
          freqRange: [freqHz - freqPerBin, freqHz + freqPerBin],
          description: `Resonance at ~${Math.round(freqHz)}Hz`,
        });

        peakPersistence[idx] = 0; // Reset after detection
      }
    }
  }
}

function detectBreaths(
  frameBandEnergies: Record<BandName, number>[],
  frameTotalEnergies: number[],
  hopSize: number,
  sampleRate: number,
  windowFrames: number,
  events: IssueEvent[],
): void {
  const numFrames = frameBandEnergies.length;

  // Compute global average energy
  let globalSum = 0;
  for (let f = 0; f < numFrames; f++) globalSum += frameTotalEnergies[f];
  const globalAvg = globalSum / numFrames;
  if (globalAvg <= 0) return;

  // Breath: low total energy + relatively high air band ratio
  let breathStart = -1;
  for (let f = 0; f < numFrames; f++) {
    const total = frameTotalEnergies[f];
    const airEnergy = frameBandEnergies[f].air;

    const isLowEnergy = total < globalAvg * 0.1 && total > globalAvg * 0.001;
    const hasAirContent = total > 0 && airEnergy / total > 0.15;

    if (isLowEnergy && hasAirContent) {
      if (breathStart === -1) breathStart = f;
    } else {
      if (breathStart !== -1) {
        const durationFrames = f - breathStart;
        const durationSec = (durationFrames * hopSize) / sampleRate;
        // Breaths are typically 0.2-1.5 seconds
        if (durationSec >= 0.15 && durationSec <= 2.0) {
          events.push({
            type: "breath",
            startSec: (breathStart * hopSize) / sampleRate,
            endSec: (f * hopSize) / sampleRate,
            severity: Math.min(1, durationSec / 1.0),
            freqRange: [BANDS.air.low, BANDS.air.high],
            description: "Breath detected",
          });
        }
        breathStart = -1;
      }
    }
  }
}

function mergeEvents(events: IssueEvent[]): IssueEvent[] {
  if (events.length <= 1) return events;

  const merged: IssueEvent[] = [];
  let current = { ...events[0] };

  for (let i = 1; i < events.length; i++) {
    const next = events[i];
    // Merge if same type and overlapping or adjacent (within 50ms)
    if (next.type === current.type && next.startSec <= current.endSec + 0.05) {
      current.endSec = Math.max(current.endSec, next.endSec);
      current.severity = Math.max(current.severity, next.severity);
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);

  return merged;
}
