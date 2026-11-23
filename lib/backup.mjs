// Shared by the API, the weekly schedule and the background backup job.
import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";

export const labName = () => (globalThis.Netlify?.env?.get("LAB_NAME") || process.env.LAB_NAME || "Lab Hub");
export const labSlug = () => labName().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "lab-hub";

export const db = () => getDatabase().sql;

// Everything belonging to one lab, plus the private tenure records of that lab's owner(s).
export async function exportAll(labId) {
  const sql = db();
  const [lab] = await sql`SELECT * FROM labs WHERE id = ${labId}`;
  const tables = {
    lab: [lab],
    lab_members: await sql`SELECT * FROM lab_members WHERE lab_id = ${labId} ORDER BY joined_at`,
    members: await sql`SELECT m.id, m.email, m.full_name, m.created_at, m.last_seen FROM members m
                       JOIN lab_members lm ON lm.member_id = m.id WHERE lm.lab_id = ${labId} ORDER BY m.email`,
    protocols: await sql`SELECT * FROM protocols WHERE lab_id = ${labId} ORDER BY id`,
    protocol_versions: await sql`SELECT v.* FROM protocol_versions v JOIN protocols p ON p.id = v.protocol_id WHERE p.lab_id = ${labId} ORDER BY v.id`,
    protocol_comments: await sql`SELECT c.* FROM protocol_comments c JOIN protocols p ON p.id = c.protocol_id WHERE p.lab_id = ${labId} ORDER BY c.id`,
    inventory_items: await sql`SELECT * FROM inventory_items WHERE lab_id = ${labId} ORDER BY id`,
    inventory_transactions: await sql`SELECT t.* FROM inventory_transactions t JOIN inventory_items i ON i.id = t.item_id WHERE i.lab_id = ${labId} ORDER BY t.id`,
    activity_log: await sql`SELECT * FROM activity_log WHERE lab_id = ${labId} ORDER BY id`,
    access_grants: await sql`SELECT * FROM access_grants WHERE lab_id = ${labId}`,
    media: await sql`SELECT * FROM media WHERE lab_id = ${labId} ORDER BY id`,
    pi_activities: await sql`SELECT a.* FROM pi_activities a JOIN lab_members lm ON lm.member_id = a.owner_id
                             WHERE lm.lab_id = ${labId} AND lm.role = 'owner' ORDER BY a.id`,
  };
  return { app: labName(), lab: lab?.name, exported_at: new Date().toISOString(), tables };
}

export async function getSetting(key) {
  const sql = db();
  const [row] = await sql`SELECT value FROM app_settings WHERE key = ${key}`;
  return row?.value ?? null;
}
export async function setSetting(key, value) {
  const sql = db();
  await sql`INSERT INTO app_settings (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`;
}
export async function patchSetting(key, patch) {
  const cur = (await getSetting(key)) || {};
  const next = { ...cur, ...patch };
  await setSetting(key, next);
  return next;
}

// Secret shared between the API/schedule and the background job, created on first use.
export async function internalSecret() {
  let s = await getSetting("internal_secret");
  if (!s?.value) {
    s = { value: crypto.randomUUID() + crypto.randomUUID() };
    await setSetting("internal_secret", s);
  }
  return s.value;
}

// ---------- Google Drive ----------
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export async function googleAccessToken(g) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: g.client_id, client_secret: g.client_secret, refresh_token: g.refresh_token, grant_type: "refresh_token" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google sign-in expired or was revoked (${data.error || res.status}). Reconnect Google Drive.`);
  return data.access_token;
}

export async function exchangeCode(g, code, redirectUri) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: g.client_id, client_secret: g.client_secret, code, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || `Google returned ${res.status}`);
  return data;
}

async function gapi(token, url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = j.error?.message || msg; } catch { /* ignore */ }
    throw new Error(`Google Drive: ${msg}`);
  }
  return res;
}

export async function driveUser(token) {
  const r = await gapi(token, "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)");
  return (await r.json()).user;
}

export async function createFolder(token, name, parent) {
  const r = await gapi(token, "https://www.googleapis.com/drive/v3/files?fields=id,webViewLink", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", ...(parent ? { parents: [parent] } : {}) }),
  });
  return r.json();
}

export async function folderExists(token, id) {
  try {
    const r = await gapi(token, `https://www.googleapis.com/drive/v3/files/${id}?fields=id,trashed`);
    const j = await r.json();
    return !j.trashed;
  } catch { return false; }
}

