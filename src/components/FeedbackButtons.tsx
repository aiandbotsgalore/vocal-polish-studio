import type { FeedbackToken } from "@/types/gemini";
import { Button } from "@/components/ui/button";
import { ThumbsDown, ThumbsUp, Ear, Sun } from "lucide-react";

interface FeedbackButtonsProps {
  onFeedback: (token: FeedbackToken) => void;
  disabled?: boolean;
}

const feedbackOptions: { token: FeedbackToken; label: string; icon: typeof ThumbsDown }[] = [
  { token: "too_dull", label: "Too Dull", icon: Sun },
  { token: "too_sharp", label: "Too Sharp", icon: ThumbsDown },
  { token: "too_lispy", label: "Too Lispy", icon: Ear },
  { token: "better", label: "Better", icon: ThumbsUp },
];

export function FeedbackButtons({ onFeedback, disabled }: FeedbackButtonsProps) {
  return (
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
  );
}
