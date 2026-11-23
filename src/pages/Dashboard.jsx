import { Link } from "react-router-dom";
import { useMe } from "../App.jsx";
import { useApi, Loading, ErrorMsg, PageHead } from "../ui.jsx";
import { fmtDate, fmtDateTime, who, ACTION_LABELS, STATUS_LABELS } from "../api.js";

export default function Dashboard() {
  const { me } = useMe();
  const admin = me.role !== "student";
  const seesActivity = me.can.includes("view_activity");
  const { data, error, loading } = useApi("/dashboard");
  const first = (me.full_name || me.email).split(/[ @]/)[0];

  return (
    <>
      <PageHead title={`Hello, ${first}`} sub={seesActivity ? "Here's what's happening in the lab." : "Here's your lab work at a glance."}>
        <Link className="btn" to="/protocols/new">+ New protocol</Link>
      </PageHead>
      <ErrorMsg error={error} />
      {loading && !data ? <Loading /> : data && (
        <>
          {admin && data.lab && (
            <div className="stats">
              {data.reviewer && <Stat n={data.needsAttention.length} label="Awaiting your review" to="/protocols?tab=review" hot={data.needsAttention.length > 0} />}
              <Stat n={data.lab.members} label="Active members" to={me.can.includes("manage_members") || seesActivity ? "/members" : "/"} />
              <Stat n={data.lab.protocols} label="Protocols" to="/protocols?tab=all" />
              <Stat n={data.lowStock.length} label="Low-stock items" to="/inventory?filter=low" hot={data.lowStock.length > 0} />
              {seesActivity && <Stat n={data.lab.activity7d} label="Actions this week" to="/activity" />}
            </div>
          )}
          {(!admin || !data.lab) && (
            <div className="stats">
              {["draft", "submitted", "changes_requested", "approved"].map((s) => (
                <Stat key={s} n={data.myCounts.find((c) => c.status === s)?.n || 0} label={STATUS_LABELS[s]} to="/protocols" hot={s === "changes_requested" && data.myCounts.some((c) => c.status === s && c.n > 0)} />
              ))}
            </div>
          )}

          <div className="grid2">
            <section className="card">
              <h2>{data.reviewer ? "Review queue" : "Needs your changes"}</h2>
              {data.needsAttention.length === 0 ? (
                <p className="muted">{data.reviewer ? "Nothing waiting for review." : "No protocols need changes. 🎉"}</p>
              ) : (
                <ul className="list">
                  {data.needsAttention.map((p) => (
                    <li key={p.id}>
                      <Link to={`/protocols/${p.id}`}>{p.title}</Link>
                      <span className="muted small">{data.reviewer ? `${who(p)} · ` : ""}{fmtDate(p.updated_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <h2>Inventory alerts</h2>
              {data.lowStock.length === 0 && data.expiring.length === 0 && <p className="muted">All stocked, nothing expiring in 30 days.</p>}
              <ul className="list">
                {data.lowStock.map((i) => (
                  <li key={`l${i.id}`}><span className="dot warn" />{i.name}<span className="muted small">{Number(i.quantity)} {i.unit} left (min {Number(i.min_quantity)})</span></li>
                ))}
                {data.expiring.map((i) => (
                  <li key={`e${i.id}`}><span className="dot bad" />{i.name}<span className="muted small">expires {fmtDate(i.expiry_date)}</span></li>
                ))}
              </ul>
            </section>
          </div>

          <section className="card">
            <div className="card-head">
              <h2>{seesActivity ? "Recent lab activity" : "Your recent activity"}</h2>
              <Link to="/activity" className="small">See all →</Link>
            </div>
            <ActivityList rows={data.recent} showWho={seesActivity} />
          </section>
        </>
      )}
    </>
  );
}

function Stat({ n, label, to, hot }) {
  return (
    <Link to={to} className={`stat ${hot ? "hot" : ""}`}>
      <span className="n">{n}</span>
      <span className="label">{label}</span>
    </Link>
  );
}

export function ActivityList({ rows, showWho }) {
  if (!rows?.length) return <p className="muted">No activity yet.</p>;
  return (
    <ul className="feed">
      {rows.map((r) => (
        <li key={r.id}>
          <span className="when">{fmtDateTime(r.created_at)}</span>
          <span>
            {showWho && <strong>{who(r)} </strong>}
            {ACTION_LABELS[r.action] ?? r.action.replace(/_/g, " ")}{" "}
            {r.entity_type === "protocol" && r.entity_id ? (
              <Link to={`/protocols/${r.entity_id}`}>{r.summary}</Link>
            ) : (
              <span>{r.summary}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
