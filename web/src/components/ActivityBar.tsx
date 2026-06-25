import type { ActivityState } from "../hooks/useSession";
import { t } from "../lib/i18n";
import styles from "./ActivityBar.module.css";

interface Props {
  activity: ActivityState;
  queuedCount: number;
}

export function ActivityBar({ activity, queuedCount }: Props) {
  if (activity === "idle" && queuedCount === 0) return null;

  const label =
    activity === "reconnecting"
      ? t("activityReconnecting")
      : activity === "connecting"
        ? t("activityConnecting")
        : activity === "thinking"
          ? t("activityThinking")
          : activity === "tool"
            ? t("activityTool")
            : activity === "working"
              ? t("activityWorking")
              : queuedCount > 0
                ? t("activityQueued", queuedCount)
                : t("activityReady");

  const active = activity === "thinking" || activity === "tool" || activity === "working";

  return (
    <div className={`${styles.bar} ${active ? styles.active : ""} ${styles[activity]}`} role="status">
      {active && <span className={styles.pulse} aria-hidden="true" />}
      <span>{label}</span>
    </div>
  );
}
