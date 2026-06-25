import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import styles from "./RenameDialog.module.css";

interface Props {
  open: boolean;
  initial: string;
  onClose: () => void;
  /** May return a Promise; dialog waits for it before closing. */
  onSave: (name: string) => Promise<void> | void;
}

export function RenameDialog({ open, initial, onClose, onSave }: Props) {
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(initial);
      setSaving(false);
    }
  }, [open, initial]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onSave(trimmed);
    } finally {
      setSaving(false);
    }
    onClose();
  };

  return (
    <Modal open={open} title="Rename session" onClose={saving ? undefined : onClose}>
      <input
        ref={inputRef}
        className={styles.input}
        value={name}
        autoFocus
        placeholder="Session name"
        disabled={saving}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
      />
      <div className={styles.actions}>
        <button className={styles.cancel} onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button className={styles.save} onClick={() => void save()} disabled={saving || !name.trim()}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}
