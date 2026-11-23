// Uses Claude (through Netlify AI Gateway) to turn a CV or pasted lists into tenure-record entries.
import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";
import { db } from "./backup.mjs";

export const AI_MODEL = "claude-sonnet-5-5";
const CATEGORIES = ["publication", "grant", "teaching", "service", "mentoring", "presentation", "award", "outreach", "other"];
export const aiInputs = () => getStore({ name: "ai-inputs", consistency: "strong" });

const TOOL = {
  name: "record_activities",
  description: "Save every academic activity found in the document as structured tenure-and-promotion record entries.",
  input_schema: {
    type: "object",
    properties: {
      activities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: { type: "string", enum: CATEGORIES },
            title: { type: "string", description: "Publications: full citation (authors, year, title, venue, volume/pages). Grants: title and agency. Teaching: course code and name. Mentoring: student name and degree. Service: committee/role and body. Presentations: talk title and event." },
            details: { type: "string", description: "Useful extra context: co-authors, agency, students involved, journal, location, enrollment, impact. Empty if none." },
            role: { type: "string", description: "The faculty member's role, e.g. first author, corresponding author, co-author, PI, co-PI, instructor, advisor, committee member, chair, invited speaker." },
            start_date: { type: "string", description: "YYYY-MM-DD, YYYY-MM or YYYY. For publications the publication year/date; for grants the start; for courses the semester start. Empty if unknown." },
            end_date: { type: "string", description: "YYYY-MM-DD, YYYY-MM or YYYY, or empty." },
            amount: { type: "number", description: "Grant amount in US dollars (the faculty member's total award), or 0 if not a grant / unknown." },
            status: { type: "string", description: "e.g. published, in press, under review, submitted, funded, pending, declined, completed, current, graduated." },
            link: { type: "string", description: "DOI as https://doi.org/... or a URL if present, else empty." },
          },
          required: ["category", "title", "details", "role", "start_date", "end_date", "amount", "status", "link"],
        },
      },
      notes: { type: "string", description: "Anything the faculty member should double-check (unclear dates, items you were unsure how to classify)." },
    },
    required: ["activities", "notes"],
  },
};

const normDate = (s) => {
  const t = String(s || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (/^\d{4}-\d{2}$/.test(t)) return `${t}-01`;
  if (/^\d{4}$/.test(t)) return `${t}-01-01`;
  return null;
};
const key = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);

export async function runTenureJob(jobId) {
  const sql = db();
  const [job] = await sql`SELECT j.*, m.full_name, m.email FROM ai_jobs j JOIN members m ON m.id = j.owner_id WHERE j.id = ${jobId}`;
  if (!job || job.status !== "pending") return;
  await sql`UPDATE ai_jobs SET status = 'running' WHERE id = ${jobId}`;
  try {
    const input = await aiInputs().get(String(jobId), { type: "json" });
    if (!input) throw new Error("The uploaded content was not found");
    const content = [];
    if (input.pdf_base64) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: input.pdf_base64 } });
    if (input.text) content.push({ type: "text", text: `<document name="${(input.name || "pasted text").replace(/"/g, "")}">\n${input.text}\n</document>` });
    content.push({
      type: "text",
      text: `This is academic material belonging to ${job.full_name || job.email}, a faculty member building their tenure and promotion record.
Extract EVERY individual activity (each paper, grant, course taught (one entry per course, listing the semesters/years in details), student mentored, service role, talk, award, outreach activity). Do not merge separate items and do not skip any. Do not invent information that is not in the document; leave fields empty when unknown. Use the faculty member's name to work out their role (e.g. first or corresponding author, PI vs co-PI). You MUST respond by calling the record_activities tool exactly once with all entries — do not reply with plain text.`,
    });
    const anthropic = new Anthropic();
    const msg = await anthropic.messages.stream({
      model: AI_MODEL,
      max_tokens: 64000,
      tools: [TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content }],
    }).finalMessage();
    let out = msg.content.find((b) => b.type === "tool_use")?.input;
    if (!out?.activities) {
      // Fallback: the model answered in text — pull out the JSON object.
      const txt = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const start = txt.indexOf("{"), end = txt.lastIndexOf("}");
      try { out = JSON.parse(txt.slice(start, end + 1)); } catch { out = null; }
      if (Array.isArray(out)) out = { activities: out, notes: "" };
    }
    if (!out?.activities) throw new Error("The AI didn't return any entries. Please try again.");

    const existing = await sql`SELECT title FROM pi_activities WHERE owner_id = ${job.owner_id}`;
    const seen = new Set(existing.map((e) => key(e.title)));
    const items = out.activities
      .filter((a) => a && CATEGORIES.includes(a.category) && String(a.title || "").trim())
      .map((a) => ({
        category: a.category, title: a.title.trim(), details: a.details || "", role: a.role || "",
        start_date: normDate(a.start_date), end_date: normDate(a.end_date),
        amount: a.category === "grant" && Number(a.amount) > 0 ? Number(a.amount) : null,
        status: a.status || "", link: /^https?:\/\//.test(a.link || "") ? a.link : "",
        duplicate: seen.has(key(a.title)),
      }));
    const truncated = msg.stop_reason === "max_tokens";
    await sql`UPDATE ai_jobs SET status = 'done', finished_at = NOW(),
      result = ${JSON.stringify({ items, notes: out.notes || "", truncated, usage: msg.usage })}::jsonb WHERE id = ${jobId}`;
  } catch (e) {
    console.error("tenure AI job failed", e);
    const message = String(e?.message || e).includes("credit") ? "Your Netlify AI credits ran out. Add credits in Netlify, then try again." : String(e?.message || e).slice(0, 500);
    await sql`UPDATE ai_jobs SET status = 'error', finished_at = NOW(), error = ${message} WHERE id = ${jobId}`;
  } finally {
    try { await aiInputs().delete(String(jobId)); } catch { /* ignore */ }
  }
}
