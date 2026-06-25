import { useCallback, useEffect, useRef, useState } from "react";
import type { Attachment } from "../api/types";
import { useDraft } from "../hooks/useDraft";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import styles from "./Composer.module.css";

// Accepted MIME types
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

function ext(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

async function fileToAttachment(file: File): Promise<Attachment | null> {
  if (IMAGE_TYPES.has(file.type)) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        // data-URI format: "data:<mime>;base64,<b64>"
        const base64 = dataUrl.split(",")[1];
        resolve({
          id: nextAttachId(),
          name: file.name,
          kind: "image",
          mimeType: file.type,
          data: base64,
          previewUrl: dataUrl,
        });
      };
      reader.readAsDataURL(file);
    });
  }

  if (file.type.startsWith("text/") || TEXT_EXTENSIONS.has(ext(file.name))) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          id: nextAttachId(),
          name: file.name,
          kind: "text",
          mimeType: file.type || "text/plain",
          data: reader.result as string,
          previewUrl: "",
        });
      };
      reader.readAsText(file);
    });
  }

  // Unsupported (e.g. PDF, binary)
  return null;
}

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
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dictateBase = useRef("");
  const dragCounter = useRef(0); // track nested enter/leave

  const grow = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, []);

  useEffect(grow, [text, grow]);

  // Auto-clear the unsupported notice after 3s
  useEffect(() => {
    if (!unsupported.length) return;
    const t = setTimeout(() => setUnsupported([]), 3000);
    return () => clearTimeout(t);
  }, [unsupported]);

  const addFiles = useCallback(async (files: File[]) => {
    const results = await Promise.all(files.map(fileToAttachment));
    const ok: Attachment[] = [];
    const bad: string[] = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i]) ok.push(results[i]!);
      else bad.push(files[i].name);
    }
    if (ok.length) setAttachments((prev) => [...prev, ...ok]);
    if (bad.length) setUnsupported(bad);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // ── Drag & Drop ──────────────────────────────────────────────────────────
  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setDragOver(true);
  }, []);
  const onDragLeave = useCallback(() => {
    dragCounter.current--;
    if (dragCounter.current === 0) setDragOver(false);
  }, []);
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length) void addFiles(files);
    },
    [addFiles],
  );

  // ── Paste images from clipboard ──────────────────────────────────────────
  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const imageFiles = Array.from(e.clipboardData.items)
        .filter((item) => IMAGE_TYPES.has(item.type))
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      if (imageFiles.length) {
        e.preventDefault();
        void addFiles(imageFiles);
      }
    },
    [addFiles],
  );

  // ── Speech ───────────────────────────────────────────────────────────────
  const onTranscript = useCallback((spoken: string) => {
    const base = dictateBase.current;
    setText(base ? `${base} ${spoken}`.trimStart() : spoken);
  }, []);
  const speech = useSpeechRecognition({ onTranscript });

  const toggleMic = () => {
    if (speech.listening) {
      speech.stop();
    } else {
      dictateBase.current = text.trim();
      speech.start();
    }
  };

  // ── Submit ───────────────────────────────────────────────────────────────
  const submit = () => {
    if (speech.listening) speech.stop();
    const trimmed = text.trim();
    if (!trimmed && !attachments.length) return;
    onSend(trimmed, attachments.length ? attachments : undefined);
    clearDraft();
    setAttachments([]);
    dictateBase.current = "";
    if (ref.current) ref.current.style.height = "auto";
  };

  const canSend = !disabled && (text.trim().length > 0 || attachments.length > 0);

  return (
    <div
      className={`${styles.composer} ${dragOver ? styles.dragOver : ""}`}
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
          e.target.value = ""; // reset so same file can be re-attached
        }}
      />

      {/* Drag overlay */}
      {dragOver && (
        <div className={styles.dropOverlay}>
          <DropIcon />
          <span>Drop files here</span>
        </div>
      )}

      {/* Unsupported file notice */}
      {unsupported.length > 0 && (
        <div className={styles.unsupported}>
          Unsupported: {unsupported.join(", ")} — images &amp; text files only
        </div>
      )}

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className={styles.attachBar}>
          {attachments.map((a) => (
            <div key={a.id} className={styles.attachChip}>
              {a.kind === "image" ? (
                <img src={a.previewUrl} alt={a.name} className={styles.attachThumb} />
              ) : (
                <FileIcon />
              )}
              <span className={styles.attachName}>{a.name}</span>
              <button
                className={styles.attachRemove}
                onClick={() => removeAttachment(a.id)}
                aria-label={`Remove ${a.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className={styles.inputRow}>
        {/* Paperclip / attach button */}
        <button
          className={styles.btn}
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          aria-label="Attach file"
          title="Attach image or text file"
        >
          <PaperclipIcon />
        </button>

        <textarea
          ref={ref}
          className={styles.input}
          placeholder={disabled ? "Starting pi…" : "Message pi…"}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            grow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={onPaste}
        />

        {speech.supported && (
          <button
            className={`${styles.btn} ${styles.mic} ${speech.listening ? styles.micOn : ""}`}
            onClick={toggleMic}
            disabled={disabled}
            aria-label={speech.listening ? "Stop dictation" : "Dictate"}
          >
            <MicIcon />
          </button>
        )}
        {streaming && (
          <button className={`${styles.btn} ${styles.abort}`} onClick={onAbort} aria-label="Stop">
            <StopIcon />
          </button>
        )}
        <button
          className={`${styles.btn} ${streaming ? styles.sendQueued : styles.send}`}
          onClick={submit}
          disabled={!canSend}
          aria-label={streaming ? "Queue message" : "Send"}
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────

function PaperclipIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function DropIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3" />
    </svg>
  );
}
