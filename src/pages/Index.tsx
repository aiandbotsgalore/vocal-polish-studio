import { lazy, Suspense } from "react";
import { useAudioEngine } from "@/hooks/useAudioEngine";
import { FileUploadCard } from "@/components/FileUploadCard";
import { AnalysisReport } from "@/components/AnalysisReport";
import { ABTogglePlayer } from "@/components/ABTogglePlayer";
import { LiveSliders } from "@/components/LiveSliders";
import { StatusBadge } from "@/components/StatusBadge";
import { ModeSelector } from "@/components/ModeSelector";
import { StyleTargetSelector } from "@/components/StyleTargetSelector";
import { AutonomyPanel } from "@/components/AutonomyPanel";
import { FeedbackButtons } from "@/components/FeedbackButtons";
import { RevisionHistory } from "@/components/RevisionHistory";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Activity, Sparkles, Download, AlertTriangle, XCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

// Lazy-load heavy components
const WaveformComparison = lazy(() => import("@/components/WaveformComparison").then(m => ({ default: m.WaveformComparison })));
const ExportSummary = lazy(() => import("@/components/ExportSummary").then(m => ({ default: m.ExportSummary })));

const LazyFallback = () => <Skeleton className="h-32 w-full rounded-lg" />;

const Index = () => {
  const {
    status,
    mode, setMode,
    styleTarget, setStyleTarget,
    originalFile,
    originalUrl,
    originalBuffer,
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
    applyOverrides,
    sendFeedback,
    feedbackHistory,
    exportFile,
    cancelProcessing,
    renderProgress,
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
          {busy && (
            <Button
              onClick={cancelProcessing}
              variant="destructive"
              size="sm"
              className="gap-2"
            >
              <XCircle className="h-4 w-4" />
              Cancel
            </Button>
          )}
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

        {/* Progress indicator */}
        {busy && (
          <div className="rounded-lg panel-gradient studio-border p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="relative flex h-8 w-8 items-center justify-center shrink-0">
                <div className="absolute inset-0 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                <Sparkles className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {status === "analyzing" ? "Analyzing audio…" : status === "calling_gemini" ? "Consulting Gemini AI…" : status === "fixing" ? "Rendering audio…" : "Validating output…"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {status === "analyzing" ? "Measuring harshness, sibilance & frequency profile" : status === "calling_gemini" ? "AI is deciding optimal EQ, de-essing & processing strategy" : status === "fixing" ? `Applying DSP chain to your vocal — ${renderProgress}%` : "Comparing before & after metrics"}
                </p>
              </div>
            </div>
            {status === "fixing" ? (
              <Progress value={renderProgress} className="h-1.5" />
            ) : (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-primary/70 w-1/3 animate-[pulse_1.5s_ease-in-out_infinite]" />
              </div>
            )}
          </div>
        )}

        {/* Gemini Error */}
        {geminiError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">AI analysis didn't complete</p>
              <p className="text-xs text-destructive/80 mt-1">{geminiError.details || "Please check your connection and try again."}</p>
              {analysis && (
                <p className="text-xs text-muted-foreground mt-2">Your audio analysis is preserved — you can retry without re-uploading.</p>
              )}
            </div>
          </div>
        )}

        {/* Two column layout */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            {(analysis || geminiDecision || geminiError) && (
              <AnalysisReport
                analysis={analysis || undefined}
                decision={geminiDecision || undefined}
                clampsApplied={clampsApplied}
                postRenderScore={currentVersionId ? postRenderScores[currentVersionId] : undefined}
                geminiError={geminiError}
                modelUsed={modelUsed}
              />
            )}

            {versions.length > 1 && (
              <div className="rounded-lg panel-gradient studio-border p-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Variant Scores</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {versions.filter(v => v.scoringResult).map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setCurrentVersionId(v.id)}
                      className={`rounded-md p-3 text-left transition-all border ${
                        v.id === currentVersionId
                          ? "border-primary bg-primary/10 glow-primary-sm"
                          : "border-border hover:border-muted-foreground bg-card"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-foreground">{v.label}</span>
                        <span className={`text-sm font-bold ${
                          (v.scoringResult?.overallScore ?? 0) >= 70 ? "text-primary" : "text-muted-foreground"
                        }`}>
                          {v.scoringResult?.overallScore ?? "–"}
                        </span>
                      </div>
                      {v.isSafeBaseline && (
                        <span className="text-[10px] text-muted-foreground">Safe Baseline</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* A/B Toggle Player */}
            <ABTogglePlayer
              originalUrl={originalUrl}
              processedUrl={currentVersion?.url ?? null}
              processedLabel={currentVersion?.label}
            />

            {/* Lazy-loaded waveform */}
            {(originalBuffer || currentVersion) && (
              <Suspense fallback={<LazyFallback />}>
                <WaveformComparison
                  originalBuffer={originalBuffer}
                  processedBuffer={currentVersion?.buffer || null}
                />
              </Suspense>
            )}

            {currentVersion && geminiDecision && (
              <LiveSliders
                decision={geminiDecision}
                onOverridesChange={applyOverrides}
                disabled={busy}
              />
            )}

            {versions.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Feedback</p>
                <FeedbackButtons onFeedback={sendFeedback} disabled={busy} history={feedbackHistory} />
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
              <Suspense fallback={<LazyFallback />}>
                <ExportSummary
                  mode={mode}
                  styleTarget={styleTarget}
                  modelUsed={modelUsed}
                  decision={currentVersion.decision}
                  clampsApplied={currentVersion.clampsApplied}
                  score={currentVersionId ? postRenderScores[currentVersionId] : undefined}
                  analysis={analysis}
                />
              </Suspense>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
