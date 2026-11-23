import { useState } from "react";
import { updateUser } from "@netlify/identity";
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
    </>
  );
}
