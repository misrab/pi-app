import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { Attachment } from "../api/types";
import { useDraft } from "../hooks/useDraft";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import styles from "./Composer.module.css";

// ── File handling ──────────────────────────────────────────────────────────

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "json", "yaml", "yml", "toml", "xml",
  "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java", "c", "cpp",
  "h", "hpp", "cs", "swift", "kt", "sh", "bash", "zsh", "fish",
  "html", "css", "scss", "sass", "sql", "graphql", "gql", "env",
  "gitignore", "dockerfile", "makefile", "lock",
]);

let attachId = 0;
const nextAttachId = () => `att${++attachId}`;
const ext = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

async function fileToAttachment(file: File): Promise<Attachment | null> {
  if (IMAGE_TYPES.has(file.type)) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        resolve({
          id: nextAttachId(), name: file.name, kind: "image",
          mimeType: file.type, data: dataUrl.split(",")[1], previewUrl: dataUrl,
        });
      };
      reader.readAsDataURL(file);
    });
  }
  if (file.type.startsWith("text/") || TEXT_EXTENSIONS.has(ext(file.name))) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        id: nextAttachId(), name: file.name, kind: "text",
        mimeType: file.type || "text/plain", data: reader.result as string, previewUrl: "",
      });
      reader.readAsText(file);
    });
  }
  return null;
}

// ── Component ──────────────────────────────────────────────────────────────

const MAX_HEIGHT = 200; // ~8 lines before the box scrolls

interface Props {
  sessionId: string | undefined;
  streaming: boolean;
  disabled: boolean;
  onSend: (text: string, attachments?: Attachment[]) => void;
  onAbort: () => void;
}

export function Composer({ sessionId, streaming, disabled, onSend, onAbort }: Props) {
  const { text, setText, clearDraft } = useDraft(sessionId);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [unsupported, setUnsupported] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dictateBase = useRef("");
  const dragCounter = useRef(0);

  // ── Auto-grow ─────────────────────────────────────────────────────────────
  // Key insight: set height to 0 (invisible under overflow:hidden) then
  // immediately read scrollHeight — both in the same sync call, so the browser
  // never paints the collapsed state. useLayoutEffect runs before paint.
  const grow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, []);

  useLayoutEffect(grow, [text, grow]);

  // ── Unsupported notice timeout ────────────────────────────────────────────
  useLayoutEffect(() => {
    if (!unsupported.length) return;
    const t = setTimeout(() => setUnsupported([]), 3000);
    return () => clearTimeout(t);
  }, [unsupported]);

  // ── File helpers ──────────────────────────────────────────────────────────
  const addFiles = useCallback(async (files: File[]) => {
    const results = await Promise.all(files.map(fileToAttachment));
    const ok: Attachment[] = [];
    const bad: string[] = [];
    results.forEach((r, i) => (r ? ok.push(r) : bad.push(files[i].name)));
    if (ok.length) setAttachments((prev) => [...prev, ...ok]);
    if (bad.length) setUnsupported(bad);
  }, []);

  const removeAttachment = useCallback(
    (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id)),
    [],
  );

  // ── Drag & drop ───────────────────────────────────────────────────────────
  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setDragOver(true);
  }, []);
  const onDragLeave = useCallback(() => {
    if (--dragCounter.current === 0) setDragOver(false);
  }, []);
  const onDragOver = useCallback((e: React.DragEvent) => e.preventDefault(), []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) void addFiles(files);
  }, [addFiles]);

  // ── Paste images ──────────────────────────────────────────────────────────
  const onPaste = useCallback((e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.items)
      .filter((item) => IMAGE_TYPES.has(item.type))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (imgs.length) { e.preventDefault(); void addFiles(imgs); }
  }, [addFiles]);

  // ── Speech ────────────────────────────────────────────────────────────────
  const onTranscript = useCallback((spoken: string) => {
    const base = dictateBase.current;
    setText(base ? `${base} ${spoken}`.trimStart() : spoken);
  }, [setText]);
  const speech = useSpeechRecognition({ onTranscript });

  const toggleMic = () => {
    if (speech.listening) { speech.stop(); return; }
    dictateBase.current = text.trim();
    speech.start();
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const submit = () => {
    if (speech.listening) speech.stop();
    const trimmed = text.trim();
    if (!trimmed && !attachments.length) return;
    onSend(trimmed, attachments.length ? attachments : undefined);
    clearDraft();
    setAttachments([]);
    dictateBase.current = "";
    // Height resets automatically via useLayoutEffect when text clears.
  };

  const canSend = !disabled && (text.trim().length > 0 || attachments.length > 0);
  const boxClass = [
    styles.inputBox,
    focused ? styles.focused : "",
    dragOver ? styles.dragOver : "",
  ].filter(Boolean).join(" ");

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit();
  };

  return (
    <form
      className={styles.composer}
      onSubmit={onSubmit}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,.txt,.md,.csv,.json,.yaml,.yml,.toml,.xml,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.cs,.swift,.kt,.sh,.html,.css,.scss,.sql,.graphql,.env"
        className={styles.fileInput}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) void addFiles(files);
          e.target.value = "";
        }}
      />

      {/* Unsupported notice */}
      {unsupported.length > 0 && (
        <p className={styles.unsupported}>
          Can't attach: {unsupported.join(", ")} — images &amp; text files only
        </p>
      )}

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className={styles.attachBar}>
          {attachments.map((a) => (
            <div key={a.id} className={styles.chip}>
              {a.kind === "image"
                ? <img src={a.previewUrl} alt={a.name} className={styles.chipThumb} />
                : <span className={styles.chipIcon}><FileIcon /></span>}
              <span className={styles.chipName}>{a.name}</span>
              <button
                className={styles.chipRemove}
                onClick={() => removeAttachment(a.id)}
                aria-label={`Remove ${a.name}`}
              >×</button>
            </div>
          ))}
        </div>
      )}

      {/* Unified input box — single border, like Claude */}
      <div className={boxClass}>

        {/* Drag overlay inside the box */}
        {dragOver && (
          <div className={styles.dropOverlay}>
            <UploadIcon />
            <span>Drop to attach</span>
          </div>
        )}

        {/* Textarea — no border, transparent bg, overflow:hidden (key to no scrollbar/jerk) */}
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          placeholder="Message pi…"
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(e) => { setText(e.target.value); grow(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
          onPaste={onPaste}
          onFocus={() => {
            setFocused(true);
            // iOS doesn't resize the layout for the keyboard, so nudge the
            // input into view once the keyboard has animated in.
            setTimeout(() => textareaRef.current?.scrollIntoView({ block: "nearest" }), 300);
          }}
          onBlur={() => setFocused(false)}
        />

        {/* Footer: left actions | right actions */}
        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            <button
              className={styles.iconBtn}
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
              aria-label="Attach file"
              title="Attach image or text file"
            >
              <PaperclipIcon />
            </button>
          </div>

          <div className={styles.footerRight}>
            {speech.supported && (
              <button
                className={`${styles.iconBtn} ${speech.listening ? styles.micActive : ""}`}
                onClick={toggleMic}
                disabled={disabled}
                aria-label={speech.listening ? "Stop dictation" : "Dictate"}
              >
                <MicIcon />
              </button>
            )}
            {streaming
              ? <button className={`${styles.actionBtn} ${styles.stopBtn}`} onClick={onAbort} aria-label="Stop">
                  <StopIcon />
                </button>
              : <button type="submit" className={`${styles.actionBtn} ${styles.sendBtn}`} disabled={!canSend} aria-label="Send">
                  <SendIcon />
                </button>
            }
          </div>
        </div>
      </div>
    </form>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
