import { describe, it, expect } from "vitest";
import { validateAndCorrect, type SafetyReport } from "../SafetyRails";

function makeSine(freq: number, sampleRate: number, duration: number, amplitude = 0.5): Float32Array {
  const len = Math.round(sampleRate * duration);
  const data = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    data[i] = amplitude * Math.sin(2 * Math.PI * freq * i / sampleRate);
  }
  return data;
}

describe("SafetyRails", () => {
  it("passes clean audio within limits", () => {
    const ch = makeSine(440, 44100, 1, 0.5);
    const report = validateAndCorrect([ch], 44100);
    expect(report.passed).toBe(true);
    expect(report.corrections).toHaveLength(0);
    expect(report.samplePeakDb).toBeLessThan(0);
    expect(report.rmsDb).toBeGreaterThan(-80);
  });

  it("clamps sample peak above ceiling", () => {
    const ch = makeSine(440, 44100, 1, 0.98);
    const report = validateAndCorrect([ch], 44100);
    // Peak ~= -0.18 dBFS, ceiling is -0.5 dBFS → should clamp
    expect(report.samplePeakDb).toBeLessThanOrEqual(-0.4);
    expect(report.corrections.some((c) => c.includes("clamped"))).toBe(true);
  });

  it("removes DC offset", () => {
    const len = 44100;
    const ch = new Float32Array(len);
    for (let i = 0; i < len; i++) ch[i] = 0.1 + 0.3 * Math.sin(2 * Math.PI * 440 * i / 44100);
    const report = validateAndCorrect([ch], 44100);
    expect(report.corrections.some((c) => c.includes("DC offset"))).toBe(true);
  });

  it("fails silent audio (RMS < -80 dBFS)", () => {
    const ch = new Float32Array(44100); // all zeros
    const report = validateAndCorrect([ch], 44100);
    expect(report.passed).toBe(false);
    expect(report.rmsDb).toBeLessThanOrEqual(-80);
  });

  it("handles multi-channel audio", () => {
    const ch1 = makeSine(440, 44100, 1, 0.3);
    const ch2 = makeSine(880, 44100, 1, 0.3);
    const report = validateAndCorrect([ch1, ch2], 44100);
    expect(report.passed).toBe(true);
  });

  it("corrects true peak > 0 dBFS", () => {
    // Create signal with inter-sample peak > 0 dBFS
    const ch = makeSine(440, 44100, 1, 1.05);
    const report = validateAndCorrect([ch], 44100);
    expect(report.truePeakDb).toBeLessThanOrEqual(0.1);
    expect(report.corrections.length).toBeGreaterThan(0);
  });

  it("returns finite LUFS for normal audio", () => {
    const ch = makeSine(1000, 44100, 2, 0.5);
    const report = validateAndCorrect([ch], 44100);
    expect(isFinite(report.integratedLufs)).toBe(true);
  });
});
