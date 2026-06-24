import type { Model, ThinkingLevel } from "../api/types";
import { Skeleton } from "./Skeleton";
import styles from "./Toolbar.module.css";

interface Props {
  initializing: boolean;
  model: Model | null;
  thinkingLevel: ThinkingLevel;
  askMode: boolean;
  onOpenSession: () => void;
  onOpenModel: () => void;
  onCycleThinking: () => void;
  onToggleAskMode: () => void;
}

export function Toolbar({
  initializing,
  model,
  thinkingLevel,
  askMode,
  onOpenSession,
  onOpenModel,
  onCycleThinking,
  onToggleAskMode,
}: Props) {
  return (
    <div className={styles.toolbar}>
      <button className={styles.sessions} onClick={onOpenSession} aria-label="Sessions">
        ☰
      </button>

      <button className={styles.model} onClick={onOpenModel} disabled={initializing}>
        {initializing
          ? <Skeleton width="100px" height="1em" />
          : <><span className={styles.modelName}>{model?.name ?? "no model"}</span>
             <span className={styles.caret}>▾</span></>
        }
      </button>

      <div className={styles.controls}>
        {model?.reasoning && (
          <button className={styles.pill} onClick={onCycleThinking} title="Cycle thinking level">
            {thinkingLevel}
          </button>
        )}
        <button
          className={`${styles.pill} ${askMode ? styles.askActive : ""}`}
          onClick={onToggleAskMode}
          title={askMode ? "Ask mode (read-only) — click to disable" : "Enable ask mode (read-only)"}
        >
          {askMode ? "ask" : "write"}
        </button>
      </div>
    </div>
  );
}
