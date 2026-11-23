// Single API router for the lab app. Every request is authenticated with
// Netlify Identity and authorized against the `members` table.
import { getUser } from "@netlify/identity";
import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";
import { exportAll, getSetting, setSetting, patchSetting, DRIVE_SCOPE, exchangeCode, googleAccessToken, driveUser,
  createFolder, triggerBackgroundBackup, internalSecret, labName } from "../../lib/backup.mjs";
import { aiInputs } from "../../lib/tenureAi.mjs";

const db = getDatabase();
const sql = db.sql;

// ---------- helpers ----------
const json = (data, status = 200) => Response.json(data, { status });
const err = (message, status = 400) => json({ error: message }, status);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const deny = (msg = "Forbidden") => { throw new HttpError(403, msg); };
const notFound = () => { throw new HttpError(404, "Not found"); };

const adminEmails = () =>
  (Netlify.env.get("ADMIN_EMAILS") || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const clean = (v) => (v === undefined || v === "" ? null : v);
const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));

const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const DEFAULT_LIMITS = { storage_limit_mb: 2048, ai_monthly_limit: 5 };

// One-time: a single-lab install that was upgraded gets its LAB_NAME as the lab's name.
let legacyChecked = false;
async function renameLegacyLab() {
  if (legacyChecked) return;
  legacyChecked = true;
  const [lab] = await sql`SELECT id FROM labs WHERE legacy_import`;
  if (!lab) return;
  const name = Netlify.env.get("LAB_NAME") || "My Lab";
  let slug = slugify(name);
  if (!SLUG_RE.test(slug)) slug = "my-lab";
  const [taken] = await sql`SELECT 1 FROM labs WHERE slug = ${slug} AND id <> ${lab.id}`;
  if (taken) slug = `${slug.slice(0, 34)}-${lab.id}`;
  await sql`UPDATE labs SET name = ${name}, slug = ${slug}, legacy_import = FALSE WHERE id = ${lab.id}`;
}

// The signed-in person, their labs, and any lab requests they've made.
async function currentUser() {
  const user = await getUser();
  if (!user || !user.email) throw new HttpError(401, "Please log in");
  const email = user.email.toLowerCase();
  const platformAdmin = adminEmails().includes(email);
  const name = user.name || user.userMetadata?.full_name || null;
  await renameLegacyLab();
  const [me] = await sql`
    INSERT INTO members (id, email, full_name, is_platform_admin, last_seen)
    VALUES (${user.id}, ${email}, ${name}, ${platformAdmin}, NOW())
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = COALESCE(members.full_name, EXCLUDED.full_name),
      is_platform_admin = ${platformAdmin},
      last_seen = NOW()
    RETURNING id, email, full_name, is_platform_admin, active, created_at, last_seen`;
  if (!me.active) throw new HttpError(403, "Your account has been suspended");
  // Lab invitations waiting for this email become memberships.
  const grants = await sql`
    SELECT g.* FROM access_grants g JOIN labs l ON l.id = g.lab_id WHERE g.email = ${email} AND l.status = 'active'`;
  for (const g of grants) {
    await sql`
      INSERT INTO lab_members (lab_id, member_id, role, permissions, active)
      VALUES (${g.lab_id}, ${me.id}, ${g.role}, ${g.permissions}, TRUE)
      ON CONFLICT (lab_id, member_id) DO UPDATE SET
        role = CASE WHEN lab_members.role = 'owner' THEN 'owner' ELSE EXCLUDED.role END,
        permissions = EXCLUDED.permissions, active = TRUE`;
    await sql`DELETE FROM access_grants WHERE lab_id = ${g.lab_id} AND email = ${email}`;
    await sql`INSERT INTO activity_log (member_id, lab_id, action, entity_type, entity_id, summary)
              VALUES (${me.id}, ${g.lab_id}, 'member_joined', 'member', ${me.id}, ${me.full_name || me.email})`;
  }
  me.labs = await sql`
    SELECT lm.lab_id, lm.role, lm.permissions, lm.position, lm.start_date, l.name, l.slug, l.institution, l.department
    FROM lab_members lm JOIN labs l ON l.id = lm.lab_id
    WHERE lm.member_id = ${me.id} AND lm.active AND l.status = 'active'
    ORDER BY (lm.role = 'owner') DESC, l.name`;
  me.requests = await sql`
    SELECT id, name, slug, institution, department, status, decision_note, created_at FROM labs
    WHERE requested_by = ${me.id} AND status IN ('pending', 'rejected') ORDER BY created_at DESC`;
  me.has_tenure = me.labs.some((l) => l.role === "owner" || (l.role === "admin" && l.permissions.includes("tenure")));
  return me;
}

// Attach the lab this request is for (X-Lab-Id header, else the person's first lab).
function inLab(user, labId) {
  const m = user.labs.find((l) => l.lab_id === Number(labId)) || (labId == null ? user.labs[0] : null);
  if (!m) return null;
  const me = { ...user, lab_id: m.lab_id, lab: m, role: m.role, permissions: m.permissions, position: m.position };
  me.can = effectivePerms(me);
  return me;
}

async function log(me, action, entityType, entityId, summary, labId = me.lab_id ?? null) {
  await sql`
    INSERT INTO activity_log (member_id, lab_id, action, entity_type, entity_id, summary)
    VALUES (${me.id}, ${labId}, ${action}, ${entityType}, ${entityId == null ? null : String(entityId)}, ${summary})`;
}

// ---------- permissions ----------
export const PERMISSIONS = {
  review_protocols: "Review & approve protocols (sees all protocols)",
  edit_protocols: "Edit any member's protocol",
  manage_inventory: "Remove inventory items",
  view_activity: "See all members' activity",
  manage_members: "Manage student profiles (position, active)",
  tenure: "Own private tenure & promotion tracker",
};
const ALL_PERMS = Object.keys(PERMISSIONS);
const isOwner = (me) => me.role === "owner";
function effectivePerms(me) {
  if (me.role === "owner") return [...ALL_PERMS, "owner"];
  if (me.role === "admin") return (me.permissions || []).filter((p) => ALL_PERMS.includes(p));
  return [];
}
const can = (me, perm) => (perm === "tenure" ? !!me.has_tenure : effectivePerms(me).includes(perm));
const requirePerm = (me, perm) => { if (!can(me, perm)) deny("You don't have access to this"); };
const requireOwner = (me) => { if (!isOwner(me)) deny("Only the lab owner can do this"); };
const requirePlatformAdmin = (me) => { if (!me.is_platform_admin) deny("Platform admins only"); };
const cleanPerms = (list) => (Array.isArray(list) ? list.filter((p) => ALL_PERMS.includes(p)) : []);
const isStaff = (me) => me.role !== "student";

const PROTOCOL_FIELDS = ["title", "project", "experiment", "objective", "materials", "equipment", "steps", "safety", "notes"];

