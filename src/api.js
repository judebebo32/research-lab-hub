// Tiny fetch wrapper. The Netlify Identity cookie (nf_jwt) is sent automatically.
async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const e = new Error(data?.error || `Request failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return data;
}

export const api = {
  get: (p) => request("GET", p),
  post: (p, b = {}) => request("POST", p, b),
  put: (p, b = {}) => request("PUT", p, b),
  del: (p) => request("DELETE", p),
};

export const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
export const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
export const isoDate = (d) => (d ? String(d).slice(0, 10) : "");
export const who = (r) => r?.full_name || r?.author_name || r?.email || r?.author_email || "Unknown";

export function downloadCSV(filename, rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => esc(c.label)).join(",");
  const lines = rows.map((r) => columns.map((c) => esc(typeof c.value === "function" ? c.value(r) : r[c.value])).join(","));
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const STATUS_LABELS = {
  draft: "Draft",
  submitted: "Awaiting review",
  changes_requested: "Changes requested",
  approved: "Approved",
  archived: "Archived",
};

export const ACTION_LABELS = {
  protocol_created: "created protocol",
  protocol_submitted: "submitted for review",
  protocol_edited: "edited protocol",
  protocol_approved: "approved protocol",
  protocol_changes_requested: "requested changes on",
  protocol_commented: "commented on",
  protocol_archived: "archived protocol",
  inventory_added: "added to inventory",
  inventory_edited: "updated item",
  inventory_used: "",
  inventory_restocked: "",
  inventory_removed: "removed item",
  member_updated: "updated member",
  admin_preapproved: "pre-approved admin",
  backup_downloaded: "downloaded",
  media_uploaded: "uploaded",
  drive_connected: "",
  drive_disconnected: "",
  drive_backup_started: "",
  drive_settings: "",
  ai_import_started: "ran AI import on",
};
