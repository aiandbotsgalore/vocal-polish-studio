import { useRef, useEffect, useState, useCallback } from "react";

interface Props {
  originalBuffer: AudioBuffer | null;
  processedBuffer: AudioBuffer | null;
}

function downsample(data: Float32Array, width: number): { min: number; max: number }[] {
  const bucketSize = Math.ceil(data.length / width);
  const result: { min: number; max: number }[] = [];
  for (let i = 0; i < width; i++) {
    let mn = 1, mx = -1;
    const start = i * bucketSize;
    const end = Math.min(start + bucketSize, data.length);
    for (let j = start; j < end; j++) {
      if (data[j] < mn) mn = data[j];
      if (data[j] > mx) mx = data[j];
    }
    result.push({ min: mn, max: mx });
  }
  return result;
}

export function WaveformComparison({ originalBuffer, processedBuffer }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [sliderX, setSliderX] = useState(0.5); // 0–1 ratio
  const dragging = useRef(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = canvas;
    const mid = height / 2;
    ctx.clearRect(0, 0, width, height);

    const drawWave = (buf: AudioBuffer, color: string, clipStart: number, clipEnd: number) => {
      const data = buf.getChannelData(0);
      const samples = downsample(data, width);
      ctx.save();
      ctx.beginPath();
      ctx.rect(clipStart, 0, clipEnd - clipStart, height);
      ctx.clip();
      ctx.fillStyle = color;
      for (let i = 0; i < samples.length; i++) {
        const top = mid + samples[i].min * mid;
        const bottom = mid + samples[i].max * mid;
        ctx.fillRect(i, top, 1, bottom - top || 1);
      }
      ctx.restore();
    };

    // Original full width in gray
    if (originalBuffer) {
      drawWave(originalBuffer, "hsl(215 15% 50% / 0.5)", 0, width);
    }
    // Processed from slider to right in primary
    if (processedBuffer) {
      const sx = Math.round(sliderX * width);
      drawWave(processedBuffer, "hsl(var(--primary))", sx, width);
    }

    // Divider line
    const dx = Math.round(sliderX * width);
    ctx.fillStyle = "hsl(var(--primary))";
    ctx.fillRect(dx - 1, 0, 2, height);
    // Pill handle
    const pillH = 28, pillW = 14;
    const py = mid - pillH / 2;
    ctx.beginPath();
    ctx.roundRect(dx - pillW / 2, py, pillW, pillH, 7);
    ctx.fillStyle = "hsl(var(--primary))";
    ctx.fill();
    ctx.fillStyle = "hsl(var(--primary-foreground))";
    ctx.fillRect(dx - 2, mid - 4, 1, 8);
    ctx.fillRect(dx + 1, mid - 4, 1, 8);
  }, [originalBuffer, processedBuffer, sliderX]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = container.clientWidth;
      canvas.height = 120;
      draw();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  useEffect(() => { draw(); }, [draw]);

  const handlePointer = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSliderX(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative rounded-lg studio-border bg-card overflow-hidden cursor-col-resize select-none"
      onPointerDown={(e) => { dragging.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); handlePointer(e); }}
      onPointerMove={(e) => { if (dragging.current) handlePointer(e); }}
      onPointerUp={() => { dragging.current = false; }}
    >
      <canvas ref={canvasRef} className="block w-full" style={{ height: 120 }} />
      <div className="absolute bottom-2 left-3 text-[10px] text-muted-foreground">Original</div>
      <div className="absolute bottom-2 right-3 text-[10px] text-primary font-medium">Processed</div>
    </div>
  );
}
