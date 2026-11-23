// Weekly trigger: starts a Google Drive backup for every lab that connected Drive.
import { driveConnectedLabs, triggerBackgroundBackup } from "../../lib/backup.mjs";

export default async (req, context) => {
  const site = Netlify.env.get("URL") || context.site?.url;
  for (const labId of await driveConnectedLabs()) {
    console.log(`Triggered Drive backup for lab ${labId}:`, await triggerBackgroundBackup(site, labId));
  }
};

// Sundays 11:20 PM US Eastern (04:20 UTC Monday in winter; 12:20 AM Monday during daylight time).
export const config = { schedule: "20 4 * * 1" };
