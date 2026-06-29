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
  onOpenModel: () => void;
  onOpenPersona: () => void;
  onCycleThinking: () => void;
  onToggleAskMode: () => void;
  onTogglePlanMode: () => void;
}

export function Toolbar({
  initializing,
  model,
  thinkingLevel,
  askMode,
  planMode,
  persona,
  onOpenModel,
  onOpenPersona,
  onCycleThinking,
  onToggleAskMode,
  onTogglePlanMode,
}: Props) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.modelRow}>
        <button className={styles.model} onClick={onOpenModel} disabled={initializing}>
            {initializing
              ? <Skeleton width="100px" height="1em" />
              : <>
                  <span className={styles.modelName}>{model ? trimModelName(model.name) : t("modelNone")}</span>
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
          title={t("askModeTooltip")}
        >
          {askMode ? t("askMode") : t("writeMode")}
        </button>
        <button
          className={`${styles.pill} ${planMode === "on" ? styles.planActive : ""}`}
          onClick={onTogglePlanMode}
          title={planMode === "on" ? t("planExit") : t("planEnter")}
        >
          {planMode === "on" ? t("planModeActive") : t("planMode")}
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
