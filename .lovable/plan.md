
1) Stabilize immediate freeze points:
- Add hard processing guardrails (interactive preview length cap; full-length render only on explicit final export).
- Change slider rendering to commit-on-release + longer debounce; cancel stale in-flight renders when new input arrives.
- Add explicit “Cancel processing” support for Analyze/Auto Fix/Feedback flows.

2) Remove main-thread CPU hotspots:
- Replace naive per-bin/per-sample DFT code in `DenoiseLite`, `ResonanceSuppressor`, `computeNoiseProfile`, `AnalysisCache`, and `audioAnalysis` with a shared FFT utility.
- Precompute/reuse Hann windows and trig tables by FFT size.
- Early-exit heavy spectral passes when activation criteria fail (clean/noise-free input).

3) Eliminate duplicate full-buffer work:
- In `autoFix`/`sendFeedback`, stop WAV-exporting every variant immediately; keep `AudioBuffer` in memory and export only selected version.
- Run `validateRender` only for the currently selected/recommended variant.
- Reuse cached spectral analysis for scoring + post-render checks instead of re-analyzing each version.
- Decode source file once and reuse it in `renderWithOverrides` (no per-slider decode).

4) Reduce rendering workload per interaction:
- Interactive mode: render fewer variants first (Safe Baseline + primary); defer extra variants behind a quality toggle.
- Add draft-quality audition mode (lower FFT workload) and reserve full-quality for final pass/export.
- Make chunk yielding time-budgeted (yield every ~8–12ms budget) to prevent long blocking slices.

5) Cut UI/runtime overhead:
- Lazy-load DSP-heavy components/modules after file upload (`WaveformComparison`, `ExportSummary`, heavy DSP libs).
- Keep icon/component imports scoped and avoid loading unused heavy UI paths at startup.
- Simplify `analyzeAudio` to one deterministic pipeline (remove extra realtime analyzer/context path).

6) Add performance gates and verification:
- Instrument stage timings (analyze, decision, render per variant, score, validate, export).
- Add regression thresholds: no unresponsive dialog on 3-minute stereo test, slider feedback under 300ms, first playable processed output under target latency.
- Verify end-to-end manually with short/medium/long files and compare pre/post timing logs.
