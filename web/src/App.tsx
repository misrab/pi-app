import { useState } from "react";
import { PwaInstall } from "make-pwa";
import { useSession } from "./hooks/useSession";
import { Header } from "./components/Header";
import { Toolbar } from "./components/Toolbar";
import { Transcript } from "./components/Transcript";
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
      <PwaInstall appName="pi" accentColor="#7c9cff" />

      <Header
        status={session.status}
        sessionName={session.sessionName}
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
        onOpenSession={() => setSheet("session")}
        onOpenModel={() => setSheet("model")}
        onCycleThinking={session.cycleThinking}
        onToggleAskMode={session.toggleAskMode}
      />

      <Composer
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
