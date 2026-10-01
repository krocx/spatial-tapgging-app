// scorecard-core.ts - the Technology Readiness scorecard SIB keeps for the
// tracks it has evidence for (docs/TRL-SCORECARD.md).
//
// SIB scores lens L1 (technology readiness) and L2 (SiB readiness) of the
// master TRL scorecard for Hardware Fit, Content Pipeline and AR SDK, each
// lens through a few criteria scored 1 to 5 against a written rubric, with a
// confidence and evidence that links to what SIB already holds (import logs,
// sessions, readiness snapshots) or to a file elsewhere. L3 to L5 stay in the
// master sheet with the track owner. Pure functions here; the store and the
// routes are in routes/scorecard.ts.
//
// Proprietary & Confidential · Applied Materials.

export type TrackId = 'hardware-fit' | 'content-pipeline' | 'ar-sdk';
export type Lens = 'L1' | 'L2';
export type Confidence = 'High' | 'Medium' | 'Low';
export type Verdict = 'ADVANCE' | 'CONTINUE' | 'PARK' | 'CLOSE';

export interface Criterion { id: string; lens: Lens; name: string; question: string; evidence: string; levels: [string, string, string, string, string] /* 1..5 */ }
export interface Track { id: TrackId; letter: string; name: string; l1: string; l2: string; criteria: Criterion[] }

const L1_WORDS: [string, string, string, string, string] = ['Concept', 'Demo only', 'Repeatable in a controlled setting', 'Works in situ', 'Proven in situ'];
const L2_WORDS: [string, string, string, string, string] = ['Does not exist', 'Scoped, not started', 'In build', 'Shipped with known gaps', 'Shipped and reused'];

const c = (id: string, lens: Lens, name: string, question: string, evidence: string, levels?: Criterion['levels']): Criterion =>
  ({ id, lens, name, question, evidence, levels: levels ?? (lens === 'L1' ? L1_WORDS : L2_WORDS) });

