import type { StyleTarget } from "@/types/gemini";
import { STYLE_LABELS } from "@/types/gemini";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface StyleTargetSelectorProps {
  value: StyleTarget;
  onChange: (v: StyleTarget) => void;
  disabled?: boolean;
}

const targets = Object.keys(STYLE_LABELS) as StyleTarget[];

export function StyleTargetSelector({ value, onChange, disabled }: StyleTargetSelectorProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as StyleTarget)} disabled={disabled}>
      <SelectTrigger className="w-48">
        <SelectValue placeholder="Style target" />
      </SelectTrigger>
      <SelectContent>
        {targets.map((t) => (
          <SelectItem key={t} value={t}>{STYLE_LABELS[t]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
