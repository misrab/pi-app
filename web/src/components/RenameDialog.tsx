import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import styles from "./RenameDialog.module.css";

interface Props {
  open: boolean;
  initial: string;
  onClose: () => void;
  onSave: (name: string) => void;
}

export function RenameDialog({ open, initial, onClose, onSave }: Props) {
  const [name, setName] = useState(initial);

  useEffect(() => {
    if (open) setName(initial);
  }, [open, initial]);

  const save = () => {
    onSave(name.trim());
    onClose();
  };

  return (
    <Modal open={open} title="Rename session" onClose={onClose}>
      <input
        className={styles.input}
        value={name}
        autoFocus
        placeholder="Session name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
      />
      <div className={styles.actions}>
        <button className={styles.cancel} onClick={onClose}>
          Cancel
        </button>
        <button className={styles.save} onClick={save}>
          Save
        </button>
      </div>
    </Modal>
  );
}
