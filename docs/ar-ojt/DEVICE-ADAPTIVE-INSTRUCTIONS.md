# Device-adaptive work instructions - proposal

Proprietary & Confidential · Applied Materials

Status: **approved and built, first slice, 2026-09-30.** Step needs
(`sib/src/guides/readiness.ts`), device profiles (`docs/devices/*.md`,
`GET /devices`), the readiness join (`GET /guides/:id/readiness`, guide
menu → Device readiness, CSV) and the XR kit profile switch (`?profile=`
or detected: reduced model without flipbooks; text pages; spoken pages
with voice commands) are in. Authoring the needs in the Designer (chips)
and the assessment itself are next.

First numbers, Bee drone, 128 steps: iPad / Quest 3 / HoloLens 2 / Vision
Pro 128 native; Rayneo X3 Pro 103 native, 25 adapted (the steps that play
a hose flipbook); Even G2 and Oakley Vanguard 128 adapted (text or spoken,
location in words from the CAD pin). No step is assisted because the Bee
has no step images; a deck with photos will show assisted cells on the
text and spoken devices. Treat these as the rule set's opinion, to be
corrected on hardware.

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

## Getting onto the device

**Headsets with a browser** (Quest 3, HoloLens 2, Vision Pro, Rayneo X3
Pro): the QR from the guide menu or the readiness matrix. It carries a
device link (`sib/src/middleware/device-link.ts`): single use, ten minutes,
one guide, minted by the portal user. The content gate redeems it, sets
the access cookie and continues to the page with the person's name as the
operator hint, so nobody types the site key on a headset keyboard and the
session is attributed. The key itself is never in the QR. When SSO comes,
the same link is the shared-device path: HYPR runs on the phone that made
the link, never on the headset.

**Glasses without a browser or camera** (Even G2, Oakley Vanguard): the
text and spoken pages run on the paired phone; the glasses need the
maker's companion app to mirror them and forward ring, trackpad or voice.
That bridge is phone-side work on the maker's SDK and is not built yet;
the matrix marks these columns "open on the phone".

## What it does not need

No new renderer per device: the XR kit already adapts to a browser, and
the text and spoken forms are generated from the step data. No vendor SDK
on the server. No change to the app.

## Order of work

1. Step needs, derived at request time from the step (done; `step.needs`
   override honoured, Designer chips to come).
2. Device profiles as files + readiness join + portal matrix (done).
3. XR kit profile switch (done, first cut): `?profile=<id>` or detected
   from the browser (Quest, HoloLens, Vision Pro). Reduced overlay asks the
   server for the 350 k variant and does not play hose flipbooks (the rest
   tube stands for each hose). Text profile: one step per screen, paged
   with arrow keys, space and R (what a ring or trackpad sends), green
   monochrome for the G2 class. Spoken profile: the same page read aloud
   with the browser's own speech synthesis, "next / back / repeat" by
   voice where the browser offers recognition. The session record carries
   the profile in its work context.
4. The assessment: devices in hand are Meta Quest 3, Rayneo X3 Pro, Even
   Realities G2, Meta Oakley Vanguard, HoloLens 2, Apple Vision Pro. Start
   with Quest 3, Rayneo X3 Pro and Even G2, which cover the three delivery
   forms; correct the profiles and the rules from what holds.
