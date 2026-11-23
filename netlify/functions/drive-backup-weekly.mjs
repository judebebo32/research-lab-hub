// Weekly trigger for the Google Drive backup.
import { getSetting, triggerBackgroundBackup } from "../../lib/backup.mjs";

export default async (req, context) => {
  const g = await getSetting("google");
  if (!g?.refresh_token) return; // not connected yet
  const site = Netlify.env.get("URL") || context.site?.url;
  console.log("Triggered Drive backup:", await triggerBackgroundBackup(site));
};

// Sundays 11:20 PM US Eastern (04:20 UTC Monday in winter; 12:20 AM Monday during daylight time).
export const config = { schedule: "20 4 * * 1" };
