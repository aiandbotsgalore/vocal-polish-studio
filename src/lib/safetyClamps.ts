import type { GeminiDecision, ClampedDecision, ProcessingMode } from "@/types/gemini";

export function applySafetyClamps(
  raw: GeminiDecision,
  mode: ProcessingMode
): ClampedDecision {
  const d = { ...raw };
  const clamps: string[] = [];

  const maxDeEssReduction = mode === "safe" ? -6 : -8;
  const maxEqBellCut = mode === "safe" ? -5 : -7;
  const maxHighShelf = -2;
  const maxPresenceComp = 2;
  const minQ = 0.5;
  const maxQ = 4.0;

  // De-ess center frequency
  if (d.deEssCenterHz < 5000) {
    clamps.push(`De-ess center clamped from ${d.deEssCenterHz}Hz to 5000Hz`);
    d.deEssCenterHz = 5000;
  }
  if (d.deEssCenterHz > 10000) {
    clamps.push(`De-ess center clamped from ${d.deEssCenterHz}Hz to 10000Hz`);
    d.deEssCenterHz = 10000;
  }

  // De-ess reduction
  if (d.deEssReductionDb < maxDeEssReduction) {
    clamps.push(`De-ess reduction clamped from ${d.deEssReductionDb}dB to ${maxDeEssReduction}dB`);
    d.deEssReductionDb = maxDeEssReduction;
  }

  // EQ bell cut
  if (d.eqBellCutDb < maxEqBellCut) {
    clamps.push(`EQ bell cut clamped from ${d.eqBellCutDb}dB to ${maxEqBellCut}dB`);
    d.eqBellCutDb = maxEqBellCut;
  }

  // Q range
  if (d.eqBellQ < minQ) {
    clamps.push(`EQ Q clamped from ${d.eqBellQ} to ${minQ}`);
    d.eqBellQ = minQ;
  }
  if (d.eqBellQ > maxQ) {
    clamps.push(`EQ Q clamped from ${d.eqBellQ} to ${maxQ}`);
    d.eqBellQ = maxQ;
  }

  // Optional second EQ
  if (d.optionalSecondEqBellCutDb != null && d.optionalSecondEqBellCutDb < maxEqBellCut) {
    clamps.push(`2nd EQ bell cut clamped from ${d.optionalSecondEqBellCutDb}dB to ${maxEqBellCut}dB`);
    d.optionalSecondEqBellCutDb = maxEqBellCut;
  }
  if (d.optionalSecondEqBellQ != null) {
    if (d.optionalSecondEqBellQ < minQ) d.optionalSecondEqBellQ = minQ;
    if (d.optionalSecondEqBellQ > maxQ) d.optionalSecondEqBellQ = maxQ;
  }

  // High shelf
  if (d.optionalHighShelfCutDb != null && d.optionalHighShelfCutDb < maxHighShelf) {
    clamps.push(`High shelf clamped from ${d.optionalHighShelfCutDb}dB to ${maxHighShelf}dB`);
    d.optionalHighShelfCutDb = maxHighShelf;
  }

  // Presence compensation
  if (d.optionalPresenceCompensationDb != null && d.optionalPresenceCompensationDb > maxPresenceComp) {
    clamps.push(`Presence comp clamped from ${d.optionalPresenceCompensationDb}dB to ${maxPresenceComp}dB`);
    d.optionalPresenceCompensationDb = maxPresenceComp;
  }

  // Output trim clipping prevention
  if (d.outputTrimDb > 3) {
    clamps.push(`Output trim clamped from ${d.outputTrimDb}dB to 3dB`);
    d.outputTrimDb = 3;
  }

  return { decision: d, clampsApplied: clamps };
}
