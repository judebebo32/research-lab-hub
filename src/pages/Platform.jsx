import { useMemo, useState } from "react";
import { api, fmtDate } from "../api.js";
import { useApi, ErrorMsg, PageHead, Loading, Modal, Empty } from "../ui.jsx";

const mb = (bytes) => { const m = bytes / 1024 / 1024; return m >= 1024 ? `${(m / 1024).toFixed(1)} GB` : `${Math.round(m)} MB`; };
const STATUS = { pending: ["st-warn", "Pending"], active: ["st-ok", "Active"], rejected: ["st-bad", "Declined"], suspended: ["st-bad", "Suspended"] };

export default function Platform() {
  const { data, error, loading, reload } = useApi("/platform/labs");
  const [tab, setTab] = useState("pending");
  const [limits, setLimits] = useState(null);
  const [actErr, setActErr] = useState("");

  const act = async (lab, action, note) => {
    setActErr("");
    try { await api.post(`/platform/labs/${lab.id}/${action}`, note ? { note } : {}); await reload(); } catch (e) { setActErr(e.message); }
  };
  const rows = useMemo(() => (data || []).filter((l) => (tab === "pending" ? l.status === "pending" : tab === "active" ? l.status === "active" : !["pending", "active"].includes(l.status))), [data, tab]);
  const count = (s) => (data || []).filter((l) => (s === "other" ? !["pending", "active"].includes(l.status) : l.status === s)).length;
  const totals = useMemo(() => (data || []).reduce((t, l) => ({ labs: t.labs + (l.status === "active"), members: t.members + (l.status === "active" ? l.members : 0), storage: t.storage + l.storage_bytes, ai: t.ai + l.ai_this_month }), { labs: 0, members: 0, storage: 0, ai: 0 }), [data]);

  return (
    <>
      <PageHead title="Platform admin" sub="Approve new labs and manage limits. You see usage numbers only — never a lab's protocols, inventory, files, members' work or anyone's tenure record." />
      {data && (
        <div className="stats">
          <div className="stat"><span className="n">{totals.labs}</span><span className="label">Active labs</span></div>
          <div className="stat"><span className="n">{totals.members}</span><span className="label">People in labs</span></div>
          <div className="stat"><span className="n">{mb(totals.storage)}</span><span className="label">Photo/video storage</span></div>
          <div className="stat"><span className="n">{totals.ai}</span><span className="label">AI imports this month</span></div>
        </div>
      )}
      <div className="tabs">
        <button className={tab === "pending" ? "active" : ""} onClick={() => setTab("pending")}>Requests ({count("pending")})</button>
        <button className={tab === "active" ? "active" : ""} onClick={() => setTab("active")}>Active labs ({count("active")})</button>
        <button className={tab === "other" ? "active" : ""} onClick={() => setTab("other")}>Declined / suspended ({count("other")})</button>
      </div>
      <ErrorMsg error={error || actErr} />
      {loading && !data ? <Loading /> : rows.length === 0 ? <Empty>{tab === "pending" ? "No requests waiting." : "Nothing here."}</Empty> : (
        <div className="lab-cards">
          {rows.map((l) => {
            const [cls, label] = STATUS[l.status];
            return (
              <section key={l.id} className="card lab-card">
                <div className="card-head">
                  <h2>{l.name} <span className="muted small">/{l.slug}</span></h2>
                  <span className={`badge ${cls}`}>{label}</span>
                </div>
                <p className="small">
                  {[l.institution, l.department].filter(Boolean).join(" · ") || "—"}
                  {l.website && <> · <a href={l.website} target="_blank" rel="noreferrer">web page</a></>}
                </p>
                <p className="small muted">
                  Requested by {l.requester_name || l.requester_email || "—"}{l.requester_email && l.requester_name ? ` (${l.requester_email})` : ""} on {fmtDate(l.created_at)}
                  {l.owners && l.status !== "pending" && <> · Owner: {l.owners}</>}
                </p>
                {l.request_note && <p className="small quote">“{l.request_note}”</p>}
                {l.decision_note && <p className="small muted">Note: {l.decision_note}</p>}
                {l.status !== "pending" && (
                  <p className="small">
                    {l.members} members · storage {mb(l.storage_bytes)}{l.storage_limit_mb != null ? ` / ${l.storage_limit_mb >= 1024 ? l.storage_limit_mb / 1024 + " GB" : l.storage_limit_mb + " MB"}` : " (unlimited)"} · AI {l.ai_this_month}{l.ai_monthly_limit != null ? ` / ${l.ai_monthly_limit}` : " (unlimited)"} this month
                  </p>
                )}
                <div className="row">
                  {l.status === "pending" && <>
                    <button onClick={() => act(l, "approve")}>✓ Approve</button>
                    <button className="ghost danger" onClick={() => { const n = prompt("Reason for declining (shown to the requester, optional):"); if (n !== null) act(l, "reject", n); }}>Decline</button>
                  </>}
                  {l.status === "rejected" && <button className="secondary" onClick={() => act(l, "approve")}>Approve after all</button>}
                  {l.status === "active" && <>
                    <button className="ghost" onClick={() => setLimits(l)}>Change limits</button>
                    <button className="ghost danger" onClick={() => { const n = prompt(`Suspend ${l.name}? Members lose access until you reactivate it. Reason (optional):`); if (n !== null) act(l, "suspend", n); }}>Suspend</button>
                  </>}
                  {l.status === "suspended" && <button className="secondary" onClick={() => act(l, "reactivate")}>Reactivate</button>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {limits && <LimitsForm lab={limits} onClose={() => setLimits(null)} onSaved={() => { setLimits(null); reload(); }} />}
    </>
  );
}

function LimitsForm({ lab, onClose, onSaved }) {
  const [f, setF] = useState({ storage_limit_mb: lab.storage_limit_mb ?? "", ai_monthly_limit: lab.ai_monthly_limit ?? "" });
  const [error, setError] = useState("");
  const save = async (e) => {
    e.preventDefault();
    try { await api.post(`/platform/labs/${lab.id}/limits`, f); onSaved(); } catch (x) { setError(x.message); }
  };
  return (
    <Modal title={`Limits for ${lab.name}`} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <label>Photo/video storage (MB) — leave empty for unlimited<input type="number" min="0" value={f.storage_limit_mb} onChange={(e) => setF({ ...f, storage_limit_mb: e.target.value })} placeholder="unlimited" /></label>
        <label>AI imports per month — leave empty for unlimited<input type="number" min="0" value={f.ai_monthly_limit} onChange={(e) => setF({ ...f, ai_monthly_limit: e.target.value })} placeholder="unlimited" /></label>
        <p className="muted small">Defaults for new labs: 2048 MB storage, 5 AI imports/month. Usage is billed to your Netlify credits.</p>
        <ErrorMsg error={error} />
        <div className="row end"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button>Save</button></div>
      </form>
    </Modal>
  );
}
