

## Implementation Plan: Gemini-Powered Vocal Doctor Lite

Your model strategy is sound. Here is the concrete implementation plan.

### Current State

- Lovable Cloud: **Not enabled** (no `supabase/` directory exists)
- `LOVABLE_API_KEY`: Already provisioned as a secret
- Existing app: Single-page MVP with rule-based analysis and basic DSP
- No connections needed beyond Lovable AI Gateway

### Infrastructure Setup (Required First)

1. **Enable Lovable Cloud** -- this creates the Supabase project and allows edge function deployment
2. **Create edge function `gemini-vocal`** -- secure proxy to the Lovable AI Gateway

### Architecture

```text
Client (React SPA)
  │
  ├─ Layer 1: Deterministic Analysis (Web Audio FFT)
  │    Produces detailed JSON: global scores, band energies,
  │    segment timelines, burstiness, brightness consistency
  │
  ├─ Edge Function call ──────────────────────────┐
  │    Sends: analysis JSON, mode, style,          │
  │    feedback token, prior decision              │
  │                                                │
  │                    supabase/functions/gemini-vocal
  │                    ├─ Primary: google/gemini-3-pro-preview
  │                    ├─ Fallback: google/gemini-2.5-pro
  │                    ├─ Uses tool_choice for structured output
  │                    └─ Returns: GeminiDecision JSON
  │                                                │
  ├─ Parse decision + Safety Clamp ◄──────────────┘
  │
  ├─ Layer 3: DSP Execution (OfflineAudioContext)
  │    Bell EQ, de-esser, optional 2nd bell,
  │    high shelf, presence comp, output trim
  │
  └─ Layer 4: Post-Render Validation (async)
       Re-analyze processed audio, compute deltas,
       score result, compare A vs B if both exist
```

### Phase 1: Foundation

**Edge function: `supabase/functions/gemini-vocal/index.ts`**
- Accepts POST with `{ analysis, mode, styleTarget, feedback, priorDecision }`
- Constructs a system prompt: "You are a professional Audio Engineer. You receive Layer 1 spectral analysis data in JSON. Interpret the measurements to determine optimal DSP parameters for the given style target."
- Calls `google/gemini-3-pro-preview` via `https://ai.gateway.lovable.dev/v1/chat/completions` with `tool_choice` for structured output
- Tool schema defines the full `GeminiDecision` object (issueProfile, EQ decisions, de-ess decisions, output staging, reporting, optional alternate)
- On failure (non-200), retries once with `google/gemini-2.5-pro`
- On second failure, returns `{ error: "gemini_unavailable", details: "..." }` with 503
- Handles 429/402 specifically with user-facing error messages

**Expanded Layer 1 analysis: `src/lib/audioAnalysis.ts`**
- Extract into dedicated module from `useAudioEngine`
- Add segment-level analysis: divide audio into ~500ms windows, compute per-segment harshness/sibilance scores
- Add new metrics: peak level, RMS loudness estimate, noise floor estimate, voice brightness score, burstiness score, brightness consistency
- Add band energy ratios for 2-5kHz, 5-9kHz, 5-10kHz explicitly
- Add peak burst metrics (max segment score, segment index)
- Output a typed `LayerOneAnalysis` object

**UI additions to `Index.tsx`**
- Mode selector: Safe Mode / Unleashed Test Mode (two toggle buttons)
- Style target dropdown: Natural, Podcast Clean, Warm Smooth, Modern Bright, Presence Forward, Aggressive
- Expanded status states in `StatusBadge`: Idle, Analyzing Audio, Calling Gemini, Gemini Decision Ready, Fixing, Playback Ready, Validating, Ready, Gemini Error

**Config: `supabase/config.toml`**
- Set `verify_jwt = false` for `gemini-vocal` (public endpoint, no auth needed for this prototype)

### Phase 2: Gemini Integration

**New module: `src/lib/geminiClient.ts`**
- Function `callGemini(analysis, mode, styleTarget, feedback?, priorDecision?)` that invokes the edge function via `supabase.functions.invoke('gemini-vocal', { body: ... })`
- Parses response into typed `GeminiDecision` interface
- On error response, sets `geminiErrorState` with the specific message

**Types: `src/types/gemini.ts`**
- `GeminiDecision` interface with all fields: issueProfile, eqBellCenterHz, eqBellQ, eqBellCutDb, optional second bell, deEssMode, deEssCenterHz, deEssReductionDb, outputTrimDb, reportSummary, reportReasoning, confidence, strategy, passCount, tradeoffPriority, artifactRiskPrediction, alternateDecision
- `LayerOneAnalysis` interface
- Expanded `AppStatus` type

