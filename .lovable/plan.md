

## Plan: Waveform A/B + Live Sliders + Soft Duration Limit

### Files to Create
- `src/components/WaveformComparison.tsx` — Canvas waveform with A/B drag slider
- `src/components/LiveSliders.tsx` — 4 DSP sliders with debounced re-render

### Files to Modify
- `src/hooks/useAudioEngine.ts` — remove hard 5-min block, add `renderWithOverrides()`, store original AudioBuffer, friendlier errors
- `src/lib/dspEngine.ts` — add `renderWithOverrides()` accepting slider values that override decision params
- `src/pages/Index.tsx` — wire up WaveformComparison and LiveSliders
- `src/types/gemini.ts` — add `SliderOverrides` type

### Technical Details

**1. Waveform + A/B Slider**

Pure canvas component, no external dependency. Takes `originalBuffer: AudioBuffer | null` and `processedBuffer: AudioBuffer | null`. Draws both waveforms overlaid — original in gray (`hsl(215 15% 50%)`), processed in primary color. A draggable vertical line splits: left of line plays/shows original, right shows processed. The divider has a small pill handle. Uses `requestAnimationFrame` for smooth drag. Component is ~120 lines.

Waveform rendering: downsample channel data to canvas width, draw min/max amplitude bars per pixel column. Original draws full width underneath, processed draws full width on top with clip region based on slider position.

**2. Live Sliders**

Four sliders appear after Auto Fix completes (when `currentVersion` exists). Each maps to a DSP parameter:

| Slider | Range | Maps to |
|--------|-------|---------|
| Harshness Reduction | 0–100% | Scales `eqBellCutDb` (0% = 0dB, 100% = original AI value) |
| Sibilance Reduction | 0–100% | Scales `deEssReductionDb` similarly |
| Brightness / Air | -6 to +6 dB | Adds a high shelf boost/cut at 10kHz |
| Output Volume | -12 to +6 dB | Overrides `outputTrimDb` |

Default positions = AI decision values (100%, 100%, 0dB, original trim).

On slider change: debounce 300ms, then call `renderWithOverrides(file, decision, overrides)` which builds the same DSP chain but with scaled values. Updates the current version's blob/url/buffer in place. Waveform updates automatically since it reads the buffer.

`renderWithOverrides` in dspEngine.ts: same as `renderWithDecision` but accepts `{ harshnessPct, sibilancePct, brightnessDb, outputDb }` and multiplies/overrides the relevant params.

**3. Soft Duration Limit**

In `useAudioEngine.ts`:
- Remove the hard block at 300s
- If duration > 360s (6 min), show toast warning: "Long audio detected — processing the first 6 minutes. For best results, trim your clip."
- The 18MB size gate in geminiClient.ts still protects against truly oversized files
- All error toasts get friendlier language throughout

**4. Index.tsx Changes**

- Store decoded `originalBuffer` in useAudioEngine (from the analysis step)
- Pass `originalBuffer` and `currentVersion?.buffer` to `<WaveformComparison />`
- Show `<LiveSliders />` below waveform when a version exists
- Remove individual `AudioPlayerPanel` per version, keep just Original + Current audio elements above the waveform

