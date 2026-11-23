import { useCallback, useEffect, useState } from "react";
import { api, STATUS_LABELS } from "./api.js";

export function useApi(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try { setData(await api.get(path)); setError(""); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [path]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

export const StatusBadge = ({ status }) => (
  <span className={`badge s-${status}`}>{STATUS_LABELS[status] || status}</span>
);

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="ghost icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const Loading = () => <p className="muted">Loading…</p>;
export const ErrorMsg = ({ error }) => (error ? <p className="error">{error}</p> : null);
export const Empty = ({ children }) => <div className="empty">{children}</div>;

export const PageHead = ({ title, sub, children }) => (
  <div className="page-head">
    <div>
      <h1>{title}</h1>
      {sub && <p className="muted">{sub}</p>}
    </div>
    <div className="row">{children}</div>
  </div>
);
