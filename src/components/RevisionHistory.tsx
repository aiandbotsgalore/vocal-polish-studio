import type { ProcessedVersion } from "@/types/gemini";
import { Button } from "@/components/ui/button";
import { History, Star, Shield } from "lucide-react";

interface RevisionHistoryProps {
  versions: ProcessedVersion[];
  currentId: string | null;
  onSelect: (id: string) => void;
}

export function RevisionHistory({ versions, currentId, onSelect }: RevisionHistoryProps) {
  if (versions.length === 0) return null;

  // Find best scoring version
  const bestId = versions.reduce<string | null>((best, v) => {
    if (!v.scoringResult) return best;
    const bestVersion = versions.find((bv) => bv.id === best);
    if (!bestVersion?.scoringResult) return v.id;
    return v.scoringResult.overallScore > bestVersion.scoringResult.overallScore ? v.id : best;
  }, null);

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
            className="w-full justify-between text-xs h-auto py-1.5 px-2"
            onClick={() => onSelect(v.id)}
          >
            <span className="flex items-center gap-1.5 truncate">
              {v.isSafeBaseline && <Shield className="h-3 w-3 shrink-0 text-muted-foreground" />}
              {v.id === bestId && <Star className="h-3 w-3 shrink-0 text-primary" />}
              <span className="truncate">{v.label}</span>
            </span>
            {v.scoringResult && (
              <span className={`ml-2 font-mono text-[10px] shrink-0 ${
                v.scoringResult.overallScore >= 70 ? "text-primary" : "text-muted-foreground"
              }`}>
                {v.scoringResult.overallScore}
              </span>
            )}
          </Button>
        ))}
      </div>
    </div>
  );
}
