import { useState } from "react";
import { useMe } from "../App.jsx";
import { api, fmtDate, fmtDateTime, isoDate } from "../api.js";
import { useApi, Loading, ErrorMsg, PageHead, Modal } from "../ui.jsx";

const POSITIONS = ["PhD student", "MS student", "Undergraduate", "Postdoc", "Research staff", "Visiting scholar", "Lab manager", "Co-PI / collaborator"];

export const PERMS = [
  ["review_protocols", "Review & approve protocols", "Sees every protocol, approves or requests changes"],
  ["edit_protocols", "Edit any protocol", "Can change other members' protocols (edits are versioned)"],
  ["manage_inventory", "Remove inventory items", "Everyone can add and log use; this allows deleting items"],
  ["view_activity", "See lab activity", "All members' activity feed and lab-wide stats"],
  ["manage_members", "Manage students", "Invite students, edit their position, remove them from the lab"],
  ["tenure", "Own tenure tracker", "Their own private record (they never see yours)"],
];
const PERM_LABEL = Object.fromEntries(PERMS.map(([k, l]) => [k, l]));
const roleLabel = (r) => (r === "owner" ? "Owner" : r === "admin" ? "Admin" : "Student");

function CopyLink({ link }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-row">
      <code>{link}</code>
      <button type="button" className="small ghost" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } }}>{copied ? "Copied ✓" : "Copy"}</button>
    </div>
  );
}

export default function Members() {
  const { me } = useMe();
  const owner = me.role === "owner";
  const canManage = owner || me.can.includes("manage_members");
  const { data, error, loading, reload } = useApi("/members");
  const grants = useApi(canManage ? "/access-grants" : null);
  const [editing, setEditing] = useState(null);
  const [inviting, setInviting] = useState(null); // "student" | "admin"

  const editable = (m) => (owner ? m.role !== "owner" || m.id === me.id : canManage && m.role === "student");
  const admins = (data || []).filter((m) => m.role !== "student" && m.active);
  const reloadAll = () => { reload(); grants.reload(); };

  return (
    <>
      <PageHead title="Lab members" sub={`Everyone in ${me.lab.name}. Track each person's protocols and activity.`}>
        {canManage && <button onClick={() => setInviting("student")}>+ Invite student</button>}
        {owner && <button className="secondary" onClick={() => setInviting("admin")}>+ Add admin</button>}
      </PageHead>

      {canManage && (grants.data?.grants || []).length > 0 && (
        <section className="card">
          <h2>Invitations waiting</h2>
          <p className="muted small">These people join automatically when they create an account or sign in with this email. Send them their link.</p>
          <ul className="list invites">
            {grants.data.grants.map((g) => (
              <li key={g.email}>
                <div className="grow">
                  <strong>{g.email}</strong> <span className={`role-tag ${g.role}`}>{roleLabel(g.role)}</span>
                  {g.role === "admin" && <span className="muted small"> {g.permissions.map((p) => PERM_LABEL[p]).join(" · ") || "No permissions"}</span>}
                  <CopyLink link={g.link} />
                </div>
                <button className="small ghost danger" onClick={async () => { await api.del(`/access-grants/${encodeURIComponent(g.email)}`); grants.reload(); }}>Cancel</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {owner && admins.length > 0 && (
        <section className="card">
          <h2>Admins & what they can do</h2>
          <ul className="list">
            {admins.map((m) => (
              <li key={m.id}>
                <strong>{m.full_name || m.email}</strong>
                <span className={`role-tag ${m.role}`}>{roleLabel(m.role)}</span>
                <span className="muted small">{m.role === "owner" ? "Full access" : m.permissions?.length ? m.permissions.map((p) => PERM_LABEL[p]).join(" · ") : "No permissions yet"}</span>
                {m.role === "admin" && <button className="small ghost" onClick={() => setEditing(m)}>Change</button>}
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
                  <td><span className={`role-tag ${m.role}`}>{roleLabel(m.role)}</span>{!m.active && <span className="badge st-bad">Left lab</span>}</td>
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
      {inviting && <Invite role={inviting} labName={me.lab.name} onClose={() => { setInviting(null); reloadAll(); }} />}
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

function Invite({ role, labName, onClose }) {
  const [email, setEmail] = useState("");
  const [perms, setPerms] = useState(["review_protocols", "view_activity"]);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const save = async (e) => {
    e.preventDefault(); setError("");
    try { setResult(await api.post("/access-grants", { email, role, permissions: role === "admin" ? perms : [] })); } catch (err) { setError(err.message); }
  };
  const message = result && `Hi! I've added you to ${labName} on our lab management site. Open this link, create your account with ${email}, and you'll be in:\n${result.link}`;
  return (
    <Modal title={role === "admin" ? "Add an admin" : "Invite a student"} onClose={onClose}>
      {!result ? (
        <form className="form" onSubmit={save}>
          <label>Their email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus placeholder="name@university.edu" /></label>
          {role === "admin" && <div><label>What can they do?</label><PermChecks value={perms} onChange={setPerms} /></div>}
          <ErrorMsg error={error} />
          <div className="row end"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button>{role === "admin" ? "Add admin" : "Invite"}</button></div>
        </form>
      ) : (
        <div className="form">
          {result.applied
            ? <p className="ok">{email} already has an account — they're in the lab now. They'll see it next time they open the site.</p>
            : <p className="ok">Invitation ready. {email} joins automatically when they create an account with that email.</p>}
          <label>Send them this link</label>
          <CopyLink link={result.link} />
          <label>Or copy a ready-made message</label>
          <textarea rows={4} readOnly value={message} onFocus={(e) => e.target.select()} />
          <div className="row end">
            <a className="btn ghost" href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Join ${labName}`)}&body=${encodeURIComponent(message)}`}>Open in email</a>
            <button type="button" onClick={onClose}>Done</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function EditMember({ m, owner, self, onClose, onSaved }) {
  const [f, setF] = useState({ position: m.position || "", start_date: isoDate(m.start_date), role: m.role, active: m.active, permissions: m.permissions || [] });
  const [error, setError] = useState("");
  const save = async (e) => {
    e.preventDefault();
    try { await api.put(`/members/${m.id}`, f); onSaved(); } catch (err) { setError(err.message); }
  };
  const canSetRole = owner && !self;
  return (
    <Modal title={`Edit ${m.full_name || m.email}`} onClose={onClose}>
      <form className="form" onSubmit={save}>
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
        {!self && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active in this lab (uncheck when someone leaves — their records stay)</label>}
        <ErrorMsg error={error} />
        <div className="row end"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button>Save</button></div>
      </form>
    </Modal>
  );
}
