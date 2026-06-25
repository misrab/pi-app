import { t } from "../lib/i18n";
import styles from "./ActivityBar.module.css";

interface Props {
  queuedCount: number;
}

/** Compact queue hint only — thinking/tools/connection live in transcript + header. */
export function ActivityBar({ queuedCount }: Props) {
  if (queuedCount === 0) return null;

  return (
    <div className={styles.bar} role="status">
      <span>{t("activityQueued", queuedCount)}</span>
    </div>
  );
}
