import { useState } from "react";
import { PwaInstall } from "make-pwa";
import { useSession } from "./hooks/useSession";
import { useMediaQuery } from "./hooks/useMediaQuery";
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

  return (
    <div className={styles.shell}>
      {isDesktop && (
        <aside className={styles.sidebar} aria-label="Sessions">
          <SessionList session={session} variant="sidebar" />
        </aside>
      )}

      <main className={styles.main}>
        <div className={styles.app}>
          <PwaInstall appName="pi" accentColor="#2dd4bf" />

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
            disabled={session.status !== "open" || session.initializing}
            queue={session.queue}
            onSend={session.sendPrompt}
            onSendImmediate={session.sendImmediate}
            onRemoveQueued={session.removeQueued}
            onEditQueued={session.editQueued}
            onReorderQueued={session.reorderQueued}
            onAbort={session.abort}
          />

          <ModelPicker open={sheet === "model"} onClose={() => setSheet(null)} session={session} />
          <PersonaPicker open={sheet === "persona"} onClose={() => setSheet(null)} session={session} />
          {!isDesktop && (
            <Sheet open={sheet === "session"} title="Sessions" onClose={() => setSheet(null)}>
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
