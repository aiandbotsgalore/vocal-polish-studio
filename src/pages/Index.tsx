import { useAudioEngine } from "@/hooks/useAudioEngine";
import { FileUploadCard } from "@/components/FileUploadCard";
import { AnalysisReport } from "@/components/AnalysisReport";
import { AudioPlayerPanel } from "@/components/AudioPlayerPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Activity, Sparkles, Download } from "lucide-react";

const Index = () => {
  const {
    status,
    originalFile,
    originalUrl,
    analysisResults,
    processedUrl,
    loadFile,
    analyze,
    autoFix,
    exportFile,
  } = useAudioEngine();

  const isAnalyzing = status === "analyzing";
  const isFixing = status === "fixing";
  const busy = isAnalyzing || isFixing;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 glow-primary-sm">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-foreground text-glow">Vocal Doctor Lite</h1>
              <p className="text-[11px] text-muted-foreground">AI-assisted harshness analysis</p>
            </div>
          </div>
          <StatusBadge status={status} />
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
        {/* Upload */}
        <FileUploadCard onFileSelected={loadFile} currentFile={originalFile} />

        {/* Action buttons */}
        <div className="flex gap-3">
          <Button
            onClick={analyze}
            disabled={!originalFile || busy}
            className="gap-2"
          >
            <Sparkles className="h-4 w-4" />
            {isAnalyzing ? "Analyzing…" : "Analyze"}
          </Button>
          <Button
            onClick={autoFix}
            disabled={!analysisResults || busy}
            variant="secondary"
            className="gap-2"
          >
            <Activity className="h-4 w-4" />
            {isFixing ? "Processing…" : "Auto Fix"}
          </Button>
          <Button
            onClick={exportFile}
            disabled={!processedUrl}
            variant="outline"
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>

        {/* Analysis Report */}
        {analysisResults && <AnalysisReport results={analysisResults} />}

        {/* Players */}
        {(originalUrl || processedUrl) && (
          <div className="grid gap-4 sm:grid-cols-2">
            <AudioPlayerPanel label="Before (Original)" url={originalUrl} />
            <AudioPlayerPanel label="After (Processed)" url={processedUrl} accent={!!processedUrl} />
          </div>
        )}
      </main>
    </div>
  );
};

export default Index;