// ---------- media (photos & videos inside protocols) ----------
const MEDIA_CHUNK = 3 * 1024 * 1024;          // keeps each request/response under the function payload limit
const MEDIA_MAX = { image: MEDIA_CHUNK, video: 300 * 1024 * 1024 }; // photos are resized in the browser first
const MEDIA_TOKEN = /\[\[(image|video):(\d+)\]\]/g;
const mediaStore = () => getStore({ name: "protocol-media", consistency: "strong" });
const MEDIA_SRC = /\/api\/media\/(\d+)/g;
const mediaIdsIn = (obj) => {
  const ids = new Set();
  for (const f of PROTOCOL_FIELDS) {
    const t = String(obj[f] || "");
    for (const m of t.matchAll(MEDIA_TOKEN)) ids.add(Number(m[2]));
    for (const m of t.matchAll(MEDIA_SRC)) ids.add(Number(m[1]));
  }
  return [...ids];
};
// Attach newly uploaded media referenced in a protocol's text to that protocol.
async function linkMedia(me, protocol) {
  const ids = mediaIdsIn(protocol);
  if (!ids.length) return;
  await sql`UPDATE media SET protocol_id = ${protocol.id}
            WHERE id = ANY(${ids}::int[]) AND protocol_id IS NULL AND owner_id = ${me.id} AND lab_id = ${protocol.lab_id}`;
}

async function getProtocol(id, labId) {
  const rows = await sql`
    SELECT p.*, a.full_name AS author_name, a.email AS author_email,
           r.full_name AS reviewer_name
    FROM protocols p
    JOIN members a ON a.id = p.author_id
    LEFT JOIN members r ON r.id = p.reviewed_by
    WHERE p.id = ${id} AND p.lab_id = ${labId}`;
  return rows[0];
}
const seesAll = (me) => can(me, "review_protocols") || can(me, "edit_protocols");
const canView = (me, p) => p.author_id === me.id || p.status === "approved" || seesAll(me);
const canEdit = (me, p) => p.author_id === me.id || can(me, "edit_protocols");

// ---------- route handlers ----------
const routes = [];
// opts.lab: true (default) = needs a lab; false = no lab; "optional". opts.public = no login.
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  routes.push({ method, re, keys, handler, lab: opts.lab ?? true, public: !!opts.public });
};

// --- me ---
route("GET", "/me", async ({ me }) => json(me), { lab: "optional" });
route("PUT", "/me", async ({ me, body }) => {
  await sql`UPDATE members SET full_name = ${clean(body.full_name)} WHERE id = ${me.id}`;
  if (me.lab_id && "position" in body) {
    await sql`UPDATE lab_members SET position = ${clean(body.position)} WHERE lab_id = ${me.lab_id} AND member_id = ${me.id}`;
  }
  return json({ ok: true });
}, { lab: "optional" });

// --- dashboard ---
route("GET", "/dashboard", async ({ me }) => {
  const admin = can(me, "view_activity");
  const reviewer = can(me, "review_protocols");
  const myCounts = await sql`
    SELECT status, COUNT(*)::int AS n FROM protocols WHERE author_id = ${me.id} AND lab_id = ${me.lab_id} GROUP BY status`;
  const lowStock = await sql`
    SELECT id, name, quantity, unit, min_quantity, location FROM inventory_items
    WHERE lab_id = ${me.lab_id} AND min_quantity IS NOT NULL AND quantity <= min_quantity ORDER BY name LIMIT 20`;
  const expiring = await sql`
    SELECT id, name, expiry_date, location FROM inventory_items
    WHERE lab_id = ${me.lab_id} AND expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE + INTERVAL '30 days'
    ORDER BY expiry_date LIMIT 20`;
  const recent = admin
    ? await sql`
        SELECT l.*, m.full_name, m.email FROM activity_log l
        LEFT JOIN members m ON m.id = l.member_id
        WHERE l.lab_id = ${me.lab_id}
        ORDER BY l.created_at DESC LIMIT 15`
    : await sql`
        SELECT l.*, m.full_name, m.email FROM activity_log l
        LEFT JOIN members m ON m.id = l.member_id
        WHERE l.member_id = ${me.id} AND l.lab_id = ${me.lab_id} ORDER BY l.created_at DESC LIMIT 10`;
  const needsAttention = reviewer
    ? await sql`
        SELECT p.id, p.title, p.updated_at, m.full_name AS author_name, m.email AS author_email
        FROM protocols p JOIN members m ON m.id = p.author_id
        WHERE p.status = 'submitted' AND p.lab_id = ${me.lab_id} ORDER BY p.updated_at`
    : await sql`
        SELECT id, title, updated_at FROM protocols
        WHERE author_id = ${me.id} AND lab_id = ${me.lab_id} AND status = 'changes_requested' ORDER BY updated_at DESC`;
  let lab = null;
  if (admin || reviewer) {
    const [m] = await sql`SELECT COUNT(*)::int AS n FROM lab_members WHERE lab_id = ${me.lab_id} AND active`;
    const [p] = await sql`SELECT COUNT(*)::int AS n FROM protocols WHERE lab_id = ${me.lab_id} AND status <> 'archived'`;
    const [i] = await sql`SELECT COUNT(*)::int AS n FROM inventory_items WHERE lab_id = ${me.lab_id}`;
    const [a] = await sql`SELECT COUNT(*)::int AS n FROM activity_log WHERE lab_id = ${me.lab_id} AND created_at > NOW() - INTERVAL '7 days'`;
    lab = { members: m.n, protocols: p.n, items: i.n, activity7d: a.n };
  }
  return json({ myCounts, lowStock, expiring, recent, needsAttention, lab, reviewer });
});

// --- protocols ---
route("GET", "/protocols", async ({ me, query }) => {
  const status = query.get("status") || null;
  const scope = query.get("scope") || (seesAll(me) ? "all" : "mine"); // mine | library | all
  let rows;
  if (scope === "mine") {
    rows = await sql`
      SELECT p.id, p.title, p.project, p.experiment, p.status, p.version, p.updated_at,
             m.full_name AS author_name, m.email AS author_email
      FROM protocols p JOIN members m ON m.id = p.author_id
      WHERE p.lab_id = ${me.lab_id} AND p.author_id = ${me.id} AND (${status}::text IS NULL OR p.status = ${status})
      ORDER BY p.updated_at DESC`;
  } else if (scope === "library" || !seesAll(me)) {
    rows = await sql`
      SELECT p.id, p.title, p.project, p.experiment, p.status, p.version, p.updated_at,
             m.full_name AS author_name, m.email AS author_email
      FROM protocols p JOIN members m ON m.id = p.author_id
      WHERE p.lab_id = ${me.lab_id} AND p.status = 'approved'
      ORDER BY p.title`;
  } else {
    rows = await sql`
      SELECT p.id, p.title, p.project, p.experiment, p.status, p.version, p.updated_at,
             m.full_name AS author_name, m.email AS author_email
      FROM protocols p JOIN members m ON m.id = p.author_id
      WHERE p.lab_id = ${me.lab_id} AND (${status}::text IS NULL OR p.status = ${status})
      ORDER BY p.updated_at DESC`;
  }
  return json(rows);
});

route("POST", "/protocols", async ({ me, body }) => {
  if (!body.title?.trim()) return err("Title is required");
  const status = body.submit ? "submitted" : "draft";
  const [p] = await sql`
    INSERT INTO protocols (lab_id, title, project, experiment, objective, materials, equipment, steps, safety, notes, status, author_id)
    VALUES (${me.lab_id}, ${body.title.trim()}, ${clean(body.project)}, ${clean(body.experiment)}, ${clean(body.objective)},
            ${clean(body.materials)}, ${clean(body.equipment)}, ${clean(body.steps)}, ${clean(body.safety)},
            ${clean(body.notes)}, ${status}, ${me.id})
    RETURNING *`;
  await sql`
    INSERT INTO protocol_versions (protocol_id, version, snapshot, edited_by)
    VALUES (${p.id}, 1, ${JSON.stringify(p)}, ${me.id})`;
  await linkMedia(me, p);
  await log(me, status === "submitted" ? "protocol_submitted" : "protocol_created", "protocol", p.id, p.title);
  return json(p, 201);
});

