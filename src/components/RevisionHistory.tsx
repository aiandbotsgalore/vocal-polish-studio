import type { ProcessedVersion } from "@/types/gemini";
import { Button } from "@/components/ui/button";
import { History } from "lucide-react";

interface RevisionHistoryProps {
  versions: ProcessedVersion[];
  currentId: string | null;
  onSelect: (id: string) => void;
}

export function RevisionHistory({ versions, currentId, onSelect }: RevisionHistoryProps) {
  if (versions.length === 0) return null;

  return (
    <div className="rounded-lg panel-gradient p-4 studio-border space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <History className="h-4 w-4 text-primary" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Revision History</h3>
      </div>
      <div className="space-y-1">
        {versions.map((v) => (
          <Button
            key={v.id}
            variant={v.id === currentId ? "default" : "ghost"}
            size="sm"
            className="w-full justify-start text-xs h-7"
            onClick={() => onSelect(v.id)}
          >
            {v.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
