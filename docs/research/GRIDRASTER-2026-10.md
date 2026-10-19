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
