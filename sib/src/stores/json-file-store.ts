// JsonFileStore — drop-in replacement for InMemoryStore that persists records
// to a JSON file under <cwd>/.sib-data/<storeName>.json.
//
// On startup the file is loaded so data survives SIB restarts.
// Writes are synchronous and happen on every mutation — fine for Phase 1 with
// small data volumes.  Replace with a proper DB adapter in Phase 2.

import fs   from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { InMemoryStore } from './in-memory-store.js';

/**
 * Global store-write bus — emits ('write', storeName) after every persisted
 * mutation. The ONE hook point for reactive consumers (the .tag subscription
 * manager debounces on this instead of polling or instrumenting every route).
 */
export const storeEvents = new EventEmitter();
storeEvents.setMaxListeners(50);

// SIB_DATA_DIR env var allows overriding the data location (e.g. Render persistent disk at /data/.sib-data).
// Falls back to .sib-data/ in cwd for local development.
const DATA_DIR = process.env.SIB_DATA_DIR ?? path.join(process.cwd(), '.sib-data');

export class JsonFileStore<T extends { id: string }> extends InMemoryStore<T> {
  private readonly filePath: string;
  private readonly storeName: string;

  constructor(storeName: string) {
    super();
    this.storeName = storeName;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this.filePath = path.join(DATA_DIR, `${storeName}.json`);
    this.hydrate();
  }

  // ── Overrides — persist after every mutation ─────────────────────────────

  override save(record: T): T {
    const result = super.save(record);
    this.flush();
    return result;
  }

  override update(id: string, patch: Partial<T>): T | undefined {
    const result = super.update(id, patch);
    if (result !== undefined) this.flush();
    return result;
  }

  override delete(id: string): boolean {
    const removed = super.delete(id);
    if (removed) this.flush();
    return removed;
  }

  // Remove every record for which `shouldRemove` returns true, in a single
  // flush. Used for bounded-retention pruning (e.g. expiring old sessions)
  // so the in-memory Map — and the JSON file it's mirrored to — don't grow
  // forever. Returns the number of records removed.
  pruneWhere(shouldRemove: (record: T) => boolean): number {
    const toRemove = this.findAll().filter(shouldRemove);
    if (toRemove.length === 0) return 0;
    for (const record of toRemove) {
      super.delete(record.id);
    }
    this.flush();
    return toRemove.length;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private hydrate(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw  = fs.readFileSync(this.filePath, 'utf8');
      const rows = JSON.parse(raw) as T[];
      rows.forEach(r => super.save(r));   // use super to avoid re-flushing
      console.log(`[JsonFileStore] Loaded ${rows.length} records from ${this.filePath}`);
    } catch (err) {
      console.warn(`[JsonFileStore] Could not load ${this.filePath}: ${err} — starting empty`);
    }
  }

  private flush(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.findAll(), null, 2), 'utf8');
    } catch (err) {
      console.error(`[JsonFileStore] Failed to write ${this.filePath}: ${err}`);
    }
    // After the write, whether it succeeded or not — listeners recompute from
    // the in-memory truth, which has already mutated either way.
    storeEvents.emit('write', this.storeName);
  }
}
