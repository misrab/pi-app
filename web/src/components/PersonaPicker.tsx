import { useEffect, useState } from "react";
import type { Session } from "../hooks/useSession";
import { t } from "../lib/i18n";
import { Sheet } from "./Sheet";
import { Skeleton } from "./Skeleton";
import styles from "./PersonaPicker.module.css";

interface Persona {
  name: string;
  label: string;
  description?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  session: Session;
}

export function PersonaPicker({ open, onClose, session }: Props) {
  const { persona, setPersona } = session;
  const [personas, setPersonas] = useState<Persona[]>([]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/personas")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.personas)) setPersonas(data.personas);
      })
      .catch(() => {});
  }, [open]);

  const pick = (name: string) => {
    void setPersona(name).then(onClose);
  };

  return (
    <Sheet open={open} title={t("personaTitle")} onClose={onClose}>
      <ul className={styles.list}>
        {personas.map((p) => (
          <li key={p.name}>
            <button
              className={`${styles.item} ${persona === p.name ? styles.active : ""}`}
              onClick={() => pick(p.name)}
            >
              <div className={styles.row}>
                <span className={styles.name}>{p.label}</span>
                {persona === p.name && <span className={styles.check}>✓</span>}
              </div>
              {p.description && <span className={styles.description}>{p.description}</span>}
            </button>
          </li>
        ))}
        {personas.length === 0 && (
          <li className={styles.loading}>
            {["70%", "55%", "60%"].map((w, i) => (
              <div key={i} style={{ marginBottom: 14 }}>
                <Skeleton width={w} height="1em" />
              </div>
            ))}
          </li>
        )}
      </ul>
    </Sheet>
  );
}
