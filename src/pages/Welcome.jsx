import { useState } from "react";
import { useMe } from "../App.jsx";
import { api, fmtDate } from "../api.js";
import { ErrorMsg, PageHead } from "../ui.jsx";
import { PLATFORM_NAME } from "../config.js";

const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

// Shown to people who aren't in a lab yet (and from "Start another lab").
export default function Welcome({ another = false }) {
  const { me, reloadMe } = useMe();
  const [f, setF] = useState({ name: "", slug: "", institution: "", department: "", website: "", note: "", agree: false });
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const pending = me.requests.filter((r) => r.status === "pending");
  const declined = me.requests.filter((r) => r.status === "rejected");
  const set = (k) => (e) => setF((x) => {
    const v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    const next = { ...x, [k]: v };
    if (k === "name" && !slugEdited) next.slug = slugify(v);
    return next;
  });

  const submit = async (e) => {
    e.preventDefault(); setError("");
    try { await api.post("/labs/requests", f); setDone(true); await reloadMe(); } catch (err) { setError(err.message); }
  };

  return (
    <>
      <PageHead title={another ? "Start another lab" : `Welcome to ${PLATFORM_NAME}`}
        sub="A free space for research groups to manage protocols, inventory and lab activity — and for faculty to keep their tenure & promotion record." />

      {!another && (
        <div className="grid2">
          <section className="card">
            <h2>👩‍🎓 Joining a lab?</h2>
            <p className="small">Ask your PI to invite <strong>{me.email}</strong> from their lab's <em>Members</em> page. As soon as they do, reload this page and you're in.</p>
            <button className="secondary" onClick={reloadMe}>Check again</button>
          </section>
          <section className="card">
            <h2>🧑‍🔬 Running a lab?</h2>
            <p className="small">Request a lab space below. Each request is reviewed by the platform admin — usually within a day or two. Your lab's data is visible only to the people you invite.</p>
          </section>
        </div>
      )}

      {pending.map((r) => (
        <p key={r.id} className="notice">⏳ Your request for <strong>{r.name}</strong> ({r.slug}) is waiting for approval — sent {fmtDate(r.created_at)}.</p>
      ))}
      {declined.map((r) => (
        <p key={r.id} className="error">Your request for <strong>{r.name}</strong> was declined{r.decision_note ? `: ${r.decision_note}` : "."}</p>
      ))}
      {done && <p className="ok">Request sent! You'll get access as soon as it's approved — just sign in again or reload.</p>}

      {!done && pending.length === 0 && (
        <form className="card form" onSubmit={submit}>
          <h2>Request a lab space</h2>
          <div className="grid2">
            <label>Lab name *<input value={f.name} onChange={set("name")} placeholder="e.g. Okolie Lab" required /></label>
            <label>Short name (used in links) *
              <input value={f.slug} onChange={(e) => { setSlugEdited(true); setF({ ...f, slug: slugify(e.target.value) }); }} placeholder="okolielab" required />
              <span className="muted small">Letters, numbers and dashes. You can change both names later.</span>
            </label>
          </div>
          <div className="grid2">
            <label>Institution *<input value={f.institution} onChange={set("institution")} placeholder="University" required /></label>
            <label>Department<input value={f.department} onChange={set("department")} /></label>
          </div>
          <label>Lab or faculty web page<input value={f.website} onChange={set("website")} placeholder="https://" /></label>
          <label>Anything the admin should know? (optional)<textarea rows={2} value={f.note} onChange={set("note")} placeholder="Group size, field, what you'll use it for" /></label>
          <label className="check wrap">
            <input type="checkbox" checked={f.agree} onChange={set("agree")} />
            <span>I'll follow the <a href="https://github.com/judebebo32/research-lab-hub/blob/main/CODE_OF_CONDUCT.md" target="_blank" rel="noreferrer">Code of Conduct</a>, and I'm responsible for making sure storing my lab's data here is allowed by my institution's policies.</span>
          </label>
          <ErrorMsg error={error} />
          <div className="row end"><button disabled={!f.agree}>Send request</button></div>
        </form>
      )}
    </>
  );
}
