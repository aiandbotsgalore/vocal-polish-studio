import type { AppStatus } from "@/types/gemini";
import { Loader2, CheckCircle2, CircleDot, AlertTriangle, Brain, Play, BarChart3 } from "lucide-react";

const config: Record<AppStatus, { label: string; icon: typeof Loader2; className: string }> = {
  idle: { label: "Idle", icon: CircleDot, className: "text-muted-foreground" },
  analyzing: { label: "Analyzing Audio…", icon: Loader2, className: "text-accent animate-pulse-glow" },
  calling_gemini: { label: "Calling Gemini…", icon: Brain, className: "text-primary animate-pulse-glow" },
  gemini_ready: { label: "Gemini Decision Ready", icon: CheckCircle2, className: "text-primary" },
  fixing: { label: "Rendering…", icon: Loader2, className: "text-primary animate-pulse-glow" },
  playback_ready: { label: "Playback Ready", icon: Play, className: "text-primary" },
  validating: { label: "Validating…", icon: BarChart3, className: "text-accent animate-pulse-glow" },
  ready: { label: "Ready", icon: CheckCircle2, className: "text-primary" },
  gemini_error: { label: "Gemini Error", icon: AlertTriangle, className: "text-destructive" },
};

export function StatusBadge({ status }: { status: AppStatus }) {
  const { label, icon: Icon, className } = config[status];
  const spinning = status === "analyzing" || status === "calling_gemini" || status === "fixing" || status === "validating";

  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full bg-secondary/60 px-3 py-1 text-xs font-medium ${className}`}>
      <Icon className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`} />
      {label}
    </div>
  );
}
