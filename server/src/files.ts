// Read-only file browser scoped to the agent's working dir. Powers the "Files"
// panel so you can review the codebase the agent is working in from the phone.
// Every path is resolved and checked to stay within the root — no traversal.
import { readFile, readdir, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const MAX_FILE_BYTES = 512 * 1024;

export interface DirEntry {
  name: string;
  type: "dir" | "file";
}

function safeResolve(root: string, rel: string): string {
  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, rel || ".");
  const within = abs === rootAbs || abs.startsWith(rootAbs + sep);
  if (!within) throw new Error("path escapes root");
  return abs;
}

export async function listDir(root: string, rel: string): Promise<{ path: string; entries: DirEntry[] }> {
  const abs = safeResolve(root, rel);
  const dirents = await readdir(abs, { withFileTypes: true });
  const entries: DirEntry[] = dirents
    .filter((d) => d.isDirectory() || d.isFile())
    .map((d) => ({ name: d.name, type: d.isDirectory() ? "dir" : "file" }));
  entries.sort((a, b) =>
    a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name),
  );
  return { path: relative(resolve(root), abs) || "", entries };
}

export async function readFileText(
  root: string,
  rel: string,
): Promise<{ path: string; binary: boolean; content: string; truncated: boolean; size: number }> {
  const abs = safeResolve(root, rel);
  const st = await stat(abs);
  if (st.isDirectory()) throw new Error("is a directory");
  const buf = await readFile(abs);
  const slice = buf.subarray(0, MAX_FILE_BYTES);
  const truncated = buf.length > MAX_FILE_BYTES;
  const path = relative(resolve(root), abs);
  if (slice.includes(0)) {
    return { path, binary: true, content: "", truncated: false, size: st.size };
  }
  return { path, binary: false, content: slice.toString("utf8"), truncated, size: st.size };
}
