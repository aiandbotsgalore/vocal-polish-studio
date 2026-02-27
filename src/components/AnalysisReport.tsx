import { useState } from "react";
import type { LayerOneAnalysis, GeminiDecision, PostRenderScore, GeminiError } from "@/types/gemini";
import { AlertTriangle, CheckCircle, Info, Brain, BarChart3, Shield, Sparkles, Activity, ChevronDown, ChevronRight, Headphones, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface AnalysisReportProps {
  analysis?: LayerOneAnalysis;
  decision?: GeminiDecision;
  clampsApplied?: string[];
  postRenderScore?: PostRenderScore;
  preferredVersion?: string;
  geminiError?: GeminiError | null;
  modelUsed?: string;
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

interface HeatmapBand {
  label: string;
  rangeLabel: string;
  score: number | null;
  logWidth: number;
}

function getHeatmapBands(analysis: LayerOneAnalysis): HeatmapBand[] {
  return [
    { label: "Mud", rangeLabel: "200–500 Hz", score: null, logWidth: 1.32 },
    { label: "Box", rangeLabel: "500–1k Hz", score: null, logWidth: 0.30 },
    { label: "Nasal", rangeLabel: "800–1.5k Hz", score: null, logWidth: 0.27 },
    { label: "Harsh", rangeLabel: "2–5 kHz", score: analysis.globalHarshness, logWidth: 0.40 },
    { label: "Sibilance", rangeLabel: "5–10 kHz", score: analysis.globalSibilance, logWidth: 0.30 },
  ];
}

function bandColor(score: number | null): string {
  if (score === null) return "bg-muted";
  if (score > 60) return "bg-destructive";
  if (score >= 35) return "bg-accent";
  return "bg-primary";
}

function bandTextColor(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score > 60) return "text-destructive";
  if (score >= 35) return "text-accent";
  return "text-primary";
}

function IssueHeatmap({ analysis }: { analysis: LayerOneAnalysis }) {
  const bands = getHeatmapBands(analysis);
  const totalWidth = bands.reduce((s, b) => s + b.logWidth, 0);

  return (
    <div className="space-y-2">
      <div className="flex h-5 w-full overflow-hidden rounded-md">
        {bands.map((band) => (
          <div
            key={band.label}
            className={`${bandColor(band.score)} transition-colors duration-500 relative group`}
            style={{ flex: band.logWidth / totalWidth }}
            title={`${band.label} (${band.rangeLabel}): ${band.score !== null ? `${band.score}/100` : "N/A"}`}
          >
            <span className="absolute inset-0 flex items-center justify-center text-[8px] font-semibold uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity text-primary-foreground select-none">
              {band.label}
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[8px] font-mono text-muted-foreground px-0.5">
        <span>200</span><span>500</span><span>1k</span><span>2k</span><span>5k</span><span>10k</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {bands.map((band) => (
          <div key={band.label} className="flex items-center gap-1">
            <div className={`h-2 w-2 rounded-full ${bandColor(band.score)}`} />
            <span className={`text-[9px] font-mono ${bandTextColor(band.score)}`}>
              {band.label} {band.score !== null ? band.score : "N/A"}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 text-[8px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-primary inline-block" /> Low</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-accent inline-block" /> Moderate</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-destructive inline-block" /> High</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-muted inline-block" /> N/A</span>
      </div>
    </div>
  );
}

export function AnalysisReport({ analysis, decision, clampsApplied, postRenderScore, preferredVersion, geminiError, modelUsed }: AnalysisReportProps) {
  const [rawMetricsOpen, setRawMetricsOpen] = useState(false);
  const severity = decision?.severity || analysis?.harshnessSeverity || "low";
  const SeverityIcon = severity === "high" ? AlertTriangle : severity === "moderate" ? Info : CheckCircle;
  const severityColor = severity === "high" ? "text-destructive" : severity === "moderate" ? "text-accent" : "text-primary";

  return (
    <div className="space-y-5 rounded-lg panel-gradient p-5 studio-border">
      {/* Header */}
      <div className="flex items-center gap-2">
        <SeverityIcon className={`h-5 w-5 ${severityColor}`} />
        <h3 className="text-sm font-semibold text-foreground">Analysis Report</h3>
        <span className={`ml-auto rounded-md px-2 py-0.5 text-xs font-mono font-semibold uppercase ${
          severity === "high" ? "bg-destructive/15 text-destructive" :
          severity === "moderate" ? "bg-accent/15 text-accent" :
          "bg-primary/15 text-primary"
        }`}>{severity}</span>
      </div>

      {/* Audio analysis source indicator */}
      {decision && (
        <div className="flex items-center gap-2">
          {decision.audioReceived ? (
            <Badge variant="default" className="gap-1 bg-primary/15 text-primary border-primary/30">
              <Headphones className="h-3 w-3" />
              Gemini Listening + Metrics
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="h-3 w-3" />
              Metrics Only (Audio Not Received)
            </Badge>
          )}
          {modelUsed && (
            <span className="text-[10px] font-mono text-muted-foreground">Model: {modelUsed}</span>
          )}
        </div>
      )}

      {/* Gemini Error Display */}
      {geminiError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="text-xs font-semibold text-destructive">Gemini Analysis Failed</span>
          </div>
          {geminiError.model && (
            <p className="text-[10px] font-mono text-muted-foreground">Model attempted: {geminiError.model}</p>
          )}
          <p className="text-xs text-destructive/80">{geminiError.details || geminiError.error}</p>
          <p className="text-[10px] text-muted-foreground">Suggestions: Check your API key configuration, trim audio to under 5 minutes, or retry.</p>
        </div>
      )}

      {/* Gemini Unified Analysis — Primary section */}
      {decision?.unifiedReport && (
        <Section icon={Brain} title="Gemini Analysis">
          <div className="rounded-md bg-secondary/30 p-3">
            <p className="text-xs leading-relaxed text-secondary-foreground whitespace-pre-line">{decision.unifiedReport}</p>
          </div>
        </Section>
      )}

      {/* Raw Measured Metrics — Collapsible */}
      {analysis && (
        <Collapsible open={rawMetricsOpen} onOpenChange={setRawMetricsOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 w-full text-left group">
            {rawMetricsOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-foreground transition-colors">
              Show Raw Metrics
            </h4>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-4">
            <div className="grid gap-3">
              <ScoreBar label="Harshness" value={analysis.globalHarshness} />
              <ScoreBar label="Sibilance" value={analysis.globalSibilance} />
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Issue Heatmap</h4>
              </div>
              <IssueHeatmap analysis={analysis} />
            </div>

            <div className="grid grid-cols-3 gap-2">
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
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Strategy & Parameters */}
      {decision && (
        <Section icon={Sparkles} title="Chosen Strategy & Parameters">
          <div className="rounded-md bg-secondary/30 p-3 space-y-2">
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs font-mono text-secondary-foreground">
              <span>Strategy:</span><span>{decision.strategy}</span>
              <span>Order:</span><span>{decision.processingOrder}</span>
              <span>EQ Bell:</span><span>{decision.eqBellCenterHz}Hz, Q{decision.eqBellQ}, {decision.eqBellCutDb}dB</span>
              {decision.optionalSecondEqBellCenterHz ? (
                <><span>2nd Bell:</span><span>{decision.optionalSecondEqBellCenterHz}Hz, {decision.optionalSecondEqBellCutDb}dB</span></>
              ) : null}
              <span>De-ess:</span><span>{decision.deEssCenterHz}Hz, {decision.deEssReductionDb}dB ({decision.deEssMode})</span>
              {decision.optionalHighShelfCutDb ? <><span>Hi Shelf:</span><span>{decision.optionalHighShelfCutDb}dB</span></> : null}
              {decision.optionalPresenceCompensationDb ? <><span>Pres Comp:</span><span>+{decision.optionalPresenceCompensationDb}dB</span></> : null}
              <span>Output Trim:</span><span>{decision.outputTrimDb}dB</span>
            </div>
          </div>
        </Section>
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
          {/* Band energy delta warning */}
          {postRenderScore.targetedBandDeltaDb !== undefined && Math.abs(postRenderScore.targetedBandDeltaDb) < 0.2 && (
            <div className="mt-2 rounded-md border border-accent/30 bg-accent/5 p-2 flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 text-accent mt-0.5 shrink-0" />
              <p className="text-[10px] text-accent">Processing produced negligible audible change. DSP may not have applied.</p>
            </div>
          )}
          {postRenderScore.targetedBandDeltaDb !== undefined && Math.abs(postRenderScore.targetedBandDeltaDb) >= 0.2 && (
            <div className="mt-2 rounded-md bg-secondary/50 p-2">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Band Delta</p>
              <p className="font-mono text-sm font-semibold text-foreground">{postRenderScore.targetedBandDeltaDb}<span className="text-[10px] text-muted-foreground"> dB</span></p>
            </div>
          )}
          {preferredVersion && (
            <p className="text-xs text-primary mt-2">AI Preferred: <span className="font-semibold">{preferredVersion}</span></p>
          )}
        </Section>
      )}
    </div>
  );
}
