import { useState } from "react";
import { PwaInstall } from "make-pwa";
import { useSession } from "./hooks/useSession";
import { Header } from "./components/Header";
import { Toolbar } from "./components/Toolbar";
import { Transcript } from "./components/Transcript";
import { ActivityBar } from "./components/ActivityBar";
import { Composer } from "./components/Composer";
import { ModelPicker } from "./components/ModelPicker";
import { SessionMenu } from "./components/SessionMenu";
import styles from "./App.module.css";

type SheetKind = "model" | "session" | null;

export function App() {
  const session = useSession();
  const [sheet, setSheet] = useState<SheetKind>(null);

  return (
    <div className={styles.app}>
      <PwaInstall appName="pi" accentColor="#2dd4bf" />

      <Header
        status={session.status}
        sessionName={session.sessionName}
      />

      <Transcript
        blocks={session.blocks}
        streaming={session.streaming}
        initializing={session.initializing}
      />

      <ActivityBar activity={session.activity} queuedCount={session.queuedCount} />

      <Toolbar
        initializing={session.initializing}
        model={session.model}
        thinkingLevel={session.thinkingLevel}
        askMode={session.askMode}
        planMode={session.planMode}
        onOpenSession={() => setSheet("session")}
        onOpenModel={() => setSheet("model")}
        onCycleThinking={session.cycleThinking}
        onToggleAskMode={session.toggleAskMode}
        onCyclePlanMode={session.cyclePlanMode}
      />

      <Composer
        sessionId={session.sessionId}
        streaming={session.streaming}
        disabled={session.status !== "open" || session.initializing}
        onSend={session.sendPrompt}
        onAbort={session.abort}
      />

      <ModelPicker open={sheet === "model"} onClose={() => setSheet(null)} session={session} />
      <SessionMenu open={sheet === "session"} onClose={() => setSheet(null)} session={session} />
    </div>
  );
}
