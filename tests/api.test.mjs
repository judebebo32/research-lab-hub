// End-to-end API tests against a real local Postgres, with Netlify Identity, Blobs,
// Google and the AI model replaced by stand-ins (see tests/stub-*.mjs).
// Run with: npm test
import { NetlifyDB } from "@netlify/database-dev";
import path from "node:path";
const ROOT = path.resolve(process.argv[2] || ".");
const db = new NetlifyDB();
const cs = await db.start();
await db.applyMigrations(ROOT + "/netlify/database/migrations");
process.env.NETLIFY_DB_URL = cs;
globalThis.Netlify = { env: { get: (k) => (k === "ADMIN_EMAILS" ? "pi@uni.edu" : process.env[k]) } };
const { default: handler } = await import(ROOT + "/netlify/functions/api.mjs");
const PI = { id: "u-pi", email: "PI@uni.edu", name: "Jude Okolie" };
const ST = { id: "u-st", email: "amy@uni.edu", name: "Amy Student" };
const ST2 = { id: "u-st2", email: "bob@uni.edu" };
let LAB = null; // X-Lab-Id sent with requests (null = server picks the user's first lab)
async function raw(user, method, path, body, headers = {}) {
  globalThis.__USER = user;
  return handler(new Request("https://x.test/api" + path, { method, body, headers: { ...(LAB ? { "x-lab-id": String(LAB) } : {}), ...headers } }));
}
async function call(user, method, path, body, lab = LAB) {
  globalThis.__USER = user;
  const r = await handler(new Request("https://x.test/api" + path, { method, body: body ? JSON.stringify(body) : undefined,
    headers: { "content-type": "application/json", ...(lab ? { "x-lab-id": String(lab) } : {}) } }));
  const j = await r.json();
  return { s: r.status, j };
}
const ok = (c, m) => { if (!c) { console.log("FAIL", m); process.exitCode = 1; } else console.log("ok  ", m); };
let r;
r = await call(null, "GET", "/me"); ok(r.s === 401, "anon -> 401");
r = await call(PI, "GET", "/me"); ok(r.j.is_platform_admin === true && r.j.labs.length === 0, "platform admin starts with no lab");
r = await call(PI, "GET", "/dashboard"); ok(r.s === 409 && r.j.code === "no_lab", "no lab yet -> 409");
r = await call(PI, "POST", "/labs/requests", { name: "Okolie Lab", slug: "Okolie Lab!", institution: "Uni", agree: true }); ok(r.s === 201 && r.j.slug === "okolie-lab" && r.j.status === "pending", "lab requested (slug cleaned)");
const LAB1 = r.j.id;
r = await call(PI, "POST", `/platform/labs/${LAB1}/approve`, {}); ok(r.j.status === "active" && r.j.storage_limit_mb === 2048, "platform admin approves lab w/ default limits");
r = await call(PI, "GET", "/me"); ok(r.j.role === "owner" && r.j.can.includes("tenure") && r.j.lab_id === LAB1, "PI is owner w/ all perms");
r = await call(PI, "POST", "/access-grants", { email: "amy@uni.edu" }); ok(r.s === 201 && r.j.link.includes("/join?lab=okolie-lab"), "invite student returns join link");
await call(PI, "POST", "/access-grants", { email: "bob@uni.edu" });
r = await call(ST, "GET", "/me"); ok(r.j.role === "student" && r.j.lab_id === LAB1, "student joins on first sign-in");
await call(ST2, "GET", "/me");
r = await call(ST, "POST", "/protocols", { title: "Western blot", steps: "1. Lyse\n2. Run gel", project: "P53" }); ok(r.s === 201, "create protocol"); const pid = r.j.id;
r = await call(ST2, "GET", "/protocols/" + pid); ok(r.s === 403, "other student can't view draft");
r = await call(ST, "PUT", "/protocols/" + pid, { steps: "1. Lyse\n2. Run gel\n3. Transfer", submit: true }); ok(r.j.version === 2 && r.j.status === "submitted", "edit+submit -> v2 submitted");
r = await call(ST, "POST", `/protocols/${pid}/review`, { decision: "approved" }); ok(r.s === 403, "student can't approve");
r = await call(PI, "GET", "/protocols?scope=all&status=submitted"); ok(r.j.length === 1, "review queue has 1");
r = await call(PI, "POST", `/protocols/${pid}/review`, { decision: "changes_requested", comment: "Add antibody dilution" }); ok(r.s === 200, "request changes");
r = await call(ST, "GET", "/dashboard"); ok(r.j.needsAttention.length === 1, "student sees needs-changes");
r = await call(ST, "POST", `/protocols/${pid}/submit`); ok(r.s === 200, "resubmit");
r = await call(PI, "POST", `/protocols/${pid}/review`, { decision: "approved", comment: "Great" }); ok(r.s === 200, "approve");
r = await call(ST2, "GET", "/protocols/" + pid); ok(r.s === 200 && r.j.comments.length === 2 && r.j.versions.length === 2, "approved visible in library w/ comments+versions");
r = await call(ST2, "GET", "/protocols?scope=library"); ok(r.j.length === 1, "library list");
r = await call(ST, "PUT", "/protocols/" + pid, { notes: "tip" }); ok(r.j.status === "submitted" && r.j.version === 3, "editing approved -> back to review");
r = await call(ST, "GET", `/protocols/${pid}/versions/1`); ok(r.j.snapshot.title === "Western blot", "version snapshot");
r = await call(ST2, "POST", `/protocols/${pid}/duplicate`); ok(r.s === 403, "can't duplicate non-approved others'");
r = await call(ST, "POST", "/inventory", { name: "Ethanol 70%", category: "Chemicals & reagents", quantity: 5, unit: "L", min_quantity: 2, expiry_date: "2026-12-01" }); ok(r.s === 201, "add item"); const iid = r.j.id;
r = await call(ST2, "POST", `/inventory/${iid}/adjust`, { change: -3.5, reason: "cleaning" }); ok(Number(r.j.quantity) === 1.5, "use 3.5");
r = await call(PI, "GET", "/dashboard"); ok(r.j.lowStock.length === 1 && r.j.expiring.length === 1 && r.j.lab.members === 3, "admin dashboard alerts");
r = await call(ST, "PUT", `/inventory/${iid}`, { location: "Flammables cabinet" }); ok(r.j.location === "Flammables cabinet" && Number(r.j.min_quantity) === 2, "edit item keeps fields");
r = await call(ST, "DELETE", `/inventory/${iid}`); ok(r.s === 403, "student can't delete item");
r = await call(PI, "GET", `/inventory/${iid}/transactions`); ok(r.j.length === 1, "transactions");
r = await call(ST, "GET", "/inventory?q=ethanol"); ok(r.j.length === 1, "search inventory");
r = await call(ST, "GET", "/activity"); ok(r.j.every((a) => a.member_id === "u-st"), "student sees only own activity");
r = await call(PI, "GET", "/activity?member=u-st2"); ok(r.j.length >= 1 && r.j.every((a) => a.member_id === "u-st2"), "admin filters by member");
r = await call(ST, "GET", "/members"); ok(r.s === 403, "student can't list members");
r = await call(PI, "GET", "/members"); ok(r.j.length === 3 && r.j.find((m) => m.id === "u-st").approved_count === 0, "members list w/ stats");
r = await call(PI, "PUT", "/members/u-pi", { role: "student" }); ok(r.s === 200 && r.j.role === "owner", "PI demote ignored");
r = await call(PI, "PUT", "/members/u-st2", { active: false, position: "MS student" }); ok(r.j.active === false, "deactivate");
r = await call(ST2, "GET", "/dashboard"); ok(r.s === 409, "removed member has no lab access");
r = await call(ST, "GET", "/pi-activities"); ok(r.s === 403, "student can't see tenure");
r = await call(PI, "POST", "/pi-activities", { category: "grant", title: "NSF CAREER", amount: 550000, status: "Funded", start_date: "2026-07-01", role: "PI" }); ok(r.s === 201, "log grant");
r = await call(PI, "POST", "/pi-activities", { category: "publication", title: "Paper in JACS", start_date: "2025-03-01" }); ok(r.s === 201, "log pub");
r = await call(PI, "POST", "/pi-activities", { category: "nope", title: "x" }); ok(r.s === 400, "bad category rejected");
r = await call(PI, "GET", "/pi-activities?year=2026"); ok(r.j.length === 1, "filter by year");
r = await call(PI, "GET", "/pi-activities/summary"); ok(r.j.byYear.length === 2, "summary");
r = await call(PI, "GET", "/nope"); ok(r.s === 404, "404 route");
// --- admin permissions ---
const CO = { id: "u-co", email: "co@uni.edu", name: "Dr. Co" };
r = await call(ST, "POST", "/access-grants", { email: "co@uni.edu", permissions: ["review_protocols"] }); ok(r.s === 403, "student can't add admins");
r = await call(PI, "POST", "/access-grants", { email: "CO@uni.edu", role: "admin", permissions: ["review_protocols", "bogus"] }); ok(r.s === 201 && r.j.grant.permissions.length === 1, "owner pre-approves admin (bad perm dropped)");
r = await call(CO, "GET", "/me"); ok(r.j.role === "admin" && r.j.can.join() === "review_protocols", "grant applied at first sign-in");
r = await call(PI, "GET", "/access-grants"); ok(r.j.grants.length === 0, "grant consumed");
r = await call(ST, "POST", "/protocols", { title: "PCR", submit: true }); const p2 = r.j.id;
r = await call(ST2, "GET", "/protocols/" + p2); ok(r.s === 403 || r.s === 409, "submitted protocol hidden from other students until approved");
r = await call(CO, "GET", "/protocols/" + p2); ok(r.s === 200 && r.j.can_review === true, "reviewer admin sees it");
r = await call(CO, "POST", `/protocols/${p2}/review`, { decision: "approved" }); ok(r.s === 200, "reviewer admin approves");
r = await call(CO, "PUT", "/protocols/" + p2, { notes: "x" }); ok(r.s === 403, "reviewer without edit perm can't edit");
r = await call(CO, "GET", "/pi-activities"); ok(r.s === 403, "co-admin can't see tenure");
r = await call(CO, "DELETE", `/inventory/${iid}`); ok(r.s === 403, "co-admin can't delete inventory");
r = await call(CO, "GET", "/activity"); ok(r.j.every((a) => a.member_id === "u-co"), "co-admin sees only own activity");
r = await call(CO, "GET", "/members"); ok(r.s === 403, "co-admin can't list members");
r = await call(PI, "PUT", "/members/u-co", { permissions: ["review_protocols", "manage_members", "tenure"] }); ok(r.j.permissions.length === 3, "owner changes admin perms");
r = await call(CO, "PUT", "/members/u-pi", { position: "x" }); ok(r.s === 403, "admin can't edit owner");
r = await call(CO, "PUT", "/members/u-st", { role: "admin", position: "PhD student" }); ok(r.s === 200 && r.j.role === "student" && r.j.position === "PhD student", "manage_members edits student but can't promote");
r = await call(CO, "GET", "/pi-activities"); ok(r.s === 200 && r.j.length === 0, "co-admin's own tenure is separate from PI's");
r = await call(CO, "GET", "/backup"); ok(r.s === 403, "only owner can back up");
r = await call(PI, "GET", "/backup"); ok(r.s === 200 && r.j.tables.protocols.length >= 2 && r.j.tables.members.length === 4, "owner backup has all tables");
r = await call(PI, "POST", "/access-grants", { email: "amy@uni.edu", role: "admin", permissions: ["view_activity"] }); ok(r.j.applied === true, "existing member promoted immediately");
r = await call(ST, "GET", "/me"); ok(r.j.role === "admin" && r.j.can.join() === "view_activity", "promotion visible to member");
r = await call(PI, "PUT", "/members/u-pi", { role: "student" }); ok(r.s === 200 && r.j.role === "owner", "owner can't demote self");
// --- media ---
const SIZE = 7 * 1024 * 1024 + 123;
const vid = new Uint8Array(SIZE); for (let i = 0; i < SIZE; i++) vid[i] = i % 251;
r = await call(ST, "POST", "/media", { filename: "../evil.txt", content_type: "text/plain", size: 10 }); ok(r.s === 400, "non-media rejected");
r = await call(ST, "POST", "/media", { filename: "big.jpg", content_type: "image/jpeg", size: 4 * 1024 * 1024 }); ok(r.s === 400, "oversized photo rejected");
r = await call(ST, "POST", "/media", { filename: "western.mp4", content_type: "video/mp4", size: SIZE }); ok(r.s === 201 && r.j.chunks === 3, "video upload created (3 parts)"); const mv = r.j;
let rr = await raw(ST2, "PUT", `/media/${mv.id}/chunks/0`, vid.slice(0, mv.chunk_size), { "content-type": "application/octet-stream" }); ok(rr.status === 403 || rr.status === 409, "others can't upload into your file");
for (let n = 0; n < 2; n++) { rr = await raw(ST, "PUT", `/media/${mv.id}/chunks/${n}`, vid.slice(n * mv.chunk_size, (n + 1) * mv.chunk_size), { "content-type": "application/octet-stream" }); }
r = await call(ST, "POST", `/media/${mv.id}/complete`); ok(r.s === 400, "incomplete upload can't finish");
rr = await raw(ST, "PUT", `/media/${mv.id}/chunks/2`, vid.slice(2 * mv.chunk_size), { "content-type": "application/octet-stream" }); ok(rr.status === 200, "last part uploaded");
r = await call(ST, "POST", `/media/${mv.id}/complete`); ok(r.j.token === `[[video:${mv.id}]]`, "complete returns token");
rr = await raw(ST, "GET", `/media/${mv.id}`, undefined, { range: "bytes=0-" }); let b = new Uint8Array(await rr.arrayBuffer());
ok(rr.status === 206 && b.length === mv.chunk_size && rr.headers.get("content-range") === `bytes 0-${mv.chunk_size - 1}/${SIZE}`, "range from start returns first part");
rr = await raw(ST, "GET", `/media/${mv.id}`, undefined, { range: `bytes=${SIZE - 100}-` }); b = new Uint8Array(await rr.arrayBuffer());
ok(rr.status === 206 && b.length === 100 && b[0] === (SIZE - 100) % 251, "range near end returns right bytes");
rr = await raw(ST, "GET", `/media/${mv.id}`, undefined, { range: `bytes=${mv.chunk_size - 5}-${mv.chunk_size + 5}` }); b = new Uint8Array(await rr.arrayBuffer());
ok(b.length === 5 && b[4] === (mv.chunk_size - 1) % 251, "range across parts trimmed to one part");
rr = await raw(ST2, "GET", `/media/${mv.id}`); ok(rr.status === 403, "other student can't see unlinked video");
r = await call(ST, "POST", "/protocols", { title: "Gel demo", steps: `1. Load gel\n[[video:${mv.id}]]\n2. Run`, submit: true }); const pv = r.j.id;
rr = await raw(ST2, "GET", `/media/${mv.id}`); ok(rr.status === 403, "still hidden while protocol awaits review");
rr = await raw(CO, "GET", `/media/${mv.id}`); ok(rr.status === 206 || rr.status === 200, "reviewer can watch it");
await call(PI, "POST", `/protocols/${pv}/review`, { decision: "approved" });
const ST3 = { id: "u-st3", email: "cy@uni.edu" }; await call(PI, "POST", "/access-grants", { email: "cy@uni.edu" }); await call(ST3, "GET", "/me");
rr = await raw(ST3, "GET", `/media/${mv.id}`, undefined, { range: "bytes=0-99" }); ok(rr.status === 206, "visible to lab once approved");
r = await call(ST, "POST", "/media", { filename: "gel.jpg", content_type: "image/jpeg", size: 1000 }); const mi = r.j;
await raw(ST, "PUT", `/media/${mi.id}/chunks/0`, new Uint8Array(1000), { "content-type": "application/octet-stream" });
await call(ST, "POST", `/media/${mi.id}/complete`);
rr = await raw(ST, "GET", `/media/${mi.id}`); ok(rr.status === 200 && rr.headers.get("content-type") === "image/jpeg" && (await rr.arrayBuffer()).byteLength === 1000, "photo served whole");
r = await call(PI, "GET", "/backup"); ok(r.j.tables.media.length === 2, "backup lists media");
// --- Google Drive backup (simulated Google) ---
const gcalls = [];
const realFetch = globalThis.fetch;
let mediaUploaded = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith("https://oauth2.googleapis.com/token")) { gcalls.push("token"); const b = String(init.body); return Response.json(b.includes("authorization_code") ? { access_token: "at", refresh_token: "rt" } : { access_token: "at" }); }
  if (u.includes("/drive/v3/about")) return Response.json({ user: { emailAddress: "owner@example.com" } });
  if (u.includes("/drive/v3/files?fields")) { gcalls.push("folder"); return Response.json({ id: "fold" + gcalls.length }); }
  if (u.includes("/drive/v3/files/")) return Response.json({ id: "x", trashed: false });
  if (u.includes("uploadType=multipart")) { gcalls.push("json"); return Response.json({ id: "j1", webViewLink: "https://drive.google.com/file/d/j1" }); }
  if (u.includes("uploadType=resumable")) return new Response(null, { status: 200, headers: { location: "https://upload.example/session" } });
  if (u.startsWith("https://upload.example/session")) { const r = init.headers["Content-Range"]; const [, , end, total] = r.match(/bytes (\d+)-(\d+)\/(\d+)/); if (Number(end) + 1 < Number(total)) return new Response(null, { status: 308 }); mediaUploaded++; return Response.json({ id: "m" + mediaUploaded }); }
  if (u.includes("/.netlify/functions/drive-backup")) { gcalls.push("trigger"); return new Response(null, { status: 202 }); }
  return realFetch(url, init);
};
r = await call(CO, "GET", "/drive"); ok(r.s === 403, "only owner sees Drive settings");
r = await call(PI, "GET", "/drive"); ok(r.j.connected === false && r.j.redirect_uri.endsWith("/api/drive/callback"), "drive status (not connected)");
r = await call(PI, "PUT", "/drive/credentials", { client_id: "bad", client_secret: "x" }); ok(r.s === 400, "bad client id rejected");
r = await call(PI, "PUT", "/drive/credentials", { client_id: "123-abc.apps.googleusercontent.com", client_secret: "GOCSPX-secretsecret" }); ok(r.s === 200, "credentials saved");
r = await call(PI, "GET", "/drive"); ok(r.j.has_credentials && !("client_secret" in r.j), "secret never sent back to browser");
r = await call(PI, "POST", "/drive/run"); ok(r.s === 400, "can't run before connecting");
r = await call(PI, "POST", "/drive/connect"); const au = new URL(r.j.url); ok(au.host === "accounts.google.com" && au.searchParams.get("scope").endsWith("drive.file") && au.searchParams.get("access_type") === "offline", "connect URL asks only for app-created files, offline");
const state = au.searchParams.get("state");
let cr = await raw(PI, "GET", `/drive/callback?code=abc&state=WRONG`); ok(cr.status === 302 && cr.headers.get("location").includes("drive_error=expired"), "bad state rejected");
cr = await raw(PI, "GET", `/drive/callback?code=abc&state=${state}`); ok(cr.status === 302 && cr.headers.get("location").includes("drive=connected"), "callback connects");
r = await call(PI, "GET", "/drive"); ok(r.j.connected && r.j.email === "owner@example.com" && r.j.folder_link.includes("drive.google.com"), "connected status shows account + folder");
ok(gcalls.includes("trigger"), "first backup triggered after connecting");
const { runDriveBackup } = await import(ROOT + "/lib/backup.mjs");
const status = await runDriveBackup(LAB1); ok(status.startsWith("OK") && status.includes("copied 2 new"), "backup run uploads data file + 2 media files: " + status);
const again = await runDriveBackup(LAB1); ok(again.includes("copied 0 new"), "second run copies only new media");
r = await call(PI, "GET", "/drive"); ok(r.j.last_ok === true && r.j.media_pending === 0, "status shows last backup OK");
r = await call(PI, "POST", "/drive/disconnect"); r = await call(PI, "GET", "/drive"); ok(!r.j.connected && r.j.has_credentials, "disconnect keeps credentials, drops access");
// --- AI import ---
let triggered = null;
globalThis.fetch = async (url, init = {}) => { if (String(url).includes("/.netlify/functions/tenure-ai")) { triggered = JSON.parse(init.body).jobId; return new Response(null, { status: 202 }); } return realFetch(url, init); };
r = await call(ST3, "POST", "/tenure-ai/jobs", { text: "x" }); ok(r.s === 403, "students can't use AI import");
r = await call(PI, "POST", "/tenure-ai/jobs", { text: "" }); ok(r.s === 400, "empty input rejected");
r = await call(PI, "POST", "/tenure-ai/jobs", { name: "cv.pdf", text: "Okolie CV ...", pdf_base64: "JVBERi0x" }); ok(r.s === 202 && triggered === r.j.id, "job created and background started"); const jid = r.j.id;
const { runTenureJob } = await import(ROOT + "/lib/tenureAi.mjs");
await runTenureJob(jid);
ok(globalThis.__AI_REQ.messages[0].content.some((c) => c.type === "document") && globalThis.__AI_REQ.model === "claude-sonnet-5-5", "PDF sent to Claude as a document");
r = await call(PI, "GET", `/tenure-ai/jobs/${jid}`); const items = r.j.result?.items || [];
ok(r.j.status === "done" && items.length === 3, "3 valid entries returned (bad category dropped)");
ok(items[0].duplicate === true && items[1].duplicate === false, "existing paper flagged as duplicate");
ok(items[0].start_date === "2025-01-01" && items[1].start_date === "2023-07-01", "dates normalised");
ok(items[2].link === "" && items[0].amount === null && items[1].amount === 1800000, "unsafe link removed, amounts only on grants");
r = await call(CO, "GET", `/tenure-ai/jobs/${jid}`); ok(r.s === 404, "other admins can't read your AI job");
const before = (await call(PI, "GET", "/pi-activities")).j.length;
r = await call(PI, "POST", "/pi-activities/bulk", { items: items.filter((x) => !x.duplicate).map(({ duplicate, ...x }) => x) }); ok(r.j.added === 2, "bulk add 2 selected");
const after = (await call(PI, "GET", "/pi-activities")).j; ok(after.length === before + 2 && after.some((a) => a.title.startsWith("NIH R01") && Number(a.amount) === 1800000), "entries saved to tenure record");
globalThis.fetch = realFetch;

