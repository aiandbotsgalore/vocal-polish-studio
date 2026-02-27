import { useState, useEffect, useRef, useCallback } from "react";
import { Slider } from "@/components/ui/slider";
import type { GeminiDecision, SliderOverrides } from "@/types/gemini";

interface Props {
  decision: GeminiDecision;
  onOverridesChange: (overrides: SliderOverrides) => void;
  disabled?: boolean;
}

export function LiveSliders({ decision, onOverridesChange, disabled }: Props) {
  const [harshness, setHarshness] = useState(100);
  const [sibilance, setSibilance] = useState(100);
  const [brightness, setBrightness] = useState(0);
  const [output, setOutput] = useState(decision.outputTrimDb || 0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Reset defaults when decision changes
  useEffect(() => {
    setHarshness(100);
    setSibilance(100);
    setBrightness(0);
    setOutput(decision.outputTrimDb || 0);
  }, [decision]);

  const emit = useCallback((h: number, s: number, b: number, o: number) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onOverridesChange({ harshnessPct: h, sibilancePct: s, brightnessDb: b, outputDb: o });
    }, 300);
  }, [onOverridesChange]);

  const sliders: { label: string; value: number; min: number; max: number; step: number; unit: string; set: (v: number) => void }[] = [
    { label: "Harshness Reduction", value: harshness, min: 0, max: 100, step: 1, unit: "%", set: (v) => { setHarshness(v); emit(v, sibilance, brightness, output); } },
    { label: "Sibilance Reduction", value: sibilance, min: 0, max: 100, step: 1, unit: "%", set: (v) => { setSibilance(v); emit(harshness, v, brightness, output); } },
    { label: "Brightness / Air", value: brightness, min: -6, max: 6, step: 0.5, unit: "dB", set: (v) => { setBrightness(v); emit(harshness, sibilance, v, output); } },
    { label: "Output Volume", value: output, min: -12, max: 6, step: 0.5, unit: "dB", set: (v) => { setOutput(v); emit(harshness, sibilance, brightness, v); } },
  ];

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
            disabled={disabled}
          />
        </div>
      ))}
    </div>
  );
}
