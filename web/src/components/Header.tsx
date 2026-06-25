import type { ConnectionStatus } from "../api/rpc";
import styles from "./Header.module.css";

interface Props {
  status: ConnectionStatus;
  sessionName?: string;
}

export function Header({ status, sessionName }: Props) {
  return (
    <header className={styles.header}>
      <div className={styles.center}>
        <PiMark />
        <span className={styles.title}>{sessionName ?? "pi"}</span>
      </div>
      <span className={`${styles.dot} ${styles[status]}`} title={status} />
    </header>
  );
}

/** Anthropic-style asterisk mark in orange. */
function PiMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="#d97757" />
      <line x1="12" y1="2"  x2="12" y2="8"   stroke="#d97757" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="12" y1="16" x2="12" y2="22"  stroke="#d97757" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="2"  y1="12" x2="8"  y2="12"  stroke="#d97757" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="16" y1="12" x2="22" y2="12"  stroke="#d97757" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="5.1"  y1="5.1"  x2="9.2"  y2="9.2"  stroke="#d97757" strokeWidth="2" strokeLinecap="round" />
      <line x1="14.8" y1="14.8" x2="18.9" y2="18.9" stroke="#d97757" strokeWidth="2" strokeLinecap="round" />
      <line x1="18.9" y1="5.1"  x2="14.8" y2="9.2"  stroke="#d97757" strokeWidth="2" strokeLinecap="round" />
      <line x1="9.2"  y1="14.8" x2="5.1"  y2="18.9" stroke="#d97757" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
