import { useState } from "react";
import type { GeminiDecision, ProcessingMode, StyleTarget, PostRenderScore, LayerOneAnalysis } from "@/types/gemini";
import { STYLE_LABELS } from "@/types/gemini";
import { decisionToSlots } from "@/lib/dsp/decisionToSlots";
import { getStyleProfile } from "@/lib/dsp/StyleProfiles";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Download, FileText, Layers, ArrowRightLeft } from "lucide-react";

interface ExportSummaryProps {
  mode: ProcessingMode;
  styleTarget: StyleTarget;
  modelUsed: string;
  decision: GeminiDecision;
  clampsApplied: string[];
  score?: PostRenderScore;
  analysis?: LayerOneAnalysis | null;
}

/** Human-readable plugin names */
const PLUGIN_NAMES: Record<string, string> = {
  preGain: "Pre-Gain",
  highPass: "High-Pass Filter",
  denoiseLite: "Denoise Lite",
  noiseGate: "Noise Gate",
  dePlosive: "De-Plosive",
  resonanceSuppressor: "Resonance Suppressor",
  dynamicEQ: "Dynamic EQ",
  deEsser: "De-Esser",
  compressor: "Compressor",
  limiter: "Limiter",
  presenceShaper: "Presence Shaper",
  harmonicEnhancer: "Harmonic Enhancer",
  gainRider: "Gain Rider",
  outputStage: "Output Stage",
};

function MetricRow({ label, before, after, unit = "" }: { label: string; before: string | number; after: string | number; unit?: string }) {
  const bVal = typeof before === "number" ? before : parseFloat(before);
  const aVal = typeof after === "number" ? after : parseFloat(after);
  const delta = isNaN(bVal) || isNaN(aVal) ? null : aVal - bVal;
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center text-xs font-mono">
      <span className="text-muted-foreground truncate">{label}</span>
      <span className="text-secondary-foreground text-right w-16">{before}{unit}</span>
      <span className="text-muted-foreground text-center w-6">→</span>
      <span className="text-foreground font-semibold text-right w-16">
        {after}{unit}
        {delta !== null && (
          <span className={`ml-1 text-[10px] ${delta < 0 ? "text-primary" : delta > 0 ? "text-accent" : "text-muted-foreground"}`}>
            ({delta > 0 ? "+" : ""}{delta.toFixed(1)})
          </span>
        )}
      </span>
    </div>
  );
}

function buildReport(props: ExportSummaryProps) {
  const { mode, styleTarget, modelUsed, decision, clampsApplied, score, analysis } = props;
  const profile = getStyleProfile(styleTarget);
  const slots = decisionToSlots(decision, profile.targetLufs);

  return {
    exportedAt: new Date().toISOString(),
    mode,
    styleTarget,
    styleLabel: STYLE_LABELS[styleTarget],
    modelUsed,
    targetLufs: profile.targetLufs,
    decision: {
      strategy: decision.strategy,
      processingOrder: decision.processingOrder,
      passCount: decision.passCount,
      eqBell: { centerHz: decision.eqBellCenterHz, Q: decision.eqBellQ, cutDb: decision.eqBellCutDb },
      deEss: { mode: decision.deEssMode, centerHz: decision.deEssCenterHz, reductionDb: decision.deEssReductionDb },
      outputTrimDb: decision.outputTrimDb,
      ...(decision.optionalSecondEqBellCenterHz && {
        secondEqBell: { centerHz: decision.optionalSecondEqBellCenterHz, Q: decision.optionalSecondEqBellQ, cutDb: decision.optionalSecondEqBellCutDb },
      }),
      ...(decision.optionalHighShelfCutDb && { highShelfCutDb: decision.optionalHighShelfCutDb }),
      ...(decision.optionalPresenceCompensationDb && { presenceCompensationDb: decision.optionalPresenceCompensationDb }),
    },
    chain: slots.map(s => ({ plugin: s.id, bypass: s.bypass, params: s.params })),
    clampsApplied,
    ...(analysis && {
      beforeMetrics: {
        peakLevel: analysis.peakLevel,
        rmsLoudness: analysis.rmsLoudness,
        globalHarshness: analysis.globalHarshness,
        globalSibilance: analysis.globalSibilance,
        voiceBrightness: analysis.voiceBrightness,
        durationSeconds: analysis.durationSeconds,
      },
    }),
    ...(score && {
      afterMetrics: {
        overallScore: score.overallScore,
        harshnessReduction: score.harshnessReduction,
        sibilanceReduction: score.sibilanceReduction,
        brightnessPreservation: score.brightnessPreservation,
        artifactRisk: score.artifactRiskEstimate,
        targetedBandDeltaDb: score.targetedBandDeltaDb,
      },
    }),
  };
}

