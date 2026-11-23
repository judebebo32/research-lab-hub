import { useState } from "react";
import { updateUser, logout } from "@netlify/identity";
import { useMe } from "../App.jsx";
import { api } from "../api.js";
import { PageHead, ErrorMsg } from "../ui.jsx";

export default function Profile() {
  const { me, reloadMe } = useMe();
  const [f, setF] = useState({ full_name: me.full_name || "", position: me.position || "" });
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const saveProfile = async (e) => {
    e.preventDefault(); setMsg(""); setError("");
    try { await api.put("/me", f); await reloadMe(); setMsg("Profile saved."); } catch (err) { setError(err.message); }
  };
  const savePw = async (e) => {
    e.preventDefault(); setMsg(""); setError("");
    if (pw.length < 8) return setError("Use at least 8 characters.");
    try { await updateUser({ password: pw }); setPw(""); setMsg("Password changed."); } catch (err) { setError(err.message); }
  };

  return (
    <>
      <PageHead title="My profile" sub={me.email} />
      <div className="grid2">
        <form className="card form" onSubmit={saveProfile}>
          <h2>Details</h2>
          <label>Full name<input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></label>
          <label>Position<input value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} placeholder="e.g. PhD student, 2nd year" /></label>
          <button>Save</button>
        </form>
        <form className="card form" onSubmit={savePw}>
          <h2>Change password</h2>
          <label>New password<input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          <button className="secondary">Update password</button>
        </form>
      </div>
      {msg && <p className="ok">{msg}</p>}
      <ErrorMsg error={error} />
      <DeleteAccount me={me} />
    </>
  );
}

function DeleteAccount({ me }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const owns = me.labs.filter((l) => l.role === "owner");
  const del = async (e) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      await api.del("/me", { confirm });
      try { await logout(); } catch { /* account is gone */ }
      window.location.assign("/");
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <section className="card danger-zone">
      <h2>Delete my account</h2>
      <p className="small">Removes your sign-in, your tenure & promotion record and your lab memberships. Work you contributed to a lab (such as protocols) stays with that lab under the name “Former member”. <a href="/privacy">Privacy & data security</a></p>
      {owns.length > 0 ? (
        <p className="notice small">You own {owns.map((l) => l.name).join(", ")}. Download its backup and delete the lab in <strong>Lab settings</strong> before deleting your account.</p>
      ) : !open ? <button className="ghost danger" onClick={() => setOpen(true)}>Delete my account…</button> : (
        <form className="form" onSubmit={del}>
          <label>Type your email <code>{me.email}</code> to confirm<input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" /></label>
          <ErrorMsg error={err} />
          <div className="row">
            <button type="button" className="ghost" onClick={() => { setOpen(false); setConfirm(""); }}>Cancel</button>
            <button className="danger-btn" disabled={busy || confirm.trim().toLowerCase() !== me.email}>{busy ? "Deleting…" : "Permanently delete my account"}</button>
          </div>
        </form>
      )}
    </section>
  );
}
