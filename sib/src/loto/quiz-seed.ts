// quiz-seed.ts — the standard LOTO training question bank, drafted from
// OSHA 29 CFR 1910.147 plus this site's Safe Off convention (docs/ILOTO.md §2).
//
// Seeded into the loto-quiz store ONLY when it is empty — after that the
// stored questions are the truth and EHS may edit them freely (they are data,
// not code). Re-deploying never overwrites edits.

import type { LotoQuizQuestion } from '@spatial/shared';

/** prompt, choices, correctIndex, explanation */
type Seed = [string, string[], number, string];

const SEEDS: Seed[] = [
  [
    'What is the correct order for applying LOTO?',
    [
      'Shut down → apply lock → notify affected employees → verify',
      'Notify affected → shut down → isolate energy → apply lock → release stored energy → verify isolation',
      'Isolate energy → notify affected → apply lock → shut down',
      'Apply lock → shut down → verify → notify affected',
    ],
    1,
    'OSHA 1910.147 fixes the sequence: notification, shutdown, isolation, lockout device, stored-energy release, then verification. Order matters — verifying before releasing stored energy proves nothing.',
  ],
  [
    'What is the purpose of the "try test" (verification of isolation)?',
    [
      'To confirm the lock is physically attached',
      'To test that the machine still works after maintenance',
      'To attempt a normal start and confirm nothing energizes before work begins',
      'To check the tag is legible',
    ],
    2,
    'Verification means attempting to start the equipment with its normal controls and confirming no energization — then returning controls to off/neutral. A lock on the wrong isolator looks identical to a lock on the right one until you try.',
  ],
  [
    'Who may remove a lockout device?',
    [
      'Any authorized employee on shift',
      'The supervisor of the area',
      'Only the employee who applied it',
      'Anyone, once the work is visibly complete',
    ],
    2,
    'One lock, one person. Each device is removed by the employee who applied it. Anything else follows the documented exception procedure — never a casual removal.',
  ],
  [
    'Under what conditions may someone else\'s lock be removed?',
    [
      'Never, under any circumstances',
      'When the shift ends',
      'Under the employer\'s documented procedure: verify the employee is absent, make reasonable efforts to contact them, and inform them before they return to work',
      'When a supervisor gives verbal approval',
    ],
    2,
    'The exception exists but is narrow and documented. In this app it is the supervisor override flow, which records all three conditions and the reason.',
  ],
  [
    'What is the difference between an authorized and an affected employee?',
    [
      'Authorized employees perform lockout; affected employees operate or work near the equipment and must be notified',
      'Authorized employees are managers; affected employees are contractors',
      'There is no difference',
      'Affected employees apply locks; authorized employees verify them',
    ],
    0,
    'Authorized employees lock and tag equipment for servicing. Affected employees don\'t apply locks but must be notified before lockout begins and when it ends.',
  ],
  [
    'At this site, what does a RED lock mean?',
    [
      'The equipment is out of service for operational reasons',
      'A person is working on the equipment — a personal danger lock protecting a life',
      'The equipment failed inspection',
      'The breaker is scheduled for replacement',
    ],
    1,
    'Red is a personal LOTO lock: someone\'s hands are in the equipment. It is applied and removed only by that person.',
  ],
  [
    'At this site, what does a YELLOW lock mean?',
    [
      'A person is working inside the equipment',
      'The equipment is safe to operate',
      'Safe Off — the equipment is out of service / de-energized for operational reasons; nobody is working inside it',
      'The lock is a spare',
    ],
    2,
    'Yellow is the Safe Off out-of-service lock on a circuit breaker. It keeps equipment down but is not personal protection — that is what red LOTO locks are for.',
  ],
  [
    'Which of these are forms of stored energy that must be released or restrained?',
    [
      'Capacitors, springs, raised parts, hydraulic or pneumatic pressure',
      'Only electrical current',
      'Only fuel in the machine',
      'Noise and heat',
    ],
    0,
    'De-energizing the supply is not enough: capacitors hold charge, springs stay compressed, suspended loads hold gravitational energy, and lines hold pressure. All must be released, blocked, or bled down.',
  ],
  [
    'Before removing locks and re-energizing, what must happen?',
    [
      'Nothing — remove the lock and start up',
      'Inspect the work area, remove tools and materials, confirm all personnel are clear, and notify affected employees',
      'Take a photo of the machine',
      'Wait 15 minutes',
    ],
    1,
    'Release is the mirror of application: area inspected, tools out, people clear, affected employees notified — then the device comes off.',
  ],
  [
    'When is a tag alone (without a lock) acceptable?',
    [
      'Whenever locks are in short supply',
      'Only where the energy isolating device cannot physically accept a lock, with additional protective measures',
      'For jobs shorter than one hour',
      'Always — tags and locks are equivalent',
    ],
    1,
    'A tag is a warning, not a physical restraint. Tagout alone is permitted only where lockout is infeasible, and requires measures giving equivalent protection.',
  ],
  [
    'How does group lockout work when several people service the same equipment?',
    [
      'The most senior worker\'s lock covers everyone',
      'Each worker attaches their own personal lock, e.g. via a hasp or lock box',
      'One lock is shared and the key is passed around',
      'Locks are unnecessary if everyone is told verbally',
    ],
    1,
    'Every worker\'s protection is their own lock. A hasp or lock box lets many personal locks hold one isolation point; the equipment stays locked until the last person removes theirs.',
  ],
  [
    'When must LOTO be applied?',
    [
      'Only for electrical work',
      'Only when a supervisor requests it',
      'During servicing or maintenance where unexpected energization, start-up, or release of stored energy could injure someone',
      'Only on equipment older than ten years',
    ],
    2,
    'The trigger is the hazard, not the trade: any servicing where unexpected energization or stored-energy release could cause injury requires energy control.',
  ],
  [
    'A shift ends while equipment is still locked out. What is required?',
    [
      'Locks are removed at shift end automatically',
      'An orderly transfer: continuity of protection is maintained as off-going and on-coming employees exchange lock control',
      'The night shift works on the equipment without locks',
      'The supervisor holds all keys overnight',
    ],
    1,
    'Protection must be continuous across shift change — the off-going worker\'s lock is exchanged for the on-coming worker\'s in an orderly handoff, never a gap.',
  ],
  [
    'Which situations require retraining?',
    [
      'Only after an injury',
      'Every week regardless of circumstances',
      'A change in job assignment, machines, or energy-control procedures, or when an inspection reveals deviations or inadequate knowledge',
      'Retraining is never required after initial certification',
    ],
    2,
    'Retraining follows change and demonstrated gaps — new duties, new hazards, revised procedures, or observed deviations. This app also expires certifications on a fixed schedule as a site control.',
  ],
  [
    'After a successful try test, what must you do with the machine controls?',
    [
      'Leave them in the start position',
      'Return them to off/neutral before starting work',
      'Remove the control handles entirely',
      'Tape over them',
    ],
    1,
    'After verifying no energization, controls go back to off/neutral. Leaving a control in "start" means the machine fires the instant energy is restored.',
  ],
  [
    'What does a "locked" status in this app prove?',
    [
      'That the equipment is physically safe to touch',
      'That an apply event was recorded, with evidence — physical verification at the panel is still required before body contact',
      'That OSHA has inspected the panel',
      'That the breaker cannot physically be turned on',
    ],
    1,
    'The app is the record and verification aid. The physical lock — and your own try test — are the safety controls. Never substitute a screen for verification at the panel.',
  ],
];

export function buildSeedQuestions(now: string): LotoQuizQuestion[] {
  return SEEDS.map(([prompt, choices, correctIndex, explanation], i) => ({
    id: `loto-q-${String(i + 1).padStart(2, '0')}`,
    prompt,
    choices,
    correctIndex,
    explanation,
    createdAt: now,
    updatedAt: now,
  }));
}
