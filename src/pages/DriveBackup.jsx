import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, fmtDateTime } from "../api.js";
import { useApi, ErrorMsg } from "../ui.jsx";

const ERRORS = {
  expired: "The Google sign-in took too long or was opened twice. Please click Connect again.",
  access_denied: "Google access wasn't granted. Click Connect again and choose Allow.",
  no_refresh_token: "Google didn't give the app lasting access. In Google Cloud, make sure the app is Published (not Testing), then connect again.",
};

export default function DriveBackup({ labName = "Lab" }) {
  const LAB_NAME = labName;
  const { data, error, reload } = useApi("/drive");
  const [params, setParams] = useSearchParams();
  const [f, setF] = useState({ client_id: "", client_secret: "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    if (params.get("drive") === "connected") setMsg("Google Drive connected. The first backup is running now.");
    const e = params.get("drive_error");
    if (e) setErr(ERRORS[e] || `Google Drive: ${e}`);
    if (params.get("drive") || e) setParams({}, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh status while a backup is running.
  useEffect(() => {
    if (!data?.running) return;
    const t = setInterval(reload, 8000);
    return () => clearInterval(t);
  }, [data?.running, reload]);

  const act = async (fn) => {
    setBusy(true); setErr(""); setMsg("");
    try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); reload(); }
  };

  if (!data) return error ? <ErrorMsg error={error} /> : null;
  const uri = data.redirect_uri;

  return (
    <section className="card drive-card">
      <div className="card-head">
        <h2>Google Drive backup</h2>
        {data.connected && <span className="badge st-ok">Connected</span>}
      </div>

      {data.connected ? (
        <>
          <p className="small">
            Backing up automatically <strong>every Sunday night</strong> to{" "}
            {data.folder_link ? <a href={data.folder_link} target="_blank" rel="noreferrer">{`“${LAB_NAME} Backups”`}</a> : "your Drive"}
            {data.email && <> in <strong>{data.email}</strong></>}. Each backup saves all records plus any new photos and videos.
          </p>
          <div className="drive-status">
            {data.running ? <span className="muted">⏳ Backup in progress…</span> : data.last_run ? (
              <span className={data.last_ok ? "" : "error"}>
                Last backup {fmtDateTime(data.last_run)}: {data.last_status}
                {data.last_file_link && <> · <a href={data.last_file_link} target="_blank" rel="noreferrer">open file</a></>}
              </span>
            ) : <span className="muted">No backup yet.</span>}
            {data.media_pending > 0 && !data.running && <div className="muted small">{data.media_pending} photo/video file(s) waiting to be copied.</div>}
          </div>
          <div className="row">
            <button disabled={busy || data.running} onClick={() => act(async () => { await api.post("/drive/run"); setMsg("Backup started. This usually takes under a minute; videos take longer."); })}>Back up now</button>
            {data.folder_link && <a className="btn ghost" href={data.folder_link} target="_blank" rel="noreferrer">Open Drive folder</a>}
            <button className="ghost danger" disabled={busy} onClick={() => { if (confirm("Stop automatic Google Drive backups? Files already in Drive stay there.")) act(() => api.post("/drive/disconnect")); }}>Disconnect</button>
          </div>
        </>
      ) : (
        <>
          <p className="small">Automatic weekly backups to your Google Drive. One-time setup: create a free Google “app” so this site may save files to your Drive (≈10 minutes), then click Connect. The app can only see the backup folder it creates, nothing else in your Drive.</p>
          <button className="link" onClick={() => setShowSetup((x) => !x)}>{showSetup ? "Hide setup steps" : "Show setup steps"}</button>
          {showSetup && (
            <ol className="steps small">
              <li>Go to <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">console.cloud.google.com/projectcreate</a> (signed in as the Google account whose Drive should hold the backups). Name the project <em>{LAB_NAME}</em> and click <strong>Create</strong>.</li>
              <li>Open <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">Google Drive API</a> (check the new project is selected at the top) and click <strong>Enable</strong>.</li>
              <li>Open <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer">Google Auth Platform</a> → <strong>Get started</strong>. App name <em>{LAB_NAME}</em>, your email as support and contact email, Audience <strong>External</strong>. Finish and <strong>Create</strong>.</li>
              <li>Go to <a href="https://console.cloud.google.com/auth/audience" target="_blank" rel="noreferrer">Audience</a> and click <strong>Publish app</strong> → Confirm. (If you skip this, Google stops the backups after 7 days.)</li>
              <li>Go to <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">Clients</a> → <strong>Create client</strong>. Type <strong>Web application</strong>. Under <em>Authorized redirect URIs</em> click Add URI and paste exactly:
                <div className="copy-row"><code>{uri}</code> <button className="small ghost" type="button" onClick={() => navigator.clipboard?.writeText(uri)}>Copy</button></div>
                Click <strong>Create</strong>.</li>
              <li>Copy the <strong>Client ID</strong> and <strong>Client secret</strong> it shows into the boxes below and click Save. Paste them only here — not in emails or chats.</li>
              <li>Click <strong>Connect Google Drive</strong>, pick your account and click <strong>Continue/Allow</strong>. If Google shows “Google hasn’t verified this app”, click <strong>Advanced → Go to {LAB_NAME}</strong> — it’s your own app.</li>
            </ol>
          )}
          <form className="form drive-form" onSubmit={(e) => { e.preventDefault(); act(async () => { await api.put("/drive/credentials", f); setF({ client_id: "", client_secret: "" }); setMsg("Saved. Now click Connect Google Drive."); }); }}>
            <div className="grid2">
              <label>Client ID<input value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })} placeholder={data.client_id || "…apps.googleusercontent.com"} autoComplete="off" /></label>
              <label>Client secret<input type="password" value={f.client_secret} onChange={(e) => setF({ ...f, client_secret: e.target.value })} placeholder={data.has_credentials ? "Saved ••••••" : "GOCSPX-…"} autoComplete="off" /></label>
            </div>
            <div className="row">
              <button className="secondary" disabled={busy || !f.client_id || !f.client_secret}>Save</button>
              <button type="button" disabled={busy || !data.has_credentials} onClick={() => act(async () => { const r = await api.post("/drive/connect"); window.location.assign(r.url); })}>Connect Google Drive</button>
            </div>
          </form>
        </>
      )}
      {msg && <p className="ok">{msg}</p>}
      {err && <p className="error">{err}</p>}
    </section>
  );
}
