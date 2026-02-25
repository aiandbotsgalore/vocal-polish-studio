import type { LayerOneAnalysis, GeminiDecision, PostRenderScore } from "@/types/gemini";
import { AlertTriangle, CheckCircle, Info, Brain, BarChart3, Shield, Sparkles } from "lucide-react";

interface AnalysisReportProps {
  analysis?: LayerOneAnalysis;
  decision?: GeminiDecision;
  clampsApplied?: string[];
  postRenderScore?: PostRenderScore;
  preferredVersion?: string;
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

function Section({ icon: Icon, title, children }: { icon: typeof Info; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
      </div>
      {children}
    </div>
  );
}

export function AnalysisReport({ analysis, decision, clampsApplied, postRenderScore, preferredVersion }: AnalysisReportProps) {
  const severity = decision?.severity || analysis?.harshnessSeverity || "low";
  const SeverityIcon = severity === "high" ? AlertTriangle : severity === "moderate" ? Info : CheckCircle;
  const severityColor = severity === "high" ? "text-destructive" : severity === "moderate" ? "text-accent" : "text-primary";

  return (
    <div className="space-y-5 rounded-lg panel-gradient p-5 studio-border">
      <div className="flex items-center gap-2">
        <SeverityIcon className={`h-5 w-5 ${severityColor}`} />
        <h3 className="text-sm font-semibold text-foreground">Analysis Report</h3>
        <span className={`ml-auto rounded-md px-2 py-0.5 text-xs font-mono font-semibold uppercase ${
          severity === "high" ? "bg-destructive/15 text-destructive" :
          severity === "moderate" ? "bg-accent/15 text-accent" :
          "bg-primary/15 text-primary"
        }`}>{severity}</span>
      </div>

      {/* Measured Findings */}
      {analysis && (
        <Section icon={BarChart3} title="Measured Findings">
          <div className="grid gap-3">
            <ScoreBar label="Harshness" value={analysis.globalHarshness} />
            <ScoreBar label="Sibilance" value={analysis.globalSibilance} />
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            <div className="rounded-md bg-secondary/50 p-2">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Peak</p>
              <p className="font-mono text-sm font-semibold text-foreground">{analysis.peakLevel}<span className="text-[10px] text-muted-foreground"> dB</span></p>
            </div>
            <div className="rounded-md bg-secondary/50 p-2">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">RMS</p>
              <p className="font-mono text-sm font-semibold text-foreground">{analysis.rmsLoudness}<span className="text-[10px] text-muted-foreground"> dB</span></p>
            </div>
            <div className="rounded-md bg-secondary/50 p-2">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Brightness</p>
              <p className="font-mono text-sm font-semibold text-foreground">{analysis.voiceBrightness}<span className="text-[10px] text-muted-foreground">%</span></p>
            </div>
            <div className="rounded-md bg-secondary/50 p-2">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Harsh Center</p>
              <p className="font-mono text-sm font-semibold text-foreground">{analysis.estimatedHarshnessCenterHz}<span className="text-[10px] text-muted-foreground"> Hz</span></p>
            </div>
            <div className="rounded-md bg-secondary/50 p-2">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Burstiness</p>
              <p className="font-mono text-sm font-semibold text-foreground">{analysis.burstinessScore}<span className="text-[10px] text-muted-foreground">/100</span></p>
            </div>
            <div className="rounded-md bg-secondary/50 p-2">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Consistency</p>
              <p className="font-mono text-sm font-semibold text-foreground">{analysis.brightnessConsistency}<span className="text-[10px] text-muted-foreground">%</span></p>
            </div>
          </div>
        </Section>
      )}

      {/* Gemini Interpretation */}
      {decision && (
        <>
          <Section icon={Brain} title="Gemini Interpretation">
            <div className="rounded-md bg-secondary/30 p-3">
              <p className="text-xs leading-relaxed text-secondary-foreground">{decision.reportSummary}</p>
            </div>
          </Section>

          <Section icon={Sparkles} title="Chosen Strategy & Parameters">
            <div className="rounded-md bg-secondary/30 p-3 space-y-2">
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs font-mono text-secondary-foreground">
                <span>Strategy:</span><span>{decision.strategy}</span>
                <span>EQ Bell:</span><span>{decision.eqBellCenterHz}Hz, Q{decision.eqBellQ}, {decision.eqBellCutDb}dB</span>
                {decision.optionalSecondEqBellCenterHz && (
                  <><span>2nd Bell:</span><span>{decision.optionalSecondEqBellCenterHz}Hz, {decision.optionalSecondEqBellCutDb}dB</span></>
                )}
                <span>De-ess:</span><span>{decision.deEssCenterHz}Hz, {decision.deEssReductionDb}dB ({decision.deEssMode})</span>
                {decision.optionalHighShelfCutDb && <><span>Hi Shelf:</span><span>{decision.optionalHighShelfCutDb}dB</span></>}
                {decision.optionalPresenceCompensationDb && <><span>Pres Comp:</span><span>+{decision.optionalPresenceCompensationDb}dB</span></>}
                <span>Output Trim:</span><span>{decision.outputTrimDb}dB</span>
              </div>
            </div>
          </Section>

          <Section icon={Info} title="Reasoning">
            <div className="rounded-md bg-secondary/30 p-3">
              <p className="text-xs leading-relaxed text-secondary-foreground whitespace-pre-line">{decision.reportReasoning}</p>
            </div>
          </Section>
        </>
      )}

      {/* Safety Clamps */}
      {clampsApplied && clampsApplied.length > 0 && (
        <Section icon={Shield} title="Safety Clamps Applied">
          <div className="rounded-md bg-accent/10 border border-accent/20 p-3">
            <ul className="space-y-1">
              {clampsApplied.map((c, i) => (
                <li key={i} className="text-xs text-accent font-mono">⚠ {c}</li>
              ))}
            </ul>
          </div>
        </Section>
      )}

      {/* Post-Render Results */}
      {postRenderScore && (
        <Section icon={BarChart3} title="Post-Render Results">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-secondary/50 p-2">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Overall Score</p>
              <p className="font-mono text-lg font-semibold text-primary">{postRenderScore.overallScore}<span className="text-xs text-muted-foreground">/100</span></p>
            </div>
            <div className="rounded-md bg-secondary/50 p-2">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Artifact Risk</p>
              <p className="font-mono text-sm font-semibold text-foreground capitalize">{postRenderScore.artifactRiskEstimate}</p>
            </div>
            <div className="rounded-md bg-secondary/50 p-2">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Harshness ↓</p>
              <p className="font-mono text-sm font-semibold text-foreground">{postRenderScore.harshnessReduction}%</p>
            </div>
            <div className="rounded-md bg-secondary/50 p-2">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Sibilance ↓</p>
              <p className="font-mono text-sm font-semibold text-foreground">{postRenderScore.sibilanceReduction}%</p>
            </div>
          </div>
          {preferredVersion && (
            <p className="text-xs text-primary mt-2">AI Preferred: <span className="font-semibold">{preferredVersion}</span></p>
          )}
        </Section>
      )}
    </div>
  );
}
