import { useState, useEffect, useCallback } from "react";
import { History, Clock, Music, TrendingUp, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { loadRecentSessions, type SessionRecord, type PreferenceSummary, derivePreferenceSummary } from "@/lib/sessionHistory";
import { STYLE_LABELS, type StyleTarget } from "@/types/gemini";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SessionHistoryPanelProps {
  onPreferencesLoaded?: (summary: PreferenceSummary) => void;
  refreshTrigger?: number;
}

export function SessionHistoryPanel({ onPreferencesLoaded, refreshTrigger }: SessionHistoryPanelProps) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await loadRecentSessions(50);
    setSessions(data);
    const summary = derivePreferenceSummary(data);
    onPreferencesLoaded?.(summary);
    setLoading(false);
  }, [onPreferencesLoaded]);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  const deleteSession = async (id: string) => {
    const { error } = await supabase.from("processing_sessions").delete().eq("id", id);
    if (error) {
      toast.error("Couldn't delete session");
      return;
    }
    setSessions((prev) => prev.filter((s) => s.id !== id));
    toast.success("Session removed");
  };

  if (loading) {
    return (
      <div className="rounded-lg panel-gradient p-4 studio-border">
        <div className="flex items-center gap-2 mb-2">
          <History className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Session History</h3>
        </div>
        <p className="text-xs text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-lg panel-gradient p-4 studio-border">
        <div className="flex items-center gap-2 mb-2">
          <History className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Session History</h3>
        </div>
        <p className="text-xs text-muted-foreground">No sessions yet. Process a file to start building memory.</p>
      </div>
    );
  }

  const summary = derivePreferenceSummary(sessions);

  return (
    <div className="rounded-lg panel-gradient p-4 studio-border space-y-3">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-primary" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Session Memory ({sessions.length})
        </h3>
      </div>

      {/* Preference summary */}
      {summary.totalSessions >= 2 && (
        <div className="rounded-md bg-primary/5 border border-primary/20 p-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-3 w-3 text-primary" />
            <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">Learned Preferences</span>
          </div>
          {summary.avgFinalScore != null && (
            <p className="text-[11px] text-muted-foreground">
              Avg score: <span className="font-mono text-foreground">{summary.avgFinalScore}</span>/100
            </p>
          )}
          {Object.keys(summary.feedbackPatterns).length > 0 && (
            <div className="text-[11px] text-muted-foreground">
              <span>Top feedback: </span>
              {Object.entries(summary.feedbackPatterns)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 3)
                .map(([token, count]) => (
                  <Badge key={token} variant="secondary" className="text-[9px] mr-1 px-1.5 py-0">
                    {token.replace(/_/g, " ")} ({count}×)
                  </Badge>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Session list */}
      <ScrollArea className="max-h-64">
        <div className="space-y-1">
          {sessions.map((s) => {
            const isExpanded = expanded === s.id;
            const styleLabel = STYLE_LABELS[s.style_target as StyleTarget] ?? s.style_target;
            const date = new Date(s.created_at);
            const feedbackCount = Array.isArray(s.feedback_history) ? s.feedback_history.length : 0;

            return (
              <div key={s.id} className="rounded-md border border-border bg-card">
                <button
                  onClick={() => setExpanded(isExpanded ? null : s.id)}
                  className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-accent/50 transition-colors"
                >
                  <Music className="h-3 w-3 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{s.file_name}</p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <Clock className="h-2.5 w-2.5" />
                      <span>{date.toLocaleDateString()}</span>
                      <span>·</span>
                      <span>{styleLabel}</span>
                      {s.final_score != null && (
                        <>
                          <span>·</span>
                          <span className="font-mono">{s.final_score}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
                </button>

                {isExpanded && (
                  <div className="px-2.5 pb-2.5 pt-1 border-t border-border space-y-2">
                    {s.unified_report && (
                      <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-4">
                        {s.unified_report}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="outline" className="text-[9px]">{s.mode}</Badge>
                      {s.model_used && <Badge variant="outline" className="text-[9px]">{s.model_used}</Badge>}
                      {feedbackCount > 0 && (
                        <Badge variant="secondary" className="text-[9px]">{feedbackCount} revision{feedbackCount > 1 ? "s" : ""}</Badge>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] text-destructive hover:text-destructive gap-1 px-1.5"
                      onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                      Remove
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
