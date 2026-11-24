// Uses Claude (through Netlify AI Gateway) to turn uploaded documents, notes or photos of
// notebook pages into a structured protocol draft. Admin-only; nothing is saved automatically.
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./backup.mjs";
import { AI_MODEL, aiInputs } from "./tenureAi.mjs";

const HTML_HINT = "Simple HTML only: <p>, <ul>, <ol>, <li>, <strong>, <em>, <sub>, <sup>, <table>, <tr>, <th>, <td>. No styles, scripts or images.";
const TOOL = {
  name: "record_protocol",
  description: "Save the experimental protocol drafted from the source material.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short, specific protocol title, e.g. 'Western blot for p53 in HeLa lysates'." },
      project: { type: "string", description: "Project or grant name if stated, else empty." },
      experiment: { type: "string", description: "Experiment ID or name if stated, else empty." },
      objective: { type: "string", description: `What the procedure is for. ${HTML_HINT}` },
      materials: { type: "string", description: `Materials and reagents with amounts, concentrations, suppliers, catalog/lot numbers when given. Prefer a table (Reagent | Amount/concentration | Notes) when there are several. ${HTML_HINT}` },
      equipment: { type: "string", description: `Instruments and settings. ${HTML_HINT}` },
      steps: { type: "string", description: `Numbered procedure as an <ol>, one action per step, keeping every time, temperature, speed (× g / rpm), volume and critical note from the source. ${HTML_HINT}` },
      safety: { type: "string", description: `Hazards, PPE and waste disposal stated or clearly implied by the materials used. ${HTML_HINT}` },
      notes: { type: "string", description: `Expected results, troubleshooting, references from the source. ${HTML_HINT}` },
      missing_info: {
        type: "array", items: { type: "string" },
        description: "Specific details the source does not give but a complete, reproducible protocol needs (e.g. 'Centrifuge speed in step 4', 'Antibody dilution'). Never invent these values.",
      },
    },
    required: ["title", "project", "experiment", "objective", "materials", "equipment", "steps", "safety", "notes", "missing_info"],
  },
};

const clip = (s, n = 60000) => String(s || "").slice(0, n);
// Remove anything beyond the simple formatting the editor uses.
const tidy = (html) => clip(html)
  .replace(/<\s*(script|style|iframe|object|embed)[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
  .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
  .replace(/\s(style|class|id)\s*=\s*("[^"]*"|'[^']*')/gi, "")
  .replace(/<\s*img[^>]*>/gi, "");

export async function runProtocolJob(jobId) {
  const sql = db();
  const [job] = await sql`SELECT * FROM ai_jobs WHERE id = ${jobId}`;
  if (!job || job.status !== "pending" || job.kind !== "protocol") return;
  await sql`UPDATE ai_jobs SET status = 'running' WHERE id = ${jobId}`;
  try {
    const input = await aiInputs().get(String(jobId), { type: "json" });
    if (!input) throw new Error("The uploaded material was not found");
    const content = [];
    for (const f of input.files || []) {
      if (f.kind === "pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } });
      else if (f.kind === "image") content.push({ type: "image", source: { type: "base64", media_type: f.media_type, data: f.data } });
      else if (f.kind === "text") content.push({ type: "text", text: `<document name="${String(f.name || "notes").replace(/"/g, "")}">\n${clip(f.text, 200000)}\n</document>` });
    }
    if (input.text?.trim()) content.push({ type: "text", text: `<notes>\n${clip(input.text, 200000)}\n</notes>` });
    content.push({
      type: "text",
      text: `You are helping a principal investigator turn lab material (documents, typed notes, or photos of handwritten notebook pages) into a clear, complete, reproducible experimental protocol for their research group.
Rules:
- Use only what the material says. Never invent amounts, concentrations, times, temperatures, speeds or catalog numbers. If something needed is missing, leave it out of the text and list it in missing_info.
- Keep every quantitative detail exactly as written (units, × g vs rpm, temperatures). Fix obvious spelling only.
- If the material contains several unrelated procedures, draft the main one and mention the others in notes.
- Write steps as a numbered list a new student could follow.
${input.instructions?.trim() ? `\nThe PI's instructions for this draft:\n<instructions>\n${clip(input.instructions, 4000)}\n</instructions>\n` : ""}
You MUST respond by calling the record_protocol tool exactly once — do not reply with plain text.`,
    });
    const msg = await new Anthropic().messages.stream({
      model: AI_MODEL,
      max_tokens: 32000,
      tools: [TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content }],
    }).finalMessage();
    let out = msg.content.find((b) => b.type === "tool_use")?.input;
    if (!out) {
      const txt = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      try { out = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1)); } catch { out = null; }
    }
    if (!out?.title && !out?.steps) throw new Error("The AI couldn't find a procedure in that material. Try adding more detail.");
    const draft = {
      title: clip(out.title, 200).trim() || "AI-drafted protocol",
      project: clip(out.project, 200), experiment: clip(out.experiment, 200),
      objective: tidy(out.objective), materials: tidy(out.materials), equipment: tidy(out.equipment),
      steps: tidy(out.steps), safety: tidy(out.safety), notes: tidy(out.notes),
    };
    const missing = Array.isArray(out.missing_info) ? out.missing_info.map((x) => clip(x, 300)).filter(Boolean).slice(0, 30) : [];
    await sql`UPDATE ai_jobs SET status = 'done', finished_at = NOW(),
      result = ${JSON.stringify({ draft, missing, truncated: msg.stop_reason === "max_tokens" })}::jsonb WHERE id = ${jobId}`;
  } catch (e) {
    console.error("protocol AI job failed", e);
    const m = String(e?.message || e);
    await sql`UPDATE ai_jobs SET status = 'error', finished_at = NOW(),
      error = ${m.includes("credit") ? "Netlify AI credits ran out. Add credits in Netlify, then try again." : m.slice(0, 500)} WHERE id = ${jobId}`;
  } finally {
    try { await aiInputs().delete(String(jobId)); } catch { /* ignore */ }
  }
}
