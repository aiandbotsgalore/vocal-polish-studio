

## RawAudioData Refactor — Fix Worker AudioBuffer Crash

### Files to modify (8 files, 1 new)

**1. `src/lib/dsp/types.ts`** — Add `RawAudioData` interface + factory
- `id: string` field using `crypto.randomUUID()`
- `channels: Float32Array[]`, `sampleRate`, `length`, `numberOfChannels`
- `createRawAudioData(channels, sampleRate)` with channel-length-mismatch validation and zero-length guard
- No `rawToAudioBuffer` here — kept out of worker-importable code

**2. NEW `src/lib/audio/audioBufferUtils.ts`** — Main-thread-only AudioBuffer conversion
- `audioBufferToRaw(buf: AudioBuffer): RawAudioData` — copies channel data (safe for post-transfer reads)
- `rawToAudioBuffer(raw: RawAudioData): AudioBuffer` — reconstruction using `new AudioBuffer()`
- This file is never imported by anything in `src/workers/` or `src/lib/dsp/`

**3. `src/lib/dsp/AnalysisCache.ts`** — LRU cache keyed by `RawAudioData.id`
- Replace `WeakMap<AudioBuffer, CachedAnalysis>` with `Map<string, CachedAnalysis>` + LRU access tracking
- Max 4 entries (realistic: source + up to 3 active variants; 4 × ~52MB = ~208MB worst case for 5-min stereo)
- LRU eviction on insert when at capacity (track recency via a `string[]` access list, move-to-front on get)
- `getOrComputeAnalysis(raw: RawAudioData)` — replace `buffer.getChannelData(ch)` with `raw.channels[ch]`
- `invalidateCache(id: string)` for cleanup on worker termination

**4. `src/lib/dsp/OfflineRenderEngine.ts`** — Accept/return `RawAudioData`
- `computeNoiseProfile(raw: RawAudioData)` — replace `buffer.getChannelData` with `raw.channels[ch]`, plain property access for sampleRate/length
- `renderOffline(source: RawAudioData, ...)` returns `{ raw: RawAudioData, ... }` — use `createRawAudioData()` for output, no `new AudioBuffer()`
- `copyBuffer` → `copyRaw` (just clone channels + create new RawAudioData)

**5. `src/lib/dsp/ScoringEngine.ts`** — Accept `RawAudioData`
- `scoreProcessedAudio(original: RawAudioData, processed: RawAudioData, ...)` 
- Replace `buffer.getChannelData(ch)` → `raw.channels[ch]`
- Early return with zero-score result if `processed.length === 0`

**6. `src/workers/dspWorker.ts`** — Remove all AudioBuffer usage
- Delete `reconstructBuffer()` and `extractChannels()`
- `handleRender`: construct `RawAudioData` via `createRawAudioData(msg.channels, msg.sampleRate)`, pass directly to `renderOffline`, return `result.raw.channels`
- `handleAudition`: same pattern; pass `RawAudioData` to `renderOffline`, `validateAndCorrect`, `scoreProcessedAudio`
- Transfer outbound channels via transferables (already done)
- **Post-transfer safety**: after `postMessage` with transferables, null out local references to transferred channels so nothing reads detached buffers

**7. `src/lib/dsp/WorkerRenderer.ts`** — Main-thread bridge updates
- Import `audioBufferToRaw`, `rawToAudioBuffer` from `@/lib/audio/audioBufferUtils`
- `serializeBuffer` now calls `audioBufferToRaw` to **copy** channels before transfer (existing behavior preserved — main thread's AudioBuffer stays intact)
- `deserializeBuffer` uses `rawToAudioBuffer`
- **Worker crash/termination cleanup**: on `terminateDspWorker()`, call `invalidateCache()` for any in-flight render IDs; track active render IDs in a `Set<string>` and clear on termination
- Add `worker.onerror` handler that flushes the active-ID set and calls `invalidateCache` for each

**8. `src/lib/dspEngine.ts`** — Single render path, no File fallback
- Remove `source instanceof File` branch — signature becomes `renderWithOverrides(source: AudioBuffer, ...)`
- All rendering routes through `workerRenderOffline` (already the case)

### Edge cases handled
- **Detached ArrayBuffer after transfer**: `serializeBuffer` copies channels before transfer; worker nulls local refs after `postMessage`
- **Worker crash mid-render**: `WorkerRenderer` tracks in-flight IDs, flushes cache entries on `onerror`/`terminate`
- **Zero-length buffers**: `createRawAudioData` throws on empty channels; `scoreProcessedAudio` early-returns
- **Channel length mismatch**: `createRawAudioData` validates all channels have equal length

### Files NOT changed (confirmed correct as-is)
- `postRenderValidation.ts` — main-thread only, uses `AudioBuffer` from `WorkerRenderer.deserializeBuffer`
- `SafetyRails.ts` — already `Float32Array[]`-based
- `loudness.ts` — already `Float32Array[]`-based  
- `biquad.ts`, `fft.ts`, all plugin files — don't use `AudioBuffer`
- `useAudioEngine.ts` — passes `AudioBuffer` to `WorkerRenderer` which handles conversion; no direct DSP calls

