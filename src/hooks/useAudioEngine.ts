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
import { callGemini, clearBase64Cache } from "@/lib/geminiClient";
import { applySafetyClamps } from "@/lib/safetyClamps";
import { renderWithOverrides } from "@/lib/dspEngine";
import { validateRender } from "@/lib/postRenderValidation";
import { auditionVariants, type AuditionResult } from "@/lib/dsp/VariantAudition";
import { decisionToSlots } from "@/lib/dsp/decisionToSlots";
import { exportToWav, downloadWav } from "@/lib/dsp/WavExporter";
import { getStyleProfile } from "@/lib/dsp/StyleProfiles";

const SOFT_LIMIT_SECONDS = 360; // 6 minutes

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

  // Store the resolved style profile from the Gemini call
  const styleProfileRef = useRef<StyleProfile | undefined>(undefined);

  const currentVersion = versions.find((v) => v.id === currentVersionId) || null;

  const loadFile = useCallback((file: File) => {
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    versions.forEach((v) => URL.revokeObjectURL(v.url));
    clearBase64Cache();

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

    // Layer 1
    setStatus("analyzing");
    let layerOne: LayerOneAnalysis;
    try {
      await new Promise((r) => setTimeout(r, 100));
      layerOne = await analyzeAudio(originalFile);
      setAnalysis(layerOne);

      // Store decoded buffer for waveform
      const ac = new AudioContext();
      const ab = await originalFile.arrayBuffer();
      const buf = await ac.decodeAudioData(ab);
      ac.close();
      setOriginalBuffer(buf);
    } catch {
      toast.error("We couldn't read this audio file. Please try a different format (WAV or MP3 work best).");
      setStatus("idle");
      return;
    }

    // Soft duration warning
    if (layerOne.durationSeconds > SOFT_LIMIT_SECONDS) {
      toast.warning("Long audio detected — processing the first 6 minutes. For best results, trim your clip.");
    }

    // Layer 2: Gemini
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
  }, [originalFile, mode, styleTarget]);

  /**
   * Auto Fix — uses VariantAudition to render the Gemini chain + Safe Baseline,
   * score them, and pick the best variant.
   */
  const autoFix = useCallback(async () => {
    if (!originalFile || !geminiDecision || !originalBuffer) {
      toast.error("Run Analyze first so the AI can decide how to process your vocal.");
      return;
    }

    setStatus("fixing");
    try {
      const { decision: clamped, clampsApplied: clamps } = applySafetyClamps(geminiDecision, mode);
      setClampsApplied(clamps);

      // Resolve style profile and target LUFS
      const profile = styleProfileRef.current ?? getStyleProfile(styleTarget);
      const targetLufs = profile.targetLufs;

      // Convert clamped Gemini decision → ChainSlot[]
      const geminiSlots = decisionToSlots(clamped, targetLufs);

      // Build variant list: primary Gemini chain + alternate if present
      const variantSlots = [geminiSlots];
      if (clamped.alternateDecision) {
        const { decision: altClamped } = applySafetyClamps(clamped.alternateDecision, mode);
        variantSlots.push(decisionToSlots(altClamped, targetLufs));
      }

      // Run VariantAudition: renders Safe Baseline + all variants, scores them
      const auditionResult: AuditionResult = await auditionVariants(
        originalBuffer,
        variantSlots,
        targetLufs,
        profile,
      );

      // Create ProcessedVersions from all audition variants
      const newVersions: ProcessedVersion[] = [];
      for (let i = 0; i < auditionResult.variants.length; i++) {
        const v = auditionResult.variants[i];
        const blob = exportToWav(v.buffer, { bitDepth: 24 });
        const url = URL.createObjectURL(blob);
        const versionId = `v${versions.length + i + 1}`;

        newVersions.push({
          id: versionId,
          label: v.label,
          blob,
          url,
          buffer: v.buffer,
          decision: clamped,
          clampsApplied: clamps,
          scoringResult: v.score,
          isSafeBaseline: v.isSafeBaseline,
        });
      }

      setVersions((prev) => [...prev, ...newVersions]);

      // Select the recommended variant
      const recommendedVersion = newVersions[auditionResult.recommendedIndex];
      setCurrentVersionId(recommendedVersion?.id ?? newVersions[0]?.id ?? null);
      setStatus("playback_ready");
      toast.success(`${newVersions.length} variants rendered — "${recommendedVersion?.label}" recommended (score: ${recommendedVersion?.scoringResult?.overallScore ?? "?"})`);

      // Post-render validation for backward compat with existing PostRenderScore display
      setStatus("validating");
      for (const nv of newVersions) {
        try {
          const score = await validateRender(analysis!, nv.buffer, nv.id, clamped.eqBellCenterHz);
          setPostRenderScores((prev) => ({ ...prev, [nv.id]: score }));
        } catch {
          // validation is non-critical
        }
      }
      setStatus("ready");
    } catch (err) {
      console.error("[autoFix]", err);
      toast.error("Audio processing hit a snag. Try a different file or style target.");
      setStatus("gemini_ready");
    }
  }, [originalFile, originalBuffer, geminiDecision, mode, styleTarget, versions, analysis]);

  const applyOverrides = useCallback(async (overrides: SliderOverrides) => {
    if (!originalFile || !geminiDecision) return;
    try {
      const { decision: clamped } = applySafetyClamps(geminiDecision, mode);
      const { blob, buffer } = await renderWithOverrides(originalFile, clamped, overrides, styleTarget);
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
    } catch {
      // silent — slider tweaks shouldn't throw errors at the user
    }
  }, [originalFile, geminiDecision, mode, styleTarget, currentVersionId]);

  const sendFeedback = useCallback(async (token: FeedbackToken) => {
    if (!originalFile || !analysis || !geminiDecision || !originalBuffer) return;
    setFeedbackHistory((prev) => [...prev, token]);

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

      const auditionResult = await auditionVariants(
        originalBuffer,
        [geminiSlots],
        targetLufs,
        profile,
      );

      const best = auditionResult.variants[auditionResult.recommendedIndex];
      const blob = exportToWav(best.buffer, { bitDepth: 24 });
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

      setStatus("validating");
      try {
        const score = await validateRender(analysis, best.buffer, versionId, clamped.eqBellCenterHz);
        setPostRenderScores((prev) => ({ ...prev, [versionId]: score }));
      } catch {
        // non-critical
      }
      setStatus("ready");
    } catch {
      toast.error("Feedback revision didn't work. Give it another shot.");
      setStatus("ready");
    }
  }, [originalFile, originalBuffer, analysis, geminiDecision, mode, styleTarget, versions]);

  const exportFile = useCallback(() => {
    if (!currentVersion || !originalFile) return;
    const baseName = originalFile.name.replace(/\.[^.]+$/, "");
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
    loadFile, analyze, autoFix, applyOverrides, sendFeedback, exportFile,
  };
}
