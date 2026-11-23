import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMe } from "../App.jsx";
import { useApi, Loading, ErrorMsg, PageHead, StatusBadge, Empty } from "../ui.jsx";
import { fmtDate, who } from "../api.js";

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
  const [q, setQ] = useState("");
  const [student, setStudent] = useState("");

  const students = useMemo(() => [...new Set((data || []).map(who))].sort(), [data]);
  const rows = useMemo(() => (data || []).filter((p) => {
    const hay = `${p.title} ${p.project || ""} ${p.experiment || ""} ${who(p)}`.toLowerCase();
    return (!q || hay.includes(q.toLowerCase())) && (!student || who(p) === student) && (tab !== "all" || p.status !== "archived" || q);
  }), [data, q, student, tab]);

  return (
    <>
      <PageHead title="Protocols" sub="Write, review and reuse experimental protocols.">
        <Link className="btn" to="/protocols/new">+ New protocol</Link>
      </PageHead>
      <div className="tabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => setParams({ tab: k })}>{label}</button>
        ))}
      </div>
      <div className="toolbar">
        <input placeholder="Search title, project, experiment…" value={q} onChange={(e) => setQ(e.target.value)} />
        {admin && tab !== "mine" && (
          <select value={student} onChange={(e) => setStudent(e.target.value)}>
            <option value="">Everyone</option>
            {students.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
      </div>
      <ErrorMsg error={error} />
      {loading && !data ? <Loading /> : rows.length === 0 ? (
        <Empty>
          {tab === "review" ? "No protocols waiting for review." :
           tab === "mine" ? <>You haven't written any protocols yet. <Link to="/protocols/new">Start one</Link>.</> :
           "Nothing here yet."}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Title</th><th>Project / experiment</th>{tab !== "mine" && <th>Author</th>}<th>Status</th><th>Ver.</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/protocols/${p.id}`}><strong>{p.title}</strong></Link></td>
                  <td className="muted">{[p.project, p.experiment].filter(Boolean).join(" · ") || "—"}</td>
                  {tab !== "mine" && <td>{who(p)}</td>}
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
