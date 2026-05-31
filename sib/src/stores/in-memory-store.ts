// Generic in-memory store for Phase 1.
// All data is lost on restart — intentional for rapid iteration.
// Replace with a persistent adapter (SQLite, Postgres) in Phase 2.

export class InMemoryStore<T extends { id: string }> {
  private readonly records = new Map<string, T>();

  save(record: T): T {
    this.records.set(record.id, record);
    return record;
  }

  findById(id: string): T | undefined {
    return this.records.get(id);
  }

  findAll(): T[] {
    return Array.from(this.records.values());
  }

  update(id: string, patch: Partial<T>): T | undefined {
    const existing = this.records.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    this.records.set(id, updated);
    return updated;
  }

  delete(id: string): boolean {
    return this.records.delete(id);
  }

  count(): number {
    return this.records.size;
  }
}
