import type {
  LayerOneAnalysis,
  GeminiDecision,
  GeminiError,
  ProcessingMode,
  StyleTarget,
  FeedbackToken,
} from "@/types/gemini";
import { getStyleProfile } from "@/lib/dsp/StyleProfiles";
import type { StyleProfile } from "@/lib/dsp/types";

export interface GeminiCallResult {
  decision?: GeminiDecision;
  error?: GeminiError;
  modelUsed?: string;
  /** Resolved style profile for use in scoring pipeline */
  styleProfile?: StyleProfile;
}

// ── Constants ──
const MAX_FILE_SIZE = 10_485_760; // 10 MiB
const ALLOWED_MIME_TYPES = [
  "audio/wav", "audio/x-wav",
  "audio/mpeg", "audio/mp3",
  "audio/mp4", "audio/x-m4a", "audio/m4a",
];

function getMimeType(file: File): string {
  if (file.type && ALLOWED_MIME_TYPES.includes(file.type)) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "wav") return "audio/wav";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "mp4" || ext === "m4a") return "audio/mp4";
  return file.type || "";
}

export async function callGemini(
  file: File,
  analysis: LayerOneAnalysis,
  mode: ProcessingMode,
  styleTarget: StyleTarget,
  feedback?: FeedbackToken,
  priorDecision?: GeminiDecision
): Promise<GeminiCallResult> {
  try {
    // ── Env var guard ──
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || typeof supabaseUrl !== "string") {
      return {
        error: {
          error: "gemini_unavailable",
          details: "Backend URL not configured (VITE_SUPABASE_URL missing).",
        },
      };
    }

    // ── Client-side MIME pre-validation (relaxed: accept if extension fallback works) ──
    const mimeType = getMimeType(file);
    if (file.type && !ALLOWED_MIME_TYPES.includes(file.type) && !ALLOWED_MIME_TYPES.includes(mimeType)) {
      return {
        error: {
          error: "unsupported_format",
          details: "Unsupported audio format. Upload WAV, MP3, or M4A.",
        },
      };
    }

    // ── Size gate ──
    if (file.size > MAX_FILE_SIZE) {
      return {
        error: {
          error: "file_too_large",
          details: "Audio exceeds 10 MiB limit. Please trim or convert.",
        },
      };
    }

    // ── Build FormData ──
    const formData = new FormData();
    formData.append("audio", file);
    formData.append("analysis", JSON.stringify(analysis));
    formData.append("mode", mode);
    formData.append("styleTarget", styleTarget);
    if (feedback) {
      formData.append("feedback", feedback);
    }
    if (priorDecision) {
      formData.append("priorDecision", JSON.stringify(priorDecision));
    }

    // ── Send via fetch (no Content-Type — browser sets multipart boundary) ──
    const response = await fetch(`${supabaseUrl}/functions/v1/gemini-vocal`, {
      method: "POST",
      headers: {
        apikey: supabaseKey || "",
      },
      body: formData,
    });

    // ── Handle non-200 ──
    if (!response.ok) {
      let errorBody: any;
      try {
        errorBody = await response.json();
      } catch {
        return {
          error: {
            error: "gemini_unavailable",
            details: `Server error ${response.status}: ${response.statusText}`,
          },
        };
      }
      if (errorBody?.error) {
        return { error: errorBody as GeminiError };
      }
      return {
        error: {
          error: "gemini_unavailable",
          details: `Server error ${response.status}: ${response.statusText}`,
        },
      };
    }

    // ── Parse success response (with safety) ──
    let data: any;
    try {
      data = await response.json();
    } catch {
      return {
        error: {
          error: "gemini_unavailable",
          details: "Server returned malformed JSON on 200 OK.",
        },
      };
    }

    if (data?.error) {
      return { error: data as GeminiError };
    }

    return {
      decision: data.decision as GeminiDecision,
      modelUsed: data.modelUsed as string,
      styleProfile: getStyleProfile(styleTarget),
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
