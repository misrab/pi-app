import { type ReactNode, useRef } from "react";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { t } from "../lib/i18n";
import styles from "./Sheet.module.css";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** A mobile-first bottom sheet with backdrop. */
export function Sheet({ open, title, onClose, children }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  useDialogA11y(sheetRef, open, onClose);

  if (!open) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        ref={sheetRef}
        className={styles.sheet}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={styles.grabber} />
        <header className={styles.header}>
          <h2>{title}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t("close")}>
            ✕
          </button>
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
