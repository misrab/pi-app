import { useEffect, useState } from "react";
import type { SessionInfo, SessionStats } from "../api/types";
import type { Session } from "../hooks/useSession";
import { Sheet } from "./Sheet";
import { RenameDialog } from "./RenameDialog";
import { Skeleton } from "./Skeleton";
import styles from "./SessionMenu.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
  session: Session;
}

export function SessionMenu({ open, onClose, session }: Props) {
  const { sessionName, stats, newSession, switchSession, stopSession, renameSession } = session;
  const [list, setList] = useState<SessionInfo[] | null>(null); // null = loading
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = (showLoading = false) => {
    if (showLoading) setList(null);
    return fetch("/api/sessions")
      .then((r) => r.json())
      .then((data: SessionInfo[]) => setList(data ?? []))
      .catch(() => setList([]));
  };

  useEffect(() => {
    if (!open) return;
    void refresh(true);
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
    e.stopPropagation(); // don't trigger resume
    setBusy(true);
    await stopSession(id);
    await refresh();
    setBusy(false);
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
            Rename {sessionName ? `“${sessionName}”` : "current"}
          </button>
        </div>

        <div className={styles.listLabel}>Resume</div>
        <ul className={styles.list}>
          {list === null && [1,2,3].map(i => (
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
                {s.preview && s.preview !== s.name && <span className={styles.preview}>{s.preview}</span>}
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
          {list !== null && list.length === 0 && <li className={styles.empty}>No saved sessions yet.</li>}
        </ul>
      </Sheet>

      <RenameDialog
        open={renaming}
        initial={sessionName ?? ""}
        onClose={() => setRenaming(false)}
        onSave={(name) => void renameSession(name)}
      />
    </>
  );
}

function Stats({ stats }: { stats: SessionStats }) {
  const ctx = stats.contextUsage;
  return (
    <div className={styles.stats}>
      <Stat label="Cost" value={`$${stats.cost.toFixed(4)}`} />
      <Stat label="Tokens" value={fmt(stats.tokens.total)} />
      {ctx && ctx.percent != null && <Stat label="Context" value={`${ctx.percent.toFixed(2)}%`} />}
    </div>
  );
}

function StatusDot({ status }: { status: SessionInfo["status"] }) {
  const title = status === "running" ? "running" : status === "idle" ? "idle (process alive)" : "stopped";
  return <span className={`${styles.dot} ${styles[status]}`} title={title} aria-label={title} />;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
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
