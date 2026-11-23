import { useMemo, useState } from "react";
import { api, fmtDate, isoDate, downloadCSV } from "../api.js";
import { useApi, Loading, ErrorMsg, PageHead, Modal, Empty } from "../ui.jsx";
import AiImport from "./AiImport.jsx";

export const CATS = {
  publication: { label: "Publications", one: "Publication", roleHint: "First / corresponding / co-author", statusHint: "Published, in press, under review" },
  grant: { label: "Grants & funding", one: "Grant", roleHint: "PI, co-PI, senior personnel", statusHint: "Submitted, funded, declined" },
  teaching: { label: "Teaching", one: "Course", roleHint: "Instructor, co-instructor", statusHint: "Semester, enrollment" },
  mentoring: { label: "Mentoring", one: "Mentee", roleHint: "Advisor, committee member", statusHint: "Current, graduated" },
  service: { label: "Service", one: "Service role", roleHint: "Chair, member, reviewer", statusHint: "Department, university, profession" },
  presentation: { label: "Presentations", one: "Talk", roleHint: "Invited, contributed, poster", statusHint: "" },
  award: { label: "Awards & honors", one: "Award", roleHint: "", statusHint: "" },
  outreach: { label: "Outreach", one: "Outreach activity", roleHint: "", statusHint: "" },
  other: { label: "Other", one: "Activity", roleHint: "", statusHint: "" },
};
const BLANK = { category: "publication", title: "", details: "", role: "", start_date: "", end_date: "", amount: "", status: "", link: "" };
const money = (n) => Number(n || 0).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function Tenure() {
  const { data, error, loading, reload } = useApi("/pi-activities");
  const summary = useApi("/pi-activities/summary");
  const [cat, setCat] = useState("");
  const [year, setYear] = useState("");
  const [editing, setEditing] = useState(null);
  const [cvView, setCvView] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMsg, setAiMsg] = useState("");

  const yearOf = (a) => new Date(a.start_date || a.created_at).getFullYear();
  const years = useMemo(() => [...new Set((data || []).map(yearOf))].sort((a, b) => b - a), [data]);
  const rows = useMemo(() => (data || []).filter((a) => (!cat || a.category === cat) && (!year || yearOf(a) === Number(year))), [data, cat, year]);
  const totals = useMemo(() => {
    const t = {};
    for (const a of rows) {
      t[a.category] ??= { n: 0, amount: 0 };
      t[a.category].n++;
      if (a.category === "grant" && /fund|award/i.test(a.status || "")) t[a.category].amount += Number(a.amount || 0);
    }
    return t;
  }, [rows]);

  const reloadAll = () => { reload(); summary.reload(); };
  const exportCSV = () => downloadCSV(`tenure-record-${isoDate(new Date().toISOString())}.csv`, rows, [
    { label: "Category", value: (r) => CATS[r.category]?.one }, { label: "Title", value: "title" }, { label: "Role", value: "role" },
    { label: "Status", value: "status" }, { label: "Start", value: (r) => isoDate(r.start_date) }, { label: "End", value: (r) => isoDate(r.end_date) },
    { label: "Amount (USD)", value: "amount" }, { label: "Details", value: "details" }, { label: "Link", value: "link" },
  ]);

  return (
    <>
      <PageHead title="Tenure & promotion record" sub="Private to you. Log activities as they happen so your dossier writes itself.">
        <button className="ghost" onClick={exportCSV} disabled={!rows.length}>Export CSV</button>
        <button className="ghost" onClick={() => setCvView(true)} disabled={!rows.length}>Dossier view</button>
        <button className="secondary" onClick={() => setAiOpen(true)}>✨ AI import</button>
        <button onClick={() => setEditing(BLANK)}>+ Log activity</button>
      </PageHead>
      {aiMsg && <p className="ok">{aiMsg}</p>}

      <div className="stats">
        {["publication", "grant", "teaching", "mentoring", "service", "presentation"].map((c) => (
          <button key={c} className={`stat ${cat === c ? "selected" : ""}`} onClick={() => setCat(cat === c ? "" : c)}>
            <span className="n">{totals[c]?.n || 0}</span>
            <span className="label">{CATS[c].label}{c === "grant" && totals.grant?.amount ? ` · ${money(totals.grant.amount)} funded` : ""}</span>
          </button>
        ))}
      </div>
      {summary.data && (
        <p className="muted small">From the lab hub: {summary.data.labStats.mentees} students in your group · {summary.data.labStats.approvedProtocols} approved lab protocols (evidence of mentoring and research infrastructure).</p>
      )}

      <div className="toolbar">
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">All years</option>
          {years.map((y) => <option key={y}>{y}</option>)}
        </select>
      </div>

      <ErrorMsg error={error} />
      {loading && !data ? <Loading /> : rows.length === 0 ? (
        <Empty>No activities logged{cat || year ? " for this filter" : " yet"}. {!cat && !year && <>Fastest start: <button className="link" onClick={() => setAiOpen(true)}>✨ let the AI import your CV</button>.</>}</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Title</th><th>Role</th><th>Status</th><th>Amount</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => setEditing(a)}>
                  <td className="nowrap muted">{a.start_date ? fmtDate(a.start_date) : "—"}</td>
                  <td><span className={`badge c-${a.category}`}>{CATS[a.category]?.one}</span></td>
                  <td><strong>{a.title}</strong>{a.details && <div className="muted small clamp">{a.details}</div>}</td>
                  <td>{a.role || "—"}</td>
                  <td>{a.status || "—"}</td>
                  <td className="nowrap">{a.amount ? money(a.amount) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <ActivityForm a={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reloadAll(); }} />}
      {cvView && <Dossier rows={rows} onClose={() => setCvView(false)} />}
      {aiOpen && <AiImport onClose={() => setAiOpen(false)} onAdded={(n) => { setAiOpen(false); setAiMsg(`Added ${n} entries to your record.`); reloadAll(); }} />}
    </>
  );
}

