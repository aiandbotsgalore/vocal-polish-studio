import { describe, it, expect, vi, beforeEach } from "vitest";
import { scoreProcessedAudio } from "../ScoringEngine";
import type { StyleProfile, RawAudioData } from "../types";

// Mock AnalysisCache to avoid real FFT in tests
vi.mock("../AnalysisCache", () => ({
  getOrComputeAnalysis: vi.fn((raw: RawAudioData) => {
    const tag = (raw as any).__testTag as string | undefined;
    if (tag === "processed") {
      return {
        fftFrames: [],
        bandEnergies: {
          rumble: -60, plosive: -50, mud: -35,
          lowMid: -20, presence: -18, harshness: -28,
          sibilance: -30, air: -40,
        },
        spectralCentroid: 2500,
        sampleRate: 44100,
        fftSize: 2048,
      };
    }
    return {
      fftFrames: [],
      bandEnergies: {
        rumble: -58, plosive: -48, mud: -34,
        lowMid: -19, presence: -17, harshness: -22,
        sibilance: -24, air: -38,
      },
      spectralCentroid: 2600,
      sampleRate: 44100,
      fftSize: 2048,
    };
  }),
}));

vi.mock("../loudness", () => ({
  computeIntegratedLUFS: vi.fn(() => -16.2),
}));

function mockRaw(tag: string, length = 44100): RawAudioData {
  const data = new Float32Array(length).fill(0.1);
  const raw: RawAudioData = {
    id: crypto.randomUUID(),
    channels: [data],
    sampleRate: 44100,
    length,
    numberOfChannels: 1,
  };
  (raw as any).__testTag = tag;
  return raw;
}

const testProfile: StyleProfile = {
  name: "Test",
  referenceBandRatios: {
    rumble: 0.01, plosive: 0.04, mud: 0.12,
    lowMid: 0.35, presence: 0.25, harshness: 0.10,
    sibilance: 0.08, air: 0.05,
  },
  referenceCentroidRange: [1800, 3200],
  noiseTolerance: 0.3,
  targetLufs: -16,
};

describe("ScoringEngine", () => {
  const original = mockRaw("original");
  const processed = mockRaw("processed");

  it("returns overall score between 0 and 100", () => {
    const result = scoreProcessedAudio(original, processed, -16, testProfile);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
  });

  it("all metrics are normalized 0-1", () => {
    const result = scoreProcessedAudio(original, processed, -16, testProfile);
    for (const val of Object.values(result.metrics)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  it("LUFS accuracy is high when close to target", () => {
    const result = scoreProcessedAudio(original, processed, -16, testProfile);
    expect(result.metrics.lufsAccuracy).toBeGreaterThan(0.9);
  });

  it("harshness reduction reflects improvement", () => {
    const result = scoreProcessedAudio(original, processed, -16);
    expect(result.metrics.harshnessReduction).toBeGreaterThan(0.5);
  });

  it("sibilance reduction reflects improvement", () => {
    const result = scoreProcessedAudio(original, processed, -16);
    expect(result.metrics.sibilanceReduction).toBeGreaterThan(0.5);
  });

  it("brightness preservation penalizes large centroid shift", () => {
    const result = scoreProcessedAudio(original, processed, -16);
    expect(result.metrics.brightnessPreservation).toBe(1);
  });

  it("returns processedLufs from loudness module", () => {
    const result = scoreProcessedAudio(original, processed, -16);
    expect(result.processedLufs).toBeCloseTo(-16.2);
  });

  it("referenceDeviation is defined when profile provided", () => {
    const result = scoreProcessedAudio(original, processed, -16, testProfile);
    expect(result.referenceDeviation).toBeDefined();
    expect(result.referenceDeviation).toBeGreaterThanOrEqual(0);
  });

  it("works without a style profile", () => {
    const result = scoreProcessedAudio(original, processed, -16);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
  });
});
