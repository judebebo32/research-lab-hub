const stores = new Map();
export function getStore(opts) {
  const name = typeof opts === "string" ? opts : opts.name;
  if (!stores.has(name)) stores.set(name, new Map());
  const m = stores.get(name);
  return {
    async set(k, v) { m.set(k, v instanceof ArrayBuffer ? v : await new Response(v).arrayBuffer()); return { modified: true }; },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); return { modified: true }; },
    async get(k, o = {}) { if (!m.has(k)) return null; const v = m.get(k); return o.type === "json" ? JSON.parse(v) : v; },
    async delete(k) { m.delete(k); },
    async list({ prefix = "" } = {}) { return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
  };
}
