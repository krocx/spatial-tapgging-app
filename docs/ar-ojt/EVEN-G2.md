# SIB on G2 - work instructions on Even Realities glasses

Proprietary & Confidential · Applied Materials

Status: built 2026-10-02 (`sib/g2-client/`, served at `/g2`; codes and device
tokens in `sib/src/middleware/device-link.ts`). First target of the glasses
assessment (docs/ar-ojt/DEVICE-ADAPTIVE-INSTRUCTIONS.md).

## What the G2 is, for a work instruction

The Even G2 has a 576 x 288 green monochrome display per eye, a touchpad on
each temple, an optional R1 ring, a four-microphone array, and no camera.
Nothing runs on the glasses: an Even Hub app is a web page hosted in a
WebView inside the Even Realities phone app, and the SDK bridge relays
containers to the glasses and input events back over Bluetooth. One
full-screen text container holds roughly 400 to 500 characters and scrolls
in firmware when a page overflows. So the G2 delivers the *text* form of a
step: title, instruction, where on the tool (in words), the parts involved.
No model, no overlay, no image in this cut (288 x 144 greyscale images are
possible later for a step photo).

## How a guide reaches the glasses

1. In the portal, a guide's ⋯ menu → Open on a headset → Even Realities G2.
   The portal mints a **code**: six characters without look-alikes, shown as
   `ABC-123`, ten minutes, single use, one guide, carrying the issuer's name
   as the operator.
2. On the phone paired with the glasses, the technician opens **SIB on G2**
   in the Even Realities app (Even Hub tab), enters the SIB server once and
   the code.
3. `POST /g2/redeem { code }` answers a **device token**: a bearer the
   content gate and the API gate accept for twelve hours, sent as
   `X-Device-Token`, and only for that guide's bundle and steps and the
   session endpoints (`deviceTokenAllows`). The site key never leaves the
   server; a code is useless after one use; the redeem endpoint allows ten
   tries a minute per address.
4. The companion loads the guide bundle and shows step 1 on the glasses.

On the company server (no site key) the same flow runs; the code still
identifies the guide and the operator.

## On the glasses

One page per step:

```
3/12  Fit the O-ring

Slide the O-ring over the shaft until it seats.

Where: left side, upper part
Parts: O RING - SEAL HOUSING
Check: Pass / Fail from the menu       (validation steps only)
```

Input: **press** next, **double press** back, **long press** repeat (the page
from the top), **swipe** scrolls a long page in firmware. **Tap then hold**
raises the contextual menu with the app's items: Pass / Fail on a validation
step, First step, End guide; the system adds Display off, Brightness and
Close. The last page summarises the run and hands over to the phone for
sign-off. Curly quotes, dashes and ellipses are folded to glyphs the
firmware font has (`pages.ts`).

## On the phone

The same page mirrored in green, Next / Back / Repeat, Pass / Fail on a
validation step, glasses battery and wearing state, End guide, then the
sign-off form (name or employee ID). The phone can drive the whole run
without the glasses; outside the Even app the bridge never arrives and the
page says so and carries on phone-only, which is also how it is tested on a
desktop (arrow keys and space step, R repeats).

## What is recorded

Exactly what the XR kit records: a live session (`POST /guide-sessions/live`,
work context `Even G2 · companion`), `step:entered` / `step:completed` events
with durations, `perception:result` for manual Pass / Fail (`client:
even-g2`), and the signed-off completion (`POST /guide-sessions`), so runs
land in Analytics, Intelligence and the per-guide page like any other.

## Developing and testing

Once on the Mac:

```
npm install                                   # adds sib/g2-client to the lockfile - commit package-lock.json
npm install -g @evenrealities/evenhub-cli      # the Even Hub CLI (hub.evenrealities.com/docs)
evenhub login                                  # the developer account
```

In the Even Realities app on the phone: enable Developer Mode (Even Hub tab
→ Scan QR appears). Phone and Mac on the same network without client
isolation (a phone hotspot works).

```
npm run dev --workspace=@spatial/g2-client     # Vite on :5175, all interfaces
evenhub qr --url "http://<mac-ip>:5175"        # scan it from the Even Hub tab
```

Hot reload reaches the glasses. The dev page talks to whichever SIB server
is entered on its connect screen (Render or the company server; both allow
any origin). `app.json` whitelists the Render origin and localhost; add the
company server's origin before packaging a private build.

Simulator, no hardware: `evenhub-simulator http://localhost:5175`.

Ship to the team's own glasses without review: `evenhub pack` →
upload the `.ehpk` in the Even Hub developer portal as a private build.

Production bundle: `npm run build:g2` writes `sib/portal/g2/`; commit it
(the sandbox cannot run Vite). The server serves it at `/g2`.

## What this cut does not do

Images on the glasses; voice (the mic stream is raw PCM, recognition would
be our own code or a service - the touchpad covers next / back for the
assessment); offline bundles (the phone fetches live); the Oakley Vanguard
(spoken steps, its own cut).
