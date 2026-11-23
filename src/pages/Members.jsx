import { useState } from "react";
import { useMe } from "../App.jsx";
import { api, fmtDate, fmtDateTime, isoDate } from "../api.js";
import { useApi, Loading, ErrorMsg, PageHead, Modal } from "../ui.jsx";
import DriveBackup from "./DriveBackup.jsx";
import { LAB_SLUG } from "../config.js";

const POSITIONS = ["PhD student", "MS student", "Undergraduate", "Postdoc", "Research staff", "Visiting scholar", "Lab manager", "Co-PI / collaborator"];

export const PERMS = [
  ["review_protocols", "Review & approve protocols", "Sees every protocol, approves or requests changes"],
  ["edit_protocols", "Edit any protocol", "Can change other members' protocols (edits are versioned)"],
  ["manage_inventory", "Remove inventory items", "Everyone can add and log use; this allows deleting items"],
  ["view_activity", "See lab activity", "All members' activity feed and lab-wide stats"],
  ["manage_members", "Manage student profiles", "Edit students' position and mark them inactive"],
  ["tenure", "Own tenure tracker", "Their own private record (they never see yours)"],
];
const PERM_LABEL = Object.fromEntries(PERMS.map(([k, l]) => [k, l]));
const roleLabel = (r) => (r === "owner" ? "Owner" : r === "admin" ? "Admin" : "Student");

