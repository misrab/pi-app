import { useEffect, useState } from "react";
import type { Model, ThinkingLevel } from "../api/types";
import type { Session } from "../hooks/useSession";
import { trimModelName } from "../lib/fmt";
import { Sheet } from "./Sheet";
import { Skeleton } from "./Skeleton";
import styles from "./ModelPicker.module.css";

const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

interface Props {
  open: boolean;
  onClose: () => void;
  session: Session;
}

export function ModelPicker({ open, onClose, session }: Props) {
  const { model, thinkingLevel, getAvailableModels, pickModel, pickThinkingLevel } = session;
  const [models, setModels] = useState<Model[]>([]);
  const [enabledModels, setEnabledModels] = useState<string[] | null>(null);

  useEffect(() => {
    if (!open) return;
    void getAvailableModels()
      .then(setModels)
      .catch(() => {});
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (s && Array.isArray(s.enabledModels)) setEnabledModels(s.enabledModels);
      })
      .catch(() => {});
  }, [open, getAvailableModels]);

  return (
    <Sheet open={open} title="Model" onClose={onClose}>
      <ul className={styles.list}>
        {models
          .filter((m) => !enabledModels || enabledModels.includes(`${m.provider}/${m.id}`))
          .map((m) => (
            <li key={`${m.provider}/${m.id}`}>
              <button
                className={`${styles.item} ${model?.id === m.id ? styles.active : ""}`}
                onClick={() => pickModel(m.provider, m.id)}
              >
                <span className={styles.name}>{trimModelName(m.name)}</span>
                <span className={styles.provider}>{m.provider}</span>
                {model?.id === m.id && <span className={styles.check}>✓</span>}
              </button>
            </li>
          ))}
        {models.length === 0 && (
          <li className={styles.loading}>
            {["80%","60%","70%","55%","65%"].map((w, i) => (
              <div key={i} style={{ marginBottom: 14 }}>
                <Skeleton width={w} height="1em" />
              </div>
            ))}
          </li>
        )}
      </ul>

      {model?.reasoning && (
        <div className={styles.thinking}>
          <div className={styles.thinkingLabel}>Thinking</div>
          <div className={styles.levels}>
            {LEVELS.map((l) => (
              <button
                key={l}
                className={`${styles.level} ${thinkingLevel === l ? styles.levelActive : ""}`}
                onClick={() => pickThinkingLevel(l)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}
