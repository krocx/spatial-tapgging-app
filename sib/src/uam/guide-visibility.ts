// guide-visibility.ts — per-user guide sharing rules, pure logic.
//
// Who sees a guide?
//   · Unidentified callers (no UAM session — legacy apps, dormant UAM):
//     unchanged historical behaviour, filtering happens only by `published`
//     where the route already did so.
//   · Engineer / Manager / Owner: every guide, always.
//   · Technician: published guides that are either shared with EVERYONE
//     (sharedWith absent or empty — backward compatible) or explicitly
//     shared with their email.
//
// The same predicate gates the list, the single-guide read, and the steps
// read, so a technician can neither enumerate nor deep-link around sharing.

import type { Guide, UamUser } from '@spatial/shared';
import { normalizeEmail } from './uam-core.js';

export function guideVisibleTo(user: UamUser | undefined, guide: Guide): boolean {
  if (!user) return true;                       // unidentified — historical behaviour
  if (user.role !== 'technician') return true;  // engineer+ see everything
  if (!guide.published) return false;           // technicians never see drafts
  const list = guide.sharedWith ?? [];
  if (list.length === 0) return true;           // unshared = shared with all
  return list.includes(normalizeEmail(user.email));
}
