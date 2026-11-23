-- Lab members (one row per Netlify Identity user)
CREATE TABLE members (
  id TEXT PRIMARY KEY,                 -- Netlify Identity user id
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'student')),
  position TEXT,                       -- e.g. PhD student, MS student, postdoc, undergrad
  start_date DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ
);

-- Experimental protocols
CREATE TABLE protocols (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  project TEXT,
  experiment TEXT,
  objective TEXT,
  materials TEXT,
  equipment TEXT,
  steps TEXT,
  safety TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'changes_requested', 'approved', 'archived')),
  version INTEGER NOT NULL DEFAULT 1,
  author_id TEXT NOT NULL REFERENCES members(id),
  reviewed_by TEXT REFERENCES members(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX protocols_author_idx ON protocols(author_id);
CREATE INDEX protocols_status_idx ON protocols(status);

-- Full snapshot of every saved version, so nothing is ever lost
CREATE TABLE protocol_versions (
  id SERIAL PRIMARY KEY,
  protocol_id INTEGER NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  edited_by TEXT NOT NULL REFERENCES members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX protocol_versions_pid_idx ON protocol_versions(protocol_id);

-- Review comments and discussion on a protocol
CREATE TABLE protocol_comments (
  id SERIAL PRIMARY KEY,
  protocol_id INTEGER NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES members(id),
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'review')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX protocol_comments_pid_idx ON protocol_comments(protocol_id);

-- Lab inventory (general / mixed lab)
CREATE TABLE inventory_items (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Other',
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit TEXT,
  min_quantity NUMERIC,                -- low-stock threshold
  location TEXT,
  supplier TEXT,
  catalog_number TEXT,
  lot_number TEXT,
  cas_number TEXT,
  expiry_date DATE,
  hazard TEXT,
  notes TEXT,
  created_by TEXT REFERENCES members(id),
  updated_by TEXT REFERENCES members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every stock change, so usage can be traced
CREATE TABLE inventory_transactions (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id),
  change NUMERIC NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Automatic activity feed (who did what, when)
CREATE TABLE activity_log (
  id SERIAL PRIMARY KEY,
  member_id TEXT REFERENCES members(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX activity_log_member_idx ON activity_log(member_id);
CREATE INDEX activity_log_created_idx ON activity_log(created_at DESC);

-- PI activity record for tenure & promotion (admin only)
CREATE TABLE pi_activities (
  id SERIAL PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES members(id),
  category TEXT NOT NULL CHECK (category IN
    ('publication', 'grant', 'teaching', 'service', 'mentoring', 'presentation', 'award', 'outreach', 'other')),
  title TEXT NOT NULL,
  details TEXT,
  role TEXT,                           -- e.g. PI, co-PI, first author, chair
  start_date DATE,
  end_date DATE,
  amount NUMERIC,                      -- grant dollars
  status TEXT,                         -- e.g. submitted, funded, published, in review
  link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX pi_activities_owner_idx ON pi_activities(owner_id);
