import { useRef, useState } from "react";
import styles from "./Composer.module.css";

interface Props {
  streaming: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
  onAbort: () => void;
}

export function Composer({ streaming, disabled, onSend, onAbort }: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    onSend(trimmed);
    setText("");
    if (ref.current) ref.current.style.height = "auto";
  };

  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  return (
    <div className={styles.composer}>
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
      />
      {streaming ? (
        <button className={`${styles.btn} ${styles.abort}`} onClick={onAbort} aria-label="Stop">
          ■
        </button>
      ) : (
        <button
          className={`${styles.btn} ${styles.send}`}
          onClick={submit}
          disabled={disabled || !text.trim()}
          aria-label="Send"
        >
          ↑
        </button>
      )}
    </div>
  );
}
