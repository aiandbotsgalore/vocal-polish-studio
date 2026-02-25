import type { AnalysisResults } from "@/hooks/useAudioEngine";
import { AlertTriangle, CheckCircle, Info } from "lucide-react";

interface AnalysisReportProps {
  results: AnalysisResults;
}

function ScoreBar({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  const pct = (value / max) * 100;
  const color = pct > 60 ? "bg-destructive" : pct > 35 ? "bg-accent" : "bg-primary";

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-semibold text-foreground">{value}<span className="text-muted-foreground">/{max}</span></span>
      </div>
      <div className="h-2 w-full rounded-full bg-secondary">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function AnalysisReport({ results }: AnalysisReportProps) {
  const SeverityIcon = results.severity === "high" ? AlertTriangle : results.severity === "moderate" ? Info : CheckCircle;
  const severityColor = results.severity === "high" ? "text-destructive" : results.severity === "moderate" ? "text-accent" : "text-primary";

  return (
    <div className="space-y-5 rounded-lg panel-gradient p-5 studio-border">
      <div className="flex items-center gap-2">
        <SeverityIcon className={`h-5 w-5 ${severityColor}`} />
        <h3 className="text-sm font-semibold text-foreground">Analysis Report</h3>
        <span className={`ml-auto rounded-md px-2 py-0.5 text-xs font-mono font-semibold uppercase ${
          results.severity === "high" ? "bg-destructive/15 text-destructive" :
          results.severity === "moderate" ? "bg-accent/15 text-accent" :
          "bg-primary/15 text-primary"
        }`}>
          {results.severity}
        </span>
      </div>

      <div className="grid gap-3">
        <ScoreBar label="Harshness" value={results.harshnessScore} />
        <ScoreBar label="Sibilance" value={results.sibilanceScore} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md bg-secondary/50 p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Center Freq</p>
          <p className="font-mono text-lg font-semibold text-foreground">{results.harshnessBandCenter.toFixed(0)}<span className="text-xs text-muted-foreground"> Hz</span></p>
        </div>
        <div className="rounded-md bg-secondary/50 p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Fix Strength</p>
          <p className="font-mono text-lg font-semibold text-foreground capitalize">{results.fixStrength}</p>
        </div>
      </div>

      <div className="rounded-md bg-secondary/30 p-3">
        <p className="text-xs leading-relaxed text-secondary-foreground whitespace-pre-line">{results.reportText}</p>
      </div>

      <div className="rounded-md bg-secondary/30 p-3 space-y-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Processing Parameters</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs font-mono text-secondary-foreground">
          <span>EQ Freq:</span><span>{results.fixParams.harshEqFreq.toFixed(0)} Hz</span>
          <span>EQ Cut:</span><span>{results.fixParams.harshEqGain.toFixed(1)} dB</span>
          <span>De-ess Freq:</span><span>{results.fixParams.deEsserFreq.toFixed(0)} Hz</span>
          <span>De-ess Cut:</span><span>{results.fixParams.deEsserGain.toFixed(1)} dB</span>
        </div>
      </div>
    </div>
  );
}
