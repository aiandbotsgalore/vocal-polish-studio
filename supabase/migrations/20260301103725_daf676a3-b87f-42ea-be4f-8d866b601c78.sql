
-- Persistent history: stores every processing session for cross-song learning
CREATE TABLE public.processing_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  duration_seconds NUMERIC,
  style_target TEXT NOT NULL DEFAULT 'natural',
  mode TEXT NOT NULL DEFAULT 'safe',
  analysis JSONB,
  gemini_decision JSONB,
  feedback_history JSONB DEFAULT '[]'::jsonb,
  final_score NUMERIC,
  scoring_metrics JSONB,
  model_used TEXT,
  clamps_applied JSONB DEFAULT '[]'::jsonb,
  unified_report TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS (single-user prototype — public access)
ALTER TABLE public.processing_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON public.processing_sessions FOR SELECT USING (true);
CREATE POLICY "Public insert access" ON public.processing_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update access" ON public.processing_sessions FOR UPDATE USING (true);
CREATE POLICY "Public delete access" ON public.processing_sessions FOR DELETE USING (true);

-- Index for recent sessions lookup
CREATE INDEX idx_sessions_created_at ON public.processing_sessions (created_at DESC);
CREATE INDEX idx_sessions_style_target ON public.processing_sessions (style_target);
