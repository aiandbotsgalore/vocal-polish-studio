import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import type {
  AppStatus,
  ProcessingMode,
  StyleTarget,
  LayerOneAnalysis,
  GeminiDecision,
  ProcessedVersion,
  PostRenderScore,
  FeedbackToken,
  GeminiError,
  SliderOverrides,
} from "@/types/gemini";
import type { StyleProfile } from "@/lib/dsp/types";
import { analyzeAudio } from "@/lib/audioAnalysis";
import { callGemini } from "@/lib/geminiClient";
import { applySafetyClamps } from "@/lib/safetyClamps";
import { renderWithOverrides } from "@/lib/dspEngine";
import { validateRender } from "@/lib/postRenderValidation";
import { workerAuditionVariants, type WorkerAuditionResult } from "@/lib/dsp/WorkerRenderer";
import { decisionToSlots } from "@/lib/dsp/decisionToSlots";
import { exportToWav, downloadWav } from "@/lib/dsp/WavExporter";
import { getStyleProfile } from "@/lib/dsp/StyleProfiles";
import { startTimer } from "@/lib/perfTimer";

const SOFT_LIMIT_SECONDS = 360;

export function useAudioEngine() {
  const [status, setStatus] = useState<AppStatus>("idle");
  const [mode, setMode] = useState<ProcessingMode>("safe");
  const [styleTarget, setStyleTarget] = useState<StyleTarget>("natural");
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [originalBuffer, setOriginalBuffer] = useState<AudioBuffer | null>(null);
  const [analysis, setAnalysis] = useState<LayerOneAnalysis | null>(null);
  const [geminiDecision, setGeminiDecision] = useState<GeminiDecision | null>(null);
  const [modelUsed, setModelUsed] = useState<string>("");
  const [geminiError, setGeminiError] = useState<GeminiError | null>(null);
  const [clampsApplied, setClampsApplied] = useState<string[]>([]);
  const [versions, setVersions] = useState<ProcessedVersion[]>([]);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [postRenderScores, setPostRenderScores] = useState<Record<string, PostRenderScore>>({});
  const [feedbackHistory, setFeedbackHistory] = useState<FeedbackToken[]>([]);
  /** Real progress percentage (0-100) for rendering */
  const [renderProgress, setRenderProgress] = useState(0);

  const styleProfileRef = useRef<StyleProfile | undefined>(undefined);
  /** AbortController for cancelling in-flight processing */
  const abortRef = useRef<AbortController | null>(null);

  const currentVersion = versions.find((v) => v.id === currentVersionId) || null;

  /** Cancel any in-flight processing */
  const cancelProcessing = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setStatus((prev) => {
      if (prev === "analyzing" || prev === "calling_gemini" || prev === "fixing" || prev === "validating") {
        toast.info("Processing cancelled.");
        return "idle";
      }
      return prev;
    });
  }, []);

  const loadFile = useCallback((file: File) => {
    if (abortRef.current) abortRef.current.abort();
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    versions.forEach((v) => URL.revokeObjectURL(v.url));
    // Base64 cache removed — binary transport now used

    setOriginalFile(file);
    setOriginalUrl(URL.createObjectURL(file));
    setOriginalBuffer(null);
    setAnalysis(null);
    setGeminiDecision(null);
    setGeminiError(null);
    setModelUsed("");
    setClampsApplied([]);
    setVersions([]);
    setCurrentVersionId(null);
    setPostRenderScores({});
    setFeedbackHistory([]);
    styleProfileRef.current = undefined;
    setStatus("idle");
  }, [originalUrl, versions]);

  const analyze = useCallback(async () => {
    if (!originalFile) return;
    setGeminiError(null);
    abortRef.current = new AbortController();

    setStatus("analyzing");
    const endAnalyze = startTimer("analyze-total");
    let layerOne: LayerOneAnalysis;
    try {
      await new Promise((r) => setTimeout(r, 50));
      layerOne = await analyzeAudio(originalFile);
      setAnalysis(layerOne);

      // Decode once and cache
      const ac = new AudioContext();
      const ab = await originalFile.arrayBuffer();
      const buf = await ac.decodeAudioData(ab);
      ac.close();
      setOriginalBuffer(buf);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      toast.error("We couldn't read this audio file. Please try a different format (WAV or MP3 work best).");
      setStatus("idle");
      return;
    }

    if (layerOne.durationSeconds > SOFT_LIMIT_SECONDS) {
      toast.warning("Long audio detected — processing the first 6 minutes. For best results, trim your clip.");
    }

    setStatus("calling_gemini");
    try {
      const result = await callGemini(originalFile, layerOne, mode, styleTarget);
      if (result.error) {
        setGeminiError(result.error);
        setStatus("gemini_error");
        toast.error(result.error.details || "The AI couldn't analyze this file. Please try again in a moment.");
        return;
      }
      setGeminiDecision(result.decision!);
      setModelUsed(result.modelUsed || "unknown");
      styleProfileRef.current = result.styleProfile;
      setStatus("gemini_ready");
      toast.success("AI analysis complete — ready to fix!");
    } catch {
      setGeminiError({ error: "gemini_unavailable", details: "Something went wrong reaching the AI. Check your connection and try again." });
      setStatus("gemini_error");
      toast.error("Something went wrong reaching the AI. Check your connection and try again.");
    }
    endAnalyze();
  }, [originalFile, mode, styleTarget]);

  const autoFix = useCallback(async () => {
    if (!originalFile || !geminiDecision || !originalBuffer) {
      toast.error("Run Analyze first so the AI can decide how to process your vocal.");
      return;
    }

    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setStatus("fixing");
    setRenderProgress(0);
    const endFix = startTimer("autoFix-total");

    try {
      const { decision: clamped, clampsApplied: clamps } = applySafetyClamps(geminiDecision, mode);
      setClampsApplied(clamps);

      const profile = styleProfileRef.current ?? getStyleProfile(styleTarget);
      const targetLufs = profile.targetLufs;
      const geminiSlots = decisionToSlots(clamped, targetLufs);

      const variantSlots = [geminiSlots];
      if (clamped.alternateDecision) {
        const { decision: altClamped } = applySafetyClamps(clamped.alternateDecision, mode);
        variantSlots.push(decisionToSlots(altClamped, targetLufs));
      }

      const auditionResult: WorkerAuditionResult = await workerAuditionVariants(
        originalBuffer, variantSlots, targetLufs, profile,
        (pct) => setRenderProgress(Math.round(pct * 100)),
        signal,
      );

      if (signal.aborted) return;

      // Defer WAV export — only create blobs for playback URLs, not full WAV
      const newVersions: ProcessedVersion[] = [];
      for (let i = 0; i < auditionResult.variants.length; i++) {
        const v = auditionResult.variants[i];
        // Lightweight WAV for playback (not the final high-quality export)
        const blob = exportToWav(v.buffer, { bitDepth: 16 });
        const url = URL.createObjectURL(blob);
        const versionId = `v${versions.length + i + 1}`;

        newVersions.push({
          id: versionId, label: v.label, blob, url, buffer: v.buffer,
          decision: clamped, clampsApplied: clamps,
          scoringResult: v.score, isSafeBaseline: v.isSafeBaseline,
        });
      }

      setVersions((prev) => [...prev, ...newVersions]);
      const recommendedVersion = newVersions[auditionResult.recommendedIndex];
      setCurrentVersionId(recommendedVersion?.id ?? newVersions[0]?.id ?? null);
      setStatus("playback_ready");
      toast.success(`${newVersions.length} variants rendered — "${recommendedVersion?.label}" recommended (score: ${recommendedVersion?.scoringResult?.overallScore ?? "?"})`);

      // Validate only the recommended variant (not all)
      setStatus("validating");
      if (recommendedVersion) {
        try {
          const score = await validateRender(analysis!, recommendedVersion.buffer, recommendedVersion.id, clamped.eqBellCenterHz);
          setPostRenderScores((prev) => ({ ...prev, [recommendedVersion.id]: score }));
        } catch { /* non-critical */ }
      }
      setStatus("ready");
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        setStatus("gemini_ready");
        return;
      }
      console.error("[autoFix]", err);
      toast.error("Audio processing hit a snag. Try a different file or style target.");
      // Error recovery: preserve gemini_ready state so user can retry
      setStatus("gemini_ready");
      setRenderProgress(0);
    }
    endFix();
  }, [originalFile, originalBuffer, geminiDecision, mode, styleTarget, versions, analysis]);

  const applyOverrides = useCallback(async (overrides: SliderOverrides) => {
    if (!originalBuffer || !geminiDecision) return;
    try {
      const { decision: clamped } = applySafetyClamps(geminiDecision, mode);
      // Use cached originalBuffer instead of re-decoding file
      const { blob, buffer } = await renderWithOverrides(originalBuffer, clamped, overrides, styleTarget);
      const url = URL.createObjectURL(blob);

      setVersions((prev) => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        const idx = updated.findIndex((v) => v.id === currentVersionId);
        if (idx === -1) return prev;
        URL.revokeObjectURL(updated[idx].url);
        updated[idx] = { ...updated[idx], blob, buffer, url };
        return updated;
      });
    } catch { /* silent */ }
  }, [originalBuffer, geminiDecision, mode, styleTarget, currentVersionId]);

  const sendFeedback = useCallback(async (token: FeedbackToken) => {
    if (!originalFile || !analysis || !geminiDecision || !originalBuffer) return;
    setFeedbackHistory((prev) => [...prev, token]);

    abortRef.current = new AbortController();
    setStatus("calling_gemini");
    try {
      const result = await callGemini(originalFile, analysis, mode, styleTarget, token, geminiDecision);
      if (result.error) {
        toast.error(result.error.details || "The AI couldn't process your feedback. Try again.");
        setStatus("ready");
        return;
      }

      setGeminiDecision(result.decision!);
      if (result.modelUsed) setModelUsed(result.modelUsed);
      if (result.styleProfile) styleProfileRef.current = result.styleProfile;
      setStatus("fixing");

      const { decision: clamped, clampsApplied: clamps } = applySafetyClamps(result.decision!, mode);
      setClampsApplied(clamps);

      const profile = styleProfileRef.current ?? getStyleProfile(styleTarget);
      const targetLufs = profile.targetLufs;
      const geminiSlots = decisionToSlots(clamped, targetLufs);

      const auditionResult = await workerAuditionVariants(originalBuffer, [geminiSlots], targetLufs, profile);

      const best = auditionResult.variants[auditionResult.recommendedIndex];
      const blob = exportToWav(best.buffer, { bitDepth: 16 });
      const url = URL.createObjectURL(blob);
      const versionId = `v${versions.length + 1}`;
      const feedbackLabel = token === "too_dull" ? "Too Dull" : token === "too_sharp" ? "Too Sharp" : token === "too_lispy" ? "Too Lispy" : "Better";
      const label = `Revision ${versions.length} (${feedbackLabel})`;

      const newVersion: ProcessedVersion = {
        id: versionId, label, blob, url, buffer: best.buffer,
        decision: clamped, clampsApplied: clamps,
        scoringResult: best.score, isSafeBaseline: best.isSafeBaseline,
      };

      setVersions((prev) => [...prev, newVersion]);
      setCurrentVersionId(versionId);
      setStatus("playback_ready");
      toast.success(`${label} rendered (score: ${best.score.overallScore})`);

      // Validate only this version
      setStatus("validating");
      try {
        const score = await validateRender(analysis, best.buffer, versionId, clamped.eqBellCenterHz);
        setPostRenderScores((prev) => ({ ...prev, [versionId]: score }));
      } catch { /* non-critical */ }
      setStatus("ready");
    } catch {
      toast.error("Feedback revision didn't work. Give it another shot.");
      // Error recovery: preserve ready state + existing versions
      setStatus(versions.length > 0 ? "ready" : "gemini_ready");
    }
  }, [originalFile, originalBuffer, analysis, geminiDecision, mode, styleTarget, versions]);

  const exportFile = useCallback(() => {
    if (!currentVersion || !originalFile) return;
    const baseName = originalFile.name.replace(/\.[^.]+$/, "");
    // Full quality 24-bit export on demand
    downloadWav(currentVersion.buffer, {
      bitDepth: 24,
      filename: `${baseName}_${currentVersion.id}.wav`,
    });
  }, [currentVersion, originalFile]);

  return {
    status, mode, setMode, styleTarget, setStyleTarget,
    originalFile, originalUrl, originalBuffer, analysis,
    geminiDecision, modelUsed, geminiError,
    clampsApplied, versions,
    currentVersionId, setCurrentVersionId, currentVersion,
    postRenderScores, feedbackHistory,
    renderProgress,
    loadFile, analyze, autoFix, applyOverrides, sendFeedback, exportFile,
    cancelProcessing,
  };
}
