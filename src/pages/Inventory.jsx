import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMe } from "../App.jsx";
import { api, fmtDate, fmtDateTime, isoDate, who, downloadCSV } from "../api.js";
import { useApi, Loading, ErrorMsg, PageHead, Modal, Empty } from "../ui.jsx";

const CATEGORIES = ["Chemicals & reagents", "Biologicals", "Consumables", "Glassware & plasticware", "Equipment", "Electronics & parts", "Materials", "Software & licenses", "Safety / PPE", "Other"];
const BLANK = { name: "", category: "Consumables", quantity: "", unit: "", min_quantity: "", location: "", supplier: "", catalog_number: "", lot_number: "", cas_number: "", expiry_date: "", hazard: "", notes: "" };

const stockState = (i) => {
  if (i.expiry_date && new Date(i.expiry_date) < new Date()) return ["bad", "Expired"];
  if (i.min_quantity !== null && Number(i.quantity) <= Number(i.min_quantity)) return ["warn", "Low"];
  if (i.expiry_date && new Date(i.expiry_date) < new Date(Date.now() + 30 * 864e5)) return ["warn", "Expiring"];
  return ["ok", "OK"];
};

export default function Inventory() {
  const { me } = useMe();
  const admin = me.can.includes("manage_inventory");
  const [params] = useSearchParams();
  const { data, error, loading, reload } = useApi("/inventory");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [onlyAlerts, setOnlyAlerts] = useState(params.get("filter") === "low");
  const [editing, setEditing] = useState(null);   // item or BLANK
  const [adjusting, setAdjusting] = useState(null);
  const [history, setHistory] = useState(null);

  const categories = useMemo(() => [...new Set([...CATEGORIES, ...(data || []).map((i) => i.category)])], [data]);
  const rows = useMemo(() => (data || []).filter((i) => {
    const hay = `${i.name} ${i.catalog_number || ""} ${i.location || ""} ${i.supplier || ""} ${i.cas_number || ""}`.toLowerCase();
    return (!q || hay.includes(q.toLowerCase())) && (!cat || i.category === cat) && (!onlyAlerts || stockState(i)[0] !== "ok");
  }), [data, q, cat, onlyAlerts]);

  const exportCSV = () => downloadCSV(`inventory-${isoDate(new Date().toISOString())}.csv`, rows, [
    { label: "Name", value: "name" }, { label: "Category", value: "category" }, { label: "Quantity", value: "quantity" },
    { label: "Unit", value: "unit" }, { label: "Min", value: "min_quantity" }, { label: "Location", value: "location" },
    { label: "Supplier", value: "supplier" }, { label: "Catalog #", value: "catalog_number" }, { label: "Lot #", value: "lot_number" },
    { label: "CAS #", value: "cas_number" }, { label: "Expiry", value: (r) => isoDate(r.expiry_date) }, { label: "Hazard", value: "hazard" },
  ]);

  return (
    <>
      <PageHead title="Inventory" sub="Anyone in the lab can add items and log usage. Every change is recorded.">
        <button className="ghost" onClick={exportCSV}>Export CSV</button>
        <button onClick={() => setEditing(BLANK)}>+ Add item</button>
      </PageHead>
      <div className="toolbar">
        <input placeholder="Search name, catalog #, location, supplier…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={onlyAlerts} onChange={(e) => setOnlyAlerts(e.target.checked)} /> Alerts only</label>
      </div>
      <ErrorMsg error={error} />
      {loading && !data ? <Loading /> : rows.length === 0 ? (
        <Empty>{data?.length ? "No items match." : "No inventory yet. Add your first item."}</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Item</th><th>Category</th><th>Qty</th><th>Location</th><th>Expiry</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((i) => {
                const [cls, label] = stockState(i);
                return (
                  <tr key={i.id}>
                    <td>
                      <button className="link strong" onClick={() => setEditing(i)}>{i.name}</button>
                      <div className="muted small">{[i.supplier, i.catalog_number && `#${i.catalog_number}`, i.hazard && `⚠ ${i.hazard}`].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="muted">{i.category}</td>
                    <td className="nowrap"><strong>{Number(i.quantity)}</strong> {i.unit}</td>
                    <td>{i.location || "—"}</td>
                    <td className="nowrap">{i.expiry_date ? fmtDate(i.expiry_date) : "—"}</td>
                    <td><span className={`badge st-${cls}`}>{label}</span></td>
                    <td className="nowrap right">
                      <button className="small secondary" onClick={() => setAdjusting({ item: i, dir: -1 })}>Use</button>{" "}
                      <button className="small ghost" onClick={() => setAdjusting({ item: i, dir: 1 })}>Restock</button>{" "}
                      <button className="small ghost" onClick={() => setHistory(i)} title="History">⟲</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && <ItemForm item={editing} categories={categories} admin={admin} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {adjusting && <AdjustForm {...adjusting} onClose={() => setAdjusting(null)} onSaved={() => { setAdjusting(null); reload(); }} />}
      {history && <History item={history} onClose={() => setHistory(null)} />}
    </>
  );
}

function ItemForm({ item, categories, admin, onClose, onSaved }) {
  const isNew = !item.id;
  const [f, setF] = useState(() => ({ ...BLANK, ...Object.fromEntries(Object.entries(item).map(([k, v]) => [k, v ?? ""])), expiry_date: isoDate(item.expiry_date) }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      if (isNew) await api.post("/inventory", f); else await api.put(`/inventory/${item.id}`, f);
      onSaved();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(`Remove "${item.name}" from inventory? Its usage history will also be deleted.`)) return;
    try { await api.del(`/inventory/${item.id}`); onSaved(); } catch (err) { setError(err.message); }
  };

  return (
    <Modal title={isNew ? "Add inventory item" : `Edit ${item.name}`} onClose={onClose} wide>
      <form className="form" onSubmit={save}>
        <label>Name *<input value={f.name} onChange={set("name")} required autoFocus /></label>
        <div className="grid3">
          <label>Category
            <input list="cats" value={f.category} onChange={set("category")} />
            <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          {isNew
            ? <label>Starting quantity<input type="number" step="any" value={f.quantity} onChange={set("quantity")} /></label>
            : <label>Quantity<input value={`${Number(item.quantity)} (use Use/Restock to change)`} disabled /></label>}
          <label>Unit<input value={f.unit} onChange={set("unit")} placeholder="mL, g, boxes, units…" /></label>
        </div>
        <div className="grid3">
          <label>Low-stock alert at<input type="number" step="any" value={f.min_quantity} onChange={set("min_quantity")} /></label>
          <label>Location<input value={f.location} onChange={set("location")} placeholder="Room / fridge / shelf" /></label>
          <label>Expiry date<input type="date" value={f.expiry_date} onChange={set("expiry_date")} /></label>
        </div>
        <div className="grid3">
          <label>Supplier<input value={f.supplier} onChange={set("supplier")} /></label>
          <label>Catalog #<input value={f.catalog_number} onChange={set("catalog_number")} /></label>
          <label>Lot #<input value={f.lot_number} onChange={set("lot_number")} /></label>
        </div>
        <div className="grid2">
          <label>CAS # (chemicals)<input value={f.cas_number} onChange={set("cas_number")} /></label>
          <label>Hazard<input value={f.hazard} onChange={set("hazard")} placeholder="e.g. Flammable, corrosive" /></label>
        </div>
        <label>Notes<textarea rows={2} value={f.notes} onChange={set("notes")} /></label>
        {!isNew && <p className="muted small">Last updated {fmtDateTime(item.updated_at)}{item.updated_by_name ? ` by ${item.updated_by_name}` : ""}</p>}
        <ErrorMsg error={error} />
        <div className="row end">
          {!isNew && admin && <button type="button" className="ghost danger" onClick={remove}>Remove</button>}
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button disabled={busy}>{isNew ? "Add item" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}

function AdjustForm({ item, dir, onClose, onSaved }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const save = async (e) => {
    e.preventDefault();
    const n = Number(amount);
    if (!n || n <= 0) return setError("Enter an amount greater than 0");
    try { await api.post(`/inventory/${item.id}/adjust`, { change: dir * n, reason }); onSaved(); }
    catch (err) { setError(err.message); }
  };
  return (
    <Modal title={`${dir < 0 ? "Log usage of" : "Restock"} ${item.name}`} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <p className="muted">Currently {Number(item.quantity)} {item.unit}</p>
        <label>Amount {dir < 0 ? "used" : "added"} ({item.unit || "units"})<input type="number" step="any" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></label>
        <label>{dir < 0 ? "What for? (experiment / protocol)" : "Note (order #, new lot…)"}<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <ErrorMsg error={error} />
        <div className="row end"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button>Save</button></div>
      </form>
    </Modal>
  );
}

function History({ item, onClose }) {
  const { data, loading } = useApi(`/inventory/${item.id}/transactions`);
  return (
    <Modal title={`History: ${item.name}`} onClose={onClose}>
      {loading ? <Loading /> : !data?.length ? <p className="muted">No usage logged yet.</p> : (
        <ul className="feed">
          {data.map((t) => (
            <li key={t.id}>
              <span className="when">{fmtDateTime(t.created_at)}</span>
              <span><strong>{who(t)}</strong> {Number(t.change) < 0 ? "used" : "added"} {Math.abs(Number(t.change))} {item.unit}{t.reason ? ` — ${t.reason}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
