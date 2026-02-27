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

// ── Constants ──
const PROMPT_BUDGET = 50_000; // ~50 KB
const MAX_REQUEST_SIZE = 18_000_000; // 18 MB
const ALLOWED_MIME_TYPES = ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3"];

// ── Base64 cache ──
const base64Cache = new Map<string, string>();

export function clearBase64Cache() {
  base64Cache.clear();
}

// FNV-1a hash for first chunk of file data
function fnv1aHash(data: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

async function getCacheKey(file: File): Promise<string> {
  const chunk = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
  const shortHash = fnv1aHash(chunk);
  return `${file.name}|${file.size}|${file.lastModified}|${shortHash}`;
}

async function fileToBase64(file: File): Promise<string> {
  const key = await getCacheKey(file);
  const cached = base64Cache.get(key);
  if (cached) return cached;

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(binary);
  base64Cache.set(key, b64);
  return b64;
}

function getMimeType(file: File): string {
  if (file.type && ALLOWED_MIME_TYPES.includes(file.type)) return file.type;
  // Infer from extension
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "wav") return "audio/wav";
  if (ext === "mp3") return "audio/mpeg";
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
    // MIME validation
    const mimeType = getMimeType(file);
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return {
        error: {
          error: "unsupported_format",
          details: "Unsupported audio format. Upload WAV or MP3.",
        },
      };
    }

    // Size gate — single deterministic rule
    const estimatedSize = file.size * 1.33 + PROMPT_BUDGET;
    if (estimatedSize > MAX_REQUEST_SIZE) {
      return {
        error: {
          error: "file_too_large",
          details: "Audio too large for inline analysis. Please trim or convert.",
        },
      };
    }

    // Encode to base64 (cached)
    const audioBase64 = await fileToBase64(file);

    const { data, error } = await supabase.functions.invoke("gemini-vocal", {
      body: {
        analysis,
        mode,
        styleTarget,
        feedback,
        priorDecision,
        audioBase64,
        audioMimeType: mimeType,
      },
    });

    if (error) {
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
