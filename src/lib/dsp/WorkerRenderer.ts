/**
 * WorkerRenderer — main-thread bridge to the DSP Web Worker.
 * Handles AudioBuffer ↔ Float32Array serialization, progress,
 * and cancellation. All heavy DSP runs off the main thread.
 */

import type { ChainSlot, StyleProfile } from "./types";
import type { ScoringResult } from "./ScoringEngine";
import type { SafetyReport } from "./SafetyRails";
import type {
  WorkerRequest,
  WorkerResponse,
  AuditionResponse,
  RenderResponse,
  SerializedVariant,
} from "@/workers/dspWorker";

// ── Public result types ──────────────────────────────────────

export interface WorkerVariantResult {
  label: string;
  slots: ChainSlot[];
  buffer: AudioBuffer;
  score: ScoringResult;
  safety: SafetyReport;
  isSafeBaseline: boolean;
}

export interface WorkerAuditionResult {
  variants: WorkerVariantResult[];
  recommendedIndex: number;
}

// ── Singleton worker ─────────────────────────────────────────

let worker: Worker | null = null;
let requestId = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("@/workers/dspWorker.ts", import.meta.url), {
      type: "module",
    });
  }
  return worker;
}

/** Generate a unique request ID */
function nextId(): string {
  return `req_${++requestId}_${Date.now()}`;
}

// ── Helpers ──────────────────────────────────────────────────

function serializeBuffer(buf: AudioBuffer): { channels: Float32Array[]; sampleRate: number } {
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch);
    const copy = new Float32Array(src.length);
    copy.set(src);
    channels.push(copy);
  }
  return { channels, sampleRate: buf.sampleRate };
}

function deserializeBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  const buf = new AudioBuffer({
    numberOfChannels: channels.length,
    length,
    sampleRate,
  });
  for (let ch = 0; ch < channels.length; ch++) {
    buf.copyToChannel(channels[ch] as Float32Array<ArrayBuffer>, ch);
  }
  return buf;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Run auditionVariants in the Web Worker.
 * Returns the same shape as the original auditionVariants but without blocking the main thread.
 */
export function workerAuditionVariants(
  sourceBuffer: AudioBuffer,
  variantSlots: ChainSlot[][],
  targetLufs: number,
  styleProfile?: StyleProfile,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<WorkerAuditionResult> {
  const w = getWorker();
  const id = nextId();
  const { channels, sampleRate } = serializeBuffer(sourceBuffer);

  return new Promise<WorkerAuditionResult>((resolve, reject) => {
    // Handle abort
    const onAbort = () => {
      w.postMessage({ type: "cancel", id } as WorkerRequest);
      cleanup();
      reject(new DOMException("Render cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    function cleanup() {
      signal?.removeEventListener("abort", onAbort);
      w.removeEventListener("message", handler);
    }

    function handler(e: MessageEvent<WorkerResponse>) {
      const msg = e.data;
      if (msg.id !== id) return;

      if (msg.type === "progress") {
        onProgress?.(msg.pct);
        return;
      }

      if (msg.type === "auditionResult") {
        cleanup();
        const result = msg as AuditionResponse;
        const variants: WorkerVariantResult[] = result.variants.map((v) => ({
          label: v.label,
          slots: v.slots,
          buffer: deserializeBuffer(v.channels, v.sampleRate),
          score: v.score,
          safety: v.safety,
          isSafeBaseline: v.isSafeBaseline,
        }));
        resolve({ variants, recommendedIndex: result.recommendedIndex });
        return;
      }

      if (msg.type === "error") {
        cleanup();
        reject(new Error(msg.message));
        return;
      }
    }

    w.addEventListener("message", handler);

    const request: WorkerRequest = {
      type: "audition",
      id,
      channels,
      sampleRate,
      variantSlots,
      targetLufs,
      styleProfile,
    };

    const transferables = channels.map((ch) => ch.buffer);
    w.postMessage(request, transferables);
  });
}

/**
 * Run a single renderOffline in the Web Worker.
 * Used for slider override re-renders.
 */
export function workerRenderOffline(
  sourceBuffer: AudioBuffer,
  slots: ChainSlot[],
  signal?: AbortSignal,
): Promise<AudioBuffer> {
  const w = getWorker();
  const id = nextId();
  const { channels, sampleRate } = serializeBuffer(sourceBuffer);

  return new Promise<AudioBuffer>((resolve, reject) => {
    const onAbort = () => {
      w.postMessage({ type: "cancel", id } as WorkerRequest);
      cleanup();
      reject(new DOMException("Render cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    function cleanup() {
      signal?.removeEventListener("abort", onAbort);
      w.removeEventListener("message", handler);
    }

    function handler(e: MessageEvent<WorkerResponse>) {
      const msg = e.data;
      if (msg.id !== id) return;

      if (msg.type === "renderResult") {
        cleanup();
        const result = msg as RenderResponse;
        resolve(deserializeBuffer(result.channels, result.sampleRate));
        return;
      }

      if (msg.type === "error") {
        cleanup();
        reject(new Error(msg.message));
        return;
      }
    }

    w.addEventListener("message", handler);

    const request: WorkerRequest = {
      type: "render",
      id,
      channels,
      sampleRate,
      slots,
    };

    const transferables = channels.map((ch) => ch.buffer);
    w.postMessage(request, transferables);
  });
}

/**
 * Terminate the worker (cleanup on unmount).
 */
export function terminateDspWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}
