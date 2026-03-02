import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight } from "lucide-react";
import { computeIntegratedLUFS } from "@/lib/dsp/loudness";

interface ABTogglePlayerProps {
  originalUrl: string | null;
  processedUrl: string | null;
  processedLabel?: string;
  /** Original AudioBuffer for LUFS measurement */
  originalBuffer?: AudioBuffer | null;
  /** Processed AudioBuffer for LUFS measurement */
  processedBuffer?: AudioBuffer | null;
}

/**
 * Compute a linear gain to match the original's loudness to the processed track.
 * Returns 1 if measurement fails.
 */
function computeLoudnessMatchGain(
  originalBuffer: AudioBuffer | null | undefined,
  processedBuffer: AudioBuffer | null | undefined,
): number {
  if (!originalBuffer || !processedBuffer) return 1;

  const extractChannels = (buf: AudioBuffer): Float32Array[] => {
    const chs: Float32Array[] = [];
    for (let c = 0; c < buf.numberOfChannels; c++) {
      chs.push(buf.getChannelData(c));
    }
    return chs;
  };

  const origLufs = computeIntegratedLUFS(extractChannels(originalBuffer), originalBuffer.sampleRate);
  const procLufs = computeIntegratedLUFS(extractChannels(processedBuffer), processedBuffer.sampleRate);

  if (!isFinite(origLufs) || !isFinite(procLufs)) return 1;

  // Apply gain to original so it matches processed loudness
  const diffDb = procLufs - origLufs;
  const clampedDiff = Math.max(-12, Math.min(12, diffDb));
  return Math.pow(10, clampedDiff / 20);
}

/**
 * A/B Toggle Player — loudness-matched comparison between original and processed.
 */
export function ABTogglePlayer({
  originalUrl,
  processedUrl,
  processedLabel = "Processed",
  originalBuffer,
  processedBuffer,
}: ABTogglePlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [isProcessed, setIsProcessed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const positionRef = useRef(0);

  const activeUrl = isProcessed ? processedUrl : originalUrl;

  // Compute loudness match gain
  const matchGain = useMemo(
    () => computeLoudnessMatchGain(originalBuffer, processedBuffer),
    [originalBuffer, processedBuffer],
  );

  // Set up Web Audio gain node for loudness matching
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Only create context once
    if (!audioCtxRef.current) {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(audio);
      const gain = ctx.createGain();
      source.connect(gain);
      gain.connect(ctx.destination);
      audioCtxRef.current = ctx;
      sourceNodeRef.current = source;
      gainNodeRef.current = gain;
    }

    return () => {
      // Cleanup on unmount
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      sourceNodeRef.current = null;
      gainNodeRef.current = null;
    };
  }, []);

  // Update gain when switching or when match gain changes
  useEffect(() => {
    if (!gainNodeRef.current) return;
    // When playing original, apply the match gain. When playing processed, gain = 1.
    gainNodeRef.current.gain.value = isProcessed ? 1 : matchGain;
  }, [isProcessed, matchGain]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    positionRef.current = audio.currentTime;
    const wasPlaying = !audio.paused;
    setIsProcessed((prev) => !prev);
    setIsPlaying(wasPlaying);
    // Resume AudioContext if suspended (autoplay policy)
    if (audioCtxRef.current?.state === "suspended") {
      audioCtxRef.current.resume();
    }
  }, []);

  // Restore position + play state after source switch
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !activeUrl) return;

    const handleCanPlay = () => {
      audio.currentTime = positionRef.current;
      if (isPlaying) {
        if (audioCtxRef.current?.state === "suspended") {
          audioCtxRef.current.resume();
        }
        audio.play().catch(() => {});
      }
    };

    audio.addEventListener("canplay", handleCanPlay, { once: true });
    audio.load();

    return () => audio.removeEventListener("canplay", handleCanPlay);
  }, [activeUrl, isPlaying]);

  if (!originalUrl && !processedUrl) return null;

  const gainDb = isProcessed ? 0 : Math.round(20 * Math.log10(matchGain) * 10) / 10;

  return (
    <div className="rounded-lg p-4 studio-border panel-gradient space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {isProcessed ? processedLabel : "Original"}
          </p>
          {!isProcessed && gainDb !== 0 && (
            <span className="text-[10px] font-mono text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded">
              {gainDb > 0 ? "+" : ""}{gainDb} dB match
            </span>
          )}
        </div>
        {originalUrl && processedUrl && (
          <Button
            variant="outline"
            size="sm"
            onClick={toggle}
            className="gap-1.5 text-xs h-7"
          >
            <ArrowLeftRight className="h-3 w-3" />
            {isProcessed ? "Hear Original" : "Hear Processed"}
          </Button>
        )}
      </div>
      {activeUrl ? (
        <audio
          ref={audioRef}
          controls
          src={activeUrl}
          className="w-full h-10 [&::-webkit-media-controls-panel]:bg-secondary [&::-webkit-media-controls-panel]:rounded-md"
        />
      ) : (
        <div className="flex h-10 items-center justify-center rounded-md bg-secondary/50">
          <span className="text-xs text-muted-foreground">No audio loaded</span>
        </div>
      )}
    </div>
  );
}
