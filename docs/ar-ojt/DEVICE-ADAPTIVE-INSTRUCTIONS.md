# Device-adaptive work instructions - proposal

Proprietary & Confidential · Applied Materials

Status: **proposal, 2026-09-30** - not started. Backlog item "device-adaptive
work instructions (AR glasses readiness)".

## The question

One imported procedure (the Bee drone: 128 steps, 719 parts, 47 hoses, 126
camera views) has to serve very different wearables. A Rayneo X3 can show
the optimised model and overlays; an Even G2 shows a few lines of text the
technician pages through with the ring or the trackpad; Meta's Oakley
glasses have no display worth a model but can read a step aloud and hear an
answer. The question the platform must be able to answer, per guide and per
device, is: which steps can this device deliver reliably, and in what form?
That is the readiness assessment AR OMS is being evaluated for.

## What we already have

Every step is engine-neutral data: text, a suggested camera, part deltas
(show / hide / ghost / motion), a CAD pin, callouts, media. Nothing in the
guide assumes a renderer. The XR kit (`/xr?guide=`) already runs a guide in
a browser, and the app runs it on ARKit. What is missing is a description of
what a step *needs* and what a device *has*, and a rule joining the two.

## Proposal in three parts

**1. Step needs, derived at import (no authoring).** For every step the
importer records which channels carry its meaning:

| Need | Derived from |
|---|---|
| `text` | the step has body text (always) |
| `spatial` | a CAD pin or a suggested view - the step is about a place on the tool |
| `motion` | any delta with `from`/`to` or a hose flipbook - the step shows how a part moves |
| `part-id` | the step reveals or highlights parts - the technician has to find one |
| `media` | an image or callout the text refers to |
| `hands-busy` | text hints (torque, hold, insert while) - a step better read aloud than looked at |

Stored on the step as `needs: string[]`; the Designer shows them as chips
and lets an author override (a step whose text says everything can drop
`spatial`).

**2. Device profiles, a small table on the server.** Each profile lists
what the device can deliver and how it is driven:

| Profile | Display | Overlay | Input | Delivery |
|---|---|---|---|---|
| iPad / iPhone (app) | full | 3D on the tool | touch, voice | app |
| Rayneo X3 | full, small FOV | 3D, reduced model, no hoses | ring, gaze, voice | XR kit in the glasses' browser |
| Even G2 | text, 3 to 5 lines | none | ring, trackpad | text pages via the companion phone |
| Meta Oakley | none | none | voice | spoken steps, question and answer |
| Browser on a laptop | full | 3D, no anchoring | mouse | XR kit |

Profiles are data (`docs/devices/*.md`, same frontmatter idea as the
catalogue), so a new headset is a file, not a release.

**3. Readiness = needs joined with profile.** For a guide and a profile,
every step gets one of: *native* (all needs delivered as authored),
*adapted* (delivered in a reduced form: a motion step read as text with the
part name; a spatial step spoken with "on the left arm, under the cowl"
from the pin's position), or *assisted* (the device cannot carry the step;
it hands off to a phone or a colleague). The portal shows a readiness matrix
per guide (steps down, profiles across) and a percentage per profile. That
matrix is the deliverable of the POC assessment.

Presentation follows the same join: the XR kit reads the profile from the
device (user agent, screen, an explicit `?profile=`) and renders the step
in the form the profile allows; a spoken profile turns the step into a
short script (text, then the part names, then the check); a text profile
paginates.

## What it does not need

No new renderer per device: the XR kit already adapts to a browser, and
the text and spoken forms are generated from the step data. No vendor SDK
on the server. No change to the app.

## Order of work

1. Step needs at import + Designer chips (one day).
2. Device profiles as files + readiness join + portal matrix (two days).
3. XR kit profile switch: reduced model, text pages, spoken script (two to
   three days, the spoken form last).
4. Run the Bee through the matrix, walk the adapted steps on each device
   class, record what held (the assessment itself).

Decision needed before 1: which three devices are in the first assessment,
so the profiles are written from hardware in hand rather than data sheets.
