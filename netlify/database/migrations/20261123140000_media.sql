-- Photos and videos embedded in protocols. File bytes live in Netlify Blobs
-- (store "protocol-media", keys "<id>/<chunk>"); this table holds the metadata.
CREATE TABLE media (
  id SERIAL PRIMARY KEY,
  protocol_id INTEGER REFERENCES protocols(id) ON DELETE SET NULL,
  owner_id TEXT NOT NULL REFERENCES members(id),
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  size BIGINT NOT NULL,
  chunk_size INTEGER NOT NULL,
  chunks INTEGER NOT NULL,
  complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX media_protocol_idx ON media(protocol_id);
