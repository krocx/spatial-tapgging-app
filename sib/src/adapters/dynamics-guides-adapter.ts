// dynamics-guides-adapter.ts - Microsoft Dynamics 365 Guides as an
// InstructionsSourceAdapter (AROMS-366).
//
// The full import - models merged into an assembly, step images, the job
// queue, update-or-new - is POST /guides/import/dynamics (routes/guides.ts),
// because an InstructionsSourceAdapter answers with an ImportedGuide only
// and has nowhere to put a GLB. This adapter is the text path through the
// generic POST /guides/import: the same package, steps and branches, no 3D
// and no pictures. Useful for a quick text-only migration from a script or
// for a server where the worker queue is off.
//
// Payload: { packageBase64: string, name?: string }  - the .guide file.

import type { ImportedGuide } from '@spatial/shared';
import { registerInstructionsSourceAdapter, type InstructionsSourceAdapter } from './instructions-source-adapter.js';
import { importGuidePackage } from '../import/dynamics/importer.js';

export class DynamicsGuidesAdapter implements InstructionsSourceAdapter {
  readonly name = 'dynamics';

  async fetchGuide(payload: unknown): Promise<ImportedGuide> {
    const p = payload as { packageBase64?: unknown; name?: unknown } | null;
    if (!p || typeof p.packageBase64 !== 'string' || !p.packageBase64) {
      throw new Error('DynamicsGuidesAdapter: payload must be { packageBase64: string } - the .guide package');
    }
    const bytes = Buffer.from(p.packageBase64, 'base64');
    const r = importGuidePackage(bytes, { name: typeof p.name === 'string' ? p.name : undefined });
    // Text path: nothing to attach the node deltas or positions to.
    for (const s of r.imported.steps) { delete s.nodes; delete s.cadPosition; delete s.models; }
    delete r.imported.assembly;
    console.log(`[instructions-source] dynamics: guide ${r.provenance.guideId.slice(0, 8)} - ${r.report.tasks} task(s), ${r.imported.steps.length} step(s), ` +
      `${r.report.objects.placements} placement(s) and ${r.report.media.stepImages} image(s) not carried on this path` +
      (r.report.warnings.length ? `, ${r.report.warnings.length} warning(s)` : ''));
    return r.imported;
  }
}

registerInstructionsSourceAdapter(new DynamicsGuidesAdapter());
