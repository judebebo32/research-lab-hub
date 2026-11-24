export default class Anthropic {
  constructor() { this.messages = { stream: (req) => { globalThis.__AI_REQ = req; if (req.tools?.[0]?.name === "record_protocol") return { finalMessage: async () => ({
    stop_reason: "tool_use", usage: {},
    content: [{ type: "tool_use", name: "record_protocol", input: {
      title: "Western blot for p53", project: "", experiment: "EXP-031",
      objective: "<p>Detect p53 after treatment.</p>",
      materials: "<table><tr><th>Reagent</th><th>Amount</th></tr><tr><td>RIPA</td><td>100 µL</td></tr></table>",
      equipment: "<p>Gel tank</p><img src=x onerror=alert(1)>", steps: "<ol><li onclick=\"x()\">Lyse on ice 30 min</li><li>Spin 14,000 × g</li></ol><script>alert(1)</script>",
      safety: "<p>Gloves</p>", notes: "", missing_info: ["Primary antibody dilution", "Blocking time"] } }] }) };
    return { finalMessage: async () => ({
    stop_reason: "tool_use", usage: { input_tokens: 5000, output_tokens: 900 },
    content: [{ type: "tool_use", name: "record_activities", input: { notes: "Check grant end date.", activities: [
      { category: "publication", title: "Paper in JACS", details: "", role: "corresponding author", start_date: "2025", end_date: "", amount: 0, status: "published", link: "https://doi.org/10.1/x" },
      { category: "grant", title: "NIH R01: New methods", details: "NIGMS", role: "PI", start_date: "2023-07", end_date: "2028-06", amount: 1800000, status: "funded", link: "" },
      { category: "teaching", title: "CHEM 341 Physical Chemistry", details: "Fall 2022, Fall 2023", role: "instructor", start_date: "2022-08-20", end_date: "", amount: 0, status: "completed", link: "javascript:alert(1)" },
      { category: "bogus", title: "drop me", details: "", role: "", start_date: "", end_date: "", amount: 0, status: "", link: "" },
    ] } }],
  }) }; } };
  }
}
