import { useEffect, useState } from "react";
import type { ForkMessage, SessionStats } from "../api/types";
import type { Session } from "../hooks/useSession";
import { Sheet } from "./Sheet";
import styles from "./SessionMenu.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
  session: Session;
}

export function SessionMenu({ open, onClose, session }: Props) {
  const { client, sessionName, stats, newSession } = session;
  const [forks, setForks] = useState<ForkMessage[]>([]);

  useEffect(() => {
    if (!open) return;
    client
      .request<{ messages: ForkMessage[] }>({ type: "get_fork_messages" })
      .then((res) => res.success && res.data && setForks(res.data.messages))
      .catch(() => {});
  }, [open, client]);

  const rename = async () => {
    const name = prompt("Session name", sessionName ?? "");
    if (name === null) return;
    await client.request({ type: "set_session_name", name });
    await session.refreshState();
  };

  const clone = async () => {
    await client.request({ type: "clone" });
    onClose();
  };

  const fork = async (entryId: string) => {
    await client.request({ type: "fork", entryId });
    onClose();
  };

  const start = async () => {
    await newSession();
    onClose();
  };

  return (
    <Sheet open={open} title="Session" onClose={onClose}>
      {stats && <Stats stats={stats} />}

      <div className={styles.actions}>
        <button className={styles.action} onClick={start}>
          ＋ New session
        </button>
        <button className={styles.action} onClick={rename}>
          ✎ Rename
        </button>
        <button className={styles.action} onClick={clone}>
          ⎘ Clone
        </button>
      </div>

      {forks.length > 0 && (
        <div className={styles.forks}>
          <div className={styles.forksLabel}>Fork from a message</div>
          {forks.map((f) => (
            <button key={f.entryId} className={styles.fork} onClick={() => fork(f.entryId)}>
              {f.text}
            </button>
          ))}
        </div>
      )}
    </Sheet>
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
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
