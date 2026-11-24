import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMe } from "../App.jsx";
import { useApi, Loading, ErrorMsg, PageHead, StatusBadge, Empty } from "../ui.jsx";
import { api, fmtDate, who } from "../api.js";
import AiProtocol from "./AiProtocol.jsx";

// Turns ⟦match⟧ markers from the server into highlighted text (no HTML from the server is rendered).
function Snippet({ text }) {
  if (!text) return null;
  const parts = String(text).split(/⟦|⟧/);
  return <div className="snippet">{parts.map((t, i) => (i % 2 ? <mark key={i}>{t}</mark> : <span key={i}>{t}</span>))}</div>;
}

export default function Protocols() {
  const { me } = useMe();
  const admin = me.can.includes("review_protocols") || me.can.includes("edit_protocols");
  const [params, setParams] = useSearchParams();
  const tabs = admin
    ? [...(me.can.includes("review_protocols") ? [["review", "Review queue"]] : []), ["all", "All protocols"], ["library", "Approved library"], ["mine", "Mine"]]
    : [["mine", "My protocols"], ["library", "Lab library"]];
  const tab = params.get("tab") || tabs[0][0];
  const path =
    tab === "review" ? "/protocols?scope=all&status=submitted" :
    tab === "all" ? "/protocols?scope=all" :
    tab === "library" ? "/protocols?scope=library" : "/protocols?scope=mine";
  const { data, error, loading } = useApi(path);
  const [q, setQ] = useState(params.get("q") || "");
  const [student, setStudent] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const labAdmin = me.role === "owner" || me.role === "admin";
  const searchScope = tab === "mine" ? "mine" : tab === "library" ? "library" : "visible";

  // Full-text search across every section, debounced while typing.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults(null); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try { setResults(await api.get(`/protocols/search?q=${encodeURIComponent(term)}&scope=${searchScope}`)); setSearchErr(""); }
      catch (e) { setSearchErr(e.message); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, searchScope]);

  const students = useMemo(() => [...new Set((data || []).map(who))].sort(), [data]);
  const searchingNow = results !== null;
  const rows = useMemo(() => (searchingNow ? results : data || []).filter((p) =>
    (!student || who(p) === student) && (searchingNow || tab !== "all" || p.status !== "archived")
  ), [data, results, searchingNow, student, tab]);

  return (
    <>
      <PageHead title="Protocols" sub="Write, review and reuse experimental protocols.">
        {labAdmin && <button className="secondary" onClick={() => setAiOpen(true)}>✨ AI protocol from notes</button>}
        <Link className="btn" to="/protocols/new">+ New protocol</Link>
      </PageHead>
      {aiOpen && <AiProtocol onClose={() => setAiOpen(false)} />}
      <div className="tabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => setParams({ tab: k })}>{label}</button>
        ))}
      </div>
      <div className="toolbar">
        <input type="search" className="protocol-search" placeholder='🔍 Search all protocols: words, reagents, steps, people, or "an exact phrase"' value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search protocols" />
        {admin && tab !== "mine" && (
          <select value={student} onChange={(e) => setStudent(e.target.value)}>
            <option value="">Everyone</option>
            {students.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
      </div>
      <ErrorMsg error={error || searchErr} />
      {searchingNow && (
        <p className="muted small search-info">
          {searching ? "Searching…" : `${rows.length} protocol${rows.length === 1 ? "" : "s"} match “${q.trim()}”`}
          {" "}· searched every section {tab === "mine" ? "of your protocols" : tab === "library" ? "of approved protocols" : "of all protocols you can see"}
          {" "}· <button className="link" onClick={() => setQ("")}>Clear</button>
        </p>
      )}
      {loading && !data ? <Loading /> : rows.length === 0 ? (
        <Empty>
          {searchingNow ? (searching ? "Searching…" : <>No protocols match “{q.trim()}”. Try fewer or different words, or the start of a word.</>) :
           tab === "review" ? "No protocols waiting for review." :
           tab === "mine" ? <>You haven't written any protocols yet. <Link to="/protocols/new">Start one</Link>.</> :
           "Nothing here yet."}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Title</th><th>Project / experiment</th>{(tab !== "mine" || searchingNow) && <th>Author</th>}<th>Status</th><th>Ver.</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/protocols/${p.id}`}><strong>{p.title}</strong></Link>{searchingNow && <Snippet text={p.snippet} />}</td>
                  <td className="muted">{[p.project, p.experiment].filter(Boolean).join(" · ") || "—"}</td>
                  {(tab !== "mine" || searchingNow) && <td>{who(p)}</td>}
                  <td><StatusBadge status={p.status} /></td>
                  <td>v{p.version}</td>
                  <td className="muted">{fmtDate(p.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
