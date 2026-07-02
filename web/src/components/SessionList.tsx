import { useEffect, useMemo, useRef, useState } from "react";
import { fmtCost, fmtPercent, fmtTokens } from "../lib/fmt";
import { t, relativeTime, formatStatTokensTitle } from "../lib/i18n";
import type { SessionInfo, SessionStats } from "../api/types";
import type { Session } from "../hooks/useSession";
import { RenameDialog } from "./RenameDialog";
import { Modal } from "./Modal";
import { Skeleton } from "./Skeleton";
import styles from "./SessionList.module.css";

const POLL_MS = 10_000;
const PAGE = 20;

async function setPinApi(id: string, pinned: boolean): Promise<void> {
  await fetch(`/api/sessions/${encodeURIComponent(id)}/pin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pinned }),
  });
}

async function deleteSessionApi(id: string): Promise<void> {
  await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

interface Props {
  session: Session;
  active?: boolean;
  onNavigate?: () => void;
  variant?: "default" | "sidebar";
}

export function SessionList({
  session,
  active = true,
  onNavigate,
  variant = "default",
}: Props) {
  const { sessionName, stats, sessionId, newSession, switchSession, renameSession } = session;
  const [list, setList] = useState<SessionInfo[] | null>(null);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SessionInfo | null>(null);
  const pollRef = useRef<number | null>(null);

  const refresh = (showLoading = false) => {
    if (showLoading) setList(null);
    return fetch("/api/sessions")
      .then((r) => r.json())
      .then((data: SessionInfo[]) => setList(data ?? []))
      .catch(() => setList([]));
  };

  useEffect(() => {
    setShown(PAGE);
  }, [query]);

  useEffect(() => {
    if (!active) {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    void refresh(true);
    pollRef.current = window.setInterval(() => void refresh(), POLL_MS);

    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active]);

  const filtered = useMemo(() => {
    if (!list) return null;
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (s) => s.name.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q),
    );
  }, [list, query]);

  const pinned = filtered?.filter((s) => s.pinned) ?? [];
  const rest = filtered?.filter((s) => !s.pinned) ?? [];
  const restVisible = rest.slice(0, shown);
  const hasMore = rest.length > shown;

  const start = async () => {
    setBusy(true);
    await newSession();
    setBusy(false);
    onNavigate?.();
  };

  const resume = async (id: string) => {
    setBusy(true);
    await switchSession(id);
    setBusy(false);
    onNavigate?.();
  };

  const handleRename = async (name: string) => {
    await renameSession(name);
    await refresh();
  };

  const togglePin = async (s: SessionInfo) => {
    setMenuFor(null);
    await setPinApi(s.id, !s.pinned);
    await refresh();
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    setConfirmDelete(null);
    setBusy(true);
    await deleteSessionApi(id);
    if (id === sessionId) await newSession();
    await refresh();
    setBusy(false);
  };

  const renameLabel = sessionName
    ? `${t("sessionsRename")} "${sessionName}"`
    : t("sessionsRenameCurrent");

  const row = (s: SessionInfo) => (
    <li key={s.id} className={styles.row}>
      <button
        className={`${styles.item} ${s.id === sessionId ? styles.active : ""}`}
        onClick={() => resume(s.id)}
        disabled={busy}
      >
        <div className={styles.itemHeader}>
          <span className={styles.nameRow}>
            {s.pinned && <span className={styles.pinDot} aria-hidden>★</span>}
            <StatusDot status={s.status} />
            <span className={styles.name}>{s.name}</span>
            {s.status === "running" && (
              <span className={styles.runningBadge}>{t("sessionsRunning")}</span>
            )}
          </span>
          <time className={styles.time} dateTime={new Date(s.modified).toISOString()}>
            {relativeTime(s.modified)}
          </time>
        </div>
        {s.preview && s.preview !== s.name && (
          <span className={styles.preview}>{s.preview}</span>
        )}
      </button>
      <button
        className={styles.rowMenuBtn}
        aria-label={t("sessionsActions")}
        onClick={() => setMenuFor((cur) => (cur === s.id ? null : s.id))}
      >
        ⋯
      </button>
      {menuFor === s.id && (
        <div className={styles.menu} role="menu">
          <button className={styles.menuItem} onClick={() => togglePin(s)}>
            {s.pinned ? t("sessionsUnpin") : t("sessionsPin")}
          </button>
          <button
            className={`${styles.menuItem} ${styles.menuDanger}`}
            onClick={() => {
              setMenuFor(null);
              setConfirmDelete(s);
            }}
          >
            {t("sessionsDelete")}
          </button>
        </div>
      )}
    </li>
  );

  return (
    <>
      <div className={`${styles.root} ${variant === "sidebar" ? styles.sidebar : ""}`}>
        {variant === "sidebar" && <h2 className={styles.title}>{t("sessionsTitle")}</h2>}
        {stats && <Stats stats={stats} />}

        <div className={styles.actions}>
          <button className={styles.primary} onClick={start} disabled={busy}>
            ＋ {t("sessionsNew")}
          </button>
          <button className={styles.secondary} onClick={() => setRenaming(true)} disabled={busy}>
            {renameLabel}
          </button>
        </div>

        <div className={styles.search}>
          <input
            className={styles.searchInput}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("sessionsSearchPlaceholder")}
            aria-label={t("sessionsSearchPlaceholder")}
          />
        </div>

        {list === null && (
          <ul className={styles.list}>
            {[1, 2, 3].map((i) => (
              <li key={i} className={styles.skeletonRow}>
                <Skeleton width="60%" height="0.9em" />
                <Skeleton width="85%" height="0.75em" />
              </li>
            ))}
          </ul>
        )}

        {pinned.length > 0 && (
          <>
            <div className={styles.listLabel}>{t("sessionsPinned")}</div>
            <ul className={styles.list}>{pinned.map(row)}</ul>
          </>
        )}

        {list !== null && (
          <>
            <div className={styles.listLabel}>{t("sessionsResume")}</div>
            <ul className={styles.list}>
              {restVisible.map(row)}
              {hasMore && (
                <li>
                  <button
                    className={styles.showMore}
                    onClick={() => setShown((n) => n + PAGE)}
                    disabled={busy}
                  >
                    {t("sessionsShowMore")}
                  </button>
                </li>
              )}
              {filtered !== null && filtered.length === 0 && query.trim() && (
                <li className={styles.noMatches}>{t("sessionsNoMatches")}</li>
              )}
              {list.length === 0 && <li className={styles.empty}>{t("sessionsEmpty")}</li>}
            </ul>
          </>
        )}
      </div>

      <RenameDialog
        open={renaming}
        initial={sessionName ?? ""}
        onClose={() => setRenaming(false)}
        onSave={handleRename}
      />

      <Modal
        open={confirmDelete !== null}
        title={t("sessionsDeleteTitle")}
        onClose={() => setConfirmDelete(null)}
      >
        <p className={styles.confirmBody}>{t("sessionsDeleteBody")}</p>
        <div className={styles.confirmActions}>
          <button className={styles.secondary} onClick={() => setConfirmDelete(null)}>
            {t("cancel")}
          </button>
          <button className={styles.deleteBtn} onClick={doDelete}>
            {t("sessionsDelete")}
          </button>
        </div>
      </Modal>
    </>
  );
}

function Stats({ stats }: { stats: SessionStats }) {
  const ctx = stats.contextUsage;
  const activeTokens = stats.tokens.input + stats.tokens.output;
  return (
    <div className={styles.stats}>
      <Stat label={t("statCost")} value={fmtCost(stats.cost)} />
      <Stat
        label={t("statTokens")}
        value={fmtTokens(activeTokens)}
        title={formatStatTokensTitle(fmtTokens(stats.tokens.input), fmtTokens(stats.tokens.output), fmtTokens(stats.tokens.cacheRead))}
      />
      {ctx && ctx.percent != null && <Stat label={t("statContext")} value={fmtPercent(ctx.percent)} />}
    </div>
  );
}

function StatusDot({ status }: { status: SessionInfo["status"] }) {
  const title =
    status === "running" ? t("statusRunning") : status === "idle" ? t("statusIdle") : t("statusStopped");
  return <span className={`${styles.dot} ${styles[status]}`} title={title} aria-label={title} />;
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className={styles.stat} title={title}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}
