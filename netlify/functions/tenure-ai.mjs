// Background job (up to 15 min): AI extraction of tenure-record entries.
import { internalSecret } from "../../lib/backup.mjs";
import { runTenureJob } from "../../lib/tenureAi.mjs";

export default async (req) => {
  if (req.headers.get("x-labhub-secret") !== (await internalSecret())) return;
  const { jobId } = await req.json();
  await runTenureJob(Number(jobId));
};

export const config = { background: true };
