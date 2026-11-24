// Background job (up to 15 min): runs an AI job — tenure-record import or protocol drafting.
import { internalSecret, db } from "../../lib/backup.mjs";
import { runTenureJob } from "../../lib/tenureAi.mjs";
import { runProtocolJob } from "../../lib/protocolAi.mjs";

export default async (req) => {
  if (req.headers.get("x-labhub-secret") !== (await internalSecret())) return;
  const { jobId } = await req.json();
  const [job] = await db()`SELECT kind FROM ai_jobs WHERE id = ${Number(jobId)}`;
  if (job?.kind === "protocol") await runProtocolJob(Number(jobId));
  else await runTenureJob(Number(jobId));
};

export const config = { background: true };
