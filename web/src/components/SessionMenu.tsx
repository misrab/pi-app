import { useEffect, useRef, useState } from "react";
import { fmtCost, fmtPercent, fmtTokens } from "../lib/fmt";
import type { SessionInfo, SessionStats } from "../api/types";
import type { Session } from "../hooks/useSession";
import { Sheet } from "./Sheet";
import { RenameDialog } from "./RenameDialog";
import { Skeleton } from "./Skeleton";
import styles from "./SessionMenu.module.css";

const POLL_MS = 2000; // refresh session list while menu is open

interface Props {
  open: boolean;
  onClose: () => void;
  session: Session;
}

export function SessionMenu({ open, onClose, session }: Props) {
  const { sessionName, stats, newSession, switchSession, stopSession, renameSession } = session;
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

  // Initial load + polling while open.
  useEffect(() => {
    if (!open) {
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
  }, [open]);

  const start = async () => {
    setBusy(true);
    await newSession();
    setBusy(false);
    onClose();
  };

  const resume = async (id: string) => {
    setBusy(true);
    await switchSession(id);
    setBusy(false);
    onClose();
  };

  const stop = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setBusy(true);
    await stopSession(id);
    await refresh();
    setBusy(false);
  };

  // Wait for rename to persist before refreshing the list — the header updates
  // via useSession.refreshState inside renameSession; the list needs an extra
  // fetch so the saved-session name is also current.
  const handleRename = async (name: string) => {
    await renameSession(name);
    await refresh();
  };

  return (
    <>
      <Sheet open={open} title="Sessions" onClose={onClose}>
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
            <li key={i} style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
              <Skeleton width="60%" height="0.9em" />
              <Skeleton width="85%" height="0.75em" />
            </li>
          ))}
          {list !== null && list.map((s) => (
            <li key={s.id} className={styles.row}>
              <button className={styles.item} onClick={() => resume(s.id)} disabled={busy}>
                <span className={styles.name}>
                  <StatusDot status={s.status} />
                  {s.name}
                </span>
                {s.preview && s.preview !== s.name && (
                  <span className={styles.preview}>{s.preview}</span>
                )}
                <span className={styles.time}>{relative(s.modified)}</span>
              </button>
              {s.status === "running" && (
                <button
                  className={styles.stop}
                  onClick={(e) => stop(e, s.id)}
                  disabled={busy}
                  aria-label="Stop session"
                  title="Stop process"
                >
                  ■
                </button>
              )}
            </li>
          ))}
          {list !== null && list.length === 0 && (
            <li className={styles.empty}>No saved sessions yet.</li>
          )}
        </ul>
      </Sheet>

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
  // input+output is what the user actually sent/received.
  // total includes cache-read tokens which re-count the full context on every
  // turn and can be 10-100x larger — misleading as a headline figure.
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
