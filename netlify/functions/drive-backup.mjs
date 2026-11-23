// Background job (up to 15 min): copies one lab's data and new photos/videos to its Google Drive.
import { internalSecret, runDriveBackup } from "../../lib/backup.mjs";

export default async (req) => {
  if (req.headers.get("x-labhub-secret") !== (await internalSecret())) return;
  const { labId } = await req.json().catch(() => ({}));
  if (!labId) return;
  try { console.log(`Lab ${labId}:`, await runDriveBackup(Number(labId))); } catch (e) { console.error(`Drive backup failed for lab ${labId}:`, e.message); }
};

export const config = { background: true };
