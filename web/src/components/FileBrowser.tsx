import { useEffect, useState } from "react";
import { Streamdown } from "streamdown";
import { t } from "../lib/i18n";
import type { DirEntry, FileContent } from "../api/types";
import styles from "./FileBrowser.module.css";

const LANG: Record<string, string> = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", json: "json", py: "python",
  go: "go", rs: "rust", md: "markdown", css: "css", html: "html", yml: "yaml",
  yaml: "yaml", sh: "bash", sql: "sql", toml: "toml", java: "java", rb: "ruby",
};

function langFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return LANG[ext] ?? "";
}

const join = (p: string, name: string) => (p ? `${p}/${name}` : name);
const parent = (p: string) => {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(0, i) : "";
};

export function FileBrowser({ active }: { active: boolean }) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [file, setFile] = useState<FileContent | null>(null);
  const [error, setError] = useState<string>();

  const loadDir = async (p: string) => {
    setError(undefined);
    setFile(null);
    setEntries(null);
    try {
      const r = await fetch(`/api/files?path=${encodeURIComponent(p)}`);
      if (!r.ok) throw new Error();
      const data = await r.json();
      setPath(data.path);
      setEntries(data.entries);
    } catch {
      setError(t("filesError"));
      setEntries([]);
    }
  };

  const openFile = async (p: string) => {
    setError(undefined);
    try {
      const r = await fetch(`/api/file?path=${encodeURIComponent(p)}`);
      if (!r.ok) throw new Error();
      setFile(await r.json());
    } catch {
      setError(t("filesError"));
    }
  };

  useEffect(() => {
    if (active) void loadDir("");
  }, [active]);

  if (file) {
    const lang = langFor(file.path);
    return (
      <div className={styles.root}>
        <div className={styles.bar}>
          <button className={styles.back} onClick={() => setFile(null)}>
            ← {file.path}
          </button>
        </div>
        {file.binary ? (
          <p className={styles.note}>{t("filesBinary")}</p>
        ) : (
          <div className={styles.viewer}>
            <Streamdown>{`\`\`\`${lang}\n${file.content}\n\`\`\``}</Streamdown>
            {file.truncated && <p className={styles.note}>{t("filesTruncated")}</p>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <span className={styles.crumb}>/{path || t("filesRoot")}</span>
        {path && (
          <button className={styles.up} onClick={() => loadDir(parent(path))}>
            ↑ {t("filesUp")}
          </button>
        )}
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <ul className={styles.list}>
        {entries?.map((e) => (
          <li key={e.name}>
            <button
              className={styles.entry}
              onClick={() =>
                e.type === "dir" ? loadDir(join(path, e.name)) : openFile(join(path, e.name))
              }
            >
              <span className={styles.icon} aria-hidden>
                {e.type === "dir" ? "📁" : "📄"}
              </span>
              <span className={styles.entryName}>{e.name}</span>
            </button>
          </li>
        ))}
        {entries && entries.length === 0 && <li className={styles.note}>{t("filesEmpty")}</li>}
      </ul>
    </div>
  );
}
