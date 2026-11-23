export async function getUser() { return globalThis.__USER || null; }
export const admin = { deleteUser: async (id) => { (globalThis.__DELETED_USERS ||= []).push(id); } };
