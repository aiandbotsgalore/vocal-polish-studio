import type { ProcessingMode } from "@/types/gemini";
import { Shield, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ModeSelectorProps {
  mode: ProcessingMode;
  onChange: (mode: ProcessingMode) => void;
  disabled?: boolean;
}

export function ModeSelector({ mode, onChange, disabled }: ModeSelectorProps) {
  return (
    <div className="flex gap-2">
      <Button
        variant={mode === "safe" ? "default" : "outline"}
        size="sm"
        onClick={() => onChange("safe")}
        disabled={disabled}
        className="gap-1.5"
      >
        <Shield className="h-3.5 w-3.5" />
        Safe Mode
      </Button>
      <Button
        variant={mode === "unleashed" ? "default" : "outline"}
        size="sm"
        onClick={() => onChange("unleashed")}
        disabled={disabled}
        className="gap-1.5"
      >
        <Zap className="h-3.5 w-3.5" />
        Unleashed
      </Button>
    </div>
  );
}