// --- multi-lab isolation ---
const P2 = { id: "u-p2", email: "prof2@other.edu", name: "Prof Two" };
r = await call(P2, "POST", "/labs/requests", { name: "Second Lab", slug: "okolie-lab", institution: "Other U", agree: true }); ok(r.s === 400, "taken short name rejected");
r = await call(P2, "POST", "/labs/requests", { name: "Second Lab", slug: "second", institution: "Other U" }); ok(r.s === 400, "must agree to terms");
r = await call(P2, "POST", "/labs/requests", { name: "Second Lab", slug: "second", institution: "Other U", agree: true }); const LAB2 = r.j.id; ok(r.s === 201, "second professor requests a lab");
r = await call(P2, "GET", "/me"); ok(r.j.labs.length === 0 && r.j.requests[0].status === "pending", "request shows as pending");
r = await call(P2, "GET", "/platform/labs"); ok(r.s === 403, "only platform admin sees all labs");
r = await call(PI, "GET", "/platform/labs"); ok(r.j.length === 2 && r.j[0].status === "pending", "platform admin sees pending first");
r = await call(PI, "POST", `/platform/labs/${LAB2}/approve`, {}); ok(r.j.status === "active", "approved");
r = await call(P2, "GET", "/me"); ok(r.j.role === "owner" && r.j.lab.slug === "second", "second professor owns their lab");
r = await call(P2, "GET", "/protocols?scope=all"); ok(r.j.length === 0, "new lab sees none of lab 1's protocols");
r = await call(P2, "GET", `/protocols/${pid}`); ok(r.s === 404, "can't open lab 1 protocol by id");
r = await call(P2, "GET", "/inventory", undefined, LAB1); ok(r.s === 409, "can't pick a lab you're not in");
r = await call(P2, "GET", "/pi-activities"); ok(r.j.length === 0, "tenure records are private per person");
rr = await raw(P2, "GET", `/media/${mi.id}`); ok(rr.status === 403, "can't view lab 1 photos");
r = await call(P2, "PUT", "/lab", { name: "Second Lab Hub", slug: "second-lab", department: "ChemE" }); ok(r.j.slug === "second-lab" && r.j.name === "Second Lab Hub", "owner renames lab + short name");
r = await call(ST3, "PUT", "/lab", { name: "Hacked" }); ok(r.s === 403, "students can't rename lab");
r = await call(null, "GET", "/public/labs/second-lab"); ok(r.s === 200 && r.j.name === "Second Lab Hub" && !("status" in r.j), "public lab info for join page");
// co-advised student in both labs
r = await call(P2, "POST", "/access-grants", { email: "cy@uni.edu" }); ok(r.j.applied === true, "existing user added to second lab immediately");
r = await call(ST3, "GET", "/me"); ok(r.j.labs.length === 2, "student sees two labs");
r = await call(ST3, "POST", "/protocols", { title: "Lab2 only" }, LAB2); const pLab2 = r.j.id;
r = await call(ST3, "GET", "/protocols?scope=mine", undefined, LAB1); ok(!r.j.some((x) => x.id === pLab2), "lab switch keeps data separate");
r = await call(P2, "GET", "/protocols?scope=all"); ok(r.j.some((x) => x.id === pLab2), "lab 2 owner sees it");
// limits
await call(PI, "POST", `/platform/labs/${LAB2}/limits`, { storage_limit_mb: 1, ai_monthly_limit: 0 });
r = await call(P2, "POST", "/media", { filename: "big.mp4", content_type: "video/mp4", size: 2 * 1024 * 1024 }); ok(r.s === 413, "storage limit enforced");
r = await call(P2, "POST", "/tenure-ai/jobs", { text: "cv" }); ok(r.s === 429, "AI monthly limit enforced");
r = await call(P2, "GET", "/lab"); ok(r.j.storage_limit_mb === 1 && r.j.ai_monthly_limit === 0, "lab usage/limits visible to owner");
await call(PI, "POST", `/platform/labs/${LAB2}/suspend`, { note: "test" });
r = await call(P2, "GET", "/dashboard"); ok(r.s === 409, "suspended lab is closed");
r = await call(PI, "GET", "/dashboard", undefined, LAB1); ok(r.s === 200, "other labs unaffected");
r = await call(PI, "GET", "/platform/labs"); ok(r.j.every((l) => !("protocols" in l)), "platform view has no content counts");

