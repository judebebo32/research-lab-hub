import { useEffect, useMemo, useRef, useState } from "react";
import { api, isoDate } from "../api.js";
import { Modal, ErrorMsg } from "../ui.jsx";
import { CATS } from "./Tenure.jsx";

const toBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1]);
  r.onerror = reject;
  r.readAsDataURL(file);
});

export default function AiImport({ onClose, onAdded }) {
  const [stage, setStage] = useState("input"); // input | working | review
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState(null);
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const start = async () => {
    setError("");
    try {
      const body = { name: file?.name || "pasted text", text };
      if (file) {
        if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
          if (file.size > 3.2 * 1024 * 1024) throw new Error("That PDF is over 3 MB. Save a smaller copy, or copy-paste its text into the box.");
          body.pdf_base64 = await toBase64(file);
        } else if (/\.docx$/i.test(file.name)) {
          const mammoth = (await import("mammoth/mammoth.browser.js")).default;
          const r = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
          body.text = `${r.value}\n\n${text}`;
        } else if (/\.(txt|md|csv|bib|ris)$/i.test(file.name) || file.type.startsWith("text/")) {
          body.text = `${await file.text()}\n\n${text}`;
        } else {
          throw new Error("Use a PDF, Word (.docx) or text file — or paste the text.");
        }
      }
      if (!body.pdf_base64 && !body.text.trim()) throw new Error("Upload your CV or paste some text first.");
      const r = await api.post("/tenure-ai/jobs", body);
      setJobId(r.id);
      setStage("working");
    } catch (e) { setError(e.message); }
  };

  useEffect(() => {
    if (stage !== "working" || !jobId) return;
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    const poll = setInterval(async () => {
      try {
        const j = await api.get(`/tenure-ai/jobs/${jobId}`);
        if (j.status === "done") {
          setItems(j.result.items.map((it, i) => ({ ...it, _id: i, _on: !it.duplicate })));
          setNotes(j.result.notes || "");
          setTruncated(!!j.result.truncated);
          setStage("review");
        } else if (j.status === "error") {
          setError(j.error || "The assistant ran into a problem.");
          setStage("input");
        }
      } catch (e) { setError(e.message); setStage("input"); }
    }, 3000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [stage, jobId]);

  const upd = (id, patch) => setItems((xs) => xs.map((x) => (x._id === id ? { ...x, ...patch } : x)));
  const shown = useMemo(() => items.filter((x) => !filter || x.category === filter), [items, filter]);
  const counts = useMemo(() => items.reduce((c, x) => ({ ...c, [x.category]: (c[x.category] || 0) + 1 }), {}), [items]);
  const selected = items.filter((x) => x._on);

  const save = async () => {
    setSaving(true); setError("");
    try {
      const r = await api.post("/pi-activities/bulk", { items: selected.map(({ _id, _on, duplicate, ...x }) => x) });
      onAdded(r.added);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <Modal title="✨ AI import assistant" onClose={stage === "working" ? () => {} : onClose} wide>
      {stage === "input" && (
        <div className="form">
          <p className="small">Upload your CV, or paste any list — publications from Google Scholar, grants, courses taught, committees, talks, students. The AI drafts entries; <strong>nothing is saved until you review and confirm</strong>.</p>
          <div className="drop" onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); setFile(e.dataTransfer.files[0] || null); }}>
            {file ? <><strong>{file.name}</strong> <span className="muted small">({Math.round(file.size / 1024)} KB)</span> <button type="button" className="small ghost" onClick={(e) => { e.stopPropagation(); setFile(null); }}>Remove</button></>
              : <><strong>📄 Choose your CV</strong><span className="muted small">PDF, Word (.docx) or text — or drag it here</span></>}
          </div>
          <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.txt,.md,.csv,.bib,.ris,application/pdf,text/plain"
            onChange={(e) => { setFile(e.target.files[0] || null); e.target.value = ""; }} />
          <label>…and/or paste text
            <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder={"e.g.\nSmith J, Doe A (2023) Title of paper. J. Am. Chem. Soc. 145:1234\nNSF CAREER Award, PI, $550,000, 2024–2029\nCHEM 341 Physical Chemistry, Fall 2022, Fall 2023 (45 students)"} />
          </label>
          <p className="muted small">Uses Claude through your Netlify AI credits (a full CV typically costs well under 100 credits). Your document is used only for this extraction and isn't stored afterwards.</p>
          <ErrorMsg error={error} />
          <div className="row end">
            <button type="button" className="ghost" onClick={onClose}>Cancel</button>
            <button type="button" onClick={start} disabled={!file && !text.trim()}>Extract entries</button>
          </div>
        </div>
      )}

      {stage === "working" && (
        <div className="ai-working">
          <div className="spinner" />
          <p><strong>Reading {file?.name || "your text"}…</strong></p>
          <p className="muted small">{elapsed}s — a long CV can take 1–3 minutes. Keep this window open.</p>
        </div>
      )}

      {stage === "review" && (
        <div className="form">
          <p className="small">Found <strong>{items.length}</strong> entries. Untick anything you don't want and fix details inline. Entries that look like they're already in your record are unticked.</p>
          {truncated && <p className="notice">The document was very long and the AI stopped before the end. Add these, then run the assistant again on the remaining sections.</p>}
          {notes && <p className="notice"><strong>Check:</strong> {notes}</p>}
          <div className="chips">
            <button type="button" className={`chip ${!filter ? "on" : ""}`} onClick={() => setFilter("")}>All ({items.length})</button>
            {Object.entries(counts).map(([k, n]) => (
              <button type="button" key={k} className={`chip ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>{CATS[k]?.label} ({n})</button>
            ))}
          </div>
          <div className="row small">
            <button type="button" className="link" onClick={() => setItems((xs) => xs.map((x) => (shown.includes(x) ? { ...x, _on: true } : x)))}>Select all shown</button>
            <button type="button" className="link" onClick={() => setItems((xs) => xs.map((x) => (shown.includes(x) ? { ...x, _on: false } : x)))}>Clear shown</button>
          </div>
          <div className="table-wrap ai-table">
            <table>
              <thead><tr><th></th><th>Type</th><th>Entry</th><th>Role</th><th>Date</th><th>Status</th><th>$</th></tr></thead>
              <tbody>
                {shown.map((x) => (
                  <tr key={x._id} className={x._on ? "" : "off"}>
                    <td><input type="checkbox" checked={x._on} onChange={(e) => upd(x._id, { _on: e.target.checked })} /></td>
                    <td>
                      <select value={x.category} onChange={(e) => upd(x._id, { category: e.target.value })}>
                        {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v.one}</option>)}
                      </select>
                      {x.duplicate && <div className="badge st-warn">Already in record?</div>}
                    </td>
                    <td>
                      <textarea rows={2} value={x.title} onChange={(e) => upd(x._id, { title: e.target.value })} />
                      {x.details && <div className="muted small clamp">{x.details}</div>}
                    </td>
                    <td><input value={x.role} onChange={(e) => upd(x._id, { role: e.target.value })} /></td>
                    <td><input type="date" value={isoDate(x.start_date)} onChange={(e) => upd(x._id, { start_date: e.target.value || null })} /></td>
                    <td><input value={x.status} onChange={(e) => upd(x._id, { status: e.target.value })} /></td>
                    <td>{x.category === "grant" ? <input type="number" value={x.amount ?? ""} onChange={(e) => upd(x._id, { amount: e.target.value ? Number(e.target.value) : null })} /> : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Dates given only as a year are set to January 1 of that year — adjust if it matters.</p>
          <ErrorMsg error={error} />
          <div className="row end">
            <button type="button" className="ghost" onClick={() => { setStage("input"); setItems([]); }}>Start over</button>
            <button type="button" onClick={save} disabled={saving || !selected.length}>{saving ? "Adding…" : `Add ${selected.length} to my record`}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