function ActivityForm({ a, onClose, onSaved }) {
  const isNew = !a.id;
  const [f, setF] = useState(() => ({ ...BLANK, ...Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v ?? ""])), start_date: isoDate(a.start_date), end_date: isoDate(a.end_date) }));
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const c = CATS[f.category];
  const save = async (e) => {
    e.preventDefault(); setError("");
    try { if (isNew) await api.post("/pi-activities", f); else await api.put(`/pi-activities/${a.id}`, f); onSaved(); }
    catch (err) { setError(err.message); }
  };
  const remove = async () => {
    if (!confirm("Delete this entry permanently?")) return;
    try { await api.del(`/pi-activities/${a.id}`); onSaved(); } catch (err) { setError(err.message); }
  };
  return (
    <Modal title={isNew ? "Log an activity" : "Edit activity"} onClose={onClose} wide>
      <form className="form" onSubmit={save}>
        <div className="chips">
          {Object.entries(CATS).map(([k, v]) => (
            <button type="button" key={k} className={`chip ${f.category === k ? "on" : ""}`} onClick={() => setF({ ...f, category: k })}>{v.one}</button>
          ))}
        </div>
        <label>{f.category === "publication" ? "Citation / title" : "Title"} *<input value={f.title} onChange={set("title")} required autoFocus /></label>
        <div className="grid2">
          <label>Your role<input value={f.role} onChange={set("role")} placeholder={c.roleHint} /></label>
          <label>Status<input value={f.status} onChange={set("status")} placeholder={c.statusHint} /></label>
        </div>
        <div className="grid3">
          <label>Date / start<input type="date" value={f.start_date} onChange={set("start_date")} /></label>
          <label>End (optional)<input type="date" value={f.end_date} onChange={set("end_date")} /></label>
          {f.category === "grant" && <label>Amount (USD)<input type="number" step="any" value={f.amount} onChange={set("amount")} /></label>}
        </div>
        <label>Details<textarea rows={3} value={f.details} onChange={set("details")} placeholder="Journal, agency, co-authors, students involved, impact…" /></label>
        <label>Link (DOI, award page, syllabus)<input type="url" value={f.link} onChange={set("link")} /></label>
        <ErrorMsg error={error} />
        <div className="row end">
          {!isNew && <button type="button" className="ghost danger" onClick={remove}>Delete</button>}
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button>{isNew ? "Save" : "Save changes"}</button>
        </div>
      </form>
    </Modal>
  );
}

function Dossier({ rows, onClose }) {
  const grouped = Object.keys(CATS).map((k) => [k, rows.filter((r) => r.category === k)]).filter(([, r]) => r.length);
  return (
    <Modal title="Dossier view" onClose={onClose} wide>
      <div className="dossier">
        {grouped.map(([k, items]) => (
          <section key={k}>
            <h3>{CATS[k].label} ({items.length})</h3>
            <ol>
              {items.map((a) => (
                <li key={a.id}>
                  <strong>{a.title}</strong>
                  {[a.role, a.status, a.start_date && new Date(a.start_date).getFullYear(), a.amount && money(a.amount)].filter(Boolean).length > 0 &&
                    <> — {[a.role, a.status, a.start_date && new Date(a.start_date).getFullYear(), a.amount && money(a.amount)].filter(Boolean).join(", ")}</>}
                  {a.details && <div className="muted small">{a.details}</div>}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
      <div className="row end no-print"><button onClick={() => window.print()}>Print / save as PDF</button></div>
    </Modal>
  );
}