export const TRACKS: Track[] = [
  {
    id: 'content-pipeline', letter: 'C', name: 'Content Pipeline CAD→AR',
    l1: 'Cortona / CAD publications become correct AR work instructions on real decks.',
    l2: 'The SIB importer, variants, Designer and players that deliver them are shipped and stable.',
    criteria: [
      c('cp-format', 'L1', 'Format coverage', 'Do the publication variants we receive import without code changes?', 'Import logs: PROTOs handled / ignored / unknown; warnings',
        ['One sample deck only', 'Demo decks only', '3D OMS content with known exceptions listed in the log', 'Every deck received this quarter imported; exceptions warned, none blocking', 'Every deck, including new exporter versions, with no new exceptions']),
      c('cp-geometry', 'L1', 'Geometry fidelity', 'Do small and thin parts survive reduction on every device budget?', 'Variant stats; before / after screenshots; seal and screw checks',
        ['Parts collapse or vanish', 'Visible loss on most reduced models', 'Floors hold on demo decks', 'Floors hold on 3D OMS content at every budget', 'No fidelity complaint from a technician in situ']),
      c('cp-animation', 'L1', 'Animation fidelity', 'Do motions, hoses and flipbooks play as the source viewer plays them?', 'Designer Play step recording against the Cortona viewer',
        ['Motions missing', 'Rigid motions only', 'Motions and hoses on demo decks', '3D OMS content matches the viewer step for step', 'Technicians confirm the sequence in situ']),
      c('cp-state', 'L1', 'State fidelity', 'Are visibility and pose per step what the source shows?', 'Designer step walk; readiness snapshot; context overlay in AR',
        ['Wrong parts shown', 'Right at the first steps only', 'Right on demo decks', 'Right on 3D OMS content, assembled pose correct on first import or one explicit choice', 'Right in situ across procedures']),
      c('cp-units', 'L1', 'Units and pose', 'Is the model the right size and in the assembled pose without manual fixing?', 'Import log units and assembled-pose lines',
        ['Wrong size, no way to fix', 'Fixable by re-import with guessing', 'Fixable with the Units / pose options', 'Correct or warned on every deck; one re-import at most', 'Correct first time on every deck']),
      c('cp-metadata', 'L1', 'Metadata', 'Do part numbers, descriptions, text and views carry through?', 'Import log parts and text counts; Designer part chips',
        ['Text only', 'Names only', 'Part numbers where the publication has them', 'BOM and descriptions on 3D OMS content', 'Everything the viewer shows, nothing more to author']),
      c('cp-scale', 'L1', 'Scale and performance', 'How large a deck, how fast, on which host?', 'Import logs: size, time, memory; Render and company server',
        ['Only tiny decks', 'Demo decks on the company server only', '3D OMS content on the company server; Render needs the larger tier', '3D OMS content on both hosts within the guard', 'Largest deck received, both hosts, with headroom']),
      c('cp-diagnosability', 'L1', 'Diagnosability', 'Can every failure be explained from the saved log without the source file?', 'Issues resolved this quarter from logs alone',
        ['Needs the file and a developer', 'Needs the file', 'Most issues from the log', 'Every issue this quarter from the log', 'Authors fix their own imports from the log']),
      c('cp-sib-import', 'L2', 'Import tool', 'The importer and its options as a shipped capability.', 'Changelog; tests; company server runs', undefined),
      c('cp-sib-variants', 'L2', 'Variants and delivery', 'Server variants, device budgets, caches.', 'Model records; device logs', undefined),
      c('cp-sib-designer', 'L2', 'Designer preview', 'State per step and playback in the Designer.', 'Designer bundle; recordings', undefined),
      c('cp-sib-players', 'L2', 'Players', 'The app and the XR kit as consumers of the pipeline.', 'Session records', undefined),
    ],
  },
  {
    id: 'hardware-fit', letter: 'H', name: 'Hardware Fit',
    l1: 'The headset carries the authored step in the environment it must work in.',
    l2: 'The SIB app and the XR kit deliver it on that device.',
    criteria: [
      c('hw-delivery', 'L1', 'Delivery', 'Does the guide open on the device from the QR with nothing typed?', 'Session record with the profile in its work context',
        ['Does not open', 'Opens with manual steps', 'Opens from the QR in the lab', 'Opens from the QR on the floor', 'Opens from the QR for technicians unaided']),
      c('hw-legibility', 'L1', 'Legibility and field of view', 'Can the technician read the step and see the overlay where the work is?', 'Photos through the device; technician notes',
        ['Unreadable', 'Readable at rest only', 'Readable in the lab', 'Readable on the floor in its lighting', 'No legibility complaints across shifts']),
      c('hw-anchoring', 'L1', 'Overlay accuracy', 'Does the overlay sit on the tool and stay there?', 'Anchor Lab runs; drift notes per session',
        ['No overlay', 'Drifts within a step', 'Holds in the lab', 'Holds on the floor with documented limits', 'Holds across operators and shifts']),
      c('hw-input', 'L1', 'Input while hands are busy', 'Can the technician advance, go back and repeat without stopping work?', 'Readiness matrix hands-busy steps; observations',
        ['Needs a hand on the device every time', 'Voice or ring works sometimes', 'Works in the lab', 'Works on the floor with gloves and noise', 'Preferred by technicians']),
      c('hw-comfort', 'L1', 'Comfort and duration', 'Can it be worn for a full procedure?', 'Session durations; technician notes',
        ['Minutes', 'One short procedure', 'One full procedure', 'A shift with breaks', 'A shift without comment']),
      c('hw-environment', 'L1', 'Environment', 'Cleanroom, ESD, safety eyewear, battery and charging constraints.', 'EHS and cleanroom notes',
        ['Not allowed in', 'Allowed with exceptions pending', 'Allowed in the training area', 'Allowed on the floor with a documented procedure', 'Standard issue']),
      c('hw-sib-kit', 'L2', 'XR kit / app on this device', 'The player SIB provides for this device class.', 'XR kit profile; app build', undefined),
      c('hw-sib-readiness', 'L2', 'Readiness and profiles', 'Profile file, readiness rules, device links.', 'docs/devices; matrix', undefined),
    ],
  },
  {
    id: 'ar-sdk', letter: 'K', name: 'AR SDK Exploration',
    l1: 'The SDK anchors and tracks reliably in the environment.',
    l2: "SIB's use of it (ARKit today, WebXR, device SDKs) is shipped and stable.",
    criteria: [
      c('sdk-anchoring', 'L1', 'Anchoring and relocalisation', 'Error in mm and time to lock per SDK and device.', 'Anchor Lab runs and accuracy records',
        ['Does not relocalise', 'Relocalises in the lab, large error', 'Under 10 mm in the lab, repeatable', 'Under 10 mm on the floor with documented limits', 'Under 5 mm across operators and shifts']),
      c('sdk-tracking', 'L1', 'Tracking under motion', 'Does the overlay hold while the technician moves and works?', 'Session observations; drift notes',
        ['Loses tracking at once', 'Holds when still', 'Holds in the lab', 'Holds on the floor', 'Holds across shifts']),
      c('sdk-coverage', 'L1', 'Device coverage', 'How many of the target devices does the SDK path reach?', 'Readiness matrix; profiles',
        ['One device', 'Two devices in the lab', 'Three device classes in the lab', 'Target devices on the floor', 'Every target device, documented limits']),
      c('sdk-sib', 'L2', 'SIB integration', 'Anchoring, sessions and validation through this SDK in SIB.', 'App and XR kit builds; session records', undefined),
    ],
  },
];

