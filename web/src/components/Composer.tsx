import { useCallback, useEffect, useRef, useState } from "react";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
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
  // Text present when dictation started, so speech appends instead of replacing.
  const dictateBase = useRef("");

  const grow = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, []);

  // Grow on any text change (typed or dictated).
  useEffect(grow, [text, grow]);

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

  const submit = () => {
    if (speech.listening) speech.stop();
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    onSend(trimmed);
    setText("");
    dictateBase.current = "";
    if (ref.current) ref.current.style.height = "auto";
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
      {!streaming && speech.supported && (
        <button
          className={`${styles.btn} ${styles.mic} ${speech.listening ? styles.micOn : ""}`}
          onClick={toggleMic}
          disabled={disabled}
          aria-label={speech.listening ? "Stop dictation" : "Dictate"}
        >
          <MicIcon />
        </button>
      )}
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

function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}
