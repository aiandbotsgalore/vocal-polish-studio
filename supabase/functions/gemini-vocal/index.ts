import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_MIME_TYPES = [
  "audio/wav", "audio/x-wav",
  "audio/mpeg", "audio/mp3",
  "audio/mp4", "audio/x-m4a", "audio/m4a",
];
const MAX_FILE_SIZE = 10_485_760; // 10 MiB — must match client
const MIN_FILE_SIZE = 1_000;
const MAX_ANALYSIS_SIZE = 200_000; // 200 KB in bytes
const MAX_FEEDBACK_SIZE = 5_000;
const MAX_HISTORY_CONTEXT_SIZE = 10_000;

const PRIMARY_MODEL = "gemini-3.1-pro-preview";
const FALLBACK_MODEL = "gemini-3-pro-preview";
const TIMEOUT_MS = 120_000;
const FILE_API_BASE = "https://generativelanguage.googleapis.com";

// ── Helpers ──

function jsonError(
  status: number,
  body: { error: string; details: string; model?: string },
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── File API helpers ──

async function uploadToFileApi(
  apiKey: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ fileUri: string; fileName: string }> {
  // Step 1: Start resumable upload
  const startRes = await fetch(
    `${FILE_API_BASE}/upload/v1beta/files?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { displayName: "vocal-upload" } }),
    },
  );

  if (!startRes.ok) {
    const errText = await startRes.text();
    throw new Error(`File API start failed (${startRes.status}): ${errText}`);
  }
  // Consume body to prevent resource leak
  await startRes.text();

  // Extract upload URL from headers
  const uploadUrl =
    startRes.headers.get("x-goog-upload-url") ||
    startRes.headers.get("location");
  if (!uploadUrl) {
    throw new Error("File API did not return an upload URL");
  }

  // Step 2: Upload bytes
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: bytes,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`File API upload failed (${uploadRes.status}): ${errText}`);
  }

  const result = await uploadRes.json();
  const file = result.file;
  if (!file?.uri || !file?.name) {
    throw new Error(`File API returned unexpected shape: ${JSON.stringify(result).slice(0, 500)}`);
  }

  return { fileUri: file.uri, fileName: file.name };
}

async function waitForFileActive(
  apiKey: string,
  fileName: string,
  reqId: string,
): Promise<void> {
  const maxPolls = 15;
  const pollIntervalMs = 2000;

  for (let i = 0; i < maxPolls; i++) {
    const res = await fetch(
      `${FILE_API_BASE}/v1beta/${fileName}?key=${apiKey}`,
    );
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`File API status check failed (${res.status}): ${errText}`);
    }

    const data = await res.json();
    console.log(`[${reqId}] File state poll ${i + 1}/${maxPolls}: ${data.state}`);

    if (data.state === "ACTIVE") return;
    if (data.state === "FAILED") {
      throw new Error(`File processing failed: ${JSON.stringify(data.error || data)}`);
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(`File did not become ACTIVE after ${maxPolls * pollIntervalMs / 1000}s`);
}

async function deleteFile(apiKey: string, fileName: string, reqId: string): Promise<void> {
  try {
    const res = await fetch(
      `${FILE_API_BASE}/v1beta/${fileName}?key=${apiKey}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[${reqId}] File delete failed (${res.status}): ${errText}`);
    } else {
      await res.text(); // consume body
      console.log(`[${reqId}] File deleted: ${fileName}`);
    }
  } catch (e) {
    console.error(`[${reqId}] File delete error:`, e);
  }
}

// ── Gemini call ──

const SYSTEM_PROMPT = `You are a professional Audio Engineer with deep expertise in vocal processing. You are receiving BOTH spectral analysis metrics AND the actual audio file. Listen to the audio.

You must reference at least one directly audible characteristic of the audio (e.g., whisper tone, room echo, sharp S sounds, plosives, dynamic jumps). If no audio is present, set audioReceived to false.

Return unifiedReport as a cohesive narrative that weaves numeric metrics with audible observations. Do not separate measurements from interpretation.

Explain what you intentionally did NOT change and why.
If safety clamps will apply, mention the tradeoff in unifiedReport.

CONFLICT RESOLUTION POLICY (in priority order):
1. Safety and artifact prevention — always highest priority
2. Severe harshness or sibilance findings override style target preferences
3. Style target influences decisions only within safe and severity-aware limits
4. Confidence score controls aggressiveness — low confidence biases toward conservative settings

REASONING REQUIREMENTS:
- Be specific: reference actual measurement values from the analysis
- Explain WHY you chose each parameter value
- State what tradeoff you prioritized and why
- Never use generic phrases like "improved clarity" or "applied enhancements"`;

const TOOL_SCHEMA = {
  name: "vocal_decision",
  description: "Return the complete vocal processing decision with unified report. ALL fields must be populated.",
  parameters: {
    type: "OBJECT",
    properties: {
      unifiedReport: { type: "STRING", description: "Cohesive narrative weaving numeric metrics with audible observations. Must reference at least one audible trait." },
      audioReceived: { type: "BOOLEAN", description: "True if you received and listened to the audio file. False if audio was not present." },
      issueProfile: { type: "STRING", description: "Brief description of detected issues" },
      severity: { type: "STRING", description: "Overall severity: low, moderate, or high" },
      confidence: { type: "NUMBER", description: "0-100 confidence in this decision" },
      styleTarget: { type: "STRING", description: "The style target applied" },
      styleInterpretation: { type: "STRING", description: "How the style target influenced the decision" },
      strategy: { type: "STRING", description: "One of: de_ess_focused, eq_focused, balanced, minimal_intervention, multi_pass" },
      processingOrder: { type: "STRING", description: "Order of processing steps applied" },
      passCount: { type: "NUMBER", description: "Number of processing passes: 1 or 2" },
      tradeoffPriority: { type: "STRING", description: "What was prioritized" },
      artifactRiskPrediction: { type: "STRING", description: "Artifact risk: low, moderate, or high" },
      eqBellCenterHz: { type: "NUMBER", description: "Primary EQ bell center frequency in Hz" },
      eqBellQ: { type: "NUMBER", description: "Q factor for EQ bell" },
      eqBellCutDb: { type: "NUMBER", description: "EQ bell gain cut in dB, negative" },
      deEssMode: { type: "STRING", description: "De-ess mode: narrow, wide, or off" },
      deEssCenterHz: { type: "NUMBER", description: "De-esser center frequency in Hz" },
      deEssReductionDb: { type: "NUMBER", description: "De-esser reduction in dB, negative" },
      outputTrimDb: { type: "NUMBER", description: "Output trim in dB" },
      optionalSecondEqBellCenterHz: { type: "NUMBER", description: "Optional 2nd EQ center Hz, 0 if not used" },
      optionalSecondEqBellQ: { type: "NUMBER", description: "Optional 2nd EQ Q, 0 if not used" },
      optionalSecondEqBellCutDb: { type: "NUMBER", description: "Optional 2nd EQ cut dB, 0 if not used" },
      optionalHighShelfCutDb: { type: "NUMBER", description: "Optional high shelf cut dB, 0 if not used" },
      optionalPresenceCompensationDb: { type: "NUMBER", description: "Optional presence compensation dB, 0 if not used" },
    },
    required: [
      "unifiedReport", "audioReceived", "issueProfile", "severity", "confidence",
      "styleTarget", "styleInterpretation", "strategy", "processingOrder", "passCount",
      "tradeoffPriority", "artifactRiskPrediction",
      "eqBellCenterHz", "eqBellQ", "eqBellCutDb",
      "deEssMode", "deEssCenterHz", "deEssReductionDb", "outputTrimDb",
    ],
  },
};

const REQUIRED_FIELDS = [
  "unifiedReport", "audioReceived", "issueProfile", "strategy", "processingOrder",
  "eqBellCenterHz", "eqBellQ", "eqBellCutDb", "deEssMode", "deEssCenterHz", "deEssReductionDb",
];

async function callGeminiNative(
  model: string,
  apiKey: string,
  contents: any[],
): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents,
        tools: [{ functionDeclarations: [TOOL_SCHEMA] }],
        toolConfig: {
          functionCallingConfig: {
            mode: "ANY",
            allowedFunctionNames: ["vocal_decision"],
          },
        },
      }),
    });
  } finally {
    clearTimeout(timer);
  }
}

// ── Style profile data ──

const STYLE_PROFILE_DATA: Record<string, { bandRatios: Record<string, number>; centroidRange: [number, number]; targetLufs: number; noiseTolerance: string }> = {
  natural: { bandRatios: { rumble: 0.03, plosive: 0.06, mud: 0.15, lowMid: 0.32, presence: 0.22, harshness: 0.10, sibilance: 0.07, air: 0.05 }, centroidRange: [1400, 3600], targetLufs: -16, noiseTolerance: "High" },
  podcast_clean: { bandRatios: { rumble: 0.01, plosive: 0.04, mud: 0.12, lowMid: 0.35, presence: 0.25, harshness: 0.10, sibilance: 0.08, air: 0.05 }, centroidRange: [1800, 3200], targetLufs: -16, noiseTolerance: "Moderate" },
  warm_smooth: { bandRatios: { rumble: 0.02, plosive: 0.05, mud: 0.16, lowMid: 0.36, presence: 0.20, harshness: 0.08, sibilance: 0.07, air: 0.06 }, centroidRange: [1400, 2600], targetLufs: -16, noiseTolerance: "Moderate" },
  modern_bright: { bandRatios: { rumble: 0.01, plosive: 0.04, mud: 0.08, lowMid: 0.28, presence: 0.30, harshness: 0.13, sibilance: 0.09, air: 0.07 }, centroidRange: [2500, 4200], targetLufs: -14, noiseTolerance: "Moderate" },
  presence_forward: { bandRatios: { rumble: 0.01, plosive: 0.04, mud: 0.09, lowMid: 0.28, presence: 0.32, harshness: 0.12, sibilance: 0.08, air: 0.06 }, centroidRange: [2400, 4000], targetLufs: -14, noiseTolerance: "Low" },
  aggressive: { bandRatios: { rumble: 0.02, plosive: 0.06, mud: 0.08, lowMid: 0.25, presence: 0.30, harshness: 0.14, sibilance: 0.09, air: 0.06 }, centroidRange: [2800, 4500], targetLufs: -12, noiseTolerance: "High" },
};

// ── Main handler ──

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const reqId = crypto.randomUUID();

  try {
    // ── Parse multipart form data ──
    let form: FormData;
    try {
      form = await req.formData();
    } catch (e) {
      console.error(`[${reqId}] formData parse error:`, e);
      return jsonError(400, { error: "invalid_payload", details: "Failed to parse multipart request." });
    }

    // ── API Key ──
    const apiKey = Deno.env.get("GOOGLE_API_KEY");
    if (!apiKey) {
      return jsonError(503, { error: "gemini_unavailable", details: "GOOGLE_API_KEY not configured." });
    }

    // ── Extract & validate audio file (capability check, not instanceof) ──
    const audioFile = form.get("audio");
    if (!audioFile || typeof (audioFile as any).arrayBuffer !== "function") {
      return jsonError(400, { error: "invalid_payload", details: "Missing or invalid audio file." });
    }

    // ── Extract & validate analysis ──
    const analysisRaw = form.get("analysis");
    if (!analysisRaw || typeof analysisRaw !== "string") {
      return jsonError(400, { error: "invalid_payload", details: "Missing analysis data." });
    }
    if (new TextEncoder().encode(analysisRaw).length > MAX_ANALYSIS_SIZE) {
      return jsonError(400, { error: "invalid_payload", details: "Analysis data too large." });
    }
    let analysis: any;
    try {
      analysis = JSON.parse(analysisRaw);
    } catch {
      return jsonError(400, { error: "invalid_payload", details: "Malformed analysis JSON." });
    }

    // ── Mode & styleTarget with typeof guard ──
    const modeRaw = form.get("mode");
    const mode = (typeof modeRaw === "string" && modeRaw) ? modeRaw : "safe";
    const styleTargetRaw = form.get("styleTarget");
    const styleTarget = (typeof styleTargetRaw === "string" && styleTargetRaw) ? styleTargetRaw : "natural";

    // ── Feedback with size limit ──
    const feedbackRaw = form.get("feedback");
    const feedback = (typeof feedbackRaw === "string" && feedbackRaw && feedbackRaw.length <= MAX_FEEDBACK_SIZE)
      ? feedbackRaw : null;

    // ── priorDecision with safe parse ──
    const priorDecisionRaw = form.get("priorDecision");
    let priorDecision: any = null;
    if (typeof priorDecisionRaw === "string" && priorDecisionRaw) {
      try {
        priorDecision = JSON.parse(priorDecisionRaw);
      } catch {
        return jsonError(400, { error: "invalid_payload", details: "Malformed priorDecision JSON." });
      }
    }

    // ── History context (preference summary from past sessions) ──
    const historyContextRaw = form.get("historyContext");
    const historyContext = (typeof historyContextRaw === "string" && historyContextRaw && 
      new TextEncoder().encode(historyContextRaw).length <= MAX_HISTORY_CONTEXT_SIZE)
      ? historyContextRaw : null;

    // ── MIME with extension fallback (handles empty type, octet-stream, empty name) ──
    let audioMimeType = (audioFile as File).type || "";
    const ext = ((audioFile as File).name || "").split(".").pop()?.toLowerCase() || "";

    if (!audioMimeType || !ALLOWED_MIME_TYPES.includes(audioMimeType)) {
      const extMap: Record<string, string> = {
        wav: "audio/wav", mp3: "audio/mpeg",
        mp4: "audio/mp4", m4a: "audio/mp4",
      };
      audioMimeType = extMap[ext] || audioMimeType;
    }

    if (!audioMimeType || !ALLOWED_MIME_TYPES.includes(audioMimeType)) {
      return jsonError(400, { error: "unsupported_format", details: "Unsupported audio format. Upload WAV, MP3, or M4A." });
    }

    // ── Size validation ──
    const fileSize = (audioFile as File).size;
    if (fileSize > MAX_FILE_SIZE) {
      return jsonError(400, { error: "file_too_large", details: "Audio exceeds 10 MiB limit." });
    }
    if (fileSize < MIN_FILE_SIZE) {
      return jsonError(400, { error: "invalid_payload", details: "Audio file too small (< 1 KB)." });
    }

    // ── Bytes integrity check ──
    const bytes = new Uint8Array(await (audioFile as File).arrayBuffer());
    if (bytes.length !== fileSize || bytes.length < MIN_FILE_SIZE) {
      return jsonError(400, { error: "invalid_payload", details: "Audio bytes do not match expected file size." });
    }

    // ── Request logging ──
    console.log(`[${reqId}] Received: size=${fileSize} mime=${audioMimeType} mode=${mode} style=${styleTarget}`);

    // ── Upload to File API ──
    console.log(`[${reqId}] Uploading audio to File API...`);
    const { fileUri, fileName } = await uploadToFileApi(apiKey, bytes, audioMimeType);

    // ── Wait for file to become ACTIVE ──
    console.log(`[${reqId}] Waiting for file to become ACTIVE...`);
    await waitForFileActive(apiKey, fileName, reqId);

    // ── Build prompt ──
    let promptText = `${SYSTEM_PROMPT}\n\n## Analysis Data\n\`\`\`json\n${JSON.stringify(analysis, null, 2)}\n\`\`\`\n\n`;
    promptText += `## Settings\n- Mode: ${mode === "safe" ? "Safe (conservative, minimal intervention)" : "Unleashed (broad authority, aggressive allowed)"}\n`;
    promptText += `- Style Target: ${styleTarget}\n`;

    const profile = STYLE_PROFILE_DATA[styleTarget] || STYLE_PROFILE_DATA.natural;
    const bandLines = Object.entries(profile.bandRatios)
      .map(([band, ratio]) => `  - ${band}: ${(ratio * 100).toFixed(1)}%`)
      .join("\n");
    promptText += `\n## Active Style Profile Reference\nTarget spectral balance (band energy ratios):\n${bandLines}\nSpectral centroid target range: ${profile.centroidRange[0]}–${profile.centroidRange[1]} Hz\nTarget integrated loudness: ${profile.targetLufs} LUFS\nNoise tolerance: ${profile.noiseTolerance}\n\nPrioritize achieving this spectral shape and loudness target. Adjust EQ, compression, and de-essing parameters to match these reference ratios while respecting safety limits.\n`;

    if (feedback) {
      promptText += `\n## User Feedback on Previous Version\nFeedback: ${feedback}\nPlease adjust the decision accordingly while maintaining safety limits.\n`;
    }
    if (priorDecision) {
      promptText += `\n## Prior Decision (for reference)\n\`\`\`json\n${JSON.stringify(priorDecision, null, 2)}\n\`\`\`\n`;
    }
    if (historyContext) {
      promptText += `\n${historyContext}\n\nUse this history to bias your decisions toward the user's demonstrated preferences. If the user frequently sends "too_sharp" feedback, reduce harshness/sibilance more aggressively. If they favor a particular style, lean into its characteristics.\n`;
    }

    // ── Build contents with file_data ──
    const contents = [
      {
        role: "user",
        parts: [
          { text: promptText },
          { file_data: { mime_type: audioMimeType, file_uri: fileUri } },
        ],
      },
    ];

    // ── Call Gemini (with cleanup in finally) ──
    let modelUsed = PRIMARY_MODEL;

    try {
      console.log(`[${reqId}] Attempting primary model: ${PRIMARY_MODEL}`);
      let response: Response;

      try {
        response = await callGeminiNative(PRIMARY_MODEL, apiKey, contents);
      } catch (e) {
        if (e.name === "AbortError") {
          console.error(`[${reqId}] Primary model (${PRIMARY_MODEL}) timed out after ${TIMEOUT_MS}ms`);
        } else {
          console.error(`[${reqId}] Primary model (${PRIMARY_MODEL}) fetch error:`, e);
        }
        response = null as any;
      }

      if (!response || !response.ok) {
        if (response) {
          const errText = await response.text();
          console.error(`[${reqId}] Primary model (${PRIMARY_MODEL}) failed: ${response.status}`, errText);
        }

        console.log(`[${reqId}] Attempting fallback model: ${FALLBACK_MODEL}`);
        modelUsed = FALLBACK_MODEL;
        try {
          response = await callGeminiNative(FALLBACK_MODEL, apiKey, contents);
        } catch (e) {
          const reason = e.name === "AbortError" ? `timed out after ${TIMEOUT_MS}ms` : (e.message || "fetch error");
          console.error(`[${reqId}] Fallback model (${FALLBACK_MODEL}) failed:`, reason);
          return jsonError(503, {
            error: "gemini_unavailable",
            details: `Both models failed. Primary: ${PRIMARY_MODEL}, Fallback: ${FALLBACK_MODEL}. Last error: ${reason}`,
            model: FALLBACK_MODEL,
          });
        }

        if (!response.ok) {
          const errText = await response.text();
          console.error(`[${reqId}] Fallback model (${FALLBACK_MODEL}) failed: ${response.status}`, errText);
          return jsonError(503, {
            error: "gemini_unavailable",
            details: `Both models failed. Fallback (${FALLBACK_MODEL}) returned ${response.status}.`,
            model: FALLBACK_MODEL,
          });
        }
      }

      console.log(`[${reqId}] Model used: ${modelUsed}, status: ${response.status}`);
      const data = await response.json();
      console.log(`[${reqId}] Gemini raw response: ${JSON.stringify(data).slice(0, 2000)}`);

      // ── Parse response ──
      const parts = data.candidates?.[0]?.content?.parts || [];
      const fnPart = parts.find((p: any) => p.functionCall);

      if (!fnPart) {
        console.error(`[${reqId}] No functionCall found in response parts:`, JSON.stringify(parts).slice(0, 1000));
        return jsonError(503, { error: "gemini_unavailable", details: "Gemini returned an unexpected response format. No function call found.", model: modelUsed });
      }

      const decision = fnPart.functionCall.args;
      if (!decision || typeof decision !== "object") {
        console.error(`[${reqId}] functionCall.args is empty or invalid:`, JSON.stringify(fnPart).slice(0, 500));
        return jsonError(503, { error: "gemini_unavailable", details: "Gemini returned empty function call arguments.", model: modelUsed });
      }

      // ── Validate required fields ──
      const missingFields = REQUIRED_FIELDS.filter((f) => decision[f] === undefined || decision[f] === null);
      if (missingFields.length > 0) {
        console.error(`[${reqId}] Missing required fields:`, missingFields);
        return jsonError(503, { error: "gemini_incomplete", details: `Gemini returned incomplete decision. Missing: ${missingFields.join(", ")}`, model: modelUsed });
      }

      // ── audioReceived enforcement ──
      if (decision.audioReceived === false) {
        console.error(`[${reqId}] Gemini reports audioReceived=false`);
        return jsonError(503, { error: "audio_not_received", details: "Gemini did not receive audio input. Analysis invalid.", model: modelUsed });
      }

      return new Response(
        JSON.stringify({ decision, modelUsed }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } finally {
      // ── Cleanup: delete uploaded file ──
      deleteFile(apiKey, fileName, reqId);
    }
  } catch (e) {
    console.error(`[${reqId}] gemini-vocal error:`, e);
    return jsonError(500, { error: "gemini_unavailable", details: e instanceof Error ? e.message : "Unknown server error" });
  }
});
