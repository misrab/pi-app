import { useState, useCallback } from "react";
import type { ConnectionStatus } from "../api/rpc";
import { PiLogo } from "./PiLogo";
import styles from "./Header.module.css";

interface Props {
  status: ConnectionStatus;
  sessionName?: string;
}

export function Header({ status, sessionName }: Props) {
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (document.documentElement.dataset.theme as "dark" | "light") ?? "dark",
  );

  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
    setTheme(next);
  }, [theme]);

  return (
    <header className={styles.header}>
      <button
        className={styles.themeBtn}
        onClick={toggleTheme}
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      >
        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      </button>

      <div className={styles.center}>
        <PiLogo size={20} aria-hidden />
        <h1 className={styles.title}>{sessionName ?? "pi"}</h1>
      </div>

      <span
        className={`${styles.dot} ${styles[status]}`}
        role="status"
        aria-label={`Connection ${status}`}
      />
    </header>
  );
}

function SunIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2"  x2="12" y2="5"  />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2"  y1="12" x2="5"  y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
      <line x1="4.9"  y1="4.9"  x2="7"    y2="7"    />
      <line x1="17"   y1="17"   x2="19.1" y2="19.1" />
      <line x1="19.1" y1="4.9"  x2="17"   y2="7"    />
      <line x1="7"    y1="17"   x2="4.9"  y2="19.1" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