export function ExportSummary({ mode, styleTarget, modelUsed, decision, clampsApplied, score, analysis }: ExportSummaryProps) {
  const [chainOpen, setChainOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);

  const profile = getStyleProfile(styleTarget);
  const slots = decisionToSlots(decision, profile.targetLufs);
  const activePlugins = slots.filter(s => !s.bypass);

  const downloadReport = () => {
    const report = buildReport({ mode, styleTarget, modelUsed, decision, clampsApplied, score, analysis });
    const json = JSON.stringify(report, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vocal-doctor-report-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-lg bg-secondary/30 p-4 space-y-3 text-xs font-mono text-secondary-foreground studio-border">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-sans font-semibold">Export Summary</p>
        <Button variant="ghost" size="sm" className="h-6 px-2 gap-1 text-[10px]" onClick={downloadReport}>
          <FileText className="h-3 w-3" />
          Report
        </Button>
      </div>

      {/* Quick overview */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span className="text-muted-foreground">Mode:</span><span>{mode === "safe" ? "Safe" : "Unleashed"}</span>
        <span className="text-muted-foreground">Style:</span><span>{STYLE_LABELS[styleTarget]}</span>
        <span className="text-muted-foreground">Model:</span><span>{modelUsed.replace("google/", "")}</span>
        <span className="text-muted-foreground">Target:</span><span>{profile.targetLufs} LUFS</span>
        <span className="text-muted-foreground">Strategy:</span><span>{decision.strategy}</span>
        <span className="text-muted-foreground">Plugins:</span><span>{activePlugins.length}/{slots.length} active</span>
      </div>

      {/* Processing chain */}
      <Collapsible open={chainOpen} onOpenChange={setChainOpen}>
        <CollapsibleTrigger className="flex items-center gap-1.5 w-full text-left group">
          {chainOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          <Layers className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] font-sans font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-foreground transition-colors">
            Processing Chain
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-1">
          {slots.map((slot, i) => (
            <div
              key={slot.id}
              className={`flex items-center gap-2 rounded px-2 py-1 ${
                slot.bypass ? "opacity-40" : "bg-card/50"
              }`}
            >
              <span className="text-[9px] text-muted-foreground w-4 text-right">{i + 1}</span>
              <span className={`text-[10px] ${slot.bypass ? "line-through text-muted-foreground" : "text-foreground font-semibold"}`}>
                {PLUGIN_NAMES[slot.id] || slot.id}
              </span>
              {!slot.bypass && slot.id === "dynamicEQ" && (
                <span className="text-[9px] text-muted-foreground ml-auto">
                  {(slot.params as any).bands?.length || 0} bands
                </span>
              )}
              {!slot.bypass && slot.id === "deEsser" && (
                <span className="text-[9px] text-muted-foreground ml-auto">
                  {(slot.params as any).frequencyHz}Hz {(slot.params as any).maxReductionDb}dB
                </span>
              )}
              {!slot.bypass && slot.id === "outputStage" && (
                <span className="text-[9px] text-muted-foreground ml-auto">
                  {(slot.params as any).targetLufsDb}LUFS
                </span>
              )}
              {!slot.bypass && slot.id === "compressor" && (
                <span className="text-[9px] text-muted-foreground ml-auto">
                  {(slot.params as any).ratio}:1
                </span>
              )}
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>

      {/* Before/After metrics */}
      {analysis && score && (
        <Collapsible open={metricsOpen} onOpenChange={setMetricsOpen}>
          <CollapsibleTrigger className="flex items-center gap-1.5 w-full text-left group">
            {metricsOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
            <ArrowRightLeft className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] font-sans font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-foreground transition-colors">
              Before / After
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1.5">
            <MetricRow label="Harshness" before={analysis.globalHarshness} after={Math.round(analysis.globalHarshness * (1 - score.harshnessReduction / 100))} unit="/100" />
            <MetricRow label="Sibilance" before={analysis.globalSibilance} after={Math.round(analysis.globalSibilance * (1 - score.sibilanceReduction / 100))} unit="/100" />
            <MetricRow label="Brightness" before={`${analysis.voiceBrightness}%`} after={`${score.brightnessPreservation}%`} />
            <div className="pt-1 border-t border-border/50">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Overall Score</span>
                <span className={`text-sm font-bold ${score.overallScore >= 70 ? "text-primary" : "text-accent"}`}>
                  {score.overallScore}/100
                </span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Clamps */}
      {clampsApplied.length > 0 && (
        <div className="pt-1 border-t border-border/50">
          <span className="text-accent text-[10px]">⚠ {clampsApplied.length} safety clamp{clampsApplied.length > 1 ? "s" : ""} applied</span>
        </div>
      )}
    </div>
  );
}