export default function Members() {
  const { me } = useMe();
  const owner = me.role === "owner";
  const canManage = me.can.includes("manage_members");
  const { data, error, loading, reload } = useApi("/members");
  const grants = useApi(owner ? "/access-grants" : null);
  const [editing, setEditing] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [backupMsg, setBackupMsg] = useState("");

  const editable = (m) => owner ? m.role !== "owner" || m.id === me.id : canManage && m.role === "student";
  const admins = (data || []).filter((m) => m.role !== "student");

  const downloadBackup = async () => {
    setBackupMsg("Preparing backup…");
    try {
      const b = await api.get("/backup");
      const blob = new Blob([JSON.stringify(b, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${LAB_SLUG}-backup-${isoDate(b.exported_at)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      const n = Object.values(b.tables).reduce((s, t) => s + t.length, 0);
      setBackupMsg(`Downloaded ${n} records. Save the file to your Google Drive backup folder.`);
    } catch (e) { setBackupMsg(e.message); }
  };

  return (
    <>
      <PageHead title={owner ? "Members & access" : "Lab members"} sub="Track each member's work. People appear here after their first sign-in.">
        {owner && <button className="ghost" onClick={downloadBackup}>⬇ Download full backup</button>}
        <button onClick={() => setShowInvite(true)}>+ Invite member</button>
      </PageHead>
      {backupMsg && <p className="ok">{backupMsg}</p>}

      {owner && <DriveBackup />}

      {owner && (
        <section className="card">
          <div className="card-head">
            <h2>Admins & what they can do</h2>
            <button className="small" onClick={() => setShowAddAdmin(true)}>+ Add admin</button>
          </div>
          <p className="muted small">You're the owner: you always have full access, and only you can add admins or change their permissions.</p>
          <ul className="list">
            {admins.map((m) => (
              <li key={m.id}>
                <strong>{m.full_name || m.email}</strong>
                <span className={`role-tag ${m.role}`}>{roleLabel(m.role)}</span>
                <span className="muted small">
                  {m.role === "owner" ? "Full access" : m.permissions?.length ? m.permissions.map((p) => PERM_LABEL[p]).join(" · ") : "No permissions yet"}
                </span>
                {m.role === "admin" && <button className="small ghost" onClick={() => setEditing(m)}>Change</button>}
              </li>
            ))}
            {(grants.data?.grants || []).map((g) => (
              <li key={g.email}>
                <strong>{g.email}</strong>
                <span className="badge">Pending first sign-in</span>
                <span className="muted small">{g.permissions.map((p) => PERM_LABEL[p]).join(" · ") || "No permissions"}</span>
                <button className="small ghost danger" onClick={async () => { await api.del(`/access-grants/${encodeURIComponent(g.email)}`); grants.reload(); }}>Cancel</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ErrorMsg error={error} />
      {loading && !data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Position</th><th>Role</th><th>Protocols</th><th>Actions (30 d)</th><th>Last active</th><th></th></tr></thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id} className={m.active ? "" : "inactive"}>
                  <td><strong>{m.full_name || "—"}</strong><div className="muted small">{m.email}</div></td>
                  <td>{m.position || "—"}{m.start_date && <div className="muted small">since {fmtDate(m.start_date)}</div>}</td>
                  <td><span className={`role-tag ${m.role}`}>{roleLabel(m.role)}</span>{!m.active && <span className="badge st-bad">Inactive</span>}</td>
                  <td>{m.protocol_count} <span className="muted small">({m.approved_count} approved)</span></td>
                  <td>{m.activity_30d}</td>
                  <td className="muted">{m.last_seen ? fmtDateTime(m.last_seen) : "Never"}</td>
                  <td>{editable(m) && <button className="small ghost" onClick={() => setEditing(m)}>Edit</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <EditMember m={editing} owner={owner} self={editing.id === me.id} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {showAddAdmin && <AddAdmin onClose={() => setShowAddAdmin(false)} onSaved={() => { setShowAddAdmin(false); reload(); grants.reload(); }} />}
      {showInvite && (
        <Modal title="Invite a lab member" onClose={() => setShowInvite(false)}>
          <ol className="steps">
            <li>Open <a href="https://app.netlify.com/" target="_blank" rel="noreferrer">Netlify</a> → this project → <strong>Users and sign-in</strong> (Identity).</li>
            <li>Click <strong>Invite users</strong> and enter their email.</li>
            <li>They click the emailed link and choose a password on this site.</li>
            <li>They join as a <em>Student</em> — unless you added their email under <strong>Add admin</strong> first, in which case they get exactly the admin permissions you chose.</li>
          </ol>
        </Modal>
      )}
    </>
  );
}

function PermChecks({ value, onChange }) {
  const toggle = (k) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <div className="perms">
      {PERMS.map(([k, label, hint]) => (
        <label key={k} className="perm">
          <input type="checkbox" checked={value.includes(k)} onChange={() => toggle(k)} />
          <span><strong>{label}</strong><span className="muted small">{hint}</span></span>
        </label>
      ))}
    </div>
  );
}

function AddAdmin({ onClose, onSaved }) {
  const [email, setEmail] = useState("");
  const [perms, setPerms] = useState(["review_protocols", "view_activity"]);
  const [error, setError] = useState("");
  const save = async (e) => {
    e.preventDefault(); setError("");
    try { await api.post("/access-grants", { email, permissions: perms }); onSaved(); } catch (err) { setError(err.message); }
  };
  return (
    <Modal title="Add an admin" onClose={onClose}>
      <form className="form" onSubmit={save}>
        <label>Their email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus placeholder="colleague@university.edu" /></label>
        <div><label>What can they do?</label><PermChecks value={perms} onChange={setPerms} /></div>
        <p className="muted small">If they already have an account, this applies right away. Otherwise it applies the first time they sign in — you still need to invite them through Netlify Identity.</p>
        <ErrorMsg error={error} />
        <div className="row end"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button>Save admin</button></div>
      </form>
    </Modal>
  );
}

function EditMember({ m, owner, self, onClose, onSaved }) {
  const [f, setF] = useState({ full_name: m.full_name || "", position: m.position || "", start_date: isoDate(m.start_date), role: m.role, active: m.active, permissions: m.permissions || [] });
  const [error, setError] = useState("");
  const save = async (e) => {
    e.preventDefault();
    try { await api.put(`/members/${m.id}`, f); onSaved(); } catch (err) { setError(err.message); }
  };
  const canSetRole = owner && !self;
  return (
    <Modal title={`Edit ${m.full_name || m.email}`} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <label>Full name<input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></label>
        <label>Position
          <input list="positions" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} />
          <datalist id="positions">{POSITIONS.map((p) => <option key={p} value={p} />)}</datalist>
        </label>
        <label>Joined lab<input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></label>
        {canSetRole && (
          <>
            <label>Role
              <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
                <option value="student">Student</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            {f.role === "admin" && <div><label>Admin permissions</label><PermChecks value={f.permissions} onChange={(permissions) => setF({ ...f, permissions })} /></div>}
          </>
        )}
        {!self && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active (uncheck when someone leaves — their records stay)</label>}
        <ErrorMsg error={error} />
        <div className="row end"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button>Save</button></div>
      </form>
    </Modal>
  );
}
