// Name of the whole platform (each lab has its own name, set by its owner).
// Set PLATFORM_NAME in Netlify to change it.
export const PLATFORM_NAME = import.meta.env.PLATFORM_NAME || "Research Lab Hub";

const KEY = "labhub.labId";
export const getLabId = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setLabId = (id) => { try { id ? localStorage.setItem(KEY, String(id)) : localStorage.removeItem(KEY); } catch { /* ignore */ } };
export const labHeaders = () => { const id = getLabId(); return id ? { "X-Lab-Id": id } : {}; };
