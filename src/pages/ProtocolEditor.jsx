import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useMe } from "../App.jsx";
import { api } from "../api.js";
import { ErrorMsg, Loading, PageHead } from "../ui.jsx";
import RichEditor from "../RichEditor.jsx";
import { uploadInlineImages } from "../media.jsx";

export const SECTIONS = [
  ["objective", "Objective / purpose", "What question does this experiment answer?"],
  ["materials", "Materials & reagents", "One per line, with amounts and concentrations (e.g. 50 mL PBS, 1×)"],
  ["equipment", "Equipment", "Instruments, settings, calibration notes"],
  ["steps", "Procedure", "Numbered steps. Include times, temperatures and critical points."],
  ["safety", "Safety & waste", "Hazards, PPE, disposal instructions"],
  ["notes", "Notes / troubleshooting", "Expected results, common pitfalls, references"],
];

const EMPTY = { title: "", project: "", experiment: "", objective: "", materials: "", equipment: "", steps: "", safety: "", notes: "" };

function SectionField({ label, hint, value, onChange }) {
  return (
    <div className="section-field">
      <span className="field-label">{label}</span>
      <RichEditor value={value} onChange={onChange} placeholder={hint} />
    </div>
  );
}

export default function ProtocolEditor() {
  const { id } = useParams();
  const { me } = useMe();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [orig, setOrig] = useState(null);
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const admin = me.can.includes("review_protocols");

  useEffect(() => {
    if (!id) return;
    api.get(`/protocols/${id}`)
      .then((p) => {
        setOrig(p);
        setForm(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, p[k] || ""])));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (submit) => {
    setError("");
    if (!form.title.trim()) return setError("Give the protocol a title.");
    setBusy(true);
    try {
      const body = { ...form, submit };
      for (const [k] of SECTIONS) body[k] = await uploadInlineImages(body[k]);
      const p = id ? await api.put(`/protocols/${id}`, body) : await api.post("/protocols", body);
      navigate(`/protocols/${p.id}`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (loading) return <Loading />;
  const isOwn = !orig || orig.author_id === me.id;
  const willResubmit = orig && !admin && orig.status === "approved";

  return (
    <>
      <PageHead title={id ? `Edit: ${orig?.title || ""}` : "New protocol"} sub={id ? `Saving creates version ${(orig?.version || 0) + 1}. Earlier versions are kept.` : "Save as a draft any time, then submit for review."} />
      {willResubmit && <p className="notice">This protocol is approved. Saving your edits will send it back for review, and it leaves the lab library until it's approved again.</p>}
      {orig && !isOwn && <p className="notice">You're editing {orig.author_name || orig.author_email}'s protocol. They'll see your edits in the version history.</p>}
      <div className="card form">
        <label>Title *<input value={form.title} onChange={set("title")} placeholder="e.g. Western blot for p53 in HeLa lysates" /></label>
        <div className="grid2">
          <label>Project<input value={form.project} onChange={set("project")} placeholder="Grant / project name" /></label>
          <label>Experiment<input value={form.experiment} onChange={set("experiment")} placeholder="Experiment ID or name" /></label>
        </div>
        <p className="muted small">Tip: paste screenshots, photos or tables from Excel/Word straight into any box, or drag files in. Use the toolbar for font size, colors, lists, tables and H₂O-style sub/superscript.</p>
        {SECTIONS.map(([k, label, hint]) => (
          <SectionField key={k} k={k} label={label} hint={hint} value={form[k]} onChange={(v) => setForm((f) => ({ ...f, [k]: v }))} />
        ))}
        <ErrorMsg error={error} />
        <div className="row end">
          <Link className="btn ghost" to={id ? `/protocols/${id}` : "/protocols"}>Cancel</Link>
          <button className="secondary" disabled={busy} onClick={() => save(false)}>{id ? "Save changes" : "Save draft"}</button>
          {!admin && (!orig || ["draft", "changes_requested"].includes(orig.status)) && (
            <button disabled={busy} onClick={() => save(true)}>Save & submit for review</button>
          )}
        </div>
      </div>
    </>
  );
}
