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

async function currentMember() {
  const user = await getUser();
  if (!user || !user.email) throw new HttpError(401, "Please log in");
  const email = user.email.toLowerCase();
  const isListedAdmin = adminEmails().includes(email);
  const name = user.name || user.userMetadata?.full_name || null;

  const [grant] = await sql`SELECT * FROM access_grants WHERE email = ${email}`;
  const firstRole = isListedAdmin ? "owner" : grant?.role || "student";
  const firstPerms = grant?.permissions || [];
  const rows = await sql`
    INSERT INTO members (id, email, full_name, role, permissions, last_seen)
    VALUES (${user.id}, ${email}, ${name}, ${firstRole}, ${firstPerms}, NOW())
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = COALESCE(members.full_name, EXCLUDED.full_name),
      role = CASE WHEN ${isListedAdmin} THEN 'owner' ELSE members.role END,
      last_seen = NOW()
    RETURNING *`;
  const me = rows[0];
  if (!me.active) throw new HttpError(403, "Your lab account has been deactivated");
  if (grant) await sql`DELETE FROM access_grants WHERE email = ${email}`;
  me.can = effectivePerms(me);
  return me;
}

async function log(me, action, entityType, entityId, summary) {
  await sql`
    INSERT INTO activity_log (member_id, action, entity_type, entity_id, summary)
    VALUES (${me.id}, ${action}, ${entityType}, ${entityId == null ? null : String(entityId)}, ${summary})`;
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
const can = (me, perm) => effectivePerms(me).includes(perm);
const requirePerm = (me, perm) => { if (!can(me, perm)) deny("You don't have access to this"); };
const requireOwner = (me) => { if (!isOwner(me)) deny("Only the lab owner can do this"); };
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
            WHERE id = ANY(${ids}::int[]) AND protocol_id IS NULL AND owner_id = ${me.id}`;
}

async function getProtocol(id) {
  const rows = await sql`
    SELECT p.*, a.full_name AS author_name, a.email AS author_email,
           r.full_name AS reviewer_name
    FROM protocols p
    JOIN members a ON a.id = p.author_id
    LEFT JOIN members r ON r.id = p.reviewed_by
    WHERE p.id = ${id}`;
  return rows[0];
}
const seesAll = (me) => can(me, "review_protocols") || can(me, "edit_protocols");
const canView = (me, p) => p.author_id === me.id || p.status === "approved" || seesAll(me);
const canEdit = (me, p) => p.author_id === me.id || can(me, "edit_protocols");

// ---------- route handlers ----------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  routes.push({ method, re, keys, handler });
};

// --- me ---
route("GET", "/me", async ({ me }) => json(me));
route("PUT", "/me", async ({ me, body }) => {
  const rows = await sql`
    UPDATE members SET full_name = ${clean(body.full_name)}, position = ${clean(body.position)}
    WHERE id = ${me.id} RETURNING *`;
  return json(rows[0]);
});

// --- dashboard ---
route("GET", "/dashboard", async ({ me }) => {
  const admin = can(me, "view_activity");
  const reviewer = can(me, "review_protocols");
  const myCounts = await sql`
    SELECT status, COUNT(*)::int AS n FROM protocols WHERE author_id = ${me.id} GROUP BY status`;
  const lowStock = await sql`
    SELECT id, name, quantity, unit, min_quantity, location FROM inventory_items
    WHERE min_quantity IS NOT NULL AND quantity <= min_quantity ORDER BY name LIMIT 20`;
  const expiring = await sql`
    SELECT id, name, expiry_date, location FROM inventory_items
    WHERE expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE + INTERVAL '30 days'
    ORDER BY expiry_date LIMIT 20`;
  const recent = admin
    ? await sql`
        SELECT l.*, m.full_name, m.email FROM activity_log l
        LEFT JOIN members m ON m.id = l.member_id
        ORDER BY l.created_at DESC LIMIT 15`
    : await sql`
        SELECT l.*, m.full_name, m.email FROM activity_log l
        LEFT JOIN members m ON m.id = l.member_id
        WHERE l.member_id = ${me.id} ORDER BY l.created_at DESC LIMIT 10`;
  const needsAttention = reviewer
    ? await sql`
        SELECT p.id, p.title, p.updated_at, m.full_name AS author_name, m.email AS author_email
        FROM protocols p JOIN members m ON m.id = p.author_id
        WHERE p.status = 'submitted' ORDER BY p.updated_at`
    : await sql`
        SELECT id, title, updated_at FROM protocols
        WHERE author_id = ${me.id} AND status = 'changes_requested' ORDER BY updated_at DESC`;
  let lab = null;
  if (admin || reviewer) {
    const [m] = await sql`SELECT COUNT(*)::int AS n FROM members WHERE active`;
    const [p] = await sql`SELECT COUNT(*)::int AS n FROM protocols WHERE status <> 'archived'`;
    const [i] = await sql`SELECT COUNT(*)::int AS n FROM inventory_items`;
    const [a] = await sql`SELECT COUNT(*)::int AS n FROM activity_log WHERE created_at > NOW() - INTERVAL '7 days'`;
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
      WHERE p.author_id = ${me.id} AND (${status}::text IS NULL OR p.status = ${status})
      ORDER BY p.updated_at DESC`;
  } else if (scope === "library" || !seesAll(me)) {
    rows = await sql`
      SELECT p.id, p.title, p.project, p.experiment, p.status, p.version, p.updated_at,
             m.full_name AS author_name, m.email AS author_email
      FROM protocols p JOIN members m ON m.id = p.author_id
      WHERE p.status = 'approved'
      ORDER BY p.title`;
  } else {
    rows = await sql`
      SELECT p.id, p.title, p.project, p.experiment, p.status, p.version, p.updated_at,
             m.full_name AS author_name, m.email AS author_email
      FROM protocols p JOIN members m ON m.id = p.author_id
      WHERE (${status}::text IS NULL OR p.status = ${status})
      ORDER BY p.updated_at DESC`;
  }
  return json(rows);
});

