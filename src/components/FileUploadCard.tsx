import { useCallback, useState, type DragEvent, type ChangeEvent } from "react";
import { Upload, FileAudio } from "lucide-react";

interface FileUploadCardProps {
  onFileSelected: (file: File) => void;
  currentFile: File | null;
}

export function FileUploadCard({ onFileSelected, currentFile }: FileUploadCardProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.type === "audio/wav" || file.type === "audio/mpeg" || file.name.endsWith(".wav") || file.name.endsWith(".mp3"))) {
      onFileSelected(file);
    }
  }, [onFileSelected]);

  const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelected(file);
  }, [onFileSelected]);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`
        relative rounded-lg border-2 border-dashed p-8 text-center
        transition-all duration-200 cursor-pointer
        ${isDragging
          ? "border-primary bg-primary/5 glow-primary-sm"
          : "border-border hover:border-muted-foreground"
        }
      `}
      onClick={() => document.getElementById("audio-file-input")?.click()}
    >
      <input
        id="audio-file-input"
        type="file"
        accept=".wav,.mp3,audio/wav,audio/mpeg"
        className="hidden"
        onChange={handleChange}
      />
      {currentFile ? (
        <div className="flex items-center justify-center gap-3">
          <FileAudio className="h-8 w-8 text-primary" />
          <div className="text-left">
            <p className="text-sm font-medium text-foreground">{currentFile.name}</p>
            <p className="text-xs text-muted-foreground">
              {(currentFile.size / (1024 * 1024)).toFixed(2)} MB — Click or drop to replace
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <Upload className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">Drop a vocal file here</p>
            <p className="text-xs text-muted-foreground">WAV or MP3 • Click to browse</p>
          </div>
        </div>
      )}
    </div>
  );
}
