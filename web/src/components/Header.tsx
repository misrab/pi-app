import type { ConnectionStatus } from "../api/rpc";
import styles from "./Header.module.css";

interface Props {
  status: ConnectionStatus;
  sessionName?: string;
  onOpenSession: () => void;
}

export function Header({ status, sessionName, onOpenSession }: Props) {
  return (
    <header className={styles.header}>
      <button className={styles.menuBtn} onClick={onOpenSession} aria-label="Sessions">
        <MenuIcon />
      </button>

      <div className={styles.center}>
        <PiMark />
        <span className={styles.title}>{sessionName ?? "pi"}</span>
      </div>

      <span className={`${styles.dot} ${styles[status]}`} title={status} />
    </header>
  );
}

function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

/** Simplified Anthropic-style mark — a small orange asterisk/star. */
function PiMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#d97757" opacity="0.15" />
      <circle cx="12" cy="12" r="4" fill="#d97757" />
      <line x1="12" y1="2" x2="12" y2="8"  stroke="#d97757" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="12" y1="16" x2="12" y2="22" stroke="#d97757" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="2" y1="12" x2="8" y2="12"  stroke="#d97757" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="16" y1="12" x2="22" y2="12" stroke="#d97757" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="5.1" y1="5.1"  x2="9.2"  y2="9.2"  stroke="#d97757" strokeWidth="2" strokeLinecap="round" />
      <line x1="14.8" y1="14.8" x2="18.9" y2="18.9" stroke="#d97757" strokeWidth="2" strokeLinecap="round" />
      <line x1="18.9" y1="5.1"  x2="14.8" y2="9.2"  stroke="#d97757" strokeWidth="2" strokeLinecap="round" />
      <line x1="9.2" y1="14.8"  x2="5.1"  y2="18.9" stroke="#d97757" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
