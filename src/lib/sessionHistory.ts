/**
 * Persistent session history — saves every processing run to the database
 * and derives preference summaries for Gemini context injection.
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  LayerOneAnalysis,
  GeminiDecision,
  FeedbackToken,
  StyleTarget,
  ProcessingMode,
} from "@/types/gemini";

export interface SessionRecord {
  id: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  duration_seconds: number | null;
  style_target: string;
  mode: string;
  analysis: LayerOneAnalysis | null;
  gemini_decision: GeminiDecision | null;
  feedback_history: FeedbackToken[];
  final_score: number | null;
  scoring_metrics: Record<string, number> | null;
  model_used: string | null;
  clamps_applied: string[];
  unified_report: string | null;
  created_at: string;
}

// ── Save a completed session ──

export async function saveSession(params: {
  fileName: string;
  fileSize?: number;
  mimeType?: string;
  durationSeconds?: number;
  styleTarget: StyleTarget;
  mode: ProcessingMode;
  analysis: LayerOneAnalysis | null;
  decision: GeminiDecision | null;
  feedbackHistory: FeedbackToken[];
  finalScore?: number;
  scoringMetrics?: Record<string, number>;
  modelUsed?: string;
  clampsApplied?: string[];
}): Promise<string | null> {
  const { data, error } = await supabase
    .from("processing_sessions")
    .insert({
      file_name: params.fileName,
      file_size: params.fileSize ?? null,
      mime_type: params.mimeType ?? null,
      duration_seconds: params.durationSeconds ?? null,
      style_target: params.styleTarget,
      mode: params.mode,
      analysis: params.analysis as any,
      gemini_decision: params.decision as any,
      feedback_history: params.feedbackHistory as any,
      final_score: params.finalScore ?? null,
      scoring_metrics: params.scoringMetrics as any ?? null,
      model_used: params.modelUsed ?? null,
      clamps_applied: params.clampsApplied as any ?? [],
      unified_report: params.decision?.unifiedReport ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[sessionHistory] save error:", error);
    return null;
  }
  return data.id;
}

// ── Update session with feedback / revised decision ──

export async function updateSession(
  sessionId: string,
  updates: {
    decision?: GeminiDecision;
    feedbackHistory?: FeedbackToken[];
    finalScore?: number;
    scoringMetrics?: Record<string, number>;
    clampsApplied?: string[];
  },
): Promise<void> {
  const payload: Record<string, any> = {};
  if (updates.decision) {
    payload.gemini_decision = updates.decision;
    payload.unified_report = updates.decision.unifiedReport;
  }
  if (updates.feedbackHistory) payload.feedback_history = updates.feedbackHistory;
  if (updates.finalScore !== undefined) payload.final_score = updates.finalScore;
  if (updates.scoringMetrics) payload.scoring_metrics = updates.scoringMetrics;
  if (updates.clampsApplied) payload.clamps_applied = updates.clampsApplied;

  const { error } = await supabase
    .from("processing_sessions")
    .update(payload)
    .eq("id", sessionId);

  if (error) console.error("[sessionHistory] update error:", error);
}

// ── Load recent sessions ──

export async function loadRecentSessions(limit = 50): Promise<SessionRecord[]> {
  const { data, error } = await supabase
    .from("processing_sessions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[sessionHistory] load error:", error);
    return [];
  }
  return (data ?? []) as unknown as SessionRecord[];
}

// ── Derive preference summary for Gemini context ──

export interface PreferenceSummary {
  totalSessions: number;
  feedbackPatterns: Record<string, number>;
  avgFinalScore: number | null;
  preferredStyles: { style: string; count: number }[];
  commonClamps: { clamp: string; count: number }[];
  recentDecisionSummaries: string[];
}

export function derivePreferenceSummary(sessions: SessionRecord[]): PreferenceSummary {
  const feedbackPatterns: Record<string, number> = {};
  let scoreSum = 0;
  let scoreCount = 0;
  const styleCounts: Record<string, number> = {};
  const clampCounts: Record<string, number> = {};
  const recentReports: string[] = [];

  for (const s of sessions) {
    // Feedback patterns
    if (Array.isArray(s.feedback_history)) {
      for (const f of s.feedback_history) {
        feedbackPatterns[f] = (feedbackPatterns[f] || 0) + 1;
      }
    }

    // Scores
    if (s.final_score != null) {
      scoreSum += s.final_score;
      scoreCount++;
    }

    // Style usage
    styleCounts[s.style_target] = (styleCounts[s.style_target] || 0) + 1;

    // Clamp frequency
    if (Array.isArray(s.clamps_applied)) {
      for (const c of s.clamps_applied) {
        clampCounts[c] = (clampCounts[c] || 0) + 1;
      }
    }

    // Recent reports (last 5)
    if (recentReports.length < 5 && s.unified_report) {
      // Truncate to keep prompt manageable
      recentReports.push(s.unified_report.slice(0, 300));
    }
  }

  const preferredStyles = Object.entries(styleCounts)
    .map(([style, count]) => ({ style, count }))
    .sort((a, b) => b.count - a.count);

  const commonClamps = Object.entries(clampCounts)
    .map(([clamp, count]) => ({ clamp, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalSessions: sessions.length,
    feedbackPatterns,
    avgFinalScore: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : null,
    preferredStyles,
    commonClamps,
    recentDecisionSummaries: recentReports,
  };
}

// ── Build context string for Gemini prompt injection ──

export function buildHistoryContext(summary: PreferenceSummary): string {
  if (summary.totalSessions === 0) return "";

  const lines: string[] = [
    `## User Processing History (${summary.totalSessions} sessions)`,
  ];

  if (summary.avgFinalScore != null) {
    lines.push(`Average final quality score: ${summary.avgFinalScore}/100`);
  }

  if (summary.preferredStyles.length > 0) {
    const top = summary.preferredStyles.slice(0, 3)
      .map((s) => `${s.style} (${s.count}x)`)
      .join(", ");
    lines.push(`Most used styles: ${top}`);
  }

  const totalFeedback = Object.values(summary.feedbackPatterns).reduce((a, b) => a + b, 0);
  if (totalFeedback > 0) {
    const fbLines = Object.entries(summary.feedbackPatterns)
      .sort(([, a], [, b]) => b - a)
      .map(([token, count]) => `  - "${token}": ${count}x (${Math.round(count / totalFeedback * 100)}%)`)
      .join("\n");
    lines.push(`Feedback patterns (what user corrects most):\n${fbLines}`);
    lines.push("→ Bias your decision AWAY from the most frequently corrected issues.");
  }

  if (summary.commonClamps.length > 0) {
    const clampLines = summary.commonClamps.slice(0, 5)
      .map((c) => `  - ${c.clamp}: ${c.count}x`)
      .join("\n");
    lines.push(`Frequently triggered safety clamps:\n${clampLines}`);
    lines.push("→ Stay within safer ranges for these parameters to avoid clamping.");
  }

  if (summary.recentDecisionSummaries.length > 0) {
    lines.push("\nRecent processing summaries (for context continuity):");
    for (let i = 0; i < summary.recentDecisionSummaries.length; i++) {
      lines.push(`  ${i + 1}. ${summary.recentDecisionSummaries[i]}`);
    }
  }

  return lines.join("\n");
}
