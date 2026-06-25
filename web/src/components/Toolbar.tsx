import type { Model, PlanMode, ThinkingLevel } from "../api/types";
import { Skeleton } from "./Skeleton";
import styles from "./Toolbar.module.css";

interface Props {
  initializing: boolean;
  model: Model | null;
  thinkingLevel: ThinkingLevel;
  askMode: boolean;
  planMode: PlanMode;
  onOpenModel: () => void;
  onCycleThinking: () => void;
  onToggleAskMode: () => void;
  onCyclePlanMode: () => void;
}

export function Toolbar({
  initializing,
  model,
  thinkingLevel,
  askMode,
  planMode,
  onOpenModel,
  onCycleThinking,
  onToggleAskMode,
  onCyclePlanMode,
}: Props) {
  return (
    <div className={styles.toolbar}>
      <button className={styles.model} onClick={onOpenModel} disabled={initializing}>
        {initializing
          ? <Skeleton width="100px" height="1em" />
          : <>
              <span className={styles.modelName}>{model?.name?.replace(/\s*[·•]\s*$/, "") ?? "no model"}</span>
              <ChevronDown />
            </>
        }
      </button>

      <div className={styles.controls}>
        {model?.reasoning && thinkingLevel !== "off" && (
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
        <button
          className={`${styles.pill} ${planMode !== "off" ? styles.planActive : ""}`}
          onClick={onCyclePlanMode}
          title={planMode === "off" ? "Enter plan mode" : planMode === "plan" ? "Planning — tap to implement" : "Implementing — tap to finish"}
        >
          {planMode === "off" ? "plan" : planMode === "plan" ? "plan ✎" : "impl ⚡"}
        </button>
      </div>
    </div>
  );
}

function ChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