route("GET", "/protocols/:id", async ({ me, params }) => {
  const p = await getProtocol(params.id, me.lab_id);
  if (!p) notFound();
  if (!canView(me, p)) deny();
  const comments = await sql`
    SELECT c.*, m.full_name, m.email,
      (SELECT lm.role FROM lab_members lm WHERE lm.lab_id = ${me.lab_id} AND lm.member_id = c.author_id) AS role
    FROM protocol_comments c
    JOIN members m ON m.id = c.author_id
    WHERE c.protocol_id = ${p.id} ORDER BY c.created_at`;
  const versions = await sql`
    SELECT v.id, v.version, v.created_at, m.full_name, m.email FROM protocol_versions v
    JOIN members m ON m.id = v.edited_by
    WHERE v.protocol_id = ${p.id} ORDER BY v.version DESC`;
  return json({ ...p, comments, versions, can_edit: canEdit(me, p), can_review: can(me, "review_protocols") });
});

route("GET", "/protocols/:id/versions/:v", async ({ me, params }) => {
  const p = await getProtocol(params.id, me.lab_id);
  if (!p) notFound();
  if (!canView(me, p)) deny();
  const [v] = await sql`
    SELECT * FROM protocol_versions WHERE protocol_id = ${p.id} AND version = ${Number(params.v)}`;
  if (!v) notFound();
  return json(v);
});

route("PUT", "/protocols/:id", async ({ me, body, params }) => {
  const p = await getProtocol(params.id, me.lab_id);
  if (!p) notFound();
  if (!canEdit(me, p)) deny();
  if (p.status === "archived") return err("Archived protocols cannot be edited");
  const next = {};
  for (const f of PROTOCOL_FIELDS) next[f] = f in body ? clean(body[f]) : p[f];
  if (!next.title?.trim()) return err("Title is required");
  // A student editing an approved protocol sends it back for review.
  let status = p.status;
  const reviewer = can(me, "review_protocols");
  if (!reviewer && p.status === "approved") status = "submitted";
  if (body.submit && !reviewer) status = "submitted";
  const [u] = await sql`
    UPDATE protocols SET
      title = ${next.title}, project = ${next.project}, experiment = ${next.experiment},
      objective = ${next.objective}, materials = ${next.materials}, equipment = ${next.equipment},
      steps = ${next.steps}, safety = ${next.safety}, notes = ${next.notes},
      status = ${status}, version = version + 1, updated_at = NOW()
    WHERE id = ${p.id} RETURNING *`;
  await sql`
    INSERT INTO protocol_versions (protocol_id, version, snapshot, edited_by)
    VALUES (${u.id}, ${u.version}, ${JSON.stringify(u)}, ${me.id})`;
  await linkMedia(me, u);
  const by = p.author_id === me.id ? "" : ` (edited by ${me.full_name || me.email})`;
  await log(me, "protocol_edited", "protocol", u.id, `${u.title} → v${u.version}${by}`);
  if (status === "submitted" && p.status !== "submitted") {
    await log(me, "protocol_submitted", "protocol", u.id, u.title);
  }
  return json(u);
});

route("POST", "/protocols/:id/submit", async ({ me, params }) => {
  const p = await getProtocol(params.id, me.lab_id);
  if (!p) notFound();
  if (p.author_id !== me.id && !can(me, "edit_protocols")) deny();
  if (!["draft", "changes_requested"].includes(p.status)) return err("Only drafts or protocols with requested changes can be submitted");
  await sql`UPDATE protocols SET status = 'submitted', updated_at = NOW() WHERE id = ${p.id}`;
  await log(me, "protocol_submitted", "protocol", p.id, p.title);
  return json({ ok: true });
});

route("POST", "/protocols/:id/review", async ({ me, body, params }) => {
  requirePerm(me, "review_protocols");
  const p = await getProtocol(params.id, me.lab_id);
  if (!p) notFound();
  const decision = body.decision;
  if (!["approved", "changes_requested"].includes(decision)) return err("Decision must be approved or changes_requested");
  await sql`
    UPDATE protocols SET status = ${decision}, reviewed_by = ${me.id}, reviewed_at = NOW(), updated_at = NOW()
    WHERE id = ${p.id}`;
  const label = decision === "approved" ? "Approved" : "Changes requested";
  await sql`
    INSERT INTO protocol_comments (protocol_id, author_id, body, kind)
    VALUES (${p.id}, ${me.id}, ${`${label}${body.comment ? ": " + body.comment : ""}`}, 'review')`;
  await log(me, decision === "approved" ? "protocol_approved" : "protocol_changes_requested", "protocol", p.id,
    `${p.title} (${p.author_name || p.author_email})`);
  return json({ ok: true });
});

route("POST", "/protocols/:id/comments", async ({ me, body, params }) => {
  const p = await getProtocol(params.id, me.lab_id);
  if (!p) notFound();
  if (!canView(me, p)) deny();
  if (!body.body?.trim()) return err("Comment is empty");
  const [c] = await sql`
    INSERT INTO protocol_comments (protocol_id, author_id, body) VALUES (${p.id}, ${me.id}, ${body.body.trim()})
    RETURNING *`;
  await log(me, "protocol_commented", "protocol", p.id, p.title);
  return json(c, 201);
});

route("POST", "/protocols/:id/archive", async ({ me, params }) => {
  const p = await getProtocol(params.id, me.lab_id);
  if (!p) notFound();
  if (!canEdit(me, p)) deny();
  await sql`UPDATE protocols SET status = 'archived', updated_at = NOW() WHERE id = ${p.id}`;
  await log(me, "protocol_archived", "protocol", p.id, p.title);
  return json({ ok: true });
});

route("POST", "/protocols/:id/duplicate", async ({ me, params }) => {
  const p = await getProtocol(params.id, me.lab_id);
  if (!p) notFound();
  if (!canView(me, p)) deny();
  const [n] = await sql`
    INSERT INTO protocols (lab_id, title, project, experiment, objective, materials, equipment, steps, safety, notes, status, author_id)
    VALUES (${me.lab_id}, ${"Copy of " + p.title}, ${p.project}, ${p.experiment}, ${p.objective}, ${p.materials},
            ${p.equipment}, ${p.steps}, ${p.safety}, ${p.notes}, 'draft', ${me.id})
    RETURNING *`;
  await sql`
    INSERT INTO protocol_versions (protocol_id, version, snapshot, edited_by)
    VALUES (${n.id}, 1, ${JSON.stringify(n)}, ${me.id})`;
  await log(me, "protocol_created", "protocol", n.id, `${n.title} (from #${p.id})`);
  return json(n, 201);
});

// --- inventory ---
route("GET", "/inventory", async ({ me, query }) => {
  const q = query.get("q") ? `%${query.get("q")}%` : null;
  const category = query.get("category") || null;
  const rows = await sql`
    SELECT i.*, m.full_name AS updated_by_name FROM inventory_items i
    LEFT JOIN members m ON m.id = i.updated_by
    WHERE i.lab_id = ${me.lab_id} AND (${q}::text IS NULL OR i.name ILIKE ${q} OR i.catalog_number ILIKE ${q} OR i.location ILIKE ${q} OR i.supplier ILIKE ${q})
      AND (${category}::text IS NULL OR i.category = ${category})
    ORDER BY i.category, i.name`;
  return json(rows);
});

