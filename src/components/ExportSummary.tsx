import type { GeminiDecision, ProcessingMode, StyleTarget, PostRenderScore } from "@/types/gemini";
import { STYLE_LABELS } from "@/types/gemini";

interface ExportSummaryProps {
  mode: ProcessingMode;
  styleTarget: StyleTarget;
  modelUsed: string;
  decision: GeminiDecision;
  clampsApplied: string[];
  score?: PostRenderScore;
}

export function ExportSummary({ mode, styleTarget, modelUsed, decision, clampsApplied, score }: ExportSummaryProps) {
  return (
    <div className="rounded-lg bg-secondary/30 p-3 space-y-2 text-xs font-mono text-secondary-foreground">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-sans font-semibold">Export Summary</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span>Mode:</span><span>{mode === "safe" ? "Safe" : "Unleashed"}</span>
        <span>Style:</span><span>{STYLE_LABELS[styleTarget]}</span>
        <span>Model:</span><span>{modelUsed.replace("google/", "")}</span>
        <span>Strategy:</span><span>{decision.strategy}</span>
        <span>EQ Bell:</span><span>{decision.eqBellCenterHz}Hz @ {decision.eqBellCutDb}dB</span>
        <span>De-ess:</span><span>{decision.deEssCenterHz}Hz @ {decision.deEssReductionDb}dB</span>
        {decision.outputTrimDb !== 0 && <><span>Trim:</span><span>{decision.outputTrimDb}dB</span></>}
      </div>
      {clampsApplied.length > 0 && (
        <div>
          <span className="text-accent">Clamps: </span>
          {clampsApplied.join("; ")}
        </div>
      )}
      {score && (
        <div>
          <span className="text-primary">Score: </span>{score.overallScore}/100
          {" | "}Harshness ↓{score.harshnessReduction}%
          {" | "}Sibilance ↓{score.sibilanceReduction}%
        </div>
      )}
    </div>
  );
}
