import { useEffect, useState } from "react";
import { useMe } from "../App.jsx";
import { api, isoDate } from "../api.js";
import { useApi, ErrorMsg, PageHead, Loading } from "../ui.jsx";
import DriveBackup from "./DriveBackup.jsx";

const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const mb = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n} MB`);

export default function LabSettings() {
  const { reloadMe } = useMe();
  const { data: lab, error, reload } = useApi("/lab");
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [backupMsg, setBackupMsg] = useState("");

  useEffect(() => {
    if (lab) setF({ name: lab.name, slug: lab.slug, institution: lab.institution || "", department: lab.department || "", website: lab.website || "" });
  }, [lab]);

  const save = async (e) => {
    e.preventDefault(); setMsg(""); setErr("");
    try { await api.put("/lab", f); await reload(); await reloadMe(); setMsg("Saved."); } catch (x) { setErr(x.message); }
  };

  const downloadBackup = async () => {
    setBackupMsg("Preparing backup…");
    try {
      const b = await api.get("/backup");
      const blob = new Blob([JSON.stringify(b, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${lab.slug}-backup-${isoDate(b.exported_at)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      const n = Object.values(b.tables).reduce((s, t) => s + t.length, 0);
      setBackupMsg(`Downloaded ${n} records.`);
    } catch (x) { setBackupMsg(x.message); }
  };

  if (error) return <ErrorMsg error={error} />;
  if (!lab || !f) return <Loading />;
  const storagePct = lab.storage_limit_mb ? Math.min(100, Math.round((lab.storage_used_mb / lab.storage_limit_mb) * 100)) : null;

  return (
    <>
      <PageHead title="Lab settings" sub="Only you (the lab owner) can see this page." />
      <div className="grid2">
        <form className="card form" onSubmit={save}>
          <h2>Lab details</h2>
          <label>Lab name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>Short name (used in invite links)
            <input value={f.slug} onChange={(e) => setF({ ...f, slug: slugify(e.target.value) })} />
            <span className="muted small">Changing it makes older invite links stop working — re-send any pending invites.</span>
          </label>
          <label>Institution<input value={f.institution} onChange={(e) => setF({ ...f, institution: e.target.value })} /></label>
          <label>Department<input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></label>
          <label>Web page<input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://" /></label>
          {msg && <p className="ok">{msg}</p>}
          <ErrorMsg error={err} />
          <div className="row end"><button>Save</button></div>
        </form>

        <section className="card">
          <h2>Usage</h2>
          <div className="usage">
            <div className="usage-row"><span>Photo & video storage</span>
              <strong>{mb(lab.storage_used_mb)}{lab.storage_limit_mb != null ? ` of ${mb(lab.storage_limit_mb)}` : " (unlimited)"}</strong></div>
            {storagePct != null && <div className="bar"><div style={{ width: `${storagePct}%` }} className={storagePct > 85 ? "hot" : ""} /></div>}
            <div className="usage-row"><span>AI imports this month</span>
              <strong>{lab.ai_used_this_month}{lab.ai_monthly_limit != null ? ` of ${lab.ai_monthly_limit}` : " (unlimited)"}</strong></div>
          </div>
          <p className="muted small">Need more? Contact the platform admin.</p>
          <h2 style={{ marginTop: "1.2rem" }}>Backup</h2>
          <p className="small">Download everything in this lab (members, protocols with all versions, inventory, activity, and your tenure record).</p>
          <button className="ghost" onClick={downloadBackup}>⬇ Download full backup</button>
          {backupMsg && <p className="ok">{backupMsg}</p>}
        </section>
      </div>
      <DriveBackup labName={lab.name} />
      <DeleteLab lab={lab} />
    </>
  );
}

function DeleteLab({ lab }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const del = async (e) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try { await api.del("/lab", { confirm }); window.location.assign("/"); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <section className="card danger-zone">
      <h2>Delete this lab</h2>
      <p className="small">Permanently removes <strong>{lab.name}</strong> and everything in it — all protocols and their versions, photos and videos, inventory, activity and memberships — from the platform. Your own tenure record is not affected. <strong>Download a backup first</strong>; this can't be undone.</p>
      {!open ? <button className="ghost danger" onClick={() => setOpen(true)}>Delete lab…</button> : (
        <form className="form" onSubmit={del}>
          <label>Type <code>{lab.slug}</code> to confirm<input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" /></label>
          <ErrorMsg error={err} />
          <div className="row">
            <button type="button" className="ghost" onClick={() => { setOpen(false); setConfirm(""); }}>Cancel</button>
            <button className="danger-btn" disabled={busy || confirm.trim() !== lab.slug}>{busy ? "Deleting…" : "Permanently delete lab"}</button>
          </div>
        </form>
      )}
    </section>
  );
}