route("POST", "/protocols", async ({ me, body }) => {
  if (!body.title?.trim()) return err("Title is required");
  const status = body.submit ? "submitted" : "draft";
  const [p] = await sql`
    INSERT INTO protocols (title, project, experiment, objective, materials, equipment, steps, safety, notes, status, author_id)
    VALUES (${body.title.trim()}, ${clean(body.project)}, ${clean(body.experiment)}, ${clean(body.objective)},
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
  const p = await getProtocol(params.id);
  if (!p) notFound();
  if (!canView(me, p)) deny();
  const comments = await sql`
    SELECT c.*, m.full_name, m.email, m.role FROM protocol_comments c
    JOIN members m ON m.id = c.author_id
    WHERE c.protocol_id = ${p.id} ORDER BY c.created_at`;
  const versions = await sql`
    SELECT v.id, v.version, v.created_at, m.full_name, m.email FROM protocol_versions v
    JOIN members m ON m.id = v.edited_by
    WHERE v.protocol_id = ${p.id} ORDER BY v.version DESC`;
  return json({ ...p, comments, versions, can_edit: canEdit(me, p), can_review: can(me, "review_protocols") });
});

route("GET", "/protocols/:id/versions/:v", async ({ me, params }) => {
  const p = await getProtocol(params.id);
  if (!p) notFound();
  if (!canView(me, p)) deny();
  const [v] = await sql`
    SELECT * FROM protocol_versions WHERE protocol_id = ${p.id} AND version = ${Number(params.v)}`;
  if (!v) notFound();
  return json(v);
});

route("PUT", "/protocols/:id", async ({ me, body, params }) => {
  const p = await getProtocol(params.id);
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
  const p = await getProtocol(params.id);
  if (!p) notFound();
  if (p.author_id !== me.id && !can(me, "edit_protocols")) deny();
  if (!["draft", "changes_requested"].includes(p.status)) return err("Only drafts or protocols with requested changes can be submitted");
  await sql`UPDATE protocols SET status = 'submitted', updated_at = NOW() WHERE id = ${p.id}`;
  await log(me, "protocol_submitted", "protocol", p.id, p.title);
  return json({ ok: true });
});

route("POST", "/protocols/:id/review", async ({ me, body, params }) => {
  requirePerm(me, "review_protocols");
  const p = await getProtocol(params.id);
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
  const p = await getProtocol(params.id);
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
  const p = await getProtocol(params.id);
  if (!p) notFound();
  if (!canEdit(me, p)) deny();
  await sql`UPDATE protocols SET status = 'archived', updated_at = NOW() WHERE id = ${p.id}`;
  await log(me, "protocol_archived", "protocol", p.id, p.title);
  return json({ ok: true });
});

route("POST", "/protocols/:id/duplicate", async ({ me, params }) => {
  const p = await getProtocol(params.id);
  if (!p) notFound();
  if (!canView(me, p)) deny();
  const [n] = await sql`
    INSERT INTO protocols (title, project, experiment, objective, materials, equipment, steps, safety, notes, status, author_id)
    VALUES (${"Copy of " + p.title}, ${p.project}, ${p.experiment}, ${p.objective}, ${p.materials},
            ${p.equipment}, ${p.steps}, ${p.safety}, ${p.notes}, 'draft', ${me.id})
    RETURNING *`;
  await sql`
    INSERT INTO protocol_versions (protocol_id, version, snapshot, edited_by)
    VALUES (${n.id}, 1, ${JSON.stringify(n)}, ${me.id})`;
  await log(me, "protocol_created", "protocol", n.id, `${n.title} (from #${p.id})`);
  return json(n, 201);
});

// --- inventory ---
route("GET", "/inventory", async ({ query }) => {
  const q = query.get("q") ? `%${query.get("q")}%` : null;
  const category = query.get("category") || null;
  const rows = await sql`
    SELECT i.*, m.full_name AS updated_by_name FROM inventory_items i
    LEFT JOIN members m ON m.id = i.updated_by
    WHERE (${q}::text IS NULL OR i.name ILIKE ${q} OR i.catalog_number ILIKE ${q} OR i.location ILIKE ${q} OR i.supplier ILIKE ${q})
      AND (${category}::text IS NULL OR i.category = ${category})
    ORDER BY i.category, i.name`;
  return json(rows);
});

const ITEM_FIELDS = ["name", "category", "unit", "location", "supplier", "catalog_number", "lot_number", "cas_number", "expiry_date", "hazard", "notes"];

route("POST", "/inventory", async ({ me, body }) => {
  if (!body.name?.trim()) return err("Name is required");
  const [i] = await sql`
    INSERT INTO inventory_items (name, category, quantity, unit, min_quantity, location, supplier, catalog_number,
      lot_number, cas_number, expiry_date, hazard, notes, created_by, updated_by)
    VALUES (${body.name.trim()}, ${clean(body.category) || "Other"}, ${num(body.quantity) ?? 0}, ${clean(body.unit)},
      ${num(body.min_quantity)}, ${clean(body.location)}, ${clean(body.supplier)}, ${clean(body.catalog_number)},
      ${clean(body.lot_number)}, ${clean(body.cas_number)}, ${clean(body.expiry_date)}, ${clean(body.hazard)},
      ${clean(body.notes)}, ${me.id}, ${me.id})
    RETURNING *`;
  await log(me, "inventory_added", "inventory", i.id, `${i.name} (${i.quantity} ${i.unit || ""})`.trim());
  return json(i, 201);
});

route("PUT", "/inventory/:id", async ({ me, body, params }) => {
  const [cur] = await sql`SELECT * FROM inventory_items WHERE id = ${params.id}`;
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
    WHERE id = ${params.id} RETURNING *`;
  if (!i) notFound();
  await sql`
    INSERT INTO inventory_transactions (item_id, member_id, change, reason)
    VALUES (${i.id}, ${me.id}, ${change}, ${clean(body.reason)})`;
  const verb = change < 0 ? "used" : "restocked";
  await log(me, change < 0 ? "inventory_used" : "inventory_restocked", "inventory", i.id,
    `${verb} ${Math.abs(change)} ${i.unit || ""} of ${i.name}${body.reason ? " — " + body.reason : ""}`.replace(/\s+/g, " "));
  return json(i);
});

route("GET", "/inventory/:id/transactions", async ({ params }) => {
  const rows = await sql`
    SELECT t.*, m.full_name, m.email FROM inventory_transactions t
    JOIN members m ON m.id = t.member_id
    WHERE t.item_id = ${params.id} ORDER BY t.created_at DESC LIMIT 100`;
  return json(rows);
});

route("DELETE", "/inventory/:id", async ({ me, params }) => {
  requirePerm(me, "manage_inventory");
  const [i] = await sql`DELETE FROM inventory_items WHERE id = ${params.id} RETURNING name`;
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
  const [m] = await sql`
    INSERT INTO media (owner_id, filename, content_type, kind, size, chunk_size, chunks)
    VALUES (${me.id}, ${String(body.filename || kind).slice(0, 200)}, ${type}, ${kind}, ${size}, ${MEDIA_CHUNK}, ${chunks})
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

async function canViewMedia(me, m) {
  if (m.owner_id === me.id || seesAll(me)) return true;
  if (m.protocol_id) {
    const p = await getProtocol(m.protocol_id);
    if (p && canView(me, p)) return true;
  }
  // Also visible wherever it appears in an approved protocol (e.g. a duplicated protocol).
  const token = `%[[${m.kind}:${m.id}]]%`;
  const src = `%/api/media/${m.id}"%`;
  const [hit] = await sql`
    SELECT 1 FROM protocols WHERE status = 'approved'
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
route("GET", "/media/:id", async ({ me, params, req }) => serveMedia(me, params.id, req));

// --- activity ---
route("GET", "/activity", async ({ me, query }) => {
  const limit = Math.min(Number(query.get("limit")) || 100, 500);
  const member = can(me, "view_activity") ? query.get("member") || null : me.id;
  const since = query.get("since") || null;
  const rows = await sql`
    SELECT l.*, m.full_name, m.email FROM activity_log l
    LEFT JOIN members m ON m.id = l.member_id
    WHERE (${member}::text IS NULL OR l.member_id = ${member})
      AND (${since}::date IS NULL OR l.created_at >= ${since}::date)
    ORDER BY l.created_at DESC LIMIT ${limit}`;
  return json(rows);
});

// --- members (admin) ---
route("GET", "/members", async ({ me }) => {
  if (!can(me, "manage_members") && !can(me, "view_activity")) deny();
  const rows = await sql`
    SELECT m.*,
      (SELECT COUNT(*)::int FROM protocols p WHERE p.author_id = m.id AND p.status <> 'archived') AS protocol_count,
      (SELECT COUNT(*)::int FROM protocols p WHERE p.author_id = m.id AND p.status = 'approved') AS approved_count,
      (SELECT COUNT(*)::int FROM activity_log l WHERE l.member_id = m.id AND l.created_at > NOW() - INTERVAL '30 days') AS activity_30d,
      (SELECT MAX(l.created_at) FROM activity_log l WHERE l.member_id = m.id) AS last_activity
    FROM members m ORDER BY m.active DESC, m.role, m.full_name NULLS LAST, m.email`;
  return json(rows);
});

route("PUT", "/members/:id", async ({ me, body, params }) => {
  requirePerm(me, "manage_members");
  const [cur] = await sql`SELECT * FROM members WHERE id = ${params.id}`;
  if (!cur) notFound();
  const owner = isOwner(me);
  // Only the owner can change roles/permissions or touch other admins.
  if (!owner && cur.role !== "student") deny("Only the lab owner can change admin accounts");
  if (cur.role === "owner" && cur.id !== me.id) deny("The owner account can't be changed");
  let role = cur.role, permissions = cur.permissions;
  if (owner && cur.id !== me.id) {
    if (["admin", "student"].includes(body.role)) role = body.role;
    if ("permissions" in body) permissions = cleanPerms(body.permissions);
    if (role === "student") permissions = [];
  }
  const active = cur.id === me.id ? cur.active : typeof body.active === "boolean" ? body.active : cur.active;
  const [m] = await sql`
    UPDATE members SET
      full_name = ${"full_name" in body ? clean(body.full_name) : cur.full_name},
      position = ${"position" in body ? clean(body.position) : cur.position},
      start_date = ${"start_date" in body ? clean(body.start_date) : cur.start_date},
      role = ${role}, permissions = ${permissions}, active = ${active}
    WHERE id = ${cur.id} RETURNING *`;
  const permNote = m.role === "admin" ? ` [${m.permissions.join(", ") || "no permissions"}]` : "";
  await log(me, "member_updated", "member", m.id, `${m.full_name || m.email}: ${m.role}${permNote}${m.active ? "" : ", deactivated"}`);
  return json(m);
});

// --- pre-approved admin emails (owner only) ---
route("GET", "/access-grants", async ({ me }) => {
  requireOwner(me);
  return json({ grants: await sql`SELECT * FROM access_grants ORDER BY created_at DESC`, permissions: PERMISSIONS });
});
route("POST", "/access-grants", async ({ me, body }) => {
  requireOwner(me);
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err("Enter a valid email");
  const perms = cleanPerms(body.permissions);
  const [existing] = await sql`SELECT * FROM members WHERE email = ${email}`;
  if (existing) {
    if (existing.role === "owner") return err("That's the owner account");
    const [m] = await sql`UPDATE members SET role = 'admin', permissions = ${perms} WHERE id = ${existing.id} RETURNING *`;
    await log(me, "member_updated", "member", m.id, `${m.full_name || m.email}: admin [${perms.join(", ") || "no permissions"}]`);
    return json({ applied: true, member: m });
  }
  const [g] = await sql`
    INSERT INTO access_grants (email, role, permissions, created_by) VALUES (${email}, 'admin', ${perms}, ${me.id})
    ON CONFLICT (email) DO UPDATE SET permissions = EXCLUDED.permissions, created_by = EXCLUDED.created_by, created_at = NOW()
    RETURNING *`;
  await log(me, "admin_preapproved", "member", null, `${email} [${perms.join(", ") || "no permissions"}]`);
  return json({ applied: false, grant: g }, 201);
});
route("DELETE", "/access-grants/:email", async ({ me, params }) => {
  requireOwner(me);
  await sql`DELETE FROM access_grants WHERE email = ${params.email.toLowerCase()}`;
  return json({ ok: true });
});

// --- full backup (owner only) ---
route("GET", "/backup", async ({ me }) => {
  requireOwner(me);
  const data = await exportAll();
  await log(me, "backup_downloaded", null, null, "Full lab data backup");
  return json(data);
});

// --- Google Drive backup (owner only) ---
const driveRedirect = (req) => new URL("/api/drive/callback", req.url).href;
route("GET", "/drive", async ({ me, req }) => {
  requireOwner(me);
  const g = (await getSetting("google")) || {};
  const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM media WHERE complete AND drive_file_id IS NULL`;
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
  const g = (await getSetting("google")) || {};
  await setSetting("google", { ...g, client_id, client_secret, refresh_token: g.client_id === client_id ? g.refresh_token : null });
  await log(me, "drive_settings", null, null, "Saved Google Drive app credentials");
  return json({ ok: true });
});
route("POST", "/drive/connect", async ({ me, req }) => {
  requireOwner(me);
  const g = await getSetting("google");
  if (!g?.client_id) return err("Save your Google Client ID and secret first");
  const state = crypto.randomUUID();
  await patchSetting("google", { oauth_state: state, oauth_state_at: Date.now() });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: g.client_id, redirect_uri: driveRedirect(req), response_type: "code", scope: DRIVE_SCOPE,
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  }).toString();
  return json({ url: url.href });
});
route("GET", "/drive/callback", async ({ me, req, query }) => {
  const back = (q) => Response.redirect(new URL(`/members?${q}`, req.url).href, 302);
  try {
    requireOwner(me);
    const g = (await getSetting("google")) || {};
    if (query.get("error")) return back(`drive_error=${encodeURIComponent(query.get("error"))}`);
    if (!g.oauth_state || query.get("state") !== g.oauth_state || Date.now() - g.oauth_state_at > 15 * 60 * 1000) {
      return back("drive_error=expired");
    }
    const tokens = await exchangeCode(g, query.get("code"), driveRedirect(req));
    if (!tokens.refresh_token) return back("drive_error=no_refresh_token");
    const next = { ...g, refresh_token: tokens.refresh_token, oauth_state: null };
    const token = await googleAccessToken(next);
    const user = await driveUser(token);
    const folder = await createFolder(token, `${labName()} Backups`);
    const mediaFolder = await createFolder(token, "Photos & videos", folder.id);
    await sql`UPDATE media SET drive_file_id = NULL`;
    await setSetting("google", { ...next, email: user?.emailAddress || null, folder_id: folder.id, media_folder_id: mediaFolder.id,
      folder_link: `https://drive.google.com/drive/folders/${folder.id}` });
    await log(me, "drive_connected", null, null, `Google Drive backup connected (${user?.emailAddress || "account"})`);
    await triggerBackgroundBackup(new URL(req.url).origin);
    return back("drive=connected");
  } catch (e) {
    console.error(e);
    return back(`drive_error=${encodeURIComponent(e.message || "failed")}`);
  }
});
route("POST", "/drive/run", async ({ me, req }) => {
  requireOwner(me);
  const g = await getSetting("google");
  if (!g?.refresh_token) return err("Connect Google Drive first");
  await triggerBackgroundBackup(new URL(req.url).origin);
  await log(me, "drive_backup_started", null, null, "Started a Google Drive backup");
  return json({ ok: true });
});
route("POST", "/drive/disconnect", async ({ me }) => {
  requireOwner(me);
  const g = (await getSetting("google")) || {};
  if (g.refresh_token) {
    try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(g.refresh_token)}`, { method: "POST" }); } catch { /* ignore */ }
  }
  await setSetting("google", { client_id: g.client_id, client_secret: g.client_secret });
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
});

route("GET", "/pi-activities/summary", async ({ me }) => {
  requirePerm(me, "tenure");
  const byYear = await sql`
    SELECT EXTRACT(YEAR FROM COALESCE(start_date, created_at::date))::int AS year, category,
           COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::float AS amount
    FROM pi_activities WHERE owner_id = ${me.id}
    GROUP BY 1, 2 ORDER BY 1 DESC, 2`;
  const [mentees] = await sql`SELECT COUNT(*)::int AS n FROM members WHERE role = 'student' AND active`;
  const [approved] = await sql`SELECT COUNT(*)::int AS n FROM protocols WHERE status = 'approved'`;
  return json({ byYear, labStats: { mentees: mentees.n, approvedProtocols: approved.n } });
});

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
});

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
});

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
});

// --- AI import assistant ---
route("POST", "/tenure-ai/jobs", async ({ me, body, req }) => {
  requirePerm(me, "tenure");
  const text = typeof body.text === "string" ? body.text.slice(0, 400000) : "";
  const pdf = typeof body.pdf_base64 === "string" ? body.pdf_base64 : "";
  if (!text.trim() && !pdf) return err("Upload a file or paste some text first");
  if (pdf.length > 4.3 * 1024 * 1024) return err("That PDF is too large (max about 3 MB). Try pasting the text instead.");
  const [job] = await sql`INSERT INTO ai_jobs (owner_id, source_name) VALUES (${me.id}, ${String(body.name || "pasted text").slice(0, 200)}) RETURNING id`;
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
});

route("DELETE", "/pi-activities/:id", async ({ me, params }) => {
  requirePerm(me, "tenure");
  const [a] = await sql`DELETE FROM pi_activities WHERE id = ${params.id} AND owner_id = ${me.id} RETURNING id`;
  if (!a) notFound();
  return json({ ok: true });
});

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
      const me = await currentMember();
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
