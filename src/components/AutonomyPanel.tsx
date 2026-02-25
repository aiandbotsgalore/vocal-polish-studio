import type { GeminiDecision, ProcessingMode, StyleTarget } from "@/types/gemini";
import { STYLE_LABELS } from "@/types/gemini";
import { Bot } from "lucide-react";

interface AutonomyPanelProps {
  mode: ProcessingMode;
  styleTarget: StyleTarget;
  decision: GeminiDecision;
  modelUsed: string;
  preferredVersion?: string;
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

export function AutonomyPanel({ mode, styleTarget, decision, modelUsed, preferredVersion }: AutonomyPanelProps) {
  return (
    <div className="rounded-lg panel-gradient p-4 studio-border space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <Bot className="h-4 w-4 text-primary" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">AI Autonomy</h3>
      </div>
      <Row label="Mode" value={mode === "safe" ? "Safe" : "Unleashed"} />
      <Row label="Style" value={STYLE_LABELS[styleTarget]} />
      <Row label="Model" value={modelUsed.replace("google/", "")} />
      <Row label="Confidence" value={`${decision.confidence}%`} />
      <Row label="Strategy" value={decision.strategy} />
      <Row label="Passes" value={decision.passCount} />
      <Row label="Tradeoff" value={decision.tradeoffPriority} />
      {preferredVersion && <Row label="Preferred" value={preferredVersion} />}
    </div>
  );
}
