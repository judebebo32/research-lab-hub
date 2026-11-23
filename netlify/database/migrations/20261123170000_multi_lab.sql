-- Multi-lab platform: many labs on one site, each with its own members and data.

CREATE TABLE labs (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name TEXT NOT NULL,
  institution TEXT,
  department TEXT,
  website TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'rejected', 'suspended')),
  requested_by TEXT REFERENCES members(id),
  request_note TEXT,
  decision_note TEXT,
  storage_limit_mb INTEGER,          -- NULL = unlimited
  ai_monthly_limit INTEGER,          -- NULL = unlimited
  legacy_import BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  decided_by TEXT REFERENCES members(id)
);

CREATE TABLE lab_members (
  lab_id INTEGER NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('owner', 'admin', 'student')),
  permissions TEXT[] NOT NULL DEFAULT '{}',
  position TEXT,
  start_date DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lab_id, member_id)
);
CREATE INDEX lab_members_member_idx ON lab_members(member_id);

ALTER TABLE members ADD COLUMN is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing single-lab installs become lab #1 (renamed from LAB_NAME on first use).
INSERT INTO labs (slug, name, status, legacy_import, decided_at)
SELECT 'my-lab', 'My Lab', 'active', TRUE, NOW() WHERE EXISTS (SELECT 1 FROM members);

INSERT INTO lab_members (lab_id, member_id, role, permissions, position, start_date, active)
SELECT l.id, m.id, m.role, m.permissions, m.position, m.start_date, m.active
FROM members m CROSS JOIN labs l WHERE l.legacy_import;

-- Lab-owned data gets a lab_id.
ALTER TABLE protocols ADD COLUMN lab_id INTEGER REFERENCES labs(id) ON DELETE CASCADE;
ALTER TABLE inventory_items ADD COLUMN lab_id INTEGER REFERENCES labs(id) ON DELETE CASCADE;
ALTER TABLE activity_log ADD COLUMN lab_id INTEGER REFERENCES labs(id) ON DELETE CASCADE;
ALTER TABLE media ADD COLUMN lab_id INTEGER REFERENCES labs(id) ON DELETE CASCADE;
ALTER TABLE ai_jobs ADD COLUMN lab_id INTEGER REFERENCES labs(id) ON DELETE SET NULL;

UPDATE protocols SET lab_id = (SELECT id FROM labs WHERE legacy_import);
UPDATE inventory_items SET lab_id = (SELECT id FROM labs WHERE legacy_import);
UPDATE activity_log SET lab_id = (SELECT id FROM labs WHERE legacy_import);
UPDATE media SET lab_id = (SELECT id FROM labs WHERE legacy_import);
UPDATE ai_jobs SET lab_id = (SELECT id FROM labs WHERE legacy_import);

ALTER TABLE protocols ALTER COLUMN lab_id SET NOT NULL;
ALTER TABLE inventory_items ALTER COLUMN lab_id SET NOT NULL;
ALTER TABLE media ALTER COLUMN lab_id SET NOT NULL;
CREATE INDEX protocols_lab_idx ON protocols(lab_id);
CREATE INDEX inventory_lab_idx ON inventory_items(lab_id);
CREATE INDEX activity_lab_idx ON activity_log(lab_id);
CREATE INDEX media_lab_idx ON media(lab_id);

-- Invitations are now per lab (students or admins).
ALTER TABLE access_grants DROP CONSTRAINT access_grants_pkey;
ALTER TABLE access_grants ADD COLUMN lab_id INTEGER REFERENCES labs(id) ON DELETE CASCADE;
UPDATE access_grants SET lab_id = (SELECT id FROM labs WHERE legacy_import);
DELETE FROM access_grants WHERE lab_id IS NULL;
ALTER TABLE access_grants ALTER COLUMN lab_id SET NOT NULL;
ALTER TABLE access_grants ADD PRIMARY KEY (lab_id, email);

-- Google Drive backup settings are per lab.
UPDATE app_settings SET key = 'google:' || (SELECT id FROM labs WHERE legacy_import)
WHERE key = 'google' AND EXISTS (SELECT 1 FROM labs WHERE legacy_import);
