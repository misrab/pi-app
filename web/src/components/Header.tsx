import type { Model, ThinkingLevel } from "../api/types";
import type { ConnectionStatus } from "../api/rpc";
import { Skeleton } from "./Skeleton";
import styles from "./Header.module.css";

interface Props {
  status: ConnectionStatus;
  initializing: boolean;
  model: Model | null;
  thinkingLevel: ThinkingLevel;
  sessionName?: string;
  onOpenModel: () => void;
  onOpenSession: () => void;
  onCycleThinking: () => void;
}

export function Header({
  status,
  initializing,
  model,
  thinkingLevel,
  sessionName,
  onOpenModel,
  onOpenSession,
  onCycleThinking,
}: Props) {
  return (
    <header className={styles.header}>
      <button className={styles.session} onClick={onOpenSession} aria-label="Sessions">
        ☰
      </button>

      <button className={styles.model} onClick={onOpenModel} disabled={initializing}>
        {initializing
          ? <Skeleton width="120px" height="1em" />
          : <><span className={styles.modelName}>{model?.name ?? "no model"}</span>
             <span className={styles.caret}>▾</span></>
        }
      </button>

      {model?.reasoning && (
        <button className={styles.think} onClick={onCycleThinking} title="Cycle thinking level">
          {thinkingLevel}
        </button>
      )}

      <div className={styles.right}>
        {sessionName && <span className={styles.sessionName}>{sessionName}</span>}
        <span className={`${styles.dot} ${styles[status]}`} title={status} />
      </div>
    </header>
  );
}
