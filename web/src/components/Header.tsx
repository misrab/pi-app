import { useState, useCallback } from "react";
import type { ConnectionStatus } from "../api/rpc";
import { t } from "../lib/i18n";
import { PiLogo } from "./PiLogo";
import styles from "./Header.module.css";

interface Props {
  status: ConnectionStatus;
  sessionName?: string;
  onOpenSession?: () => void;
  onOpenFiles?: () => void;
}

export function Header({ status, sessionName, onOpenSession, onOpenFiles }: Props) {
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
      <div className={styles.left}>
        {onOpenSession && (
          <button className={styles.iconBtn} onClick={onOpenSession} aria-label={t("headerMenu")}>
            <MenuIcon />
          </button>
        )}

        <button
          className={styles.iconBtn}
          onClick={toggleTheme}
          aria-label={theme === "dark" ? t("themeLight") : t("themeDark")}
          title={theme === "dark" ? t("themeLight") : t("themeDark")}
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>

        {onOpenFiles && (
          <button
            className={styles.iconBtn}
            onClick={onOpenFiles}
            aria-label={t("filesOpen")}
            title={t("filesOpen")}
          >
            <FolderIcon />
          </button>
        )}
      </div>

      <div className={styles.center}>
        <PiLogo size={20} aria-hidden />
        <h1 className={styles.title}>{sessionName ?? t("appName")}</h1>
      </div>

      <div className={styles.status} role="status">
        {status !== "open" && (
          <span className={styles.statusLabel}>
            {status === "connecting" ? t("activityConnecting") : t("activityReconnecting")}
          </span>
        )}
        <span
          className={`${styles.dot} ${styles[status]}`}
          aria-label={t("connectionStatus", status)}
        />
      </div>
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

function FolderIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="3" y1="6"  x2="21" y2="6"  />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}
