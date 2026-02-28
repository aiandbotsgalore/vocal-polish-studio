/**
 * Performance instrumentation for DSP pipeline stages.
 */

const timings: Record<string, number[]> = {};

export function startTimer(label: string): () => number {
  const start = performance.now();
  return () => {
    const elapsed = performance.now() - start;
    if (!timings[label]) timings[label] = [];
    timings[label].push(elapsed);
    console.debug(`[perf] ${label}: ${elapsed.toFixed(1)}ms`);
    return elapsed;
  };
}

export function getTimings(): Record<string, { avg: number; max: number; count: number }> {
  const result: Record<string, { avg: number; max: number; count: number }> = {};
  for (const [label, times] of Object.entries(timings)) {
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const max = Math.max(...times);
    result[label] = { avg: Math.round(avg), max: Math.round(max), count: times.length };
  }
  return result;
}

export function clearTimings(): void {
  for (const key of Object.keys(timings)) delete timings[key];
}
