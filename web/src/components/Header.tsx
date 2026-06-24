import type { ConnectionStatus } from "../api/rpc";
import styles from "./Header.module.css";

interface Props {
  status: ConnectionStatus;
  sessionName?: string;
}

export function Header({ status, sessionName }: Props) {
  return (
    <header className={styles.header}>
      <span className={styles.sessionName}>{sessionName ?? "pi"}</span>
      <span className={`${styles.dot} ${styles[status]}`} title={status} />
    </header>
  );
}