const ITEM_FIELDS = ["name", "category", "unit", "location", "supplier", "catalog_number", "lot_number", "cas_number", "expiry_date", "hazard", "notes"];

route("POST", "/inventory", async ({ me, body }) => {
  if (!body.name?.trim()) return err("Name is required");
  const [i] = await sql`
    INSERT INTO inventory_items (lab_id, name, category, quantity, unit, min_quantity, location, supplier, catalog_number,
      lot_number, cas_number, expiry_date, hazard, notes, created_by, updated_by)
    VALUES (${me.lab_id}, ${body.name.trim()}, ${clean(body.category) || "Other"}, ${num(body.quantity) ?? 0}, ${clean(body.unit)},
      ${num(body.min_quantity)}, ${clean(body.location)}, ${clean(body.supplier)}, ${clean(body.catalog_number)},
      ${clean(body.lot_number)}, ${clean(body.cas_number)}, ${clean(body.expiry_date)}, ${clean(body.hazard)},
      ${clean(body.notes)}, ${me.id}, ${me.id})
    RETURNING *`;
  await log(me, "inventory_added", "inventory", i.id, `${i.name} (${i.quantity} ${i.unit || ""})`.trim());
  return json(i, 201);
});

route("PUT", "/inventory/:id", async ({ me, body, params }) => {
  const [cur] = await sql`SELECT * FROM inventory_items WHERE id = ${params.id} AND lab_id = ${me.lab_id}`;
  if (!cur) notFound();
  const n = {};
  for (const f of ITEM_FIELDS) n[f] = f in body ? clean(body[f]) : cur[f];
  const minq = "min_quantity" in body ? num(body.min_quantity) : cur.min_quantity;
  if (!n.name?.trim()) return err("Name is required");
  const [i] = await sql`
    UPDATE inventory_items SET name = ${n.name}, category = ${n.category || "Other"}, unit = ${n.unit},
      min_quantity = ${minq}, location = ${n.location}, supplier = ${n.supplier}, catalog_number = ${n.catalog_number},
      lot_number = ${n.lot_number}, cas_number = ${n.cas_number}, expiry_date = ${n.expiry_date},
      hazard = ${n.hazard}, notes = ${n.notes}, updated_by = ${me.id}, updated_at = NOW()
    WHERE id = ${cur.id} RETURNING *`;
  await log(me, "inventory_edited", "inventory", i.id, i.name);
  return json(i);
});

route("POST", "/inventory/:id/adjust", async ({ me, body, params }) => {
  const change = num(body.change);
  if (!change) return err("Enter a non-zero amount");
  const [i] = await sql`
    UPDATE inventory_items SET quantity = quantity + ${change}, updated_by = ${me.id}, updated_at = NOW()
    WHERE id = ${params.id} AND lab_id = ${me.lab_id} RETURNING *`;
  if (!i) notFound();
  await sql`
    INSERT INTO inventory_transactions (item_id, member_id, change, reason)
    VALUES (${i.id}, ${me.id}, ${change}, ${clean(body.reason)})`;
  const verb = change < 0 ? "used" : "restocked";
  await log(me, change < 0 ? "inventory_used" : "inventory_restocked", "inventory", i.id,
    `${verb} ${Math.abs(change)} ${i.unit || ""} of ${i.name}${body.reason ? " — " + body.reason : ""}`.replace(/\s+/g, " "));
  return json(i);
});

route("GET", "/inventory/:id/transactions", async ({ me, params }) => {
  const rows = await sql`
    SELECT t.*, m.full_name, m.email FROM inventory_transactions t
    JOIN members m ON m.id = t.member_id
    JOIN inventory_items i ON i.id = t.item_id AND i.lab_id = ${me.lab_id}
    WHERE t.item_id = ${params.id} ORDER BY t.created_at DESC LIMIT 100`;
  return json(rows);
});

route("DELETE", "/inventory/:id", async ({ me, params }) => {
  requirePerm(me, "manage_inventory");
  const [i] = await sql`DELETE FROM inventory_items WHERE id = ${params.id} AND lab_id = ${me.lab_id} RETURNING name`;
  if (!i) notFound();
  await log(me, "inventory_removed", "inventory", params.id, i.name);
  return json({ ok: true });
});

// --- media ---
route("POST", "/media", async ({ me, body }) => {
  const type = String(body.content_type || "");
  const kind = type.startsWith("image/") ? "image" : type.startsWith("video/") ? "video" : null;
  if (!kind) return err("Only photos and videos can be added");
  const size = Number(body.size);
  if (!size || size <= 0) return err("Empty file");
  if (size > MEDIA_MAX[kind]) return err(kind === "image" ? "That photo is too large even after resizing (max 3 MB). Try a JPG." : "That video is too large (max 300 MB). Trim it or upload a shorter clip.");
  const chunks = Math.ceil(size / MEDIA_CHUNK);
  const [lab] = await sql`SELECT storage_limit_mb FROM labs WHERE id = ${me.lab_id}`;
  if (lab.storage_limit_mb != null) {
    const [{ used }] = await sql`SELECT COALESCE(SUM(size), 0)::float AS used FROM media WHERE lab_id = ${me.lab_id}`;
    if (used + size > lab.storage_limit_mb * 1024 * 1024) {
      return err(`Your lab has used its ${lab.storage_limit_mb >= 1024 ? lab.storage_limit_mb / 1024 + " GB" : lab.storage_limit_mb + " MB"} of photo/video storage. Ask the platform admin for more space.`, 413);
    }
  }
  const [m] = await sql`
    INSERT INTO media (lab_id, owner_id, filename, content_type, kind, size, chunk_size, chunks)
    VALUES (${me.lab_id}, ${me.id}, ${String(body.filename || kind).slice(0, 200)}, ${type}, ${kind}, ${size}, ${MEDIA_CHUNK}, ${chunks})
    RETURNING *`;
  return json(m, 201);
});

route("PUT", "/media/:id/chunks/:n", async ({ me, params, req }) => {
  const [m] = await sql`SELECT * FROM media WHERE id = ${params.id}`;
  if (!m) notFound();
  if (m.owner_id !== me.id) deny();
  if (m.complete) return err("Upload already finished");
  const n = Number(params.n);
  if (!Number.isInteger(n) || n < 0 || n >= m.chunks) return err("Bad chunk number");
  const buf = await req.arrayBuffer();
  const expected = n === m.chunks - 1 ? Number(m.size) - n * m.chunk_size : m.chunk_size;
  if (buf.byteLength !== expected) return err(`Chunk ${n} should be ${expected} bytes, got ${buf.byteLength}`);
  await mediaStore().set(`${m.id}/${n}`, buf);
  return json({ ok: true });
});

route("POST", "/media/:id/complete", async ({ me, params }) => {
  const [m] = await sql`SELECT * FROM media WHERE id = ${params.id}`;
  if (!m) notFound();
  if (m.owner_id !== me.id) deny();
  const { blobs } = await mediaStore().list({ prefix: `${m.id}/` });
  if (blobs.length !== m.chunks) return err(`Upload incomplete (${blobs.length}/${m.chunks} parts)`);
  await sql`UPDATE media SET complete = TRUE WHERE id = ${m.id}`;
  await log(me, "media_uploaded", "media", m.id, `${m.kind}: ${m.filename}`);
  return json({ id: m.id, kind: m.kind, token: `[[${m.kind}:${m.id}]]` });
});

