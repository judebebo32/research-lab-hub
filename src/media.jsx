import DOMPurify from "dompurify";
import { api } from "./api.js";

export const MEDIA_TOKEN = /\[\[(image|video):(\d+)\]\]/g;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Older protocols were plain text with [[image:12]] markers; convert them to HTML.
export function legacyToHtml(text) {
  const t = String(text || "");
  if (!t.trim()) return "";
  if (/^\s*<(p|h[1-6]|ul|ol|table|div|img|video|blockquote|pre)[\s>]/i.test(t)) return t;
  return t.split("\n").map((line) => {
    const media = line.trim().match(/^\[\[(image|video):(\d+)\]\]$/);
    if (media) return media[1] === "image" ? `<img src="/api/media/${media[2]}">` : `<video src="/api/media/${media[2]}"></video>`;
    return `<p>${esc(line)}</p>`;
  }).join("");
}

// Shrink photos in the browser so they upload fast and fit in one request.
async function shrinkImage(file, maxSide = 2000, quality = 0.85) {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (!blob) return file;
    return new File([blob], (file.name || "pasted").replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export async function uploadMedia(original, onProgress) {
  const file = original.type.startsWith("image/") ? await shrinkImage(original) : original;
  const m = await api.post("/media", { filename: file.name || "pasted-image.jpg", content_type: file.type || "application/octet-stream", size: file.size });
  for (let n = 0; n < m.chunks; n++) {
    const part = file.slice(n * m.chunk_size, Math.min((n + 1) * m.chunk_size, file.size));
    let tries = 0;
    for (;;) {
      const res = await fetch(`/api/media/${m.id}/chunks/${n}`, {
        method: "PUT", body: part, headers: { "Content-Type": "application/octet-stream" }, credentials: "same-origin",
      });
      if (res.ok) break;
      if (++tries >= 3) {
        let msg = `Upload failed (${res.status})`;
        try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
        throw new Error(msg);
      }
    }
    onProgress?.((n + 1) / m.chunks);
  }
  return api.post(`/media/${m.id}/complete`);
}

// Images pasted from Word/web can arrive embedded as data: URLs. Upload them so
// protocols stay small and the pictures are stored with the lab's files.
export async function uploadInlineImages(html) {
  if (!html || !html.includes("data:image")) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const img of doc.querySelectorAll('img[src^="data:image"]')) {
    try {
      const blob = await (await fetch(img.getAttribute("src"))).blob();
      const r = await uploadMedia(new File([blob], "pasted-image", { type: blob.type || "image/png" }));
      img.setAttribute("src", `/api/media/${r.id}`);
    } catch { img.remove(); }
  }
  return doc.body.innerHTML;
}

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); }
  if (node.tagName === "VIDEO") { node.setAttribute("controls", ""); node.setAttribute("preload", "metadata"); node.setAttribute("playsinline", ""); }
});

// Renders protocol content safely (formatting, tables, photos, videos).
export function RichText({ text, className = "" }) {
  const html = DOMPurify.sanitize(legacyToHtml(text), {
    ADD_TAGS: ["video"], ADD_ATTR: ["controls", "preload", "playsinline", "target", "colspan", "rowspan", "colwidth"],
    FORBID_TAGS: ["style", "form", "input", "button", "iframe", "script"],
  });
  return <div className={`rich ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
