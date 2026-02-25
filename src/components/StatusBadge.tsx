import type { AppStatus } from "@/hooks/useAudioEngine";
import { Loader2, CheckCircle2, CircleDot } from "lucide-react";

const config: Record<AppStatus, { label: string; icon: typeof Loader2; className: string }> = {
  idle: { label: "Idle", icon: CircleDot, className: "text-muted-foreground" },
  analyzing: { label: "Analyzing…", icon: Loader2, className: "text-accent animate-pulse-glow" },
  fixing: { label: "Processing…", icon: Loader2, className: "text-primary animate-pulse-glow" },
  ready: { label: "Ready", icon: CheckCircle2, className: "text-primary" },
};

export function StatusBadge({ status }: { status: AppStatus }) {
  const { label, icon: Icon, className } = config[status];
  const spinning = status === "analyzing" || status === "fixing";

  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full bg-secondary/60 px-3 py-1 text-xs font-medium ${className}`}>
      <Icon className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`} />
      {label}
    </div>
  );
}
