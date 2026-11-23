import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, useEditorState } from "@tiptap/react";
import { Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { uploadMedia, legacyToHtml } from "./media.jsx";

// Block-level video node (<video src="/api/media/12" controls>).
const Video = Node.create({
  name: "video",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() { return { src: { default: null } }; },
  parseHTML() { return [{ tag: "video[src]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["video", mergeAttributes({ controls: "true", preload: "metadata", playsinline: "true" }, HTMLAttributes)];
  },
});

const SIZES = ["10", "12", "14", "16", "18", "20", "24", "28", "32"];
const COLORS = ["#1d2420", "#b0413e", "#b7791f", "#1f4d3a", "#2b5f8a", "#6b3fa0", "#69716c"];

export default function RichEditor({ value, onChange, placeholder }) {
  const fileInput = useRef(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const editorRef = useRef(null);

  const insertFiles = async (files, pos) => {
    const editor = editorRef.current;
    if (!editor) return;
    setError("");
    for (const file of files) {
      try {
        setStatus(`Uploading ${file.name || "pasted image"}… 0%`);
        const r = await uploadMedia(file, (p) => setStatus(`Uploading ${file.name || "pasted image"}… ${Math.round(p * 100)}%`));
        const node = r.kind === "image"
          ? { type: "image", attrs: { src: `/api/media/${r.id}` } }
          : { type: "video", attrs: { src: `/api/media/${r.id}` } };
        const chain = editor.chain().focus();
        (pos != null ? chain.insertContentAt(pos, node) : chain.insertContent(node)).run();
        pos = null;
      } catch (e) {
        setError(`${file.name || "File"}: ${e.message}`);
      }
    }
    setStatus("");
  };

  const mediaFiles = (list) => [...(list || [])].filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TextStyleKit,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Highlight.configure({ multicolor: true }),
      Subscript,
      Superscript,
      Image.configure({ allowBase64: true, resize: { enabled: true, alwaysPreserveAspectRatio: true } }),
      Video,
      TableKit.configure({ table: { resizable: true } }),
      Placeholder.configure({ placeholder }),
    ],
    content: legacyToHtml(value),
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? "" : editor.getHTML()),
    editorProps: {
      handlePaste: (_view, event) => {
        const files = mediaFiles(event.clipboardData?.files);
        // If the clipboard also carries HTML (e.g. a table from Excel), let the editor paste that.
        const html = event.clipboardData?.getData("text/html");
        if (files.length && !(html && /<table/i.test(html))) {
          event.preventDefault();
          insertFiles(files);
          return true;
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = mediaFiles(event.dataTransfer?.files);
        if (!files.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        insertFiles(files, pos);
        return true;
      },
    },
  });
  editorRef.current = editor;

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => e ? {
      bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"),
      sub: e.isActive("subscript"), sup: e.isActive("superscript"), bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"),
      h2: e.isActive("heading", { level: 2 }), h3: e.isActive("heading", { level: 3 }),
      left: e.isActive({ textAlign: "left" }), center: e.isActive({ textAlign: "center" }), right: e.isActive({ textAlign: "right" }),
      table: e.isActive("table"), link: e.isActive("link"), highlight: e.isActive("highlight"),
      size: (e.getAttributes("textStyle").fontSize || "").replace("px", ""),
      undo: e.can().undo(), redo: e.can().redo(),
    } : {},
  }) || {};

  useEffect(() => () => editor?.destroy(), [editor]);
  if (!editor) return null;
  const c = () => editor.chain().focus();
  const B = ({ on, title, onClick, children, disabled }) => (
    <button type="button" className={`tb ${on ? "on" : ""}`} title={title} aria-label={title} disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{children}</button>
  );

  const setLink = () => {
    const prev = editor.getAttributes("link").href || "";
    const url = window.prompt("Link address (leave empty to remove)", prev);
    if (url === null) return;
    if (!url) c().extendMarkRange("link").unsetLink().run();
    else c().extendMarkRange("link").setLink({ href: /^https?:\/\//.test(url) ? url : `https://${url}` }).run();
  };

  return (
    <div className="rich-editor">
      <div className="toolbar-rich">
        <B title="Undo" disabled={!s.undo} onClick={() => c().undo().run()}>↶</B>
        <B title="Redo" disabled={!s.redo} onClick={() => c().redo().run()}>↷</B>
        <span className="sep" />
        <select title="Paragraph style" value={s.h2 ? "h2" : s.h3 ? "h3" : "p"}
          onChange={(e) => { const v = e.target.value; v === "p" ? c().setParagraph().run() : c().toggleHeading({ level: v === "h2" ? 2 : 3 }).run(); }}>
          <option value="p">Normal</option><option value="h2">Heading</option><option value="h3">Subheading</option>
        </select>
        <select title="Font size" value={s.size || ""}
          onChange={(e) => e.target.value ? c().setFontSize(`${e.target.value}px`).run() : c().unsetFontSize().run()}>
          <option value="">Size</option>
          {SIZES.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <span className="sep" />
        <B title="Bold" on={s.bold} onClick={() => c().toggleBold().run()}><b>B</b></B>
        <B title="Italic" on={s.italic} onClick={() => c().toggleItalic().run()}><i>I</i></B>
        <B title="Underline" on={s.underline} onClick={() => c().toggleUnderline().run()}><u>U</u></B>
        <B title="Strikethrough" on={s.strike} onClick={() => c().toggleStrike().run()}><s>S</s></B>
        <B title="Subscript (H₂O)" on={s.sub} onClick={() => c().toggleSubscript().run()}>X₂</B>
        <B title="Superscript (10⁶)" on={s.sup} onClick={() => c().toggleSuperscript().run()}>X²</B>
        <span className="color-wrap" title="Text color">
          {COLORS.map((col) => (
            <button key={col} type="button" className="swatch" style={{ background: col }} aria-label={`Text color ${col}`}
              onMouseDown={(e) => e.preventDefault()} onClick={() => c().setColor(col).run()} />
          ))}
        </span>
        <B title="Highlight" on={s.highlight} onClick={() => c().toggleHighlight({ color: "#fff3a3" }).run()}>🖍</B>
        <span className="sep" />
        <B title="Bulleted list" on={s.bullet} onClick={() => c().toggleBulletList().run()}>•≡</B>
        <B title="Numbered list" on={s.ordered} onClick={() => c().toggleOrderedList().run()}>1.</B>
        <B title="Align left" on={s.left} onClick={() => c().setTextAlign("left").run()}>⇤</B>
        <B title="Align center" on={s.center} onClick={() => c().setTextAlign("center").run()}>↔</B>
        <B title="Align right" on={s.right} onClick={() => c().setTextAlign("right").run()}>⇥</B>
        <B title="Link" on={s.link} onClick={setLink}>🔗</B>
        <span className="sep" />
        <B title="Insert table" onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>▦ Table</B>
        <B title="Add photo or video" onClick={() => fileInput.current?.click()}>📷</B>
        <input ref={fileInput} type="file" accept="image/*,video/*" multiple hidden
          onChange={(e) => { insertFiles(mediaFiles(e.target.files)); e.target.value = ""; }} />
      </div>
      {s.table && (
        <div className="toolbar-rich table-tools">
          <span className="muted small">Table:</span>
          <B title="Add row below" onClick={() => c().addRowAfter().run()}>+ Row</B>
          <B title="Add column right" onClick={() => c().addColumnAfter().run()}>+ Column</B>
          <B title="Delete row" onClick={() => c().deleteRow().run()}>− Row</B>
          <B title="Delete column" onClick={() => c().deleteColumn().run()}>− Column</B>
          <B title="Merge or split cells" onClick={() => c().mergeOrSplit().run()}>Merge/split</B>
          <B title="Toggle header row" onClick={() => c().toggleHeaderRow().run()}>Header row</B>
          <B title="Delete table" onClick={() => c().deleteTable().run()}>🗑 Table</B>
        </div>
      )}
      <EditorContent editor={editor} className="rich-content" />
      {(status || error) && (
        <div className="media-bar">
          {status && <span className="muted small">{status}</span>}
          {error && <span className="error small">{error}</span>}
        </div>
      )}
    </div>
  );
}
