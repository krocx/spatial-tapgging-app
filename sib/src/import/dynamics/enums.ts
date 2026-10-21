// enums.ts - every Dynamics 365 Guides option-set value the importer knows,
// in one place. Values are Microsoft's 9373800xx integers. Logic uses the raw
// value; the formatted label (`<field>@OData.Community.Display.V1.FormattedValue`)
// is the fallback for values not listed here, and an unknown value never
// crashes an import - it is mapped to a safe default and counted in the report.
//
// "verified" = seen in a real package; "unverified" = from Microsoft's docs or
// inference. Keep the comments honest when a real guide proves one.
//
// Proprietary & Confidential · Applied Materials.

export const STEP_TEMPLATE = { Default: 937380000, Question: 937380001, Completion: 937380002 } as const;       // verified
export const RESPONSE_ACTION = { NoAction: 937380000, GoToNextStep: 937380001, GoToStep: 937380002 } as const;   // verified
export const STEP_ACTION = { NoAction: 937380000 } as const;                                                     // others unverified
export const ANCHOR_TYPE = { Holographic: 937380000 } as const;                                                  // QR and circular code: unverified values
export const ATTENTION_ENDPOINT = { NoAttachment: 937380000, ThreeDObject: 937380002 } as const;                 // verified; others unverified
export const TRIGGER_ACTION = { NoAction: 937380000, UseResponse1: 937380002, GoToStep: 937380005 } as const;    // others unverified
export const TRIGGER_ACTIVATION = { OnHandExit: 937380001 } as const;                                            // others unverified
export const OBJECT_STYLE = { Original: 937380000, XRay: 937380007, Green: 937380009 } as const;                 // verified; other highlight / colour styles exist
export const ANIMATION_MODE = { Loop: 937380000 } as const;                                                      // others unverified

/** A label a human reads, from the raw value or the formatted string. */
export function labelOf(raw: unknown, formatted: unknown, known: Record<string, number>): string {
  if (typeof raw === 'number') { const k = Object.entries(known).find(([, v]) => v === raw)?.[0]; if (k) return k; }
  if (typeof formatted === 'string' && formatted.trim()) return formatted.trim();
  return raw === null || raw === undefined ? 'unset' : String(raw);
}

/** Object styles → how SIB shows the node. Unknown highlight / colour styles read
 *  the formatted label: anything with "ray" is ghost, a colour word is a colour. */
export function styleToNode(raw: unknown, formatted: unknown): { show: 'solid' | 'ghost'; color?: [number, number, number]; known: boolean } {
  if (raw === OBJECT_STYLE.Original) return { show: 'solid', known: true };
  if (raw === OBJECT_STYLE.XRay) return { show: 'ghost', known: true };
  if (raw === OBJECT_STYLE.Green) return { show: 'solid', color: [0.2, 0.8, 0.3], known: true };
  const f = typeof formatted === 'string' ? formatted.toLowerCase() : '';
  if (f.includes('ray') || f.includes('ghost') || f.includes('transparent')) return { show: 'ghost', known: false };
  const colours: Record<string, [number, number, number]> = { green: [0.2, 0.8, 0.3], red: [0.9, 0.25, 0.2], blue: [0.2, 0.5, 0.95], yellow: [0.95, 0.85, 0.2], orange: [1, 0.6, 0.1], white: [1, 1, 1], purple: [0.6, 0.4, 0.9], cyan: [0.2, 0.85, 0.9] };
  for (const [name, rgb] of Object.entries(colours)) if (f.includes(name)) return { show: 'solid', color: rgb, known: false };
  return { show: 'solid', known: false };
}

/** Stock holograms Microsoft ships with Guides (arrows, hands, zones, …), by display name.
 *  They are packaged like any model and import normally; the names let SIB mark
 *  them and optionally swap native equivalents later. "Invisible" is imported hidden. */
export const STOCK_HOLOGRAM_NAMES = new Set([
  'Invisible', 'Arrow', 'Arrow Curved', 'Arrow Double', 'Hand', 'Hand Pointing', 'Hand Grab', 'Zone', 'Circle', 'Dot', 'Dotted Line', 'Line',
  'Number 1', 'Number 2', 'Number 3', 'Number 4', 'Number 5', 'Number 6', 'Number 7', 'Number 8', 'Number 9', 'Number 10',
  'Check', 'Cross', 'Warning', 'Caution', 'Rotate', 'Push', 'Pull', 'Twist', 'Tap', 'Drill', 'Screwdriver', 'Wrench', 'Hammer', 'Pliers',
]);
export const isStockHologram = (name: string | undefined): boolean => !!name && (STOCK_HOLOGRAM_NAMES.has(name.trim()) || /^(Arrow|Hand|Zone|Number|Dot)\b/i.test(name.trim()));
