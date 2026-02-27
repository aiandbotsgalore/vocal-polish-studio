import { useAudioEngine } from "@/hooks/useAudioEngine";
import { FileUploadCard } from "@/components/FileUploadCard";
import { AnalysisReport } from "@/components/AnalysisReport";
import { AudioPlayerPanel } from "@/components/AudioPlayerPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { ModeSelector } from "@/components/ModeSelector";
import { StyleTargetSelector } from "@/components/StyleTargetSelector";
import { AutonomyPanel } from "@/components/AutonomyPanel";
import { FeedbackButtons } from "@/components/FeedbackButtons";
import { RevisionHistory } from "@/components/RevisionHistory";
import { ExportSummary } from "@/components/ExportSummary";
import { Button } from "@/components/ui/button";
import { Activity, Sparkles, Download, AlertTriangle } from "lucide-react";

const Index = () => {
  const {
    status,
    mode, setMode,
    styleTarget, setStyleTarget,
    originalFile,
    originalUrl,
    analysis,
    geminiDecision,
    modelUsed,
    geminiError,
    clampsApplied,
    versions,
    currentVersionId, setCurrentVersionId,
    currentVersion,
    postRenderScores,
    loadFile,
    analyze,
    autoFix,
    sendFeedback,
    exportFile,
  } = useAudioEngine();

  const busy = status === "analyzing" || status === "calling_gemini" || status === "fixing" || status === "validating";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 glow-primary-sm">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-foreground text-glow">Vocal Doctor Lite</h1>
              <p className="text-[11px] text-muted-foreground">Gemini-powered vocal analysis & cleanup</p>
            </div>
          </div>
          <StatusBadge status={status} />
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        {/* Controls row */}
        <div className="flex flex-wrap items-center gap-4">
          <ModeSelector mode={mode} onChange={setMode} disabled={busy} />
          <StyleTargetSelector value={styleTarget} onChange={setStyleTarget} disabled={busy} />
        </div>

        {/* Upload */}
        <FileUploadCard onFileSelected={loadFile} currentFile={originalFile} />

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          <Button onClick={analyze} disabled={!originalFile || busy} className="gap-2">
            <Sparkles className="h-4 w-4" />
            {status === "analyzing" ? "Analyzing…" : status === "calling_gemini" ? "Calling Gemini…" : "Analyze"}
          </Button>
          <Button
            onClick={autoFix}
            disabled={!geminiDecision || busy || status === "gemini_error"}
            variant="secondary"
            className="gap-2"
          >
            <Activity className="h-4 w-4" />
            {status === "fixing" ? "Rendering…" : "Auto Fix"}
          </Button>
          <Button
            onClick={exportFile}
            disabled={!currentVersion}
            variant="outline"
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>

        {/* Gemini Error */}
        {geminiError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">Gemini analysis failed</p>
              <p className="text-xs text-destructive/80 mt-1">{geminiError.details || "No AI decision was generated. Please check your API key, network connection, or model availability and try again."}</p>
            </div>
          </div>
        )}

        {/* Two column layout for report + autonomy panel */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            {/* Analysis Report */}
            {geminiDecision && (
              <AnalysisReport
                analysis={analysis || undefined}
                decision={geminiDecision || undefined}
                clampsApplied={clampsApplied}
                postRenderScore={currentVersionId ? postRenderScores[currentVersionId] : undefined}
              />
            )}

            {/* Players */}
            {(originalUrl || currentVersion) && (
              <div className="space-y-3">
                <AudioPlayerPanel label="Before (Original)" url={originalUrl} />
                {versions.map((v) => (
                  <AudioPlayerPanel
                    key={v.id}
                    label={v.label}
                    url={v.url}
                    accent={v.id === currentVersionId}
                  />
                ))}
              </div>
            )}

            {/* Feedback */}
            {versions.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Feedback</p>
                <FeedbackButtons onFeedback={sendFeedback} disabled={busy} />
              </div>
            )}
          </div>

          {/* Right sidebar */}
          <div className="space-y-4">
            {geminiDecision && modelUsed && (
              <AutonomyPanel
                mode={mode}
                styleTarget={styleTarget}
                decision={geminiDecision}
                modelUsed={modelUsed}
              />
            )}

            {versions.length > 0 && (
              <RevisionHistory
                versions={versions}
                currentId={currentVersionId}
                onSelect={setCurrentVersionId}
              />
            )}

            {currentVersion && geminiDecision && (
              <ExportSummary
                mode={mode}
                styleTarget={styleTarget}
                modelUsed={modelUsed}
                decision={currentVersion.decision}
                clampsApplied={currentVersion.clampsApplied}
                score={currentVersionId ? postRenderScores[currentVersionId] : undefined}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
