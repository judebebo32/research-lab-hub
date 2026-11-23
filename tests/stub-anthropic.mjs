export default class Anthropic {
  constructor() { this.messages = { stream: (req) => { globalThis.__AI_REQ = req; return { finalMessage: async () => ({
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
