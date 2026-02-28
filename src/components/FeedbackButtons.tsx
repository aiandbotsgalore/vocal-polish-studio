import type { FeedbackToken } from "@/types/gemini";
import { Button } from "@/components/ui/button";
import { ThumbsDown, ThumbsUp, Ear, Sun } from "lucide-react";

interface FeedbackButtonsProps {
  onFeedback: (token: FeedbackToken) => void;
  disabled?: boolean;
  history?: FeedbackToken[];
}

const feedbackOptions: { token: FeedbackToken; label: string; icon: typeof ThumbsDown }[] = [
  { token: "too_dull", label: "Too Dull", icon: Sun },
  { token: "too_sharp", label: "Too Sharp", icon: ThumbsDown },
  { token: "too_lispy", label: "Too Lispy", icon: Ear },
  { token: "better", label: "Better", icon: ThumbsUp },
];

const TOKEN_LABELS: Record<FeedbackToken, string> = {
  too_dull: "Dull",
  too_sharp: "Sharp",
  too_lispy: "Lispy",
  better: "Better",
};

export function FeedbackButtons({ onFeedback, disabled, history = [] }: FeedbackButtonsProps) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {feedbackOptions.map(({ token, label, icon: Icon }) => (
          <Button
            key={token}
            variant="outline"
            size="sm"
            onClick={() => onFeedback(token)}
            disabled={disabled}
            className="gap-1.5 text-xs"
          >
            <Icon className="h-3 w-3" />
            {label}
          </Button>
        ))}
      </div>
      {history.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground">History:</span>
          {history.map((t, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {TOKEN_LABELS[t]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