// Small file in one request.
export async function uploadSmall(token, { name, mimeType, parent, data }) {
  const boundary = "labhub" + crypto.randomUUID();
  const meta = JSON.stringify({ name, parents: [parent] });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${data}\r\n--${boundary}--`;
  const r = await gapi(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body,
  });
  return r.json();
}

// Large file in pieces (photos/videos stored in Netlify Blobs as 3 MB chunks).
export async function uploadMediaFile(token, m, parent) {
  const init = await gapi(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": m.content_type, "X-Upload-Content-Length": String(m.size) },
    body: JSON.stringify({ name: `${m.id}-${m.filename}`, parents: [parent] }),
  });
  const session = init.headers.get("location");
  const store = getStore({ name: "protocol-media", consistency: "strong" });
  const size = Number(m.size);
  let fileId = null;
  for (let n = 0; n < m.chunks; n++) {
    const buf = await store.get(`${m.id}/${n}`, { type: "arrayBuffer" });
    if (!buf) throw new Error(`Missing part ${n} of ${m.filename}`);
    const start = n * m.chunk_size, end = start + buf.byteLength - 1;
    const res = await fetch(session, { method: "PUT", headers: { "Content-Range": `bytes ${start}-${end}/${size}` }, body: buf });
    if (res.status === 308) continue;
    if (!res.ok) throw new Error(`Google Drive upload failed for ${m.filename} (${res.status})`);
    fileId = (await res.json()).id;
  }
  return fileId;
}

// The whole backup run: data file + any photos/videos not yet copied.
export async function runDriveBackup(labId) {
  const sql = db();
  const key = `google:${labId}`;
  const g = await getSetting(key);
  if (!g?.refresh_token) throw new Error("Google Drive isn't connected");
  const [lab] = await sql`SELECT name, slug, status FROM labs WHERE id = ${labId}`;
  if (!lab || lab.status !== "active") throw new Error("Lab is not active");
  await patchSetting(key, { running_since: new Date().toISOString() });
  try {
    const token = await googleAccessToken(g);
    let { folder_id, media_folder_id } = g;
    if (!folder_id || !(await folderExists(token, folder_id))) {
      folder_id = (await createFolder(token, `${lab.name} Backups`)).id;
      media_folder_id = null;
    }
    if (!media_folder_id || !(await folderExists(token, media_folder_id))) {
      media_folder_id = (await createFolder(token, "Photos & videos", folder_id)).id;
      await sql`UPDATE media SET drive_file_id = NULL WHERE lab_id = ${labId}`;
    }
    const data = await exportAll(labId);
    const stamp = data.exported_at.slice(0, 16).replace("T", "_").replace(":", "-");
    const file = await uploadSmall(token, { name: `${lab.slug}-backup-${stamp}.json`, mimeType: "application/json", parent: folder_id, data: JSON.stringify(data, null, 2) });
    const pending = await sql`SELECT * FROM media WHERE lab_id = ${labId} AND complete AND drive_file_id IS NULL ORDER BY id`;
    let copied = 0;
    const started = Date.now();
    for (const m of pending) {
      if (Date.now() - started > 12 * 60 * 1000) break; // stay inside the 15-minute limit; the rest goes next run
      const id = await uploadMediaFile(token, m, media_folder_id);
      await sql`UPDATE media SET drive_file_id = ${id} WHERE id = ${m.id}`;
      copied++;
    }
    const counts = Object.fromEntries(Object.entries(data.tables).map(([k, v]) => [k, v.length]));
    const left = pending.length - copied;
    const status = `OK: saved ${file.webViewLink ? "backup file" : "file"} with ${counts.protocols} protocols, ${counts.inventory_items} inventory items, ${counts.pi_activities} tenure entries; copied ${copied} new photo/video file(s)${left ? ` (${left} left for next run)` : ""}.`;
    await patchSetting(key, {
      folder_id, media_folder_id, running_since: null,
      folder_link: `https://drive.google.com/drive/folders/${folder_id}`,
      last_run: new Date().toISOString(), last_status: status, last_ok: true, last_file_link: file.webViewLink || null,
    });
    return status;
  } catch (e) {
    await patchSetting(key, { running_since: null, last_run: new Date().toISOString(), last_status: `Failed: ${e.message}`, last_ok: false });
    throw e;
  }
}

export async function triggerBackgroundBackup(siteUrl, labId) {
  const secret = await internalSecret();
  const res = await fetch(new URL("/.netlify/functions/drive-backup", siteUrl), {
    method: "POST", headers: { "x-labhub-secret": secret, "Content-Type": "application/json" }, body: JSON.stringify({ labId }),
  });
  return res.status;
}

// Labs that have connected Google Drive.
export async function driveConnectedLabs() {
  const sql = db();
  const rows = await sql`SELECT key, value FROM app_settings WHERE key LIKE 'google:%'`;
  return rows.filter((r) => r.value?.refresh_token).map((r) => Number(r.key.split(":")[1]));
}
