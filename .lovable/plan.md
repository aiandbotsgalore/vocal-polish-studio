

## Plan: Binary multipart/form-data transport with runtime guardrails

Three files changed. No DSP, scoring, or Gemini prompt logic touched.

### 1. `src/lib/geminiClient.ts` — Replace base64 with FormData

**Delete:** `base64Cache`, `clearBase64Cache`, `fnv1aHash`, `getCacheKey`, `fileToBase64`, `PROMPT_BUDGET`, `MAX_REQUEST_SIZE` (lines 22-63).

**Keep:** imports, `GeminiCallResult`, `ALLOWED_MIME_TYPES`, `getMimeType`.

**Add `audio/mp4` and `audio/x-m4a`** to `ALLOWED_MIME_TYPES`. Extend `getMimeType` to handle `mp4` and `m4a` extensions.

**Rewrite `callGemini`:**
- Size gate: reject if `file.size > 10_485_760` (10 MB).
- Build `FormData`: append `audio` (raw File), `analysis` (JSON string), `mode`, `styleTarget`. Conditionally append `feedback` and `priorDecision` (JSON string).
- Send via `fetch` to `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gemini-vocal` with only `apikey` header. No `Content-Type` — browser sets multipart boundary.
- Parse JSON response. Return same `GeminiCallResult` shape.

**Export a no-op `clearBase64Cache`** so `useAudioEngine.ts` import doesn't break. (Cleaned up separately in step 3.)

### 2. `supabase/functions/gemini-vocal/index.ts` — Accept multipart/form-data

**Constants:** Remove `MIN_BASE64_LENGTH`. Add `audio/mp4` and `audio/x-m4a` to `ALLOWED_MIME_TYPES`. Add `MAX_FILE_SIZE = 10_485_760` and `MIN_FILE_SIZE = 1000`.

**`uploadToFileApi` signature change:** Accept `(apiKey, bytes: Uint8Array, mimeType)` instead of `(apiKey, audioBase64, mimeType)`. Remove the `atob` decoding block (lines 23-28). The rest of the function (resumable start, header extraction checking both `x-goog-upload-url` and `location`, PUT with `upload, finalize`, return `{ fileUri, fileName }`) stays byte-for-byte identical — it already operates on a `Uint8Array` named `bytes`.

**Main handler parsing (the three guardrails):**

Replace `await req.json()` with `await req.formData()`.

Guardrail 1 — safe field extraction with null checks:
```
const audioFile = form.get("audio") as File | null;
if (!audioFile) return 400 "Missing audio file"

const analysisRaw = form.get("analysis");
if (!analysisRaw || typeof analysisRaw !== "string") return 400 "Missing analysis data"
const analysis = JSON.parse(analysisRaw);

const mode = (form.get("mode") as string) || "safe";
const styleTarget = (form.get("styleTarget") as string) || "natural";

const feedback = form.get("feedback") as string | null;
const priorDecisionRaw = form.get("priorDecision") as string | null;
const priorDecision = priorDecisionRaw ? JSON.parse(priorDecisionRaw) : null;
```

Guardrail 2 — MIME fallback for empty `audioFile.type`:
```
let audioMimeType = audioFile.type;
if (!audioMimeType) {
  const ext = audioFile.name?.split(".").pop()?.toLowerCase();
  if (ext === "wav") audioMimeType = "audio/wav";
  else if (ext === "mp3") audioMimeType = "audio/mpeg";
  else if (ext === "mp4" || ext === "m4a") audioMimeType = "audio/mp4";
}
```
Then validate against `ALLOWED_MIME_TYPES`.

Guardrail 3 — size validation:
- Reject if `audioFile.size > MAX_FILE_SIZE` or `audioFile.size < MIN_FILE_SIZE`.

Get bytes: `const bytes = new Uint8Array(await audioFile.arrayBuffer())`.
Pass to `uploadToFileApi(apiKey, bytes, audioMimeType)`.

Everything downstream (prompt building, `callGeminiNative`, response parsing, model fallback, `try/finally` cleanup) is unchanged.

### 3. `src/hooks/useAudioEngine.ts` — Remove dead import

- Line 17: remove `clearBase64Cache` from the import (keep `callGemini`).
- Line 73: delete the `clearBase64Cache()` call.

No other changes.

