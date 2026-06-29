// Provisions the pi agent config directory for this container: clone/pull a
// config repo (or seed from a dir), overlay auth.json, install declared
// packages for this platform, and optionally re-pull on a timer. Ported from
// the previous Go implementation (internal/config) — same env-var contract.
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { msg } from "./util.js";

const execFileAsync = promisify(execFile);

export interface ConfigOptions {
  repo: string; // PI_CONFIG_REPO   — git repo with the .pi config
  seed: string; // PI_CONFIG_SEED   — source dir to copy portable config from
  dir: string; // PI_CONFIG_DIR     — the container's own config dir
  subdir: string; // PI_CONFIG_SUBDIR — subdir within repo/seed holding the agent config
  githubToken: string; // GITHUB_TOKEN — HTTPS clone of private config repo
  authFile: string; // PI_AUTH_FILE  — auth.json to overlay
  piBin: string; // PI_BIN          — pi binary, for `pi install`
}

// Never copied when seeding: platform-specific, generated, or secret.
const EXCLUDED = new Set(["git", "npm", "bin", "node_modules", "sessions", ".git"]);

/**
 * Resolve the agent config dir, provisioning the fast parts synchronously
 * (clone/seed + auth overlay) so the server can start listening immediately.
 * Package installation is slow and runs separately via installPackages().
 * Returns "" when neither repo nor seed is set (pi uses its built-in default).
 */
export function resolveConfig(o: ConfigOptions): string {
  if (o.repo) {
    try {
      syncRepo(o.repo, o.dir, o.githubToken);
    } catch (e) {
      console.warn(`config repo sync failed, using empty dir: ${msg(e)}`);
      fs.mkdirSync(o.dir, { recursive: true });
    }
  } else if (o.seed) {
    console.log(`seeding config from ${o.seed} -> ${o.dir}`);
    try {
      seedDir(o.seed, o.dir);
    } catch (e) {
      console.warn(`config seed failed, using empty dir: ${msg(e)}`);
      fs.mkdirSync(o.dir, { recursive: true });
    }
  } else {
    console.log("no config repo or seed set, using pi default config");
    return "";
  }

  const agentDir = o.subdir ? path.join(o.dir, o.subdir) : o.dir;
  overlayAuth(o.authFile, agentDir);
  return agentDir;
}

/**
 * Install the packages declared in settings.json for this platform (native
 * modules built in-container). Async so it never blocks the event loop; safe to
 * call without awaiting after the server starts listening.
 */
export async function installPackages(agentDir: string, piBin: string): Promise<void> {
  let settings: { packages?: string[] };
  try {
    settings = JSON.parse(fs.readFileSync(path.join(agentDir, "settings.json"), "utf8"));
  } catch {
    return; // no settings, nothing to install
  }
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
  for (const pkg of settings.packages ?? []) {
    console.log(`installing pi package: ${pkg}`);
    try {
      await execFileAsync(piBin, ["install", pkg], { env });
    } catch (e) {
      console.warn(`package install failed (${pkg}): ${msg(e)}`);
    }
  }
}

/** Start a timer that re-pulls the repo and reinstalls packages on change. */
export function startConfigPoll(o: ConfigOptions, intervalMs: number): void {
  if (!o.repo || intervalMs <= 0) return;
  let syncing = false;
  setInterval(() => {
    if (syncing) return;
    syncing = true;
    void (async () => {
      try {
        const before = gitHead(o.dir);
        await syncRepoAsync(o.repo, o.dir, o.githubToken);
        if (gitHead(o.dir) === before) return;
        console.log("config updated, reinstalling packages");
        const agentDir = o.subdir ? path.join(o.dir, o.subdir) : o.dir;
        overlayAuth(o.authFile, agentDir);
        await installPackages(agentDir, o.piBin);
      } catch (e) {
        console.warn(`config re-pull failed: ${msg(e)}`);
      } finally {
        syncing = false;
      }
    })();
  }, intervalMs).unref();
}

function overlayAuth(src: string, agentDir: string): void {
  if (!src || !agentDir || !fs.existsSync(src)) return;
  fs.mkdirSync(agentDir, { recursive: true });
  const dst = path.join(agentDir, "auth.json");
  fs.copyFileSync(src, dst);
  console.log(`auth.json overlaid -> ${dst}`);
}

function syncRepo(repo: string, dir: string, token: string): void {
  runGitSync(repo, dir, token);
}

async function syncRepoAsync(repo: string, dir: string, token: string): Promise<void> {
  await runGitAsync(repo, dir, token);
}

function runGitSync(repo: string, dir: string, token: string): void {
  const url = authRepoUrl(repo, token);
  if (fs.existsSync(path.join(dir, ".git"))) {
    if (token) git("-C", dir, "remote", "set-url", "origin", url);
    console.log(`pulling config repo (${dir})`);
    git("-C", dir, "checkout", "--", ".");
    git("-C", dir, "pull", "--ff-only", "--quiet");
    git("-C", dir, "submodule", "update", "--init", "--recursive", "--quiet");
    return;
  }
  console.log(`cloning config repo ${repo} -> ${dir}`);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  git("clone", "--quiet", "--recurse-submodules", url, dir);
}

async function runGitAsync(repo: string, dir: string, token: string): Promise<void> {
  const url = authRepoUrl(repo, token);
  if (fs.existsSync(path.join(dir, ".git"))) {
    if (token) await gitAsync("-C", dir, "remote", "set-url", "origin", url);
    console.log(`pulling config repo (${dir})`);
    await gitAsync("-C", dir, "checkout", "--", ".");
    await gitAsync("-C", dir, "pull", "--ff-only", "--quiet");
    await gitAsync("-C", dir, "submodule", "update", "--init", "--recursive", "--quiet");
    return;
  }
  console.log(`cloning config repo ${repo} -> ${dir}`);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await gitAsync("clone", "--quiet", "--recurse-submodules", url, dir);
}

/** Embed a fine-grained PAT in HTTPS clone URLs (private repos on GitHub). */
function authRepoUrl(repo: string, token: string): string {
  if (!token) return repo;
  const authed = (path: string) => `https://x-access-token:${token}@github.com/${path}`;
  if (repo.startsWith("git@github.com:")) return authed(repo.slice("git@github.com:".length));
  if (repo.startsWith("https://github.com/")) return authed(repo.slice("https://github.com/".length));
  return repo;
}

function seedDir(src: string, dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    if (EXCLUDED.has(entry)) continue;
    fs.cpSync(path.join(src, entry), path.join(dir, entry), { recursive: true });
  }
}

function gitHead(dir: string): string {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { stdio: "pipe" }).toString();
  } catch {
    return "";
  }
}

function git(...args: string[]): void {
  execFileSync("git", args, { stdio: "pipe" });
}

async function gitAsync(...args: string[]): Promise<void> {
  await execFileAsync("git", args);
}