**AI Autonomy Panel: `src/components/AutonomyPanel.tsx`**
- Compact panel showing: Mode, Style Target, Gemini Model Used, AI Confidence, Chosen Strategy, Pass Count, Tradeoff Priority, Preferred Version

**Updated Analysis Report: `src/components/AnalysisReport.tsx`**
- Sections: Measured Findings (Layer 1 data), Gemini Interpretation, Chosen Strategy, Chosen Parameters, Safety Clamps Applied, Post-Render Results, AI Preferred Version

**Analyze button flow**
1. Set status "Analyzing Audio"
2. Run Layer 1 deterministic analysis
3. Set status "Calling Gemini"
4. Call edge function with analysis + mode + style
5. On success: set status "Gemini Decision Ready", populate panels
6. On failure: set status "Gemini Error", show explicit error, disable Auto Fix

### Phase 3: DSP and Playback

**Safety clamp module: `src/lib/safetyClamps.ts`**
- Accepts raw `GeminiDecision`, returns clamped decision + list of clamps applied
- Limits: de-ess center 5000-10000Hz, de-ess reduction max -6dB (Safe) / -8dB (Unleashed), EQ bell max -5dB / -7dB, high shelf max -2dB, presence comp max +2dB, Q range 0.5-4.0
- Output trim to prevent clipping

**Rewritten DSP engine: `src/lib/dspEngine.ts`**
- Accepts clamped `GeminiDecision` and audio file
- Builds `OfflineAudioContext` chain: bell EQ 1, optional bell EQ 2, de-esser (peaking), optional high shelf, optional presence compensation, gain node for output trim
- Supports single-pass and two-pass (Unleashed multi-pass)
- Returns `{ blob, buffer }` per version

**Auto Fix flow**
1. Require valid `geminiDecision` -- if missing, show error
2. Apply safety clamps, record what was clamped
3. Render Version A
4. Make playback available immediately
5. Render Version B only if: confidence < threshold, artifact risk moderate/high, Gemini requested alternate, or user clicks "Generate Alternate"

**Updated playback UI**
- Before / After A / After B (conditional) players
- Version selector for revision history

### Phase 4: Feedback and Validation

**Post-render validation: `src/lib/postRenderValidation.ts`**
- Run Layer 1 analysis on processed audio
- Compare against original: compute sibilance reduction %, harshness reduction %, brightness preservation %, artifact risk estimate, overall score
- If A and B both exist, compare and mark preferred version
- Runs async after playback is available, updates report when done

**Feedback loop**
- Buttons: Too dull, Too sharp, Too lispy, Better
- On click: preserve current version in revision history, call Gemini again with original analysis + prior decision + feedback token
- Render new revision, add to history
- Show adjustment note in natural language

**Revision history: `src/components/RevisionHistory.tsx`**
- Compact list: Original, AI Version A, AI Version B, Revision 1 (Too dull), etc.
- Clicking switches the active playback version

**Export**
- Downloads currently selected version
- Shows compact summary: mode, style, model used, strategy, parameters, clamps, post-render score, preferred version status

### New and Modified Files Summary

```text
NEW FILES:
  supabase/config.toml
  supabase/functions/gemini-vocal/index.ts
  src/types/gemini.ts
  src/lib/audioAnalysis.ts
  src/lib/geminiClient.ts
  src/lib/safetyClamps.ts
  src/lib/dspEngine.ts
  src/lib/postRenderValidation.ts
  src/components/AutonomyPanel.tsx
  src/components/RevisionHistory.tsx
  src/components/ModeSelector.tsx
  src/components/StyleTargetSelector.tsx
  src/components/ExportSummary.tsx
  src/components/FeedbackButtons.tsx

MODIFIED FILES:
  src/hooks/useAudioEngine.ts  (major rewrite -- orchestrates all 4 layers)
  src/pages/Index.tsx           (expanded layout with new panels)
  src/components/AnalysisReport.tsx  (sectioned report)
  src/components/StatusBadge.tsx     (new status states)
  src/components/AudioPlayerPanel.tsx (multi-version support)
```

### Technical Notes

- **No streaming needed** -- Gemini calls use non-streaming `supabase.functions.invoke()` since we need the complete structured decision before proceeding
- **Tool calling** is used instead of asking for raw JSON to ensure reliable structured output from both Gemini models
- **System prompt** explicitly tells Gemini it receives spectral measurements, not audio, and must reason from the numbers
- **Conflict resolution** is encoded in the system prompt: safety > severity > style target > confidence-scaled aggressiveness
- **All state is local** -- no database tables needed

