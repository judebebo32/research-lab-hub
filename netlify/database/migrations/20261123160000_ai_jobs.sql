-- AI import jobs for the tenure & promotion record (input files live in Netlify Blobs).
CREATE TABLE ai_jobs (
  id SERIAL PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES members(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'error')),
  source_name TEXT,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
