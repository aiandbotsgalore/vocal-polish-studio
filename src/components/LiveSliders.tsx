import { useState, useEffect, useRef, useCallback } from "react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Undo2, Redo2 } from "lucide-react";
import type { GeminiDecision, SliderOverrides } from "@/types/gemini";

interface Props {
  decision: GeminiDecision;
  onOverridesChange: (overrides: SliderOverrides) => void;
  disabled?: boolean;
}

interface SliderState {
  harshness: number;
  sibilance: number;
  brightness: number;
  output: number;
}

const MAX_HISTORY = 20;

/**
 * LiveSliders — commit-on-release with undo/redo history.
 */
export function LiveSliders({ decision, onOverridesChange, disabled }: Props) {
  const [state, setState] = useState<SliderState>({
    harshness: 100, sibilance: 100, brightness: 0, output: decision.outputTrimDb || 0,
  });
  const [history, setHistory] = useState<SliderState[]>([]);
  const [future, setFuture] = useState<SliderState[]>([]);
  const inflightRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const initial: SliderState = { harshness: 100, sibilance: 100, brightness: 0, output: decision.outputTrimDb || 0 };
    setState(initial);
    setHistory([]);
    setFuture([]);
  }, [decision]);

  const commit = useCallback((newState: SliderState) => {
    if (inflightRef.current) inflightRef.current.abort();
    inflightRef.current = new AbortController();
    onOverridesChange({
      harshnessPct: newState.harshness,
      sibilancePct: newState.sibilance,
      brightnessDb: newState.brightness,
      outputDb: newState.output,
    });
  }, [onOverridesChange]);

  const commitWithHistory = useCallback((newState: SliderState) => {
    setState((prev) => {
      setHistory((h) => [...h.slice(-MAX_HISTORY + 1), prev]);
      setFuture([]);
      return newState;
    });
    commit(newState);
  }, [commit]);

  const valsRef = useRef(state);
  valsRef.current = state;

  const handleCommit = useCallback(() => {
    commitWithHistory({ ...valsRef.current });
  }, [commitWithHistory]);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      const rest = h.slice(0, -1);
      setFuture((f) => [...f, valsRef.current]);
      setState(prev);
      commit(prev);
      return rest;
    });
  }, [commit]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[f.length - 1];
      const rest = f.slice(0, -1);
      setHistory((h) => [...h, valsRef.current]);
      setState(next);
      commit(next);
      return rest;
    });
  }, [commit]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  const sliders: { label: string; key: keyof SliderState; min: number; max: number; step: number; unit: string }[] = [
    { label: "Harshness Reduction", key: "harshness", min: 0, max: 100, step: 1, unit: "%" },
    { label: "Sibilance Reduction", key: "sibilance", min: 0, max: 100, step: 1, unit: "%" },
    { label: "Brightness / Air", key: "brightness", min: -6, max: 6, step: 0.5, unit: "dB" },
    { label: "Output Volume", key: "output", min: -12, max: 6, step: 0.5, unit: "dB" },
  ];

  return (
    <div className="rounded-lg studio-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live Adjustments</p>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={undo}
            disabled={disabled || history.length === 0}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={redo}
            disabled={disabled || future.length === 0}
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {sliders.map((s) => (
        <div key={s.key} className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{s.label}</span>
            <span className="text-xs font-mono text-foreground">{state[s.key]}{s.unit}</span>
          </div>
          <Slider
            min={s.min}
            max={s.max}
            step={s.step}
            value={[state[s.key]]}
            onValueChange={([v]) => setState((prev) => ({ ...prev, [s.key]: v }))}
            onValueCommit={() => handleCommit()}
            disabled={disabled}
          />
        </div>
      ))}
    </div>
  );
}