async function canViewMedia(user, m) {
  const me = inLab(user, m.lab_id);
  if (!me) return false; // not a member of the lab that owns this file
  if (m.owner_id === me.id || seesAll(me)) return true;
  if (m.protocol_id) {
    const p = await getProtocol(m.protocol_id, m.lab_id);
    if (p && canView(me, p)) return true;
  }
  // Also visible wherever it appears in an approved protocol (e.g. a duplicated protocol).
  const token = `%[[${m.kind}:${m.id}]]%`;
  const src = `%/api/media/${m.id}"%`;
  const [hit] = await sql`
    SELECT 1 FROM protocols WHERE status = 'approved' AND lab_id = ${m.lab_id}
      AND (concat_ws(' ', objective, materials, equipment, steps, safety, notes) LIKE ${token}
        OR concat_ws(' ', objective, materials, equipment, steps, safety, notes) LIKE ${src}) LIMIT 1`;
  return !!hit;
}

// Streams a file with HTTP Range support so videos can play and seek.
async function serveMedia(me, id, req) {
  const [m] = await sql`SELECT * FROM media WHERE id = ${id}`;
  if (!m || !m.complete) notFound();
  if (!(await canViewMedia(me, m))) deny();
  const size = Number(m.size), cs = m.chunk_size;
  let start = 0, end = size - 1, partial = false;
  const range = req.headers.get("range");
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (match) {
    partial = true;
    if (match[1] === "") { start = Math.max(0, size - Number(match[2])); }
    else { start = Number(match[1]); if (match[2] !== "") end = Math.min(Number(match[2]), size - 1); }
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
  }
  // Never send more than one stored chunk per response.
  const chunk = Math.floor(start / cs);
  const chunkEnd = Math.min((chunk + 1) * cs, size) - 1;
  if (end > chunkEnd) { end = chunkEnd; partial = true; }
  const data = await mediaStore().get(`${m.id}/${chunk}`, { type: "arrayBuffer" });
  if (!data) notFound();
  const body = data.slice(start - chunk * cs, end - chunk * cs + 1);
  const headers = {
    "Content-Type": m.content_type,
    "Content-Length": String(body.byteLength),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
    "Content-Disposition": `inline; filename="${m.filename.replace(/[^\w.\- ]/g, "_")}"`,
  };
  if (partial) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  return new Response(body, { status: partial ? 206 : 200, headers });
}
route("GET", "/media/:id", async ({ me, params, req }) => serveMedia(me, params.id, req), { lab: false });

// --- activity ---
route("GET", "/activity", async ({ me, query }) => {
  const limit = Math.min(Number(query.get("limit")) || 100, 500);
  const member = can(me, "view_activity") ? query.get("member") || null : me.id;
  const since = query.get("since") || null;
  const rows = await sql`
    SELECT l.*, m.full_name, m.email FROM activity_log l
    LEFT JOIN members m ON m.id = l.member_id
    WHERE l.lab_id = ${me.lab_id} AND (${member}::text IS NULL OR l.member_id = ${member})
      AND (${since}::date IS NULL OR l.created_at >= ${since}::date)
    ORDER BY l.created_at DESC LIMIT ${limit}`;
  return json(rows);
});

// --- members of the current lab ---
route("GET", "/members", async ({ me }) => {
  if (!can(me, "manage_members") && !can(me, "view_activity")) deny();
  const rows = await sql`
    SELECT m.id, m.email, m.full_name, m.last_seen, m.created_at,
      lm.role, lm.permissions, lm.position, lm.start_date, lm.active, lm.joined_at,
      (SELECT COUNT(*)::int FROM protocols p WHERE p.lab_id = lm.lab_id AND p.author_id = m.id AND p.status <> 'archived') AS protocol_count,
      (SELECT COUNT(*)::int FROM protocols p WHERE p.lab_id = lm.lab_id AND p.author_id = m.id AND p.status = 'approved') AS approved_count,
      (SELECT COUNT(*)::int FROM activity_log l WHERE l.lab_id = lm.lab_id AND l.member_id = m.id AND l.created_at > NOW() - INTERVAL '30 days') AS activity_30d,
      (SELECT MAX(l.created_at) FROM activity_log l WHERE l.lab_id = lm.lab_id AND l.member_id = m.id) AS last_activity
    FROM lab_members lm JOIN members m ON m.id = lm.member_id
    WHERE lm.lab_id = ${me.lab_id}
    ORDER BY lm.active DESC, (lm.role = 'owner') DESC, (lm.role = 'admin') DESC, m.full_name NULLS LAST, m.email`;
  return json(rows);
});

route("PUT", "/members/:id", async ({ me, body, params }) => {
  requirePerm(me, "manage_members");
  const [cur] = await sql`
    SELECT lm.*, m.full_name, m.email FROM lab_members lm JOIN members m ON m.id = lm.member_id
    WHERE lm.lab_id = ${me.lab_id} AND lm.member_id = ${params.id}`;
  if (!cur) notFound();
  const owner = isOwner(me);
  const self = cur.member_id === me.id;
  // Only the owner can change roles/permissions or touch other admins.
  if (!owner && cur.role !== "student") deny("Only the lab owner can change admin accounts");
  if (cur.role === "owner" && !self) deny("The owner account can't be changed");
  let role = cur.role, permissions = cur.permissions;
  if (owner && !self) {
    if (["admin", "student"].includes(body.role)) role = body.role;
    if ("permissions" in body) permissions = cleanPerms(body.permissions);
    if (role === "student") permissions = [];
  }
  const active = self ? cur.active : typeof body.active === "boolean" ? body.active : cur.active;
  if (owner && "full_name" in body && !self) {
    await sql`UPDATE members SET full_name = ${clean(body.full_name)} WHERE id = ${cur.member_id} AND full_name IS NULL`;
  }
  const [m] = await sql`
    UPDATE lab_members SET
      position = ${"position" in body ? clean(body.position) : cur.position},
      start_date = ${"start_date" in body ? clean(body.start_date) : cur.start_date},
      role = ${role}, permissions = ${permissions}, active = ${active}
    WHERE lab_id = ${me.lab_id} AND member_id = ${cur.member_id} RETURNING *`;
  const who = cur.full_name || cur.email;
  const permNote = m.role === "admin" ? ` [${m.permissions.join(", ") || "no permissions"}]` : "";
  await log(me, "member_updated", "member", cur.member_id, `${who}: ${m.role}${permNote}${m.active ? "" : ", removed from lab"}`);
  return json({ ...m, id: cur.member_id, email: cur.email, full_name: cur.full_name });
});

