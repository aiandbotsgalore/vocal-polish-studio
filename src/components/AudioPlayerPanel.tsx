interface AudioPlayerPanelProps {
  label: string;
  url: string | null;
  accent?: boolean;
}

export function AudioPlayerPanel({ label, url, accent }: AudioPlayerPanelProps) {
  return (
    <div className={`rounded-lg p-4 studio-border ${accent ? "panel-gradient glow-primary-sm" : "bg-card"}`}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      {url ? (
        <audio controls src={url} className="w-full h-10 [&::-webkit-media-controls-panel]:bg-secondary [&::-webkit-media-controls-panel]:rounded-md" />
      ) : (
        <div className="flex h-10 items-center justify-center rounded-md bg-secondary/50">
          <span className="text-xs text-muted-foreground">No audio loaded</span>
        </div>
      )}
    </div>
  );
}
