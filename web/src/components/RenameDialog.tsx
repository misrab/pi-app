import { useEffect, useState } from "react";
import { t } from "../lib/i18n";
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
    <Modal open={open} title={t("sessionsRenameDialogTitle")} onClose={saving ? undefined : onClose}>
      <input
        className={styles.input}
        value={name}
        autoFocus
        placeholder={t("sessionsRenamePlaceholder")}
        disabled={saving}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
      />
      <div className={styles.actions}>
        <button type="button" className={styles.cancel} onClick={onClose} disabled={saving}>
          {t("cancel")}
        </button>
        <button type="button" className={styles.save} onClick={() => void save()} disabled={saving || !name.trim()}>
          {saving ? t("saving") : t("save")}
        </button>
      </div>
    </Modal>
  );
}