// --- invitations (owner: students & admins; manage_members: students) ---
const joinLink = (req, lab, email) => {
  const u = new URL("/join", req.url);
  u.searchParams.set("lab", lab.slug);
  u.searchParams.set("email", email);
  return u.href;
};
route("GET", "/access-grants", async ({ me, req }) => {
  if (!isOwner(me) && !can(me, "manage_members")) deny();
  const grants = await sql`SELECT * FROM access_grants WHERE lab_id = ${me.lab_id} ORDER BY created_at DESC`;
  return json({ grants: grants.map((g) => ({ ...g, link: joinLink(req, me.lab, g.email) })), permissions: PERMISSIONS });
});
route("POST", "/access-grants", async ({ me, body, req }) => {
  const role = body.role === "admin" ? "admin" : "student";
  if (role === "admin") requireOwner(me);
  else if (!isOwner(me) && !can(me, "manage_members")) deny();
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err("Enter a valid email");
  const perms = role === "admin" ? cleanPerms(body.permissions) : [];
  const [existing] = await sql`SELECT * FROM members WHERE email = ${email}`;
  const link = joinLink(req, me.lab, email);
  if (existing) {
    const [lm] = await sql`SELECT role FROM lab_members WHERE lab_id = ${me.lab_id} AND member_id = ${existing.id}`;
    if (lm?.role === "owner") return err("That's the lab owner's account");
    await sql`
      INSERT INTO lab_members (lab_id, member_id, role, permissions, active) VALUES (${me.lab_id}, ${existing.id}, ${role}, ${perms}, TRUE)
      ON CONFLICT (lab_id, member_id) DO UPDATE SET role = EXCLUDED.role, permissions = EXCLUDED.permissions, active = TRUE`;
    await log(me, "member_added", "member", existing.id, `${existing.full_name || email} as ${role}${role === "admin" ? ` [${perms.join(", ") || "no permissions"}]` : ""}`);
    return json({ applied: true, link });
  }
  const [g] = await sql`
    INSERT INTO access_grants (lab_id, email, role, permissions, created_by) VALUES (${me.lab_id}, ${email}, ${role}, ${perms}, ${me.id})
    ON CONFLICT (lab_id, email) DO UPDATE SET role = EXCLUDED.role, permissions = EXCLUDED.permissions, created_by = EXCLUDED.created_by, created_at = NOW()
    RETURNING *`;
  await log(me, "member_invited", "member", null, `${email} as ${role}`);
  return json({ applied: false, grant: g, link }, 201);
});
route("DELETE", "/access-grants/:email", async ({ me, params }) => {
  if (!isOwner(me) && !can(me, "manage_members")) deny();
  await sql`DELETE FROM access_grants WHERE lab_id = ${me.lab_id} AND email = ${params.email.toLowerCase()}`;
  return json({ ok: true });
});

// --- labs: public info, requests, settings ---
route("GET", "/public/labs/:slug", async ({ params }) => {
  const [lab] = await sql`SELECT name, slug, institution, department FROM labs WHERE slug = ${params.slug} AND status = 'active'`;
  if (!lab) notFound();
  return json(lab);
}, { public: true });

route("POST", "/labs/requests", async ({ me, body }) => {
  const name = String(body.name || "").trim();
  const slug = slugify(body.slug || name);
  if (name.length < 3) return err("Give your lab a name");
  if (!SLUG_RE.test(slug)) return err("The short name must be 3–40 letters, numbers or dashes");
  if (!String(body.institution || "").trim()) return err("Add your institution");
  if (!body.agree) return err("Please confirm the platform terms");
  const [pending] = await sql`SELECT COUNT(*)::int AS n FROM labs WHERE requested_by = ${me.id} AND status = 'pending'`;
  if (pending.n >= 2) return err("You already have a request waiting for approval");
  const [taken] = await sql`SELECT 1 FROM labs WHERE slug = ${slug}`;
  if (taken) return err(`The short name "${slug}" is taken — try another`);
  const [lab] = await sql`
    INSERT INTO labs (slug, name, institution, department, website, status, requested_by, request_note)
    VALUES (${slug}, ${name}, ${clean(body.institution)}, ${clean(body.department)}, ${clean(body.website)}, 'pending', ${me.id}, ${clean(body.note)})
    RETURNING *`;
  await log(me, "lab_requested", "lab", lab.id, `${name} (${lab.institution || ""})`, lab.id);
  return json(lab, 201);
}, { lab: false });

route("GET", "/lab", async ({ me }) => {
  const [lab] = await sql`SELECT * FROM labs WHERE id = ${me.lab_id}`;
  const [{ used }] = await sql`SELECT COALESCE(SUM(size), 0)::float AS used FROM media WHERE lab_id = ${me.lab_id}`;
  const [{ ai }] = await sql`SELECT COUNT(*)::int AS ai FROM ai_jobs WHERE lab_id = ${me.lab_id} AND created_at >= date_trunc('month', NOW())`;
  return json({ ...lab, storage_used_mb: Math.round(used / 1024 / 1024), ai_used_this_month: ai });
});

route("PUT", "/lab", async ({ me, body }) => {
  requireOwner(me);
  const [cur] = await sql`SELECT * FROM labs WHERE id = ${me.lab_id}`;
  const name = "name" in body ? String(body.name || "").trim() : cur.name;
  const slug = "slug" in body ? slugify(body.slug) : cur.slug;
  if (name.length < 3) return err("Give your lab a name");
  if (!SLUG_RE.test(slug)) return err("The short name must be 3–40 letters, numbers or dashes");
  if (slug !== cur.slug) {
    const [taken] = await sql`SELECT 1 FROM labs WHERE slug = ${slug} AND id <> ${cur.id}`;
    if (taken) return err(`The short name "${slug}" is taken — try another`);
  }
  const [lab] = await sql`
    UPDATE labs SET name = ${name}, slug = ${slug},
      institution = ${"institution" in body ? clean(body.institution) : cur.institution},
      department = ${"department" in body ? clean(body.department) : cur.department},
      website = ${"website" in body ? clean(body.website) : cur.website}
    WHERE id = ${cur.id} RETURNING *`;
  await log(me, "lab_updated", "lab", lab.id, `${lab.name} (${lab.slug})`);
  return json(lab);
});

// --- platform admin (people listed in ADMIN_EMAILS) ---
route("GET", "/platform/labs", async ({ me }) => {
  requirePlatformAdmin(me);
  const labs = await sql`
    SELECT l.*, r.email AS requester_email, r.full_name AS requester_name,
      (SELECT COUNT(*)::int FROM lab_members lm WHERE lm.lab_id = l.id AND lm.active) AS members,
      (SELECT COUNT(*)::int FROM protocols p WHERE p.lab_id = l.id) AS protocols,
      (SELECT COALESCE(SUM(size), 0)::float FROM media md WHERE md.lab_id = l.id) AS storage_bytes,
      (SELECT COUNT(*)::int FROM ai_jobs j WHERE j.lab_id = l.id AND j.created_at >= date_trunc('month', NOW())) AS ai_this_month,
      (SELECT string_agg(m.email, ', ') FROM lab_members lm JOIN members m ON m.id = lm.member_id WHERE lm.lab_id = l.id AND lm.role = 'owner') AS owners
    FROM labs l LEFT JOIN members r ON r.id = l.requested_by
    ORDER BY (l.status = 'pending') DESC, l.created_at DESC`;
  return json(labs);
}, { lab: false });