// --- deleting a lab and accounts ---
await call(PI, "POST", `/platform/labs/${LAB2}/reactivate`, {});
r = await call(ST3, "DELETE", "/lab", { confirm: "second-lab" }, LAB2); ok(r.s === 403, "only the owner can delete a lab");
r = await call(P2, "DELETE", "/lab", { confirm: "wrong" }); ok(r.s === 400, "wrong confirmation rejected");
r = await call(P2, "DELETE", "/lab", { confirm: "second-lab" }); ok(r.s === 200, "owner deletes lab");
r = await call(ST3, "GET", "/me"); ok(r.j.labs.length === 1 && r.j.labs[0].lab_id === LAB1, "members lose the deleted lab only");
r = await call(PI, "GET", "/platform/labs"); ok(!r.j.some((l) => l.id === LAB2), "deleted lab is gone from the platform");
r = await call(PI, "DELETE", "/me", { confirm: "pi@uni.edu" }); ok(r.s === 400, "lab owners must delete their lab before their account");
r = await call(P2, "POST", "/pi-activities", { category: "award", title: "Teaching award" });
r = await call(P2, "DELETE", "/me", { confirm: "nope@x.com" }); ok(r.s === 400, "account delete needs email confirmation");
r = await call(P2, "DELETE", "/me", { confirm: "prof2@other.edu" }); ok(r.s === 200 && globalThis.__DELETED_USERS.includes("u-p2"), "account deleted incl. sign-in");
r = await call(P2, "GET", "/me"); ok(r.s === 403, "deleted account can't be used");
r = await call(ST3, "DELETE", "/me", { confirm: "cy@uni.edu" }); ok(r.s === 200, "student deletes account");
r = await call(PI, "GET", "/members", undefined, LAB1); ok(!r.j.some((m) => m.id === "u-st3"), "removed from lab member list");
await db.stop();
console.log(process.exitCode ? "\nSOME TESTS FAILED" : "\nALL TESTS PASSED");
process.exit(process.exitCode || 0);
