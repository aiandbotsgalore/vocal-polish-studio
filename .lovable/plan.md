

## Plan: 12 Final Hardening Fixes to DSP Engine Architecture

These are spec amendments to the approved plan. No new features — only precision fixes that prevent sonic/technical bugs.

### Fix 1: Complete LUFS Filter Chain in `src/lib/dsp/loudness.ts`

The loudness measurement chain must be:
1. **Stage 1 — High-shelf pre-filter**: +3.999dB at 1681.97Hz (BS.1770 head-related)
2. **Stage 2 — RLB weighting filter**: high-pass at 38.135Hz (revised low-frequency)
3. **Stage 3 — Energy integration**: per-block mean-square
4. **Stage 4 — Gating**: absolute at -70 LUFS, relative at -10 LUFS

Both filters are biquad — use shared `biquad.ts` with exact BS.1770-4 coefficients. Without Stage 2, vocal LUFS can be 1-3dB wrong on bass-heavy recordings.

### Fix 2: Lock DenoiseLite STFT Settings in Plugin

Hardcode in `src/lib/dsp/plugins/DenoiseLite.ts`:
- FFT size: 2048
- Hop size: 512 (75% overlap)
- Window: Hann
- Chunk processing size: 4096 samples per async yield

These are not configurable params — they are internal constants.

### Fix 3: Median Smoothing Before Resonance Peak Detection

In `src/lib/dsp/plugins/ResonanceSuppressor.ts`:
- Apply 5-bin median smoothing to spectral magnitude before peak detection
- This prevents notching transient consonant spikes that look like resonances but aren't

### Fix 4: Internal Gain Reduction Clamp in Compressor

In `src/lib/dsp/plugins/Compressor.ts`:
- Hard internal clamp: max gain reduction = -12dB regardless of threshold/ratio combination
- This is inside the plugin, not just in SafetyRails — defense in depth

### Fix 5: GainRider Ramp Rate Limiter

In `src/lib/dsp/plugins/GainRider.ts`:
- Max gain change rate: 6 dB/second
- Slew-limit the gain automation curve to prevent robotic pumping artifacts

### Fix 6: Add DynamicEQ Mud Band to Safe Baseline

In `src/lib/dsp/VariantAudition.ts`, the Safe Baseline chain becomes:
- HPF 80Hz → DynamicEQ (single mud band: 250Hz, Q=1.2, max -3dB) → ResonanceSuppressor (2 notches, -3dB) → DeEsser (-3dB) → Compressor (2:1) → Limiter -1dBFS → OutputStage

### Fix 7: Centralized Frequency Band Definitions

Create `src/lib/dsp/frequencyBands.ts`:
```
rumble: [20, 80]
plosive: [80, 200]
mud: [200, 500]
lowMid: [500, 2000]
presence: [2000, 4000]
harshness: [3000, 5000]
sibilance: [5000, 9000]
air: [10000, 16000]
```
All modules (ScoringEngine, IssueMap, ResonanceSuppressor, StyleProfiles, DynamicEQ) import from this single source.

### Fix 8: Normalize Scoring Metrics to 0-1

In `src/lib/dsp/ScoringEngine.ts`:
- Before applying weights, normalize every metric to 0-1 scale
- dB metrics: map expected range (e.g., -60 to 0) → 0-1
- Ratios: already 0-1, keep as-is
- Percentages: divide by 100
- This prevents dB-scale metrics from dominating ratio-scale metrics

### Fix 9: Cap Variant Count

In `src/lib/dsp/VariantAudition.ts`:
- `MAX_VARIANTS = 4`
- If Gemini returns more than 4, keep the first 4 (plus Safe Baseline = 5 total max)

### Fix 10: Shared Analysis Cache

Create `src/lib/dsp/AnalysisCache.ts`:
- Stores computed FFT frames, band energies, spectral centroid per buffer
- Keyed by buffer identity (reference equality)
- `IssueMap` and `ScoringEngine` both check cache before computing
- Reduces redundant FFT computation by ~40-60%

### Fix 11: True Peak Safety on Export

In `src/lib/dsp/WavExporter.ts`:
- After final render, compute 4x oversampled true peak estimate
- If true peak > 0 dBFS: apply -0.5dB gain correction to entire buffer before export
- Then re-check sample peak stays under ceiling

### Fix 12: Plugin Order Validation Before Render

In `src/lib/dsp/OfflineRenderEngine.ts`:
- Before rendering any chain, validate that plugin IDs match the fixed template order exactly
- If order mismatch: reject the chain, log error, fall back to Safe Baseline
- Defense against bugs, not just Gemini — any code path that constructs a chain must pass this gate

### Files Summary

**New files:**
- `src/lib/dsp/frequencyBands.ts`
- `src/lib/dsp/AnalysisCache.ts`

**Amended files (changes baked into existing planned files):**
- `src/lib/dsp/loudness.ts` — add RLB weighting stage
- `src/lib/dsp/plugins/DenoiseLite.ts` — lock STFT constants
- `src/lib/dsp/plugins/ResonanceSuppressor.ts` — median smoothing pre-pass
- `src/lib/dsp/plugins/Compressor.ts` — internal -12dB GR clamp
- `src/lib/dsp/plugins/GainRider.ts` — 6dB/s ramp limiter
- `src/lib/dsp/VariantAudition.ts` — add DynamicEQ mud band to Safe Baseline, cap at 4 variants
- `src/lib/dsp/ScoringEngine.ts` — normalize metrics to 0-1 before weighting, use AnalysisCache
- `src/lib/dsp/IssueMap.ts` — use AnalysisCache
- `src/lib/dsp/WavExporter.ts` — true peak check with -0.5dB correction
- `src/lib/dsp/OfflineRenderEngine.ts` — plugin order validation gate

All fixes slot into the existing 8-phase implementation order. No new phases needed.

