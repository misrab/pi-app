import type { Model, PlanMode, ThinkingLevel } from "../api/types";
import { trimModelName } from "../lib/fmt";
import { t } from "../lib/i18n";
import { Skeleton } from "./Skeleton";
import styles from "./Toolbar.module.css";

interface Props {
  initializing: boolean;
  model: Model | null;
  thinkingLevel: ThinkingLevel;
  askMode: boolean;
  planMode: PlanMode;
  persona: string;
  onOpenSession: () => void;
  onOpenModel: () => void;
  onOpenPersona: () => void;
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
  persona,
  onOpenSession,
  onOpenModel,
  onOpenPersona,
  onCycleThinking,
  onToggleAskMode,
  onCyclePlanMode,
}: Props) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.topRow}>
        <button className={styles.sessions} onClick={onOpenSession} aria-label="Sessions">
          <MenuIcon />
        </button>

        <div className={styles.modelRow}>
          <button className={styles.model} onClick={onOpenModel} disabled={initializing}>
            {initializing
              ? <Skeleton width="100px" height="1em" />
              : <>
                  <span className={styles.modelName}>{model ? trimModelName(model.name) : "no model"}</span>
                  <ChevronDown />
                </>
            }
          </button>
          <button
            className={styles.persona}
            onClick={onOpenPersona}
            disabled={initializing}
            title={t("personaTitle")}
          >
            <span className={styles.personaName}>{persona}</span>
            <ChevronDown />
          </button>
        </div>
      </div>

      <div className={styles.controls}>
        {model?.reasoning && (
          <button
            className={`${styles.pill} ${thinkingLevel === "off" ? styles.pillOff : styles.thinkActive}`}
            onClick={onCycleThinking}
            title={t("thinkingCycle")}
          >
            {thinkingLevel === "off" ? t("thinkingOff") : thinkingLevel}
          </button>
        )}
        <button
          className={`${styles.pill} ${askMode ? styles.askActive : ""}`}
          onClick={onToggleAskMode}
          title={askMode ? "Ask mode (read-only) — click to disable" : "Enable ask mode (read-only)"}
        >
          {askMode ? t("askMode") : t("writeMode")}
        </button>
        <button
          className={`${styles.pill} ${planMode !== "off" ? styles.planActive : ""}`}
          onClick={onCyclePlanMode}
          title={planMode === "off" ? t("planEnter") : planMode === "plan" ? t("planToImplement") : t("planToFinish")}
        >
          {planMode === "off" ? t("planOff") : planMode === "plan" ? t("planPlanning") : t("planImplementing")}
        </button>
      </div>
    </div>
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

function ChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
