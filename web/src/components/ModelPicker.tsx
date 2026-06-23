import { useEffect, useState } from "react";
import type { Model, ThinkingLevel } from "../api/types";
import type { Session } from "../hooks/useSession";
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
  const { client, model, thinkingLevel, refreshState } = session;
  const [models, setModels] = useState<Model[]>([]);

  useEffect(() => {
    if (!open) return;
    client
      .request<{ models: Model[] }>({ type: "get_available_models" })
      .then((res) => res.success && res.data && setModels(res.data.models))
      .catch(() => {});
  }, [open, client]);

  const pick = async (m: Model) => {
    await client.request({ type: "set_model", provider: m.provider, modelId: m.id });
    await refreshState();
  };

  const setLevel = async (level: ThinkingLevel) => {
    await client.request({ type: "set_thinking_level", level });
    await refreshState();
  };

  return (
    <Sheet open={open} title="Model" onClose={onClose}>
      <ul className={styles.list}>
        {models.map((m) => (
          <li key={`${m.provider}/${m.id}`}>
            <button
              className={`${styles.item} ${model?.id === m.id ? styles.active : ""}`}
              onClick={() => pick(m)}
            >
              <span className={styles.name}>{m.name}</span>
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
                onClick={() => setLevel(l)}
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
