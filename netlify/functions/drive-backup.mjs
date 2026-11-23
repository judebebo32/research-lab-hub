// Background job (up to 15 min): copies the lab's data and new photos/videos to Google Drive.
import { internalSecret, runDriveBackup } from "../../lib/backup.mjs";

export default async (req) => {
  if (req.headers.get("x-labhub-secret") !== (await internalSecret())) return;
  try { console.log(await runDriveBackup()); } catch (e) { console.error("Drive backup failed:", e.message); }
};

export const config = { background: true };
