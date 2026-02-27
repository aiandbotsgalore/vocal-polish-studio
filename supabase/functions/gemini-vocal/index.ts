import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_MIME_TYPES = ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3"];
const MAX_BASE64_LENGTH = 14_000_000; // ~10.5 MB raw
const MIN_BASE64_LENGTH = 2000;

const PRIMARY_MODEL = "gemini-3.1-pro-preview";
const FALLBACK_MODEL = "gemini-3-pro-preview";
const TIMEOUT_MS = 20_000;

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { analysis, mode, styleTarget, feedback, priorDecision, audioBase64, audioMimeType } = await req.json();

    // ── API Key ──
    const apiKey = Deno.env.get("GOOGLE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "gemini_unavailable", details: "GOOGLE_API_KEY not configured." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Server-side validations ──
    if (!audioBase64 || audioBase64.length < MIN_BASE64_LENGTH) {
      return new Response(
        JSON.stringify({ error: "invalid_payload", details: "Invalid audio payload received." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (audioBase64.length > MAX_BASE64_LENGTH) {
      return new Response(
        JSON.stringify({ error: "file_too_large", details: "Audio payload exceeds inline Gemini limits. Trim the clip or convert to shorter audio." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!audioMimeType || !ALLOWED_MIME_TYPES.includes(audioMimeType)) {
      return new Response(
        JSON.stringify({ error: "unsupported_format", details: "Unsupported audio format. Upload WAV or MP3." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Build prompt text ──
    let promptText = `${SYSTEM_PROMPT}\n\n## Analysis Data\n\`\`\`json\n${JSON.stringify(analysis, null, 2)}\n\`\`\`\n\n`;
    promptText += `## Settings\n- Mode: ${mode === "safe" ? "Safe (conservative, minimal intervention)" : "Unleashed (broad authority, aggressive allowed)"}\n`;
    promptText += `- Style Target: ${styleTarget}\n`;

    if (feedback) {
      promptText += `\n## User Feedback on Previous Version\nFeedback: ${feedback}\nPlease adjust the decision accordingly while maintaining safety limits.\n`;
    }
    if (priorDecision) {
      promptText += `\n## Prior Decision (for reference)\n\`\`\`json\n${JSON.stringify(priorDecision, null, 2)}\n\`\`\`\n`;
    }

    // ── Gemini-native request ──
    const contents = [
      {
        role: "user",
        parts: [
          { text: promptText },
          { inlineData: { mimeType: audioMimeType, data: audioBase64 } },
        ],
      },
    ];

    // ── Primary model ──
    console.log(`Attempting primary model: ${PRIMARY_MODEL}`);
    let response: Response;
    let modelUsed = PRIMARY_MODEL;

    try {
      response = await callGeminiNative(PRIMARY_MODEL, apiKey, contents);
    } catch (e) {
      if (e.name === "AbortError") {
        console.error(`Primary model (${PRIMARY_MODEL}) timed out after ${TIMEOUT_MS}ms`);
      } else {
        console.error(`Primary model (${PRIMARY_MODEL}) fetch error:`, e);
      }
      // Fall through to fallback
      response = null as any;
    }

    if (!response || !response.ok) {
      if (response) {
        const errText = await response.text();
        console.error(`Primary model (${PRIMARY_MODEL}) failed: ${response.status}`, errText);
      }

      // ── Fallback model ──
      console.log(`Attempting fallback model: ${FALLBACK_MODEL}`);
      modelUsed = FALLBACK_MODEL;
      try {
        response = await callGeminiNative(FALLBACK_MODEL, apiKey, contents);
      } catch (e) {
        const reason = e.name === "AbortError" ? `timed out after ${TIMEOUT_MS}ms` : (e.message || "fetch error");
        console.error(`Fallback model (${FALLBACK_MODEL}) failed:`, reason);
        return new Response(
          JSON.stringify({
            error: "gemini_unavailable",
            details: `Both models failed. Primary: ${PRIMARY_MODEL}, Fallback: ${FALLBACK_MODEL}. Last error: ${reason}`,
            model: FALLBACK_MODEL,
          }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Fallback model (${FALLBACK_MODEL}) failed: ${response.status}`, errText);
        return new Response(
          JSON.stringify({
            error: "gemini_unavailable",
            details: `Both models failed. Fallback (${FALLBACK_MODEL}) returned ${response.status}.`,
            model: FALLBACK_MODEL,
          }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    console.log(`Model used: ${modelUsed}, status: ${response.status}`);
    const data = await response.json();
    console.log("Gemini raw response:", JSON.stringify(data).slice(0, 2000));

    // ── Parse response — scan all parts for functionCall ──
    const parts = data.candidates?.[0]?.content?.parts || [];
    const fnPart = parts.find((p: any) => p.functionCall);

    if (!fnPart) {
      console.error("No functionCall found in response parts:", JSON.stringify(parts).slice(0, 1000));
      return new Response(
        JSON.stringify({ error: "gemini_unavailable", details: "Gemini returned an unexpected response format. No function call found.", model: modelUsed }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const decision = fnPart.functionCall.args;
    if (!decision || typeof decision !== "object") {
      console.error("functionCall.args is empty or invalid:", JSON.stringify(fnPart).slice(0, 500));
      return new Response(
        JSON.stringify({ error: "gemini_unavailable", details: "Gemini returned empty function call arguments.", model: modelUsed }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Validate required fields ──
    const missingFields = REQUIRED_FIELDS.filter((f) => decision[f] === undefined || decision[f] === null);
    if (missingFields.length > 0) {
      console.error("Missing required fields:", missingFields);
      return new Response(
        JSON.stringify({ error: "gemini_incomplete", details: `Gemini returned incomplete decision. Missing: ${missingFields.join(", ")}`, model: modelUsed }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── audioReceived enforcement ──
    if (decision.audioReceived === false) {
      console.error("Gemini reports audioReceived=false");
      return new Response(
        JSON.stringify({ error: "audio_not_received", details: "Gemini did not receive audio input. Analysis invalid.", model: modelUsed }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ decision, modelUsed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("gemini-vocal error:", e);
    return new Response(
      JSON.stringify({ error: "gemini_unavailable", details: e instanceof Error ? e.message : "Unknown server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
