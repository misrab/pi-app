import type { Model, ThinkingLevel } from "../api/types";
import type { ConnectionStatus } from "../api/rpc";
import styles from "./Header.module.css";

interface Props {
  status: ConnectionStatus;
  model: Model | null;
  thinkingLevel: ThinkingLevel;
  sessionName?: string;
  onOpenModel: () => void;
  onOpenSession: () => void;
}

export function Header({ status, model, thinkingLevel, sessionName, onOpenModel, onOpenSession }: Props) {
  return (
    <header className={styles.header}>
      <button className={styles.session} onClick={onOpenSession} aria-label="Sessions">
        ☰
      </button>

      <button className={styles.model} onClick={onOpenModel}>
        <span className={styles.modelName}>{model?.name ?? "no model"}</span>
        {model?.reasoning && <span className={styles.think}>{thinkingLevel}</span>}
        <span className={styles.caret}>▾</span>
      </button>

      <div className={styles.right}>
        {sessionName && <span className={styles.sessionName}>{sessionName}</span>}
        <span className={`${styles.dot} ${styles[status]}`} title={status} />
      </div>
    </header>
  );
}
