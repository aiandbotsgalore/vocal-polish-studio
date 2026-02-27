

## Plan: Use Your Google API Key for Gemini Calls

### What Changes

The edge function currently uses `LOVABLE_API_KEY` with the Lovable AI gateway (`ai.gateway.lovable.dev`). We will:

1. **Store your Google API key** as a backend secret called `GOOGLE_API_KEY`
2. **Update the edge function** to prefer `GOOGLE_API_KEY` and call the Google Generative AI API directly (`generativelanguage.googleapis.com`) instead of the Lovable gateway
3. **Keep `LOVABLE_API_KEY` as fallback** — if `GOOGLE_API_KEY` is not set, it falls back to the gateway

### Technical Details

**Secret**: Store `AIzaSyBFiCc34mOiY-m1yeQ2tMIdepBlPKOh060` as `GOOGLE_API_KEY`

**Edge function change** (`supabase/functions/gemini-vocal/index.ts`):
- Check for `GOOGLE_API_KEY` first
- If present, call `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` with the Google key
- If not present, fall back to `ai.gateway.lovable.dev` with `LOVABLE_API_KEY`
- Model names change when using Google directly: `gemini-3-pro-preview` instead of `google/gemini-3-pro-preview`

**Files modified:**
```
supabase/functions/gemini-vocal/index.ts  — dual endpoint support
```

