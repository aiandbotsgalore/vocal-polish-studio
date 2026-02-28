import { describe, it, expect } from "vitest";
import { decisionToSlots } from "../decisionToSlots";
import type { GeminiDecision } from "@/types/gemini";
import { PLUGIN_ORDER } from "../types";

function makeDecision(overrides: Partial<GeminiDecision> = {}): GeminiDecision {
  return {
    unifiedReport: "test",
    audioReceived: true,
    issueProfile: "mild",
    severity: "low",
    confidence: 0.9,
    styleTarget: "natural",
    styleInterpretation: "test",
    strategy: "gentle",
    processingOrder: "standard",
    passCount: 1,
    tradeoffPriority: "clarity",
    artifactRiskPrediction: "low",
    eqBellCenterHz: 3500,
    eqBellQ: 1.5,
    eqBellCutDb: -3,
    deEssMode: "narrow",
    deEssCenterHz: 7000,
    deEssReductionDb: -4,
    outputTrimDb: 0,
    ...overrides,
  };
}

describe("decisionToSlots", () => {
  it("returns exactly 14 slots in PLUGIN_ORDER", () => {
    const slots = decisionToSlots(makeDecision(), -16);
    expect(slots).toHaveLength(14);
    for (let i = 0; i < 14; i++) {
      expect(slots[i].id).toBe(PLUGIN_ORDER[i]);
    }
  });

  it("enables dynamicEQ when eqBellCutDb < 0", () => {
    const slots = decisionToSlots(makeDecision({ eqBellCutDb: -3 }), -16);
    const dynEq = slots.find((s) => s.id === "dynamicEQ")!;
    expect(dynEq.bypass).toBe(false);
    expect((dynEq.params as any).bands.length).toBeGreaterThanOrEqual(1);
  });

  it("bypasses dynamicEQ when eqBellCutDb is 0", () => {
    const slots = decisionToSlots(makeDecision({ eqBellCutDb: 0 }), -16);
    const dynEq = slots.find((s) => s.id === "dynamicEQ")!;
    expect(dynEq.bypass).toBe(true);
  });

  it("bypasses deEsser when deEssReductionDb is 0", () => {
    const slots = decisionToSlots(makeDecision({ deEssReductionDb: 0 }), -16);
    const deEss = slots.find((s) => s.id === "deEsser")!;
    expect(deEss.bypass).toBe(true);
  });

  it("enables deEsser when deEssReductionDb is non-zero", () => {
    const slots = decisionToSlots(makeDecision({ deEssReductionDb: -4 }), -16);
    const deEss = slots.find((s) => s.id === "deEsser")!;
    expect(deEss.bypass).toBe(false);
    expect((deEss.params as any).maxReductionDb).toBe(-4);
  });

  it("adds second EQ band when optional params present", () => {
    const slots = decisionToSlots(
      makeDecision({
        eqBellCutDb: -2,
        optionalSecondEqBellCenterHz: 5000,
        optionalSecondEqBellCutDb: -3,
      }),
      -16
    );
    const dynEq = slots.find((s) => s.id === "dynamicEQ")!;
    expect((dynEq.params as any).bands.length).toBe(2);
  });

  it("adds high shelf band when optionalHighShelfCutDb < 0", () => {
    const slots = decisionToSlots(
      makeDecision({ eqBellCutDb: -2, optionalHighShelfCutDb: -2 }),
      -16
    );
    const dynEq = slots.find((s) => s.id === "dynamicEQ")!;
    const bands = (dynEq.params as any).bands;
    const shelfBand = bands.find((b: any) => b.frequencyHz === 8000);
    expect(shelfBand).toBeDefined();
  });

  it("enables presenceShaper when optionalPresenceCompensationDb > 0", () => {
    const slots = decisionToSlots(
      makeDecision({ optionalPresenceCompensationDb: 2 }),
      -16
    );
    const ps = slots.find((s) => s.id === "presenceShaper")!;
    expect(ps.bypass).toBe(false);
    expect((ps.params as any).gainDb).toBe(2);
  });

  it("applies outputTrimDb to outputStage targetLufs", () => {
    const slots = decisionToSlots(makeDecision({ outputTrimDb: -1.5 }), -16);
    const out = slots.find((s) => s.id === "outputStage")!;
    expect((out.params as any).targetLufsDb).toBeCloseTo(-17.5);
  });

  it("compressor and limiter are never bypassed", () => {
    const slots = decisionToSlots(makeDecision(), -16);
    expect(slots.find((s) => s.id === "compressor")!.bypass).toBe(false);
    expect(slots.find((s) => s.id === "limiter")!.bypass).toBe(false);
  });
});
