import { type ReactNode, useEffect } from "react";
import styles from "./Modal.module.css";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** A centered modal dialog with backdrop. */
export function Modal({ open, title, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <h2 className={styles.title}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
