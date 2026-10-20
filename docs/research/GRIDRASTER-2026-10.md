# Market research: GridRaster SPIDER (AROMS-347)

Proprietary & Confidential · Applied Materials. Reviewed 2026-10-19 by the
XR Product Owner with Claude; verdict below. Sources at the end.

## What SPIDER is

GridRaster (Mountain View; engineering in Bengaluru) sells SPIDER as a
spatial intelligence layer whose core is server-side: remote rendering and
tracking that streams full-fidelity CAD into XR without decimation,
registers the CAD model to the physical asset and anchors data onto that
registration. Claims: on-premises or fully disconnected (an "Inspection
Kit" flight case with local compute, isolated network, headset and tablet);
content streamed, never stored on the endpoint; PLM, manuals and labels
ingested to train customer-specific recognition models. 2026 positioning is
Inspection & Maintenance for NDI (eddy-current probe tracked in 6DoF with
coverage verification, tactile 3D sensors, microwave and penetrant
inspection, paint-masking validation). Anchor customers are US Air Force,
Space Force, NAVSEA and NAVAIR programmes (2021 SBIR Phase II for CV-22
nacelle wiring; 2024 STRATFI selection).

## Overlap with SIB

| Capability | SIB | SPIDER | Read |
|---|---|---|---|
| Anchoring a model to the asset | QR, sealed world map, object origin (iPad) | markerless CAD registration, server-side | they lead on markerless registration of large assets |
| Work-instruction authoring and runs | Designer, import, lifecycle, sessions, evidence, usage log | "Active Task Assistance", thinner | SIB leads; this is our product |
| Validating the work done | cone, quick shot, readings, labels | missing-bolt / wiring-route checks against CAD | overlapping, different method |
| Full-fidelity CAD in XR | decimated variant ladder | streamed high-poly | real gap for 2M-triangle chambers on glasses |
| NDI instrument tracking | none | core of their 2026 offer | gap, outside our POC scope |
| Deployment posture | on-prem; Render for the POC | on-prem; disconnected kit | comparable |
| Device classes | iPad, Quest 3 / HoloLens 2 (WebXR), Even G2 | Vision Pro, iOS, Android XR | comparable; no WebXR or display-only glasses claimed |

## Verdict

**Do not invest; do not collaborate on the platform.** SPIDER's value
depends on ingesting our PLM geometry, manuals and labels to train
customer-specific models - the data we do not share, and the perception
layer we are patenting around. The on-prem kit addresses where it runs, not
who holds the training pipeline. Our posture (perception on the device or
our server, nothing leaves) is stricter than theirs and is part of the IP
story.

The two real gaps for us - markerless registration of a chamber from CAD
and high-poly streaming for glasses - belong to the FY27 AR Developer
(Unity client, passthrough camera, world-map reuse), with off-the-shelf
engines that need no data sharing. NDI probe tracking is the one thing we
could not build easily, and it is not on the roadmap: "not now, buy if
asked".

**Prior art to remember:** VisionLib (Visometry / Fraunhofer IGD) was
evaluated in FY25 and found **not suitable for wearables**. Do not propose
it again; registration on glasses needs another route.

## Competitors and reliability

Peers for CAD-to-reality overlay: Visometry (VisionLib / Twyn), Diota
(Dassault ecosystem), Hololight and SkyReal (streaming). Work-instruction
peers: Scope AR, Light Guide Systems, Kognitiv Spark, Sphere. On
reliability: a polished site with recent use-case videos (Sept-Oct 2026),
but a thin independent record - about $8.5M total funding across six rounds
with the last listed in 2020 (Tracxn), no commercial customer announcements
outside defence SBIR / STRATFI in 2025-26, no G2, Glassdoor or analyst
coverage, and an unverified "10x faster at a tenth of the cost" claim. A
capable, small, government-funded engineering firm; commercial depth to be
verified by reference calls.

## Revision 2026-10-21 - after the site review and the Vuforia comparison

Two corrections from gridraster.com (the platform page, read in full):

**The tracking runs on the device.** "Devices can cache CAD models, work
instructions and task data, operate on the shop floor without a live
connection, and sync results later"; camera and 3D-sensor data "is
processed in device memory and isn't stored". The Hub trains and serves -
foundation models fine-tuned on the customer's CAD, scans, manuals and
labels, pushed to the device with the cached CAD - and the real-time loop
(detect, register to the CAD, track, with the device's depth sensor) is
local. Earlier text above saying the tracking is server-side is wrong.
This makes the "5 mm on a moving object" demo plausible for a rigid part at
close range with depth; it says nothing yet about a chamber-scale object at
working distance under cleanroom light, which is the test (protocol below).

**The data-posture objection is largely answered.** The Hub "runs fully
on-premises and can operate air-gapped"; the app ships through the
customer's MDM and holds no technical data. The data does not leave. What
remains is narrower: their pipeline trains on our content, so the questions
are who owns the fine-tuned weights, whether anything about our geometry
informs their foundation models, and whether running our chambers through
their recognition stack bears on the perception IP we are filing. Contract
and IP-counsel questions, not a reason to refuse the conversation.

Unchanged: a small, defence-funded firm (the page adds AWE 2026 Enterprise
XR finalist, Army xTechSearch 9, an NVIDIA partner mark - more than the note
gave, still no commercial customer list); devices are Vision Pro, iOS and
Android XR - no HoloLens 2 or Quest, most of our glasses shortlist; Active
Task Assistance is thinner than our product; NDI tracking outside our scope.

**Against Vuforia.** PTC's engine is an SDK we would build on inside the
Unity client (Model Targets with on-prem generation so CAD stays local,
state-based targets through service steps, Step Check for a camera verdict
on CAD state; HoloLens 2 supported; public pricing; a decade of releases) -
but PTC is retreating from eyewear (Chalk retired 2025-10-31, Vantage for
RealWear ends 2026-12-01 citing declining eyewear adoption) and has nothing
for full-fidelity CAD on glasses. GridRaster is a turnkey platform on
Vision Pro with on-device registration and the streaming gap covered.
Different shapes; the registration question is empirical.

**Revised verdict: do not buy the platform; evaluate the registration
engine.** GridRaster joins the registration bake-off for the FY27 AR
Developer alongside Vuforia (AROMS-363): on-prem trial, a non-sensitive
fixture of chamber scale, nothing retained, the protocol below, scored into
Hardware Fit and AR SDK. The earlier "do not collaborate on the platform"
stands for the platform; it no longer stands for the engine.

### Measurement protocol for the briefing (no data shared)

A known fixture of ours, non-sensitive, of comparable scale to a chamber
lid; five marked points measured by tape or CMM; three conditions on the
device they bring - static at 1 m, carried slowly, carried while the wearer
walks; the pose stream exported so error is computed at the far points,
not the centroid; latency end to end; behaviour when the object leaves the
frame and returns; where the Hub sits for the demo (kit-local or Wi-Fi).
Declining the measurement is itself a finding. The Anchor Lab is the
instrument: every run ends in mm.


### Capabilities to consider, from the AR OMS seat (2026-10-21)

| Capability | For AR OMS | In SIB today | Take / test / pass | Condition |
|---|---|---|---|---|
| Markerless CAD registration of the chamber | Steps land on the equipment with no QR to find, print or keep clean | QR anchor, sealed world map, object origin (iPad) | Test - the headline reason | Working distance on a 2 m object, cleanroom light, moving operator; scored into AR SDK |
| On-device 6DoF tracking with depth | Steps, parts, hints stay glued while operator and part move | ARKit tracking off the anchor; drift check, re-align | Test | Error at the far points; recovery after occlusion |
| Full-fidelity CAD on glasses | A 2M-triangle chamber as modelled, not the decimated ladder | Decimation per device budget | Test - the gap Vuforia does not close | Only if it works offline on their device; else a kit-local server we would run |
| Step validation against CAD state | Camera verdict from the CAD, no trained reference | Cone / quick shot trained per step | Test - could remove the author's training | False-fail rate on the same steps as our cone |
| Tool tracking (6DoF) | "Every bolt torqued, in order" from the tool, not the display | Readings by camera from the display | Pass for now, watch | NDI is their core; FY28 for us |
| Automatic defect detection | Workmanship flagged in-process | Gemba findings are human; readings judge values | Pass | Needs training on our defects |
| Digital twin from scans | A chamber scanned once, twin kept to configuration | Shape model for object anchoring (beta) | Test later | For configurations with no clean CAD |
| Multi-user spatial session | Two people on one chamber | Presence & coaching | Pass - we have it | |
| Devices: Vision Pro, iOS, Android XR | Vision Pro as a glasses pilot | iPad, Quest 3 / HoloLens 2 (WebXR), Even G2 | Gap | No HoloLens 2 or Quest; ask the roadmap |
| On-prem / air-gapped Hub, offline devices | Fits GIS and the cleanroom | SIB on-prem | Comparable | Ours stricter on where models train |
| Fine-tuning on our CAD, manuals, labels | Recognition tuned to our parts | Our own perception, per step | Counsel first | Model ownership, perception-IP contamination |
| Active Task Assistance | - | Designer, lifecycle, sessions, evidence, Intelligence, Insights | Pass | Our product; theirs thinner |

### Questions the demos will not answer

| Area | Ask | Why a demo cannot settle it |
|---|---|---|
| Accuracy | Distance, object size, sensor and ground truth behind "5 mm"; error at the far corners of a 2 m object | 50 cm on a hand-held part looks glued at centimetre error |
| Degradation | 1.5 m, glossy or uniform surface, cleanroom light, gloved hands over half the part; failure mode - drift, jump, or reported loss | Demos are lit, textured, close |
| Recovery | Object out of frame 30 s; device sleeps and wakes - re-acquire time, pose jump | A continuous demo never loses it |
| On the device | Which models run on the headset, size, frame rate, thermal over 40 min on Vision Pro | Demos last five minutes |
| Offline truth | Hub unreachable: what keeps working, what quietly stops | The kit sits beside the demo |
| Training pipeline | What is fine-tuned on our data (detector, refiner, both; synthetic renders or photos); who owns the weights; deletable on exit; anything reaching their foundation models | Nothing in a demo shows what trained on what |
| Model per asset | Hours from new CAD to working registration, theirs and ours; retraining on a variant | Demo assets have months of their work |
| Large CAD on glasses | On-device or streamed; from what, over what, latency, fallback when the link drops | The demo room has their network |
| Validation semantics | Present, pose within tolerance, or both; false-fail rate on an oblique view of a correct part | A demo shows the pass |
| Devices | HoloLens 2 / Quest 3 on the roadmap; Android XR hardware; Vision Pro enterprise entitlements | Demos are on their best device |
| Integration | API / SDK for an external app to request pose and verdict, or must we live inside their app | Demos run inside their app |
| Security | FIPS on which components; MDM; telemetry; Hub as container we run or appliance they ship | "On-prem" covers many shapes |
| Commercial | Non-defence production customers; licensing per device / Hub / asset; support for a Hub on our site | Awards and SBIRs are not customers |

## Next step (AROMS-348)

A technical briefing with GridRaster, **without sharing data**: how they do
markerless CAD registration and full-fidelity streaming; a Vision Pro demo;
their view of WebXR and display-only glasses. Learnings go into this file;
actions are decided after the briefing.

## Sources

- https://gridraster.com/spatial-computing-platform/
- https://gridraster.com/inspection-maintenance/
- https://www.aero-nextgen.com/vendors/gridraster/
- https://tracxn.com/d/companies/gridraster/__g3ZNZGH_NCflrM0FeSWAVEEFdCHAnXAEucDdkPnUlas
- https://www.businesswire.com/news/home/20210921005358/en/ (USAF SBIR Phase II, CV-22 wiring)
- https://www.auganix.org/?p=15891 (STRATFI selection, 2024)
- https://www.cbinsights.com/company/gridraster/alternatives-competitors
- https://igd.fraunhofer.de/en/press/news/stable-tracking-industrial-ar-solutions-visionlib
