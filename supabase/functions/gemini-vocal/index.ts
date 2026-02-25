import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a professional Audio Engineer with deep expertise in vocal processing. You receive Layer 1 spectral analysis data in JSON format — NOT raw audio. Do not ask for the audio file. Instead, interpret the measurements (harshness scores, sibilance scores, band energy ratios, segment timelines, burstiness, brightness consistency, peak levels, RMS loudness) to determine optimal DSP parameters for the given style target.

CONFLICT RESOLUTION POLICY (in priority order):
1. Safety and artifact prevention — always highest priority
2. Severe harshness or sibilance findings override style target preferences
3. Style target influences decisions only within safe and severity-aware limits
4. Confidence score controls aggressiveness — low confidence biases toward conservative settings

REASONING REQUIREMENTS:
- Be specific: reference actual measurement values from the analysis
- Explain WHY you chose each parameter value
- State what tradeoff you prioritized and why
- If you apply conservative settings, explain which measurements drove that decision
- Never use generic phrases like "improved clarity" or "applied enhancements"`;

const TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "vocal_decision",
    description: "Return the complete vocal processing decision based on spectral analysis data.",
    parameters: {
      type: "object",
      properties: {
        issueProfile: { type: "string", description: "Brief description of detected issues" },
        severity: { type: "string", enum: ["low", "moderate", "high"] },
        confidence: { type: "number", description: "0-100 confidence in the decision" },
        styleTarget: { type: "string" },
        styleInterpretation: { type: "string", description: "How style target was balanced with findings" },
        strategy: { type: "string", enum: ["de_ess_focused", "eq_focused", "balanced", "minimal_intervention", "multi_pass"] },
        processingOrder: { type: "string", description: "Order of DSP operations" },
        passCount: { type: "number", enum: [1, 2] },
        tradeoffPriority: { type: "string", description: "What was prioritized in tradeoff decisions" },
        artifactRiskPrediction: { type: "string", enum: ["low", "moderate", "high"] },
        eqBellCenterHz: { type: "number", description: "Center frequency of primary harshness EQ bell cut (Hz)" },
        eqBellQ: { type: "number", description: "Q factor for primary EQ bell" },
        eqBellCutDb: { type: "number", description: "Gain reduction in dB (negative number)" },
        optionalSecondEqBellCenterHz: { type: "number", description: "Optional second EQ bell center frequency" },
        optionalSecondEqBellQ: { type: "number" },
        optionalSecondEqBellCutDb: { type: "number" },
        optionalHighShelfCutDb: { type: "number", description: "Optional high shelf reduction in dB" },
        optionalPresenceCompensationDb: { type: "number", description: "Optional presence boost to compensate cuts" },
        deEssMode: { type: "string", enum: ["narrow", "wide", "off"] },
        deEssCenterHz: { type: "number", description: "De-esser center frequency (Hz)" },
        deEssReductionDb: { type: "number", description: "De-esser attenuation in dB (negative number)" },
        outputTrimDb: { type: "number", description: "Output level adjustment in dB" },
        reportSummary: { type: "string", description: "2-3 sentence plain English summary of what was found and what will be done" },
        reportReasoning: { type: "string", description: "Detailed reasoning referencing actual measurements, explaining strategy choice, tradeoff priority, and safety considerations" },
      },
      required: [
        "issueProfile", "severity", "confidence", "styleTarget", "styleInterpretation",
        "strategy", "processingOrder", "passCount", "tradeoffPriority", "artifactRiskPrediction",
        "eqBellCenterHz", "eqBellQ", "eqBellCutDb",
        "deEssMode", "deEssCenterHz", "deEssReductionDb",
        "outputTrimDb", "reportSummary", "reportReasoning"
      ],
      additionalProperties: false,
    },
  },
};

async function callModel(model: string, apiKey: string, body: any): Promise<Response> {
  return await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, model }),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { analysis, mode, styleTarget, feedback, priorDecision } = await req.json();
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "gemini_unavailable", details: "LOVABLE_API_KEY not configured" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build user message
    let userContent = `## Analysis Data\n\`\`\`json\n${JSON.stringify(analysis, null, 2)}\n\`\`\`\n\n`;
    userContent += `## Settings\n- Mode: ${mode === "safe" ? "Safe (conservative, minimal intervention)" : "Unleashed (broad authority, aggressive allowed)"}\n`;
    userContent += `- Style Target: ${styleTarget}\n`;

    if (feedback) {
      userContent += `\n## User Feedback on Previous Version\nFeedback: ${feedback}\nPlease adjust the decision accordingly while maintaining safety limits.\n`;
    }
    if (priorDecision) {
      userContent += `\n## Prior Decision (for reference)\n\`\`\`json\n${JSON.stringify(priorDecision, null, 2)}\n\`\`\`\n`;
    }

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ];

    const body = {
      messages,
      tools: [TOOL_SCHEMA],
      tool_choice: { type: "function", function: { name: "vocal_decision" } },
    };

    const PRIMARY_MODEL = "google/gemini-3-pro-preview";
    const FALLBACK_MODEL = "google/gemini-2.5-pro";

    // Try primary model
    let response = await callModel(PRIMARY_MODEL, apiKey, body);
    let modelUsed = PRIMARY_MODEL;

    if (!response.ok) {
      const status = response.status;
      const errorText = await response.text();
      console.error(`Primary model (${PRIMARY_MODEL}) failed: ${status}`, errorText);

      if (status === 429) {
        return new Response(
          JSON.stringify({ error: "rate_limited", details: "Rate limit exceeded. Please wait a moment and try again." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (status === 402) {
        return new Response(
          JSON.stringify({ error: "payment_required", details: "AI usage credits exhausted. Please add credits in Settings → Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Try fallback
      console.log(`Retrying with fallback model: ${FALLBACK_MODEL}`);
      response = await callModel(FALLBACK_MODEL, apiKey, body);
      modelUsed = FALLBACK_MODEL;

      if (!response.ok) {
        const fallbackError = await response.text();
        console.error(`Fallback model (${FALLBACK_MODEL}) also failed: ${response.status}`, fallbackError);
        return new Response(
          JSON.stringify({
            error: "gemini_unavailable",
            details: `Gemini analysis failed. Primary model (${PRIMARY_MODEL}) returned ${status}. Fallback model (${FALLBACK_MODEL}) returned ${response.status}. No AI decision was generated. Please check your network connection or model availability and try again.`,
            model: FALLBACK_MODEL,
          }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const data = await response.json();

    // Extract tool call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== "vocal_decision") {
      console.error("No valid tool call in response:", JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: "gemini_unavailable", details: "Gemini returned an unexpected response format. No tool call found." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let decision;
    try {
      decision = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      console.error("Failed to parse tool call arguments:", toolCall.function.arguments);
      return new Response(
        JSON.stringify({ error: "gemini_unavailable", details: "Gemini returned malformed tool call arguments." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ decision, modelUsed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("gemini-vocal error:", e);
    return new Response(
      JSON.stringify({ error: "gemini_unavailable", details: e instanceof Error ? e.message : "Unknown server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
