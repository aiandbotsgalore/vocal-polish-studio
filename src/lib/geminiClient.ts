import { supabase } from "@/integrations/supabase/client";
import type {
  LayerOneAnalysis,
  GeminiDecision,
  GeminiError,
  ProcessingMode,
  StyleTarget,
  FeedbackToken,
} from "@/types/gemini";

export interface GeminiCallResult {
  decision?: GeminiDecision;
  error?: GeminiError;
  modelUsed?: string;
}

export async function callGemini(
  analysis: LayerOneAnalysis,
  mode: ProcessingMode,
  styleTarget: StyleTarget,
  feedback?: FeedbackToken,
  priorDecision?: GeminiDecision
): Promise<GeminiCallResult> {
  try {
    const { data, error } = await supabase.functions.invoke("gemini-vocal", {
      body: { analysis, mode, styleTarget, feedback, priorDecision },
    });

    if (error) {
      // Try to extract status from the error
      const message = error.message || "Unknown edge function error";
      return {
        error: {
          error: "gemini_unavailable",
          details: message,
        },
      };
    }

    if (data?.error) {
      return { error: data as GeminiError };
    }

    return {
      decision: data.decision as GeminiDecision,
      modelUsed: data.modelUsed as string,
    };
  } catch (e) {
    return {
      error: {
        error: "gemini_unavailable",
        details: e instanceof Error ? e.message : "Network error calling Gemini",
      },
    };
  }
}
