import { useEffect, useRef, useState } from "react";
import { fmtCost, fmtPercent, fmtTokens } from "../lib/fmt";
import type { SessionInfo, SessionStats } from "../api/types";
import type { Session } from "../hooks/useSession";
import { RenameDialog } from "./RenameDialog";
import { Skeleton } from "./Skeleton";
import styles from "./SessionList.module.css";

const POLL_MS = 2000;

interface Props {
  session: Session;
  active?: boolean;
  onNavigate?: () => void;
  variant?: "default" | "sidebar";
}

export function SessionList({
  session,
  active = true,
  onNavigate,
  variant = "default",
}: Props) {
  const { sessionName, stats, sessionId, newSession, switchSession, renameSession } = session;
  const [list, setList] = useState<SessionInfo[] | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  const refresh = (showLoading = false) => {
    if (showLoading) setList(null);
    return fetch("/api/sessions")
      .then((r) => r.json())
      .then((data: SessionInfo[]) => setList(data ?? []))
      .catch(() => setList([]));
  };

  useEffect(() => {
    if (!active) {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    void refresh(true);
    pollRef.current = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [active]);

  const start = async () => {
    setBusy(true);
    await newSession();
    setBusy(false);
    onNavigate?.();
  };

  const resume = async (id: string) => {
    setBusy(true);
    await switchSession(id);
    setBusy(false);
    onNavigate?.();
  };

  const handleRename = async (name: string) => {
    await renameSession(name);
    await refresh();
  };

  return (
    <>
      <div className={`${styles.root} ${variant === "sidebar" ? styles.sidebar : ""}`}>
        {variant === "sidebar" && <h2 className={styles.title}>Sessions</h2>}
        {stats && <Stats stats={stats} />}

        <div className={styles.actions}>
          <button className={styles.primary} onClick={start} disabled={busy}>
            ＋ New session
          </button>
          <button className={styles.secondary} onClick={() => setRenaming(true)} disabled={busy}>
            Rename {sessionName ? `"${sessionName}"` : "current"}
          </button>
        </div>

        <div className={styles.listLabel}>Resume</div>
        <ul className={styles.list}>
          {list === null && [1, 2, 3].map((i) => (
            <li key={i} className={styles.skeletonRow}>
              <Skeleton width="60%" height="0.9em" />
              <Skeleton width="85%" height="0.75em" />
            </li>
          ))}
          {list !== null && list.map((s) => (
            <li key={s.id} className={styles.row}>
              <button
                className={`${styles.item} ${s.id === sessionId ? styles.active : ""}`}
                onClick={() => resume(s.id)}
                disabled={busy}
              >
                <span className={styles.name}>
                  <StatusDot status={s.status} />
                  {s.name}
                </span>
                {s.preview && s.preview !== s.name && (
                  <span className={styles.preview}>{s.preview}</span>
                )}
                <span className={styles.time}>{relative(s.modified)}</span>
              </button>
            </li>
          ))}
          {list !== null && list.length === 0 && (
            <li className={styles.empty}>No saved sessions yet.</li>
          )}
        </ul>
      </div>

      <RenameDialog
        open={renaming}
        initial={sessionName ?? ""}
        onClose={() => setRenaming(false)}
        onSave={handleRename}
      />
    </>
  );
}

function Stats({ stats }: { stats: SessionStats }) {
  const ctx = stats.contextUsage;
  const activeTokens = stats.tokens.input + stats.tokens.output;
  return (
    <div className={styles.stats}>
      <Stat label="Cost" value={fmtCost(stats.cost)} />
      <Stat
        label="Tokens"
        value={fmtTokens(activeTokens)}
        title={`Input: ${fmtTokens(stats.tokens.input)} · Output: ${fmtTokens(stats.tokens.output)} · Cache read: ${fmtTokens(stats.tokens.cacheRead)}`}
      />
      {ctx && ctx.percent != null && <Stat label="Context" value={fmtPercent(ctx.percent)} />}
    </div>
  );
}

function StatusDot({ status }: { status: SessionInfo["status"] }) {
  const title = status === "running" ? "running" : status === "idle" ? "idle" : "stopped";
  return <span className={`${styles.dot} ${styles[status]}`} title={title} aria-label={title} />;
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className={styles.stat} title={title}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

function relative(iso: string): string {
  const d = new Date(iso).getTime();
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}
