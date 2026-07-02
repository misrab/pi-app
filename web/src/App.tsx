import { useState, type CSSProperties } from "react";
import { PwaInstall } from "make-pwa";
import { useSession } from "./hooks/useSession";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { useSidebarWidth } from "./hooks/useSidebarWidth";
import { accentColorFromTheme } from "./hooks/useAppTheme";
import { t } from "./lib/i18n";
import { Header } from "./components/Header";
import { Toolbar } from "./components/Toolbar";
import { Transcript } from "./components/Transcript";
import { Composer } from "./components/Composer";
import { ModelPicker } from "./components/ModelPicker";
import { PersonaPicker } from "./components/PersonaPicker";
import { SessionList } from "./components/SessionList";
import { Sheet } from "./components/Sheet";
import styles from "./App.module.css";

type SheetKind = "model" | "persona" | "session" | null;

export function App() {
  const session = useSession();
  const [sheet, setSheet] = useState<SheetKind>(null);
  const isDesktop = useMediaQuery("(min-width: 900px)");
  const { width: sidebarWidth, onResizePointerDown, resetWidth } = useSidebarWidth(isDesktop);

  const shellStyle = isDesktop
    ? ({ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties)
    : undefined;

  return (
    <div className={styles.shell} style={shellStyle}>
      {isDesktop && (
        <div className={styles.sidebarWrap}>
          <aside className={styles.sidebar} aria-label={t("sessionsTitle")}>
            <SessionList session={session} variant="sidebar" />
          </aside>
          <div
            className={styles.resizeHandle}
            role="separator"
            aria-orientation="vertical"
            aria-label={t("sidebarResize")}
            aria-valuenow={sidebarWidth}
            aria-valuemin={220}
            aria-valuemax={480}
            tabIndex={0}
            onPointerDown={onResizePointerDown}
            onDoubleClick={resetWidth}
          />
        </div>
      )}

      <main className={styles.main}>
        <div className={styles.app}>
          <PwaInstall appName={t("appName")} accentColor={accentColorFromTheme()} />

          <Header
            status={session.status}
            sessionName={session.sessionName}
            onOpenSession={!isDesktop ? () => setSheet("session") : undefined}
          />

          <Transcript
            blocks={session.blocks}
            streaming={session.streaming}
            initializing={session.initializing}
          />

          <Toolbar
            initializing={session.initializing}
            model={session.model}
            thinkingLevel={session.thinkingLevel}
            askMode={session.askMode}
            planMode={session.planMode}
            persona={session.persona}
            onOpenModel={() => setSheet("model")}
            onOpenPersona={() => setSheet("persona")}
            onCycleThinking={session.cycleThinking}
            onToggleAskMode={session.toggleAskMode}
            onTogglePlanMode={session.togglePlanMode}
          />

          <Composer
            sessionId={session.sessionId}
            streaming={session.streaming}
            disabled={session.status !== "open" || (session.initializing && !session.streaming)}
            queue={session.queue}
            onSend={session.sendPrompt}
            onSendImmediate={session.sendImmediate}
            onSendQueuedNow={session.sendQueuedNow}
            onRemoveQueued={session.removeQueued}
            onEditQueued={session.editQueued}
            onReorderQueued={session.reorderQueued}
            onFlushQueued={session.flushQueued}
            onAbort={session.abort}
          />

          <ModelPicker open={sheet === "model"} onClose={() => setSheet(null)} session={session} />
          <PersonaPicker open={sheet === "persona"} onClose={() => setSheet(null)} session={session} />
          {!isDesktop && (
            <Sheet open={sheet === "session"} title={t("sessionsTitle")} onClose={() => setSheet(null)}>
              <SessionList
                session={session}
                active={sheet === "session"}
                onNavigate={() => setSheet(null)}
              />
            </Sheet>
          )}
        </div>
      </main>
    </div>
  );
}
