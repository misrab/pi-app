import { useState } from "react";
import { useSession } from "./hooks/useSession";
import { Header } from "./components/Header";
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
      <Header
        status={session.status}
        model={session.model}
        thinkingLevel={session.thinkingLevel}
        sessionName={session.sessionName}
        onOpenModel={() => setSheet("model")}
        onOpenSession={() => setSheet("session")}
      />

      <Transcript blocks={session.blocks} streaming={session.streaming} />

      <Composer
        streaming={session.streaming}
        disabled={session.status !== "open"}
        onSend={session.sendPrompt}
        onAbort={session.abort}
      />

      <ModelPicker open={sheet === "model"} onClose={() => setSheet(null)} session={session} />
      <SessionMenu open={sheet === "session"} onClose={() => setSheet(null)} session={session} />
    </div>
  );
}
