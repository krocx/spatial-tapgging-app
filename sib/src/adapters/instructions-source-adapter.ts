// instructions-source-adapter.ts — pluggable guide instruction source
//
// Architecture mirrors ai-guide-adapter.ts and perception-adapter.ts:
//   • InstructionsSourceAdapter — interface every source must implement
//   • ManualJsonAdapter          — pass-through; payload IS the ImportedGuide (for testing)
//   • Registry                  — register / activate / list adapters at runtime
//
// Usage (manual / testing):
//   POST /guides/import { anchorId, createdBy, payload: { name, steps: [...] } }
//   → ManualJsonAdapter returns the payload directly
//   → server creates Guide + GuideSteps, downloading any imageUrls
//
// Usage (MES production — future):
//   1. Implement MESAdapter that fetches a work order from iOMS REST API
//      and normalises the response into ImportedGuide.
//   2. registerInstructionsSourceAdapter(new MESAdapter())
//   3. setActiveInstructionsSourceAdapter('mes')
//   4. POST /guides/import { anchorId, createdBy, sourceType: 'mes', payload: { sourceRef } }

import type { ImportedGuide } from '@spatial/shared';

// ── Interface ─────────────────────────────────────────────────────────────────

export interface InstructionsSourceAdapter {
  /** Unique identifier — used by the registry and logged on import. */
  readonly name: string;

  /**
   * Fetch (or derive) an ImportedGuide from the given payload.
   *
   * @param payload  The raw `payload` field from ImportGuideRequest.
   *                 For ManualJsonAdapter this IS the ImportedGuide.
   *                 For MESAdapter this might be { sourceRef: 'WO-12345' }.
   */
  fetchGuide(payload: unknown): Promise<ImportedGuide>;
}

// ── Registry ──────────────────────────────────────────────────────────────────

const registry = new Map<string, InstructionsSourceAdapter>();
let activeAdapterName: string | null = null;

export function registerInstructionsSourceAdapter(adapter: InstructionsSourceAdapter): void {
  registry.set(adapter.name, adapter);
  console.log(`[instructions-source] Registered adapter: ${adapter.name}`);
}

export function setActiveInstructionsSourceAdapter(name: string): void {
  if (!registry.has(name)) {
    throw new Error(`[instructions-source] Unknown adapter: ${name}`);
  }
  activeAdapterName = name;
  console.log(`[instructions-source] Active adapter: ${name}`);
}

export function getActiveInstructionsSourceAdapter(): InstructionsSourceAdapter | null {
  if (!activeAdapterName) return null;
  return registry.get(activeAdapterName) ?? null;
}

export function getInstructionsSourceAdapter(name: string): InstructionsSourceAdapter | null {
  return registry.get(name) ?? null;
}

export function listInstructionsSourceAdapters(): string[] {
  return [...registry.keys()];
}

// ── ManualJsonAdapter — default (for testing) ─────────────────────────────────

/**
 * The simplest possible adapter: the caller supplies the ImportedGuide
 * directly in the request payload. No external system is called.
 * Used during initial testing before the MES REST API is available.
 */
class ManualJsonAdapter implements InstructionsSourceAdapter {
  readonly name = 'manual';

  async fetchGuide(payload: unknown): Promise<ImportedGuide> {
    // Validate minimal shape — the route layer already checks anchorId/createdBy
    const p = payload as ImportedGuide;
    if (!p || typeof p.name !== 'string' || !Array.isArray(p.steps)) {
      throw new Error('ManualJsonAdapter: payload must be { name: string, steps: [...] }');
    }
    return p;
  }
}

// ── MES Adapter slot (future) ─────────────────────────────────────────────────
//
// When the iOMS REST API is available:
//
// class MESAdapter implements InstructionsSourceAdapter {
//   readonly name = 'mes';
//   private readonly baseUrl = process.env.MES_API_URL ?? '';
//   private readonly apiKey  = process.env.MES_API_KEY ?? '';
//
//   async fetchGuide(payload: unknown): Promise<ImportedGuide> {
//     const { sourceRef } = payload as { sourceRef: string };
//     const res = await fetch(`${this.baseUrl}/work-orders/${sourceRef}/steps`, {
//       headers: { 'X-API-Key': this.apiKey },
//     });
//     if (!res.ok) throw new Error(`MES fetch failed: ${res.status}`);
//     const data = await res.json();
//     return normaliseMESResponse(data); // field mapping: MES → ImportedGuide schema
//   }
// }
//
// registerInstructionsSourceAdapter(new MESAdapter());
// ─────────────────────────────────────────────────────────────────────────────

// Register and activate the manual adapter by default
const manualAdapter = new ManualJsonAdapter();
registerInstructionsSourceAdapter(manualAdapter);
setActiveInstructionsSourceAdapter('manual');
