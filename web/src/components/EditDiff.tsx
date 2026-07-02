import { useState } from "react";
import { diffLines } from "diff";
import { t } from "../lib/i18n";
import styles from "./EditDiff.module.css";

// Renders `edit` / `write` tool calls as a Cursor-style red/green diff instead
// of raw JSON. All data comes from the tool arguments (path + oldText/newText,
// or path + content), so this is purely presentational — no extra round-trips.

type Row = { kind: "add" | "del" | "ctx"; text: string };

const COLLAPSE_ROWS = 40;

function rowsForEdit(oldText: string, newText: string): Row[] {
  const rows: Row[] = [];
  for (const part of diffLines(oldText, newText)) {
    const kind: Row["kind"] = part.added ? "add" : part.removed ? "del" : "ctx";
    const lines = part.value.split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    for (const line of lines) rows.push({ kind, text: line });
  }
  return rows;
}

function DiffRows({ rows }: { rows: Row[] }) {
  const [expanded, setExpanded] = useState(false);
  const long = rows.length > COLLAPSE_ROWS;
  const shown = long && !expanded ? rows.slice(0, COLLAPSE_ROWS) : rows;
  return (
    <>
      <div className={styles.hunk}>
        {shown.map((r, i) => (
          <div key={i} className={`${styles.line} ${styles[r.kind]}`}>
            <span className={styles.gutter}>
              {r.kind === "add" ? "+" : r.kind === "del" ? "-" : "\u00a0"}
            </span>
            <span className={styles.code}>{r.text || "\u00a0"}</span>
          </div>
        ))}
      </div>
      {long && (
        <button className={styles.toggle} onClick={() => setExpanded((v) => !v)}>
          {expanded ? t("diffCollapse") : t("diffExpand")}
        </button>
      )}
    </>
  );
}

export function EditDiff({ name, args }: { name: string; args: unknown }) {
  const a = (args ?? {}) as {
    path?: string;
    content?: string;
    edits?: { oldText: string; newText: string }[];
  };
  const path = a.path ?? "";

  if (name === "write") {
    const rows = rowsForEdit("", a.content ?? "");
    return (
      <div className={styles.root}>
        <div className={styles.head}>
          <span className={styles.path}>{path}</span>
          <span className={styles.tag}>{t("diffNewFile")}</span>
        </div>
        <DiffRows rows={rows} />
      </div>
    );
  }

  const edits = a.edits ?? [];
  const rows = edits.flatMap((e) => rowsForEdit(e.oldText ?? "", e.newText ?? ""));
  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <span className={styles.path}>{path}</span>
      </div>
      <DiffRows rows={rows} />
    </div>
  );
}
