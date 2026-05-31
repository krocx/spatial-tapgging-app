// Perception Adapter Framework — Phase 1 stub
// See /docs/perception-framework.md for full spec.
//
// All real adapters (Sodavision, Neurocle, foundation models) implement
// PerceptionAdapter and are registered in the adapter registry below.
// SIB calls adapters without knowing which underlying model is used.

import type { Observation } from '@spatial/shared';

// --- Adapter contract ---

export interface PerceptionContext {
  assetId: string;
  anchorId: string;
  tagId: string;
  userId: string;
}

export interface PerceptionAdapter {
  readonly name: string;
  analyze(imageBuffer: Buffer, context: PerceptionContext): Promise<Observation[]>;
}

// --- Stub adapter (Phase 1) ---
// Returns empty observations. Replace with real model calls in Phase 2.

export class StubPerceptionAdapter implements PerceptionAdapter {
  readonly name = 'stub-adapter';

  async analyze(
    _imageBuffer: Buffer,
    _context: PerceptionContext,
  ): Promise<Observation[]> {
    // TODO Phase 2: call Sodavision / Neurocle / foundation model here.
    // Normalize raw labels → SIB ontology before returning.
    return [];
  }
}

// --- Adapter registry ---

const registry = new Map<string, PerceptionAdapter>();

export function registerAdapter(adapter: PerceptionAdapter): void {
  registry.set(adapter.name, adapter);
}

export function getAdapter(name: string): PerceptionAdapter | undefined {
  return registry.get(name);
}

export function listAdapters(): string[] {
  return Array.from(registry.keys());
}

// Register the Phase 1 stub by default.
registerAdapter(new StubPerceptionAdapter());
