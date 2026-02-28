import { useState, useEffect, useRef, useCallback } from "react";
import { Slider } from "@/components/ui/slider";
import type { GeminiDecision, SliderOverrides } from "@/types/gemini";

interface Props {
  decision: GeminiDecision;
  onOverridesChange: (overrides: SliderOverrides) => void;
  disabled?: boolean;
}

/**
 * LiveSliders — commit-on-release to avoid triggering renders on every drag tick.
 * Visual state updates instantly; render fires only on pointer-up via onValueCommit.
 */
export function LiveSliders({ decision, onOverridesChange, disabled }: Props) {
  const [harshness, setHarshness] = useState(100);
  const [sibilance, setSibilance] = useState(100);
  const [brightness, setBrightness] = useState(0);
  const [output, setOutput] = useState(decision.outputTrimDb || 0);
  const inflightRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setHarshness(100);
    setSibilance(100);
    setBrightness(0);
    setOutput(decision.outputTrimDb || 0);
  }, [decision]);

  const commit = useCallback((h: number, s: number, b: number, o: number) => {
    // Cancel any stale in-flight render
    if (inflightRef.current) inflightRef.current.abort();
    inflightRef.current = new AbortController();
    onOverridesChange({ harshnessPct: h, sibilancePct: s, brightnessDb: b, outputDb: o });
  }, [onOverridesChange]);

  const sliders: { label: string; value: number; min: number; max: number; step: number; unit: string; set: (v: number) => void; commitVal: () => void }[] = [
    {
      label: "Harshness Reduction", value: harshness, min: 0, max: 100, step: 1, unit: "%",
      set: (v) => setHarshness(v),
      commitVal: () => commit(harshness, sibilance, brightness, output),
    },
    {
      label: "Sibilance Reduction", value: sibilance, min: 0, max: 100, step: 1, unit: "%",
      set: (v) => setSibilance(v),
      commitVal: () => commit(harshness, sibilance, brightness, output),
    },
    {
      label: "Brightness / Air", value: brightness, min: -6, max: 6, step: 0.5, unit: "dB",
      set: (v) => setBrightness(v),
      commitVal: () => commit(harshness, sibilance, brightness, output),
    },
    {
      label: "Output Volume", value: output, min: -12, max: 6, step: 0.5, unit: "dB",
      set: (v) => setOutput(v),
      commitVal: () => commit(harshness, sibilance, brightness, output),
    },
  ];

  // We need the latest values in commitVal, so use refs
  const valsRef = useRef({ harshness, sibilance, brightness, output });
  valsRef.current = { harshness, sibilance, brightness, output };

  const commitLatest = useCallback(() => {
    const { harshness: h, sibilance: s, brightness: b, output: o } = valsRef.current;
    commit(h, s, b, o);
  }, [commit]);

  return (
    <div className="rounded-lg studio-border bg-card p-4 space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live Adjustments</p>
      {sliders.map((s) => (
        <div key={s.label} className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{s.label}</span>
            <span className="text-xs font-mono text-foreground">{s.value}{s.unit}</span>
          </div>
          <Slider
            min={s.min}
            max={s.max}
            step={s.step}
            value={[s.value]}
            onValueChange={([v]) => s.set(v)}
            onValueCommit={() => commitLatest()}
            disabled={disabled}
          />
        </div>
      ))}
    </div>
  );
}
