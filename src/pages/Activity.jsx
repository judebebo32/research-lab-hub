import { useState } from "react";
import { useMe } from "../App.jsx";
import { useApi, Loading, ErrorMsg, PageHead } from "../ui.jsx";
import { ActivityList } from "./Dashboard.jsx";
import { downloadCSV, who, ACTION_LABELS, isoDate } from "../api.js";

export default function Activity() {
  const { me } = useMe();
  const admin = me.can.includes("view_activity");
  const [member, setMember] = useState("");
  const [since, setSince] = useState("");
  const members = useApi(admin ? "/members" : null);
  const qs = new URLSearchParams({ limit: "300", ...(member && { member }), ...(since && { since }) }).toString();
  const { data, error, loading } = useApi(`/activity?${qs}`);

  const exportCSV = () => downloadCSV(`activity-${isoDate(new Date().toISOString())}.csv`, data || [], [
    { label: "Date", value: (r) => new Date(r.created_at).toISOString() },
    { label: "Member", value: (r) => who(r) },
    { label: "Action", value: (r) => (ACTION_LABELS[r.action] || r.action.replace(/_/g, " ")) },
    { label: "Details", value: "summary" },
  ]);

  return (
    <>
      <PageHead title={admin ? "Lab activity" : "My activity"} sub={admin ? "Everything members do in the hub is logged automatically." : "A record of your work in the hub."}>
        <button className="ghost" onClick={exportCSV} disabled={!data?.length}>Export CSV</button>
      </PageHead>
      <div className="toolbar">
        {admin && (
          <select value={member} onChange={(e) => setMember(e.target.value)}>
            <option value="">All members</option>
            {(members.data || []).map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
          </select>
        )}
        <label className="check">Since <input type="date" value={since} onChange={(e) => setSince(e.target.value)} /></label>
      </div>
      <ErrorMsg error={error} />
      <section className="card">{loading && !data ? <Loading /> : <ActivityList rows={data} showWho={admin} />}</section>
    </>
  );
}
