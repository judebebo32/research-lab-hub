import { marked } from "marked";
import DOMPurify from "dompurify";
import privacyMd from "../../PRIVACY.md?raw";
import { PLATFORM_NAME } from "../config.js";

// Single source of truth: the same PRIVACY.md that's in the GitHub repository.
const html = DOMPurify.sanitize(marked.parse(privacyMd.replaceAll("Research Lab Hub", PLATFORM_NAME)));

export default function Privacy({ standalone = false }) {
  const body = <article className="card privacy rich" dangerouslySetInnerHTML={{ __html: html }} />;
  if (!standalone) return body;
  return (
    <div className="privacy-wrap">
      <div className="brand big"><span className="logo" aria-hidden>⚗</span> {PLATFORM_NAME}</div>
      {body}
      <p className="muted small center"><a href="/">← Back to {PLATFORM_NAME}</a></p>
    </div>
  );
}
