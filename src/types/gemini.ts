// ── App Status ──
export type AppStatus =
  | "idle"
  | "analyzing"
  | "calling_gemini"
  | "gemini_ready"
  | "fixing"
  | "playback_ready"
  | "validating"
  | "ready"
  | "gemini_error";

// ── Style & Mode ──
export type ProcessingMode = "safe" | "unleashed";
export type StyleTarget =
  | "natural"
  | "podcast_clean"
  | "warm_smooth"
  | "modern_bright"
  | "presence_forward"
  | "aggressive";

export const STYLE_LABELS: Record<StyleTarget, string> = {
  natural: "Natural",
  podcast_clean: "Podcast Clean",
  warm_smooth: "Warm Smooth",
  modern_bright: "Modern Bright",
  presence_forward: "Presence Forward",
  aggressive: "Aggressive",
};

// ── Layer 1 Analysis ──
export interface SegmentMetrics {
  startTime: number;
  endTime: number;
  harshness: number;
  sibilance: number;
}

export interface LayerOneAnalysis {
  // Global
  peakLevel: number;
  rmsLoudness: number;
  globalHarshness: number;
  globalSibilance: number;
  voiceBrightness: number;
  noiseFloorEstimate: number;
  confidenceEstimate: number;
  // Frequency estimates
  estimatedHarshnessCenterHz: number;
  estimatedSibilanceCenterHz: number;
  // Band metrics
  energyRatio2kTo5k: number;
  energyRatio5kTo9k: number;
  sibilanceBand5kTo10k: number;
  // Segment timeline
  segments: SegmentMetrics[];
  burstinessScore: number;
  brightnessConsistency: number;
  peakBurstSegmentIndex: number;
  peakBurstScore: number;
  // Classifications
  harshnessSeverity: "low" | "moderate" | "high";
  sibilanceSeverity: "low" | "moderate" | "high";
  sampleRate: number;
  durationSeconds: number;
}

// ── Gemini Decision ──
export interface GeminiDecision {
  issueProfile: string;
  severity: string;
  confidence: number;
  styleTarget: string;
  styleInterpretation: string;
  strategy: string;
  processingOrder: string;
  passCount: number;
  tradeoffPriority: string;
  artifactRiskPrediction: string;
  // EQ
  eqBellCenterHz: number;
  eqBellQ: number;
  eqBellCutDb: number;
  optionalSecondEqBellCenterHz?: number;
  optionalSecondEqBellQ?: number;
  optionalSecondEqBellCutDb?: number;
  optionalHighShelfCutDb?: number;
  optionalPresenceCompensationDb?: number;
  // De-ess
  deEssMode: string;
  deEssCenterHz: number;
  deEssReductionDb: number;
  // Output
  outputTrimDb: number;
  // Reporting
  reportSummary: string;
  reportReasoning: string;
  // Alternate
  alternateDecision?: GeminiDecision;
}

export interface ClampedDecision {
  decision: GeminiDecision;
  clampsApplied: string[];
}

export type FeedbackToken = "too_dull" | "too_sharp" | "too_lispy" | "better";

export interface ProcessedVersion {
  id: string;
  label: string;
  blob: Blob;
  url: string;
  buffer: AudioBuffer;
  decision: GeminiDecision;
  clampsApplied: string[];
}

export interface PostRenderScore {
  versionId: string;
  sibilanceReduction: number;
  harshnessReduction: number;
  brightnessPreservation: number;
  artifactRiskEstimate: string;
  overallScore: number;
}

export interface GeminiError {
  error: string;
  details?: string;
  model?: string;
}
