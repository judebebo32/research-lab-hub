import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMe } from "../App.jsx";
import { api, fmtDate, fmtDateTime, who } from "../api.js";
import { useApi, Loading, ErrorMsg, StatusBadge, Modal } from "../ui.jsx";
import { SECTIONS } from "./ProtocolEditor.jsx";
import { RichText } from "../media.jsx";

export default function ProtocolView() {
  const { id } = useParams();
  const { me } = useMe();
  const navigate = useNavigate();
  const { data: p, error, loading, reload } = useApi(`/protocols/${id}`);
  const [comment, setComment] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [version, setVersion] = useState(null);

  const act = async (fn) => {
    setBusy(true); setActionError("");
    try { await fn(); await reload(); } catch (e) { setActionError(e.message); }
    finally { setBusy(false); }
  };

  if (loading && !p) return <Loading />;
  if (error) return <ErrorMsg error={error} />;
  if (!p) return null;

  const isAuthor = p.author_id === me.id;
  const admin = p.can_review;

  const openVersion = async (v) => {
    try { setVersion(await api.get(`/protocols/${id}/versions/${v}`)); } catch (e) { setActionError(e.message); }
  };

  return (
    <div className="protocol">
      <div className="page-head">
        <div>
          <Link to="/protocols" className="small">← Protocols</Link>
          <h1>{p.title}</h1>
          <div className="meta">
            <StatusBadge status={p.status} />
            <span>v{p.version}</span>
            <span>by {who(p)}</span>
            {p.project && <span>Project: {p.project}</span>}
            {p.experiment && <span>Experiment: {p.experiment}</span>}
            <span>Updated {fmtDate(p.updated_at)}</span>
            {p.reviewed_at && <span>Reviewed by {p.reviewer_name || "PI"} {fmtDate(p.reviewed_at)}</span>}
          </div>
        </div>
        <div className="row no-print">
          {p.can_edit && p.status !== "archived" && <Link className="btn secondary" to={`/protocols/${id}/edit`}>Edit</Link>}
          {isAuthor && ["draft", "changes_requested"].includes(p.status) && (
            <button disabled={busy} onClick={() => act(() => api.post(`/protocols/${id}/submit`))}>Submit for review</button>
          )}
          <button className="ghost" disabled={busy} onClick={async () => { const n = await api.post(`/protocols/${id}/duplicate`); navigate(`/protocols/${n.id}/edit`); }}>Duplicate</button>
          <button className="ghost" onClick={() => window.print()}>Print</button>
        </div>
      </div>
      <ErrorMsg error={actionError} />

      {admin && p.status !== "archived" && (
        <section className="card review-box no-print">
          <h2>Review</h2>
          <p className="muted small">{p.status === "submitted" ? `${who(p)} submitted this for review.` : `Current status: ${p.status.replace("_", " ")}.`} Your note is added to the discussion.</p>
          <textarea rows={3} placeholder="Feedback for the student (optional)" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
          <div className="row">
            <button disabled={busy} onClick={() => act(async () => { await api.post(`/protocols/${id}/review`, { decision: "approved", comment: reviewNote }); setReviewNote(""); })}>✓ Approve</button>
            <button className="warn" disabled={busy} onClick={() => act(async () => { await api.post(`/protocols/${id}/review`, { decision: "changes_requested", comment: reviewNote }); setReviewNote(""); })}>Request changes</button>
            <button className="ghost" disabled={busy} onClick={() => { if (confirm("Archive this protocol? It will be hidden from lists but kept on record.")) act(() => api.post(`/protocols/${id}/archive`)); }}>Archive</button>
          </div>
        </section>
      )}

      <div className="protocol-body">
        <article className="card">
          {SECTIONS.map(([k, label]) => p[k] ? (
            <section key={k} className="psec">
              <h3>{label}</h3>
              <RichText text={p[k]} />
            </section>
          ) : null)}
          {SECTIONS.every(([k]) => !p[k]) && <p className="muted">This protocol has no content yet.</p>}
        </article>

        <aside className="no-print">
          <section className="card">
            <h2>Discussion</h2>
            {p.comments.length === 0 && <p className="muted small">No comments yet.</p>}
            <ul className="comments">
              {p.comments.map((c) => (
                <li key={c.id} className={c.kind}>
                  <div className="small"><strong>{who(c)}</strong> {c.role === "admin" && <span className="role-tag admin">PI</span>} <span className="muted">{fmtDateTime(c.created_at)}</span></div>
                  <div className="pre">{c.body}</div>
                </li>
              ))}
            </ul>
            <textarea rows={2} placeholder="Add a comment or question…" value={comment} onChange={(e) => setComment(e.target.value)} />
            <button className="secondary" disabled={busy || !comment.trim()} onClick={() => act(async () => { await api.post(`/protocols/${id}/comments`, { body: comment }); setComment(""); })}>Post comment</button>
          </section>

          <section className="card">
            <h2>Version history</h2>
            <ul className="list">
              {p.versions.map((v) => (
                <li key={v.id}>
                  <button className="link" onClick={() => openVersion(v.version)}>v{v.version}</button>
                  <span className="muted small">{who(v)} · {fmtDateTime(v.created_at)}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {version && (
        <Modal title={`Version ${version.version} — ${fmtDateTime(version.created_at)}`} onClose={() => setVersion(null)} wide>
          <h3>{version.snapshot.title}</h3>
          {SECTIONS.map(([k, label]) => version.snapshot[k] ? (
            <section key={k} className="psec">
              <h4>{label}</h4>
              <RichText text={version.snapshot[k]} className={version.snapshot[k] !== p[k] ? "changed" : ""} />
            </section>
          ) : null)}
          <p className="muted small">Sections highlighted in yellow differ from the current version.</p>
        </Modal>
      )}
    </div>
  );
}
