import { useEffect, useState } from "react";
import type { SessionInfo, SessionStats } from "../api/types";
import type { Session } from "../hooks/useSession";
import { Sheet } from "./Sheet";
import { RenameDialog } from "./RenameDialog";
import styles from "./SessionMenu.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
  session: Session;
}

export function SessionMenu({ open, onClose, session }: Props) {
  const { sessionName, stats, newSession, switchSession, renameSession } = session;
  const [list, setList] = useState<SessionInfo[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((data: SessionInfo[]) => setList(data ?? []))
      .catch(() => setList([]));
  }, [open]);

  const start = async () => {
    setBusy(true);
    await newSession();
    setBusy(false);
    onClose();
  };

  const resume = async (path: string) => {
    setBusy(true);
    await switchSession(path);
    setBusy(false);
    onClose();
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
          {list.map((s) => (
            <li key={s.path}>
              <button className={styles.item} onClick={() => resume(s.path)} disabled={busy}>
                <span className={styles.name}>{s.name}</span>
                {s.preview && s.preview !== s.name && <span className={styles.preview}>{s.preview}</span>}
                <span className={styles.time}>{relative(s.modified)}</span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className={styles.empty}>No saved sessions yet.</li>}
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
      {ctx && ctx.percent != null && <Stat label="Context" value={`${ctx.percent}%`} />}
    </div>
  );
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
