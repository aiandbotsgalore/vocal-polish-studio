import { useState, useCallback } from "react";
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
} from "@/types/gemini";
import { analyzeAudio } from "@/lib/audioAnalysis";
import { callGemini } from "@/lib/geminiClient";
import { applySafetyClamps } from "@/lib/safetyClamps";
import { renderWithDecision } from "@/lib/dspEngine";
import { validateRender } from "@/lib/postRenderValidation";

export function useAudioEngine() {
  const [status, setStatus] = useState<AppStatus>("idle");
  const [mode, setMode] = useState<ProcessingMode>("safe");
  const [styleTarget, setStyleTarget] = useState<StyleTarget>("natural");
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<LayerOneAnalysis | null>(null);
  const [geminiDecision, setGeminiDecision] = useState<GeminiDecision | null>(null);
  const [modelUsed, setModelUsed] = useState<string>("");
  const [geminiError, setGeminiError] = useState<GeminiError | null>(null);
  const [clampsApplied, setClampsApplied] = useState<string[]>([]);
  const [versions, setVersions] = useState<ProcessedVersion[]>([]);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [postRenderScores, setPostRenderScores] = useState<Record<string, PostRenderScore>>({});
  const [feedbackHistory, setFeedbackHistory] = useState<FeedbackToken[]>([]);

  const currentVersion = versions.find((v) => v.id === currentVersionId) || null;

  const loadFile = useCallback((file: File) => {
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    versions.forEach((v) => URL.revokeObjectURL(v.url));

    setOriginalFile(file);
    setOriginalUrl(URL.createObjectURL(file));
    setAnalysis(null);
    setGeminiDecision(null);
    setGeminiError(null);
    setModelUsed("");
    setClampsApplied([]);
    setVersions([]);
    setCurrentVersionId(null);
    setPostRenderScores({});
    setFeedbackHistory([]);
    setStatus("idle");
  }, [originalUrl, versions]);

  const analyze = useCallback(async () => {
    if (!originalFile) return;
    setGeminiError(null);

    // Layer 1
    setStatus("analyzing");
    let layerOne: LayerOneAnalysis;
    try {
      await new Promise((r) => setTimeout(r, 100));
      layerOne = await analyzeAudio(originalFile);
      setAnalysis(layerOne);
    } catch (e) {
      console.error("Layer 1 analysis failed:", e);
      toast.error("Audio analysis failed");
      setStatus("idle");
      return;
    }

    // Layer 2: Gemini
    setStatus("calling_gemini");
    try {
      const result = await callGemini(layerOne, mode, styleTarget);
      if (result.error) {
        console.error("Gemini error:", result.error);
        setGeminiError(result.error);
        setStatus("gemini_error");
        toast.error(result.error.details || "Gemini analysis failed. No AI decision was generated.");
        return;
      }
      setGeminiDecision(result.decision!);
      setModelUsed(result.modelUsed || "unknown");
      setStatus("gemini_ready");
      toast.success("Gemini decision received");
    } catch (e) {
      console.error("Gemini call failed:", e);
      setGeminiError({ error: "gemini_unavailable", details: "Unexpected error calling Gemini" });
      setStatus("gemini_error");
      toast.error("Gemini analysis failed. No AI decision was generated.");
    }
  }, [originalFile, mode, styleTarget]);

  const autoFix = useCallback(async () => {
    if (!originalFile || !geminiDecision) {
      toast.error("No Gemini decision available. Run Analyze first.");
      return;
    }

    setStatus("fixing");
    try {
      const { decision: clamped, clampsApplied: clamps } = applySafetyClamps(geminiDecision, mode);
      setClampsApplied(clamps);

      const { blob, buffer } = await renderWithDecision(originalFile, clamped);
      const url = URL.createObjectURL(blob);
      const versionId = `v${versions.length + 1}`;
      const label = versions.length === 0 ? "AI Version A" : `Revision ${versions.length}`;

      const newVersion: ProcessedVersion = {
        id: versionId,
        label,
        blob,
        url,
        buffer,
        decision: clamped,
        clampsApplied: clamps,
      };

      setVersions((prev) => [...prev, newVersion]);
      setCurrentVersionId(versionId);
      setStatus("playback_ready");
      toast.success(`${label} rendered`);

      // Post-render validation async
      setStatus("validating");
      try {
        const score = await validateRender(analysis!, buffer, versionId);
        setPostRenderScores((prev) => ({ ...prev, [versionId]: score }));
      } catch (e) {
        console.error("Post-render validation failed:", e);
      }
      setStatus("ready");
    } catch (e) {
      console.error("DSP rendering failed:", e);
      toast.error("Audio processing failed");
      setStatus("gemini_ready");
    }
  }, [originalFile, geminiDecision, mode, versions, analysis]);

  const sendFeedback = useCallback(async (token: FeedbackToken) => {
    if (!originalFile || !analysis || !geminiDecision) return;
    setFeedbackHistory((prev) => [...prev, token]);

    setStatus("calling_gemini");
    try {
      const result = await callGemini(analysis, mode, styleTarget, token, geminiDecision);
      if (result.error) {
        toast.error(result.error.details || "Gemini feedback call failed");
        setStatus("ready");
        return;
      }

      setGeminiDecision(result.decision!);
      if (result.modelUsed) setModelUsed(result.modelUsed);
      setStatus("fixing");

      const { decision: clamped, clampsApplied: clamps } = applySafetyClamps(result.decision!, mode);
      setClampsApplied(clamps);

      const { blob, buffer } = await renderWithDecision(originalFile, clamped);
      const url = URL.createObjectURL(blob);
      const versionId = `v${versions.length + 1}`;
      const feedbackLabel = token === "too_dull" ? "Too Dull" : token === "too_sharp" ? "Too Sharp" : token === "too_lispy" ? "Too Lispy" : "Better";
      const label = `Revision ${versions.length} (${feedbackLabel})`;

      const newVersion: ProcessedVersion = {
        id: versionId, label, blob, url, buffer, decision: clamped, clampsApplied: clamps,
      };

      setVersions((prev) => [...prev, newVersion]);
      setCurrentVersionId(versionId);
      setStatus("playback_ready");
      toast.success(`${label} rendered`);

      // Async validation
      setStatus("validating");
      try {
        const score = await validateRender(analysis, buffer, versionId);
        setPostRenderScores((prev) => ({ ...prev, [versionId]: score }));
      } catch (e) {
        console.error("Post-render validation failed:", e);
      }
      setStatus("ready");
    } catch (e) {
      console.error("Feedback loop failed:", e);
      toast.error("Feedback revision failed");
      setStatus("ready");
    }
  }, [originalFile, analysis, geminiDecision, mode, styleTarget, versions]);

  const exportFile = useCallback(() => {
    if (!currentVersion || !originalFile) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(currentVersion.blob);
    const baseName = originalFile.name.replace(/\.[^.]+$/, "");
    a.download = `${baseName}_${currentVersion.id}.wav`;
    a.click();
  }, [currentVersion, originalFile]);

  return {
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
    feedbackHistory,
    loadFile,
    analyze,
    autoFix,
    sendFeedback,
    exportFile,
  };
}
