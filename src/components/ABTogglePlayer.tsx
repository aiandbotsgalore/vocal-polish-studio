import { useRef, useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight } from "lucide-react";

interface ABTogglePlayerProps {
  originalUrl: string | null;
  processedUrl: string | null;
  processedLabel?: string;
}

/**
 * A/B Toggle Player — single audio element that switches between
 * original and processed audio at the same playback position.
 */
export function ABTogglePlayer({ originalUrl, processedUrl, processedLabel = "Processed" }: ABTogglePlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isProcessed, setIsProcessed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const positionRef = useRef(0);

  const activeUrl = isProcessed ? processedUrl : originalUrl;

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    positionRef.current = audio.currentTime;
    const wasPlaying = !audio.paused;
    setIsProcessed((prev) => !prev);
    setIsPlaying(wasPlaying);
  }, []);

  // Restore position + play state after source switch
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !activeUrl) return;

    const handleCanPlay = () => {
      audio.currentTime = positionRef.current;
      if (isPlaying) audio.play().catch(() => {});
    };

    audio.addEventListener("canplay", handleCanPlay, { once: true });
    audio.load();

    return () => audio.removeEventListener("canplay", handleCanPlay);
  }, [activeUrl, isPlaying]);

  if (!originalUrl && !processedUrl) return null;

  return (
    <div className="rounded-lg p-4 studio-border panel-gradient space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {isProcessed ? processedLabel : "Original"}
        </p>
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
