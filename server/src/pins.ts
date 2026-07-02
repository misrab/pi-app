// Pinned-session state, persisted next to the agent working dir so it survives
// restarts and syncs across the user's devices (phone + desktop share one
// server). A flat JSON array of session ids.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export class Pins {
  private file: string;
  private ids = new Set<string>();

  constructor(dir: string) {
    this.file = join(dir, ".pi-app-pins.json");
    try {
      const arr = JSON.parse(readFileSync(this.file, "utf8"));
      if (Array.isArray(arr)) this.ids = new Set(arr.map(String));
    } catch {
      /* no pins yet */
    }
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  set(id: string, pinned: boolean): void {
    if (pinned) this.ids.add(id);
    else this.ids.delete(id);
    this.persist();
  }

  remove(id: string): void {
    if (this.ids.delete(id)) this.persist();
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify([...this.ids]));
    } catch (e) {
      console.error("pins: persist failed:", e);
    }
  }
}