export interface Entry {
  id: string;
  trackId: TrackId;
  criterionId: string;
  quarter: string;             // e.g. FY27-Q1
  score: 1 | 2 | 3 | 4 | 5;
  confidence: Confidence;
  comment: string;
  evidence: EvidenceLink[];
  by: string;
  at: string;
  /** For hardware-fit: the device profile scored. */
  deviceId?: string;
  /** Guide the evidence came from, when it did. */
  guideId?: string;
}
export interface EvidenceLink { kind: 'import-log' | 'session' | 'readiness' | 'guide' | 'model' | 'file' | 'link'; ref: string; label?: string }

export interface LensOverride { trackId: TrackId; lens: Lens; quarter: string; score?: number; confidence?: Confidence; note: string; by: string; at: string }
export interface MasterVerdict { trackId: TrackId; quarter: string; verdict: Verdict; weighted?: number; note?: string; by: string; at: string }

const RANK: Record<Confidence, number> = { High: 3, Medium: 2, Low: 1 };

/** Latest entry per criterion (and per device for hardware-fit) within a quarter. */
export function latestByCriterion(entries: Entry[], trackId: TrackId, quarter: string, deviceId?: string): Map<string, Entry> {
  const out = new Map<string, Entry>();
  for (const e of entries) {
    if (e.trackId !== trackId || e.quarter !== quarter) continue;
    if (deviceId !== undefined && e.deviceId !== deviceId) continue;
    const key = deviceId === undefined && e.deviceId ? `${e.criterionId}@${e.deviceId}` : e.criterionId;
    const cur = out.get(key);
    if (!cur || cur.at < e.at) out.set(key, e);
  }
  return out;
}

export interface LensSuggestion { lens: Lens; scored: number; of: number; mean: number | null; min: number | null; suggested: number | null; confidence: Confidence | null; rule: string }

/** The lens score the criteria suggest: the lower of the rounded mean and
 *  the lowest criterion plus one, so one bad criterion drags the lens but
 *  does not alone decide it; confidence is the lowest among the criteria. */
export function suggestLens(track: Track, lens: Lens, latest: Map<string, Entry>): LensSuggestion {
  const ids = track.criteria.filter(k => k.lens === lens).map(k => k.id);
  const scored = [...latest.values()].filter(e => ids.includes(e.criterionId));
  if (!scored.length) return { lens, scored: 0, of: ids.length, mean: null, min: null, suggested: null, confidence: null, rule: 'no criteria scored yet' };
  const mean = scored.reduce((a, e) => a + e.score, 0) / scored.length;
  const min = Math.min(...scored.map(e => e.score));
  const suggested = Math.min(Math.round(mean), min + 1);
  const confidence = scored.reduce<Confidence>((w, e) => (RANK[e.confidence] < RANK[w] ? e.confidence : w), 'High');
  const rule = `lower of rounded mean (${mean.toFixed(2)} → ${Math.round(mean)}) and lowest criterion + 1 (${min} + 1); confidence = lowest criterion (${confidence})`;
  return { lens, scored: scored.length, of: ids.length, mean: Math.round(mean * 100) / 100, min, suggested, confidence, rule };
}

/** The master sheet's gate rule, for the leadership view's "if the owner's L3 to L5 held" preview. */
export function masterOutcome(l: Record<'L1' | 'L2' | 'L3' | 'L4' | 'L5', number | null>, conf: Partial<Record<'L1' | 'L2' | 'L3' | 'L4' | 'L5', Confidence>>): { weighted: number | null; auto: Verdict | 'incomplete' } {
  const W = { L1: 0.30, L2: 0.25, L3: 0.20, L4: 0.15, L5: 0.10 };
  const keys = ['L1', 'L2', 'L3', 'L4', 'L5'] as const;
  if (keys.some(k => l[k] === null)) return { weighted: null, auto: 'incomplete' };
  const eff = (k: typeof keys[number]) => (conf[k] === 'Low' ? Math.min(l[k]!, 3) : l[k]!);
  const weighted = Math.round(keys.reduce((a, k) => a + eff(k) * W[k], 0) * 100) / 100;
  const min = Math.min(...keys.map(k => l[k]!));
  let auto: Verdict;
  if (l.L4! <= 2) auto = 'CLOSE';
  else if (min === 1) auto = 'PARK';
  else if (weighted < 2.5) auto = 'CLOSE';
  else if (weighted < 3.0) auto = 'PARK';
  else if (weighted < 3.8 || min === 2) auto = 'CONTINUE';
  else auto = 'ADVANCE';
  return { weighted, auto };
}

/** Quarter label for a date: FY27 runs Nov 2026 to Oct 2027 (Applied's fiscal year); adjust FY_START_MONTH if the calendar differs. */
export const FY_START_MONTH = 11;   // November
export function quarterOf(d = new Date()): string {
  const m = d.getUTCMonth() + 1, y = d.getUTCFullYear();
  const offset = (m - FY_START_MONTH + 12) % 12;         // months since FY start
  const fy = (m >= FY_START_MONTH ? y + 1 : y) % 100;
  return `FY${fy}-Q${Math.floor(offset / 3) + 1}`;
}