route("POST", "/platform/labs/:id/:action", async ({ me, params, body }) => {
  requirePlatformAdmin(me);
  const [lab] = await sql`SELECT * FROM labs WHERE id = ${params.id}`;
  if (!lab) notFound();
  const action = params.action;
  if (action === "approve") {
    if (!["pending", "rejected"].includes(lab.status)) return err("Only pending requests can be approved");
    await sql`
      UPDATE labs SET status = 'active', decided_at = NOW(), decided_by = ${me.id}, decision_note = ${clean(body.note)},
        storage_limit_mb = COALESCE(storage_limit_mb, ${DEFAULT_LIMITS.storage_limit_mb}),
        ai_monthly_limit = COALESCE(ai_monthly_limit, ${DEFAULT_LIMITS.ai_monthly_limit})
      WHERE id = ${lab.id}`;
    if (lab.requested_by) {
      await sql`
        INSERT INTO lab_members (lab_id, member_id, role, permissions, active) VALUES (${lab.id}, ${lab.requested_by}, 'owner', '{}', TRUE)
        ON CONFLICT (lab_id, member_id) DO UPDATE SET role = 'owner', active = TRUE`;
    }
  } else if (action === "reject") {
    if (lab.status !== "pending") return err("Only pending requests can be declined");
    await sql`UPDATE labs SET status = 'rejected', decided_at = NOW(), decided_by = ${me.id}, decision_note = ${clean(body.note)} WHERE id = ${lab.id}`;
  } else if (action === "suspend") {
    await sql`UPDATE labs SET status = 'suspended', decided_at = NOW(), decided_by = ${me.id}, decision_note = ${clean(body.note)} WHERE id = ${lab.id}`;
  } else if (action === "reactivate") {
    await sql`UPDATE labs SET status = 'active', decided_at = NOW(), decided_by = ${me.id} WHERE id = ${lab.id}`;
  } else if (action === "limits") {
    const lim = (v) => (v === null || v === "" || v === undefined ? null : Math.max(0, Math.round(Number(v))));
    await sql`UPDATE labs SET storage_limit_mb = ${lim(body.storage_limit_mb)}, ai_monthly_limit = ${lim(body.ai_monthly_limit)} WHERE id = ${lab.id}`;
  } else return err("Unknown action");
  await log(me, `lab_${action}`, "lab", lab.id, `${lab.name}${body.note ? " — " + body.note : ""}`, lab.id);
  const [updated] = await sql`SELECT * FROM labs WHERE id = ${lab.id}`;
  return json(updated);
}, { lab: false });

// --- full backup (owner only) ---
route("GET", "/backup", async ({ me }) => {
  requireOwner(me);
  const data = await exportAll(me.lab_id);
  await log(me, "backup_downloaded", null, null, "Full lab data backup");
  return json(data);
});

