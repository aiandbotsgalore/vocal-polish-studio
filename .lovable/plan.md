

## Plan: Tightened Multimodal Gemini Integration

### Files Modified
```
src/lib/geminiClient.ts
src/hooks/useAudioEngine.ts
supabase/functions/gemini-vocal/index.ts
src/types/gemini.ts
src/components/AnalysisReport.tsx
src/lib/postRenderValidation.ts
```

---

### 1. Single Size Gate (geminiClient.ts)

One rule, no ambiguity:
```
const PROMPT_BUDGET = 50_000; // ~50 KB
const MAX_REQUEST_SIZE = 18_000_000; // 18 MB
const estimatedSize = file.size * 1.33 + PROMPT_BUDGET;
if (estimatedSize > MAX_REQUEST_SIZE) → block with error:
  "Audio too large for inline analysis. Please trim or convert."
```
No second threshold. No dual logic.

---

### 2. MIME Type Validation (geminiClient.ts)

Before encoding, validate `file.type`:
```
Allowed: "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3"
```
Reject anything else → error: "Unsupported audio format. Upload WAV or MP3."

Pass actual `file.type` as `audioMimeType` to edge function. Never hardcode.

---

### 3. Stronger Base64 Cache Key (geminiClient.ts)

Cache key = `file.name + file.size + file.lastModified + shortHash`

Compute `shortHash` by reading the first 8KB of the file via `FileReader` / `arrayBuffer().slice(0, 8192)`, then hashing with a simple FNV-1a or similar fast hash. This prevents stale cache on same-name file replacements.

---

### 4. Audio Duration Limit (geminiClient.ts + useAudioEngine.ts)

After Web Audio API decodes the file in `analyze()`, check `audioBuffer.duration`:
```
if (duration > 300) → block: "Audio exceeds 5 minute limit. Please trim."
```
This runs after decode but before Gemini call.

---

### 5. Pass File to callGemini (useAudioEngine.ts)

- `analyze()`: pass `originalFile` to `callGemini`
- `sendFeedback()`: pass `originalFile` to `callGemini`
- `loadFile()`: call `clearBase64Cache()`

---

### 6. Edge Function — Gemini-Native Only (index.ts)

**Remove Lovable gateway path entirely.** Only `GOOGLE_API_KEY`. If missing → immediate 503 error.

**Server-side size validation:**
```
if (audioBase64.length > 14_000_000) → 400 error:
  "Audio payload exceeds inline Gemini limits. Trim the clip or convert to shorter audio."
```

**Base64 minimum check:**
```
if (!audioBase64 || audioBase64.length < 2000) → 400 error:
  "Invalid audio payload received."
```

**MIME type validation on server too:**
```
Allowed: "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3"
```

**Timeout:** Wrap each `fetch` call with `AbortController` + 20-second timeout. On timeout → return GeminiError.

**Models:** Primary `gemini-3.1-pro-preview`, fallback `gemini-3-pro-preview`. No others.

**API endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}`

**Request format — Gemini-native:**
```json
{
  "contents": [{
    "role": "user",
    "parts": [
      { "text": "<system prompt + metrics + mode + styleTarget + feedback>" },
      { "inlineData": { "mimeType": "<from request>", "data": "<base64>" } }
    ]
  }],
  "tools": [{ "functionDeclarations": [{ ... }] }],
  "toolConfig": { "functionCallingConfig": { "mode": "ANY", "allowedFunctionNames": ["vocal_decision"] } }
}
```

**System prompt additions:**
- "You are receiving both spectral analysis metrics AND the actual audio file. Listen to the audio."
- "You must reference at least one directly audible characteristic (e.g., whisper tone, room echo, sharp S sounds, plosives, dynamic jumps). If no audio is present, set audioReceived to false."
- "Return unifiedReport as a cohesive narrative that weaves numeric metrics with audible observations."
- "Explain what you intentionally did NOT change and why."
- "If safety clamps will apply, mention the tradeoff."

**Tool schema (Gemini `functionDeclarations` format):**
- `unifiedReport` — required STRING
- `audioReceived` — required BOOLEAN
- All existing DSP fields remain required
- `reportSummary`, `reportReasoning` — removed from schema

**Response parsing — scan all parts:**
```
const parts = response.candidates?.[0]?.content?.parts || [];
const fnPart = parts.find(p => p.functionCall);
if (!fnPart) → GeminiError
```
No text-parsing fallback. No JSON-from-content fallback.

**Required field validation before returning:**
Check presence of: `unifiedReport`, `audioReceived`, `issueProfile`, `strategy`, `processingOrder`, `eqBellCenterHz`, `eqBellQ`, `eqBellCutDb`, `deEssMode`, `deEssCenterHz`, `deEssReductionDb`. If any missing → GeminiError: "Gemini returned incomplete decision."

**audioReceived enforcement:**
- If `audioReceived === false` → error: "Gemini did not receive audio input. Analysis invalid."
- If `audioReceived` missing → GeminiError

**modelUsed in response:** Set to actual model string used. Return in response JSON.

**Console logging:** Log model attempted, model used, response status, and any error details.

---

### 7. Types (gemini.ts)

```typescript
// REQUIRED — not optional
unifiedReport: string;
audioReceived: boolean;

// REMOVED
// reportSummary — gone
// reportReasoning — gone
```

All existing DSP fields (`eqBellCenterHz`, etc.) remain unchanged.
Add `processingOrder` and `styleInterpretation` as required strings if not already present.

---

### 8. AnalysisReport.tsx — Unified Report UI

**Report header** shows audio analysis source indicator:
- If `audioReceived === true`: badge "Gemini Listening + Metrics"
- If `audioReceived === false`: warning badge "Metrics Only (Audio Not Received)"

**Primary section:** "Gemini Analysis" displaying `decision.unifiedReport` as rendered narrative. No fallback to reportSummary — if missing, component shows nothing (error should have been caught upstream).

**Collapsible section:** Using Radix Collapsible, "Raw Measured Metrics" containing ScoreBar, IssueHeatmap, metric grid. Collapsed by default. Toggle label: "Show Raw Metrics".

**Remove:** Separate "Reasoning" section (absorbed into unifiedReport).

**Keep unchanged:** Strategy & Parameters, Safety Clamps, Post-Render Results.

**GeminiError UI enhancement:** When error occurs, show:
- Model attempted
- Failure reason
- Suggestion text (check API key / trim audio / retry)

---

### 9. Post-Render Band Energy Delta (postRenderValidation.ts)

Add `targetedBandDeltaDb: number` to `PostRenderScore`.

Compute energy difference in the EQ-targeted frequency band (using `decision.eqBellCenterHz` passed to validator) before vs after processing.

**Failure rule:**
```
if (Math.abs(targetedBandDeltaDb) < 0.2) → flag:
  "Processing produced negligible audible change. DSP may not have applied."
```

Display in Post-Render Results section.

Add `targetedBandDeltaDb` to `PostRenderScore` type in gemini.ts.

---

### Failure Guarantees

- Both models fail → GeminiError, Auto Fix disabled, no heuristic text
- `audioReceived` false or missing → hard stop with explicit message
- `unifiedReport` missing → GeminiError (not silent fallback)
- `functionCall` not found in any part → GeminiError
- Required DSP fields missing → GeminiError
- Timeout after 20s → GeminiError
- Oversized audio → blocked client-side AND server-side
- Undersized base64 → blocked server-side
- Wrong MIME type → blocked client-side AND server-side
- Audio > 5 min → blocked client-side

