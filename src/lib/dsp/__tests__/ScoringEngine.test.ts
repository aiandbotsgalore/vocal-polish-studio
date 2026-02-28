import { describe, it, expect, vi, beforeEach } from "vitest";
import { scoreProcessedAudio } from "../ScoringEngine";
import type { StyleProfile } from "../types";

// Mock AnalysisCache to avoid real FFT in tests
vi.mock("../AnalysisCache", () => ({
  getOrComputeAnalysis: vi.fn((buffer: AudioBuffer) => {
    // Return plausible mock analysis based on a tag we embed
    const tag = (buffer as any).__testTag as string | undefined;
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
    // original
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

// Mock loudness to return a controllable value
vi.mock("../loudness", () => ({
  computeIntegratedLUFS: vi.fn(() => -16.2),
}));

function mockBuffer(tag: string, length = 44100): AudioBuffer {
  const data = new Float32Array(length).fill(0.1);
  return {
    __testTag: tag,
    numberOfChannels: 1,
    length,
    sampleRate: 44100,
    duration: length / 44100,
    getChannelData: () => data,
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  } as unknown as AudioBuffer;
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
  const original = mockBuffer("original");
  const processed = mockBuffer("processed");

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
    // Mock returns -16.2, target -16 → diff 0.2 LU → accuracy ≈ 0.97
    expect(result.metrics.lufsAccuracy).toBeGreaterThan(0.9);
  });

  it("harshness reduction reflects improvement", () => {
    const result = scoreProcessedAudio(original, processed, -16);
    // original harshness -22, processed -28 → 6dB reduction → score > 0.5
    expect(result.metrics.harshnessReduction).toBeGreaterThan(0.5);
  });

  it("sibilance reduction reflects improvement", () => {
    const result = scoreProcessedAudio(original, processed, -16);
    // original -24, processed -30 → 6dB reduction
    expect(result.metrics.sibilanceReduction).toBeGreaterThan(0.5);
  });

  it("brightness preservation penalizes large centroid shift", () => {
    const result = scoreProcessedAudio(original, processed, -16);
    // 2500/2600 ≈ 0.96 → within 0.85-1.15 → score = 1
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
