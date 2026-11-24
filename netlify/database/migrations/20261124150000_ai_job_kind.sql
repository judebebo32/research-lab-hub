-- AI jobs now cover tenure imports and AI-drafted protocols.
ALTER TABLE ai_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'tenure' CHECK (kind IN ('tenure', 'protocol'));
