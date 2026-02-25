import { analyzeBuffer } from "@/lib/audioAnalysis";
import type { LayerOneAnalysis, PostRenderScore } from "@/types/gemini";

export async function validateRender(
  originalAnalysis: LayerOneAnalysis,
  processedBuffer: AudioBuffer,
  versionId: string
): Promise<PostRenderScore> {
  const processed = await analyzeBuffer(processedBuffer);

  const sibilanceReduction = originalAnalysis.globalSibilance > 0
    ? Math.round(((originalAnalysis.globalSibilance - processed.globalSibilance) / originalAnalysis.globalSibilance) * 100)
    : 0;

  const harshnessReduction = originalAnalysis.globalHarshness > 0
    ? Math.round(((originalAnalysis.globalHarshness - processed.globalHarshness) / originalAnalysis.globalHarshness) * 100)
    : 0;

  const brightnessPreservation = originalAnalysis.voiceBrightness > 0
    ? Math.round((processed.voiceBrightness / originalAnalysis.voiceBrightness) * 100)
    : 100;

  // Artifact risk: if brightness dropped a lot or harshness increased
  let artifactRiskEstimate: string = "low";
  if (brightnessPreservation < 60 || harshnessReduction < -10) {
    artifactRiskEstimate = "high";
  } else if (brightnessPreservation < 75 || harshnessReduction < 0) {
    artifactRiskEstimate = "moderate";
  }

  // Overall score: weighted combination
  const overallScore = Math.min(100, Math.max(0, Math.round(
    (Math.max(0, sibilanceReduction) * 0.25) +
    (Math.max(0, harshnessReduction) * 0.35) +
    (Math.min(100, brightnessPreservation) * 0.3) +
    (artifactRiskEstimate === "low" ? 10 : artifactRiskEstimate === "moderate" ? 5 : 0)
  )));

  return {
    versionId,
    sibilanceReduction,
    harshnessReduction,
    brightnessPreservation,
    artifactRiskEstimate,
    overallScore,
  };
}
