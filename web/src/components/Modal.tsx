import { type ReactNode, useRef } from "react";
import { useDialogA11y } from "../hooks/useDialogA11y";
import styles from "./Modal.module.css";

interface Props {
  open: boolean;
  title: string;
  /** Omit to prevent closing (e.g. while saving). */
  onClose?: () => void;
  children: ReactNode;
}

/** A centered modal dialog with backdrop. */
export function Modal({ open, title, onClose, children }: Props) {
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogA11y(modalRef, open, onClose);

  if (!open) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        ref={modalRef}
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2 className={styles.title}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
