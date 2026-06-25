import { useCallback, useEffect, useState } from "react";

const DRAFT_PREFIX = "pi-draft:";

/**
 * Per-session draft persistence.
 * Drafts are stored in localStorage keyed by session id so switching chats
 * restores whatever the user had typed in each one.
 */
export function useDraft(sessionId: string | undefined) {
  const key = sessionId ? `${DRAFT_PREFIX}${sessionId}` : null;

  const [text, setTextRaw] = useState<string>(() =>
    key ? (localStorage.getItem(key) ?? "") : "",
  );

  // When the session changes, load that session's draft.
  useEffect(() => {
    setTextRaw(key ? (localStorage.getItem(key) ?? "") : "");
  }, [key]);

  const setText = useCallback(
    (value: string) => {
      setTextRaw(value);
      if (!key) return;
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    },
    [key],
  );

  const clearDraft = useCallback(() => {
    setTextRaw("");
    if (key) localStorage.removeItem(key);
  }, [key]);

  return { text, setText, clearDraft };
}
