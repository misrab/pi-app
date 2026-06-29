import { useEffect, useMemo, useRef, useState } from "react";
import { fmtCost, fmtPercent, fmtTokens } from "../lib/fmt";
import { t } from "../lib/i18n";
import type { SessionInfo, SessionStats } from "../api/types";
import type { Session } from "../hooks/useSession";
import { RenameDialog } from "./RenameDialog";
import { Skeleton } from "./Skeleton";
import styles from "./SessionList.module.css";

const POLL_MS = 10_000;
const PAGE = 20;

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

  const visible = filtered?.slice(0, shown) ?? null;
  const hasMore = filtered !== null && filtered.length > shown;

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

  const renameLabel = sessionName
    ? `${t("sessionsRename")} "${sessionName}"`
    : t("sessionsRenameCurrent");

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

        <div className={styles.listLabel}>{t("sessionsResume")}</div>
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
        <ul className={styles.list}>
          {list === null && [1, 2, 3].map((i) => (
            <li key={i} className={styles.skeletonRow}>
              <Skeleton width="60%" height="0.9em" />
              <Skeleton width="85%" height="0.75em" />
            </li>
          ))}
          {visible?.map((s) => (
            <li key={s.id} className={styles.row}>
              <button
                className={`${styles.item} ${s.id === sessionId ? styles.active : ""}`}
                onClick={() => resume(s.id)}
                disabled={busy}
              >
                <span className={styles.name}>
                  <StatusDot status={s.status} />
                  {s.name}
                  {s.status === "running" && (
                    <span className={styles.runningBadge}>{t("sessionsRunning")}</span>
                  )}
                </span>
                {s.preview && s.preview !== s.name && (
                  <span className={styles.preview}>{s.preview}</span>
                )}
                <span className={styles.time}>{relative(s.modified)}</span>
              </button>
            </li>
          ))}
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
          {list !== null && list.length === 0 && (
            <li className={styles.empty}>{t("sessionsEmpty")}</li>
          )}
        </ul>
      </div>

      <RenameDialog
        open={renaming}
        initial={sessionName ?? ""}
        onClose={() => setRenaming(false)}
        onSave={handleRename}
      />
    </>
  );
}

function Stats({ stats }: { stats: SessionStats }) {
  const ctx = stats.contextUsage;
  const activeTokens = stats.tokens.input + stats.tokens.output;
  return (
    <div className={styles.stats}>
      <Stat label="Cost" value={fmtCost(stats.cost)} />
      <Stat
        label="Tokens"
        value={fmtTokens(activeTokens)}
        title={`Input: ${fmtTokens(stats.tokens.input)} · Output: ${fmtTokens(stats.tokens.output)} · Cache read: ${fmtTokens(stats.tokens.cacheRead)}`}
      />
      {ctx && ctx.percent != null && <Stat label="Context" value={fmtPercent(ctx.percent)} />}
    </div>
  );
}

function StatusDot({ status }: { status: SessionInfo["status"] }) {
  const title = status === "running" ? "running" : status === "idle" ? "idle" : "stopped";
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

function relative(iso: string): string {
  const d = new Date(iso).getTime();
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}