// --- Google Drive backup (owner only) ---
const driveRedirect = (req) => new URL("/api/drive/callback", req.url).href;
const gkey = (labId) => `google:${labId}`;
route("GET", "/drive", async ({ me, req }) => {
  requireOwner(me);
  const g = (await getSetting(gkey(me.lab_id))) || {};
  const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM media WHERE lab_id = ${me.lab_id} AND complete AND drive_file_id IS NULL`;
  return json({
    has_credentials: !!(g.client_id && g.client_secret), client_id: g.client_id || "",
    connected: !!g.refresh_token, email: g.email || null, folder_link: g.folder_link || null,
    last_run: g.last_run || null, last_status: g.last_status || null, last_ok: g.last_ok ?? null,
    last_file_link: g.last_file_link || null, running: !!g.running_since && Date.now() - Date.parse(g.running_since) < 16 * 60 * 1000,
    media_pending: n, redirect_uri: driveRedirect(req),
  });
});
route("PUT", "/drive/credentials", async ({ me, body }) => {
  requireOwner(me);
  const client_id = String(body.client_id || "").trim(), client_secret = String(body.client_secret || "").trim();
  if (!/\.apps\.googleusercontent\.com$/.test(client_id)) return err("The Client ID should end in .apps.googleusercontent.com");
  if (client_secret.length < 10) return err("Paste the Client secret too");
  const g = (await getSetting(gkey(me.lab_id))) || {};
  await setSetting(gkey(me.lab_id), { ...g, client_id, client_secret, refresh_token: g.client_id === client_id ? g.refresh_token : null });
  await log(me, "drive_settings", null, null, "Saved Google Drive app credentials");
  return json({ ok: true });
});
route("POST", "/drive/connect", async ({ me, req }) => {
  requireOwner(me);
  const g = await getSetting(gkey(me.lab_id));
  if (!g?.client_id) return err("Save your Google Client ID and secret first");
  const state = `${me.lab_id}.${crypto.randomUUID()}`;
  await patchSetting(gkey(me.lab_id), { oauth_state: state, oauth_state_at: Date.now() });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: g.client_id, redirect_uri: driveRedirect(req), response_type: "code", scope: DRIVE_SCOPE,
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  }).toString();
  return json({ url: url.href });
});
route("GET", "/drive/callback", async ({ me: user, req, query }) => {
  const back = (q) => Response.redirect(new URL(`/lab-settings?${q}`, req.url).href, 302);
  try {
    const labId = Number(String(query.get("state") || "").split(".")[0]);
    const me = inLab(user, labId);
    if (!me) return back("drive_error=expired");
    requireOwner(me);
    const g = (await getSetting(gkey(labId))) || {};
    if (query.get("error")) return back(`drive_error=${encodeURIComponent(query.get("error"))}`);
    if (!g.oauth_state || query.get("state") !== g.oauth_state || Date.now() - g.oauth_state_at > 15 * 60 * 1000) {
      return back("drive_error=expired");
    }
    const tokens = await exchangeCode(g, query.get("code"), driveRedirect(req));
    if (!tokens.refresh_token) return back("drive_error=no_refresh_token");
    const next = { ...g, refresh_token: tokens.refresh_token, oauth_state: null };
    const token = await googleAccessToken(next);
    const gUser = await driveUser(token);
    const folder = await createFolder(token, `${me.lab.name} Backups`);
    const mediaFolder = await createFolder(token, "Photos & videos", folder.id);
    await sql`UPDATE media SET drive_file_id = NULL WHERE lab_id = ${labId}`;
    await setSetting(gkey(labId), { ...next, email: gUser?.emailAddress || null, folder_id: folder.id, media_folder_id: mediaFolder.id,
      folder_link: `https://drive.google.com/drive/folders/${folder.id}` });
    await log(me, "drive_connected", null, null, `Google Drive backup connected (${gUser?.emailAddress || "account"})`);
    await triggerBackgroundBackup(new URL(req.url).origin, labId);
    return back("drive=connected");
  } catch (e) {
    console.error(e);
    return back(`drive_error=${encodeURIComponent(e.message || "failed")}`);
  }
}, { lab: false });
route("POST", "/drive/run", async ({ me, req }) => {
  requireOwner(me);
  const g = await getSetting(gkey(me.lab_id));
  if (!g?.refresh_token) return err("Connect Google Drive first");
  await triggerBackgroundBackup(new URL(req.url).origin, me.lab_id);
  await log(me, "drive_backup_started", null, null, "Started a Google Drive backup");
  return json({ ok: true });
});
route("POST", "/drive/disconnect", async ({ me }) => {
  requireOwner(me);
  const g = (await getSetting(gkey(me.lab_id))) || {};
  if (g.refresh_token) {
    try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(g.refresh_token)}`, { method: "POST" }); } catch { /* ignore */ }
  }
  await setSetting(gkey(me.lab_id), { client_id: g.client_id, client_secret: g.client_secret });
  await log(me, "drive_disconnected", null, null, "Google Drive backup disconnected");
  return json({ ok: true });
});

// --- PI activities (tenure & promotion; admin only, private to owner) ---
const PI_CATEGORIES = ["publication", "grant", "teaching", "service", "mentoring", "presentation", "award", "outreach", "other"];

route("GET", "/pi-activities", async ({ me, query }) => {
  requirePerm(me, "tenure");
  const category = query.get("category") || null;
  const year = query.get("year") ? Number(query.get("year")) : null;
  const rows = await sql`
    SELECT * FROM pi_activities
    WHERE owner_id = ${me.id}
      AND (${category}::text IS NULL OR category = ${category})
      AND (${year}::int IS NULL OR EXTRACT(YEAR FROM COALESCE(start_date, created_at::date)) = ${year})
    ORDER BY COALESCE(start_date, created_at::date) DESC, id DESC`;
  return json(rows);
}, { lab: false });

route("GET", "/pi-activities/summary", async ({ me }) => {
  requirePerm(me, "tenure");
  const byYear = await sql`
    SELECT EXTRACT(YEAR FROM COALESCE(start_date, created_at::date))::int AS year, category,
           COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::float AS amount
    FROM pi_activities WHERE owner_id = ${me.id}
    GROUP BY 1, 2 ORDER BY 1 DESC, 2`;
  const [mentees] = await sql`
    SELECT COUNT(DISTINCT s.member_id)::int AS n FROM lab_members o
    JOIN lab_members s ON s.lab_id = o.lab_id AND s.role = 'student' AND s.active
    WHERE o.member_id = ${me.id} AND o.role = 'owner'`;
  const [approved] = await sql`
    SELECT COUNT(*)::int AS n FROM protocols p JOIN lab_members o ON o.lab_id = p.lab_id AND o.member_id = ${me.id} AND o.role = 'owner'
    WHERE p.status = 'approved'`;
  return json({ byYear, labStats: { mentees: mentees.n, approvedProtocols: approved.n } });
}, { lab: false });

const piValues = (b) => {
  if (!PI_CATEGORIES.includes(b.category)) throw new HttpError(400, "Pick a category");
  if (!b.title?.trim()) throw new HttpError(400, "Title is required");
  return {
    category: b.category, title: b.title.trim(), details: clean(b.details), role: clean(b.role),
    start_date: clean(b.start_date), end_date: clean(b.end_date), amount: num(b.amount),
    status: clean(b.status), link: clean(b.link),
  };
};

route("POST", "/pi-activities", async ({ me, body }) => {
  requirePerm(me, "tenure");
  const v = piValues(body);
  const [a] = await sql`
    INSERT INTO pi_activities (owner_id, category, title, details, role, start_date, end_date, amount, status, link)
    VALUES (${me.id}, ${v.category}, ${v.title}, ${v.details}, ${v.role}, ${v.start_date}, ${v.end_date},
            ${v.amount}, ${v.status}, ${v.link})
    RETURNING *`;
  return json(a, 201);
}, { lab: false });

route("PUT", "/pi-activities/:id", async ({ me, body, params }) => {
  requirePerm(me, "tenure");
  const v = piValues(body);
  const [a] = await sql`
    UPDATE pi_activities SET category = ${v.category}, title = ${v.title}, details = ${v.details}, role = ${v.role},
      start_date = ${v.start_date}, end_date = ${v.end_date}, amount = ${v.amount}, status = ${v.status},
      link = ${v.link}, updated_at = NOW()
    WHERE id = ${params.id} AND owner_id = ${me.id} RETURNING *`;
  if (!a) notFound();
  return json(a);
}, { lab: false });

route("POST", "/pi-activities/bulk", async ({ me, body }) => {
  requirePerm(me, "tenure");
  const items = Array.isArray(body.items) ? body.items.slice(0, 1000) : [];
  if (!items.length) return err("Nothing selected");
  let added = 0;
  for (const it of items) {
    let v;
    try { v = piValues(it); } catch { continue; }
    await sql`
      INSERT INTO pi_activities (owner_id, category, title, details, role, start_date, end_date, amount, status, link)
      VALUES (${me.id}, ${v.category}, ${v.title}, ${v.details}, ${v.role}, ${v.start_date}, ${v.end_date}, ${v.amount}, ${v.status}, ${v.link})`;
    added++;
  }
  return json({ added });
}, { lab: false });

// --- AI import assistant ---
route("POST", "/tenure-ai/jobs", async ({ me, body, req }) => {
  requirePerm(me, "tenure");
  const text = typeof body.text === "string" ? body.text.slice(0, 400000) : "";
  const pdf = typeof body.pdf_base64 === "string" ? body.pdf_base64 : "";
  if (!text.trim() && !pdf) return err("Upload a file or paste some text first");
  if (pdf.length > 4.3 * 1024 * 1024) return err("That PDF is too large (max about 3 MB). Try pasting the text instead.");
  const [lab] = await sql`SELECT ai_monthly_limit FROM labs WHERE id = ${me.lab_id}`;
  if (lab.ai_monthly_limit != null) {
    const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM ai_jobs WHERE lab_id = ${me.lab_id} AND created_at >= date_trunc('month', NOW())`;
    if (n >= lab.ai_monthly_limit) return err(`Your lab has used its ${lab.ai_monthly_limit} AI imports for this month. They reset on the 1st, or ask the platform admin for more.`, 429);
  }
  const [job] = await sql`INSERT INTO ai_jobs (owner_id, lab_id, source_name) VALUES (${me.id}, ${me.lab_id}, ${String(body.name || "pasted text").slice(0, 200)}) RETURNING id`;
  await aiInputs().setJSON(String(job.id), { name: body.name || "", text, pdf_base64: pdf || null });
  const res = await fetch(new URL("/.netlify/functions/tenure-ai", req.url), {
    method: "POST", headers: { "x-labhub-secret": await internalSecret(), "Content-Type": "application/json" },
    body: JSON.stringify({ jobId: job.id }),
  });
  if (res.status >= 400) return err("Couldn't start the AI assistant. Try again in a minute.", 502);
  await log(me, "ai_import_started", null, null, body.name || "pasted text");
  return json({ id: job.id }, 202);
});
route("GET", "/tenure-ai/jobs/:id", async ({ me, params }) => {
  requirePerm(me, "tenure");
  const [job] = await sql`SELECT id, status, source_name, result, error, created_at, finished_at FROM ai_jobs WHERE id = ${params.id} AND owner_id = ${me.id}`;
  if (!job) notFound();
  if (job.status === "pending" && Date.now() - new Date(job.created_at).getTime() > 5 * 60 * 1000) {
    job.status = "error"; job.error = "The assistant never started. Please try again.";
  }
  return json(job);
}, { lab: false });

route("DELETE", "/pi-activities/:id", async ({ me, params }) => {
  requirePerm(me, "tenure");
  const [a] = await sql`DELETE FROM pi_activities WHERE id = ${params.id} AND owner_id = ${me.id} RETURNING id`;
  if (!a) notFound();
  return json({ ok: true });
}, { lab: false });

// ---------- entry point ----------
export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/(\.netlify\/functions\/)?api/, "") || "/";
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = path.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      let me = null;
      if (!r.public) {
        const user = await currentUser();
        const header = req.headers.get("x-lab-id");
        if (r.lab === false) me = user;
        else {
          me = inLab(user, header || null) || (r.lab === "optional" ? user : null);
          if (!me) return json({ error: "Choose or join a lab first", code: "no_lab" }, 409);
        }
      }
      let body = {};
      if (["POST", "PUT"].includes(req.method) && (req.headers.get("content-type") || "").includes("application/json")) {
        try { body = await req.json(); } catch { body = {}; }
      }
      return await r.handler({ me, body, params, query: url.searchParams, req });
    }
    return err("Not found", 404);
  } catch (e) {
    if (e instanceof HttpError) return err(e.message, e.status);
    console.error(e);
    return err("Server error", 500);
  }
};

export const config = { path: "/api/*" };
