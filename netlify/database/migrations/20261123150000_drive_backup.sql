-- App-wide settings (Google Drive backup connection, internal secrets).
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Which photos/videos have already been copied to Google Drive.
ALTER TABLE media ADD COLUMN drive_file_id TEXT;
