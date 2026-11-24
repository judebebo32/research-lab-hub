import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { Modal, ErrorMsg } from "../ui.jsx";

export const AI_DRAFT_KEY = "labhub.aiProtocolDraft";
const MAX_BYTES = 3 * 1024 * 1024;

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1]);
  r.onerror = reject;
  r.readAsDataURL(blob);
});

// Photos of notebook pages: shrink so several fit in one request but stay readable.
async function prepImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
    return { kind: "image", name: file.name, media_type: "image/jpeg", data: await toBase64(blob) };
  } catch {
    throw new Error(`${file.name}: this photo format can't be read here. Save it as JPG or PNG.`);
  }
}

async function prepFile(file) {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_BYTES) throw new Error(`${file.name} is over 3 MB. Upload just the pages you need, or paste the text.`);
    return { kind: "pdf", name: file.name, data: await toBase64(file) };
  }
  if (/\.docx$/i.test(file.name)) {
    const mammoth = (await import("mammoth/mammoth.browser.js")).default;
    const r = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { kind: "text", name: file.name, text: r.value };
  }
  if (file.type.startsWith("image/")) return prepImage(file);
  if (file.type.startsWith("text/") || /\.(txt|md|csv|tsv|rtf)$/i.test(file.name)) return { kind: "text", name: file.name, text: await file.text() };
  throw new Error(`${file.name}: use PDF, Word (.docx), text, or a photo (JPG/PNG).`);
}

export default function AiProtocol({ onClose }) {
  const navigate = useNavigate();
  const [stage, setStage] = useState("input"); // input | working
  const [files, setFiles] = useState([]);
  const [text, setText] = useState("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const fileRef = useRef(null);

  const addFiles = (list) => setFiles((cur) => [...cur, ...[...list]].slice(0, 8));

  const start = async () => {
    setError("");
    try {
      const prepared = [];
      for (const f of files) prepared.push(await prepFile(f));
      const size = prepared.reduce((n, f) => n + (f.data?.length || 0) + (f.text?.length || 0), 0);
      if (size > 4.3 * 1024 * 1024) throw new Error("Those files are too large together. Upload fewer pages or paste the text.");
      if (!prepared.length && !text.trim()) throw new Error("Add a document, a photo, or paste your notes.");
      const r = await api.post("/protocol-ai/jobs", { files: prepared, text, instructions });
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
        const j = await api.get(`/protocol-ai/jobs/${jobId}`);
        if (j.status === "done") {
          sessionStorage.setItem(AI_DRAFT_KEY, JSON.stringify({ ...j.result, source: j.source_name }));
          onClose();
          navigate("/protocols/new?ai=1");
        } else if (j.status === "error") {
          setError(j.error || "The assistant ran into a problem."); setStage("input");
        }
      } catch (e) { setError(e.message); setStage("input"); }
    }, 3000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [stage, jobId, navigate, onClose]);

  return (
    <Modal title="✨ AI protocol from notes" onClose={stage === "working" ? () => {} : onClose} wide>
      {stage === "input" ? (
        <div className="form">
          <p className="small">Upload a document, photos of notebook pages, or paste rough notes. Claude drafts a structured protocol (objective, materials, equipment, numbered steps, safety, notes) and lists anything missing. <strong>The draft opens in the editor. Nothing is saved until you click Save.</strong></p>
          <div className="drop" onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
            <strong>📄 Add documents or photos</strong>
            <span className="muted small">PDF, Word (.docx), text, or photos of handwritten pages. Up to 8 files, about 3 MB total. Drag them here or tap to choose.</span>
          </div>
          <input ref={fileRef} type="file" hidden multiple accept=".pdf,.docx,.txt,.md,.csv,.tsv,image/*,application/pdf,text/plain"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          {files.length > 0 && (
            <ul className="list file-list">
              {files.map((f, i) => (
                <li key={i}>{f.type.startsWith("image/") ? "🖼️" : "📄"} {f.name} <span className="muted small">{Math.round(f.size / 1024)} KB</span>
                  <button type="button" className="small ghost" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>Remove</button></li>
              ))}
            </ul>
          )}
          <label>…and/or paste notes
            <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"e.g.\nlyse cells RIPA 100ul on ice 30 min, spin 14k 15 min 4C\nBCA, load 30ug, 4-12% gel 150V ~1h\ntransfer PVDF 100V 1h cold room, block 5% milk 1h\np53 DO-1 1:1000 overnight..."} />
          </label>
          <label>Instructions for the AI (optional)
            <input value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. Scale to a 96-well plate · Write it for first-year students · Focus on the DNA extraction part" />
          </label>
          <p className="muted small">Only lab owners and admins can use this. Files are sent to Claude through your Netlify AI credits, used only for this draft, and deleted afterwards. Counts toward your lab's monthly AI allowance.</p>
          <ErrorMsg error={error} />
          <div className="row end">
            <button type="button" className="ghost" onClick={onClose}>Cancel</button>
            <button type="button" onClick={start} disabled={!files.length && !text.trim()}>✨ Draft protocol</button>
          </div>
        </div>
      ) : (
        <div className="ai-working">
          <div className="spinner" />
          <p><strong>Drafting your protocol…</strong></p>
          <p className="muted small">{elapsed}s. Usually under a minute; photos of handwriting can take longer. Keep this window open.</p>
        </div>
      )}
    </Modal>
  );
}
