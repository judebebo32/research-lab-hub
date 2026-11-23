-- Owner (the PI) controls admins; each admin gets specific permissions.
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_role_check;
UPDATE members SET role = 'owner' WHERE role = 'admin';
ALTER TABLE members ADD CONSTRAINT members_role_check CHECK (role IN ('owner', 'admin', 'student'));
ALTER TABLE members ADD COLUMN permissions TEXT[] NOT NULL DEFAULT '{}';

-- Emails the owner has pre-approved as admins (applied at their first sign-in).
CREATE TABLE access_grants (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'student')),
  permissions TEXT[] NOT NULL DEFAULT '{}',
  created_by TEXT REFERENCES members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
