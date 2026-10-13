---
id: fit
name: Fit for the cleanroom
asOf: 2026-07
restricted: true
signal: |
  Enterprise AR hardware is retreating exactly when semiconductor scaling needs it most. Every enterprise headset maker has now exited: Microsoft discontinued HoloLens 2 (support ends December 2027, no successor); Meta discontinued Quest Pro and is winding down its business programme; Magic Leap exited first-party headsets in 2026 and pivoted to supplying waveguides. Apple and the new wave (Ray-Ban Display, Android XR) are consumer-first. No enterprise optical-AR headset remains in production, and the last enterprise player moved to the optics layer. That vacuum is Applied's opportunity: SENZ™, Applied Materials' integrated visual system for smart glasses, can define the enterprise-ready optics the market abandoned, if we test in-house, early, on our own floor.
means: |
  Buy nothing at scale today. No shipping device meets see-through, anchoring, wearability, offline and manageability at once; capital spent on current-generation fleets would be stranded, as HoloLens owners are discovering.
  Keep the POCs hardware-agnostic. With no enterprise optical-AR headset in production, prove the workflows on accessible devices (RayNeo for glasses ergonomics, iPad and ARKit for spatial validation) so our software is ready for whichever hardware wins.
  Fill the gap from inside. The value has shifted to the optics layer, which Magic Leap's waveguide pivot and its Google partnership confirm. The requirements no vendor is prioritising are precisely what SENZ™ can design in; early internal access turns our cleanroom into the proving ground that defines, and demonstrates, enterprise-ready AR before competitors' waveguides do.
bottom: The market will not hand us enterprise-ready AR glasses. The only path to hardware that survives a semiconductor cleanroom is to shape it ourselves, starting with early access to SENZ™ devices.
categories: |
  nodisplay-ai | No display | AI glasses + camera | Ray-Ban Meta, Oakley Vanguard | Audio assist + evidence | watch
  mono-ai | Monocular | AI glasses + camera | Ray-Ban Display | Glanceable assist | watch
  mono-nocam-teth | Monocular | no camera, tethered | viewer HUD | Reference display | no
  mono-nocam-free | Monocular | no camera, untethered | standalone HUD | Reference display | no
  mono-cam-teth | Monocular | camera, tethered | Vuzix M400C-class | Document viewer | no
  mono-cam-free | Monocular | camera, untethered | Vuzix, RealWear | Interim workhorse | interim
  bino-nocam | Binocular | no camera, no SLAM | XREAL Air-class | Reference display | no
  bino-cam | Binocular | camera, no SLAM | RayNeo X3 Pro | POC client today | poc
  bino-slam | Binocular | camera + SLAM | HoloLens-class, SENZ™ | AR OMS target | target
capabilities: |
  2D instructions in view | NO | PART | PART | PART | PART | YES | YES | YES | YES
  AR overlays on equipment | NO | NO | NO | NO | NO | NO | NO | PART | YES
  Voice commands, hands-free | YES | YES | PART | PART | PART | YES | PART | YES | YES
  Photo and video evidence capture | YES | YES | NO | NO | YES | YES | NO | YES | YES
  Remote expert, see what I see | YES | YES | NO | NO | YES | YES | NO | YES | YES
  Persistent spatial anchors, 6DoF | NO | NO | NO | NO | NO | NO | NO | PART | YES
  In-context pass / fail validation | PART | PART | NO | NO | PART | PART | NO | PART | YES
  Spatial audit trail, 3D records | NO | NO | NO | NO | NO | NO | NO | PART | YES
devices: |
  rayneo-x3-pro | RayNeo X3 Pro | consumer AR glasses | poc | POC and demo client
  hololens-2 | HoloLens 2 | enterprise MR, discontinued | reference | Reference only (end of life)
  vision-pro | Vision Pro (M5) | passthrough spatial computer | training | Training and design reviews
  quest-3 | Quest Pro / 3 | passthrough VR, discontinued | no | Not viable
  xreal-one-pro | XREAL One Pro | consumer display glasses | no | Not viable
  magic-leap-2 | Magic Leap 2 | enterprise AR, exited 2026 | reference | Reference only (end of life)
requirements: |
  Optical see-through (floor safety, situational awareness) | YES: true waveguide | YES: waveguide | NO: camera passthrough | NO: camera passthrough | YES: see-through | YES: waveguide + dimming
  6DoF SLAM and persistent spatial anchors (the core of AR OMS) | NO: none on device | YES: proven anchors | YES: excellent, closed | YES: good, cloud-tied | NO: display-oriented | YES: proven anchors
  Full-shift wearability (weight, battery, garments) | PART: light; 8 h unproven | PART: 566 g, 2-3 h | NO: about 800 g, tethered, 2.5-3 h | NO: VR form factor | PART: light but tethered | PART: 260 g + hip puck
  Offline or air-gapped cleanroom operation | NO: cloud voice | YES: on-prem capable | PART: young for headsets | NO: account and cloud tied | PART: host-dependent | YES: regulated-environment design
  Enterprise MDM, security and fleet provisioning | NO: consumer stack | YES: Intune era | PART: ABM and MDM early | NO: business programme ends 2026 | NO: consumer stack | YES: enterprise management
  SDK depth for SIB (camera, sensor, perception access) | PART: web APIs only | YES: research mode | PART: licensed camera API | PART: late camera API | PART: limited SDK | YES: open perception APIs
  Display legibility for dense instructions in cleanroom lighting | PART: consumer brightness | PART: ageing optics, small field of view | YES: via passthrough | PART: passthrough grain | PART: media-tuned | YES: 2,000 nits + dimming
  Vendor commitment to enterprise AR (roadmap risk) | PART: consumer roadmap | NO: end of life, support ends 2027 | PART: consumer-first | NO: exited enterprise | PART: consumer momentum | NO: exited headsets 2026
reads: |
  hololens-2 | HoloLens 2 (Microsoft) | The only device ever built for exactly our use-case: see-through, anchored, managed enterprise MR. | Production ended October 2024; support ends 31 December 2027; no successor. Proves the demand is real, and that the market abandoned it. Anything built on it is stranded. Its capability list is the benchmark the next generation must beat.
  vision-pro | Apple Vision Pro (M5) | Consumer-first passthrough spatial computer; best-in-class displays and hand tracking; tethered battery. | Excellent for training content, design reviews and stakeholder demos. Not floor hardware: passthrough rather than see-through, about 800 g, 2.5-3 h battery, restricted camera access. Watch Apple's enterprise APIs, but Apple optimises for consumers, not cleanrooms.
  quest-3 | Meta Quest Pro / Quest 3 | Passthrough VR pivoted to consumer gaming and social; Quest Pro discontinued January 2025. | Meta ended Quest for Business (hardware sales ended February 2026; platform winds down by 2030). The biggest XR vendor has left enterprise. Not a candidate.
  xreal-one-pro | XREAL One Pro | Consumer display glasses: virtual monitors and media; light, affordable, tethered. | A strong optics-per-dollar story, but no persistent spatial anchoring and no enterprise stack. Useful to track for waveguide cost curves; not for AR OMS.
  magic-leap-2 | Magic Leap 2 | Was the last enterprise optical-AR headset in production: strong optics (segmented dimming), open perception APIs, regulated-environment focus. | Exited first-party headsets in 2026 and pivoted to supplying waveguides, including reference designs with Google for Android XR. Two lessons: the enterprise headset vacuum is now total, and the strategic value has moved to the optics layer, where SENZ™ competes. A direct waveguide comparable, which raises the urgency of proving SENZ™ in real operations first.
  realwear | RealWear / Vuzix (assisted reality) | Rugged monocular and simple displays for remote assist, checklists and documentation; deployable today (MDM, ATEX options). | Covers interim voice-guided use-cases and remote expert calls, but no spatial anchoring means no validate-as-you-do. A stopgap lane, not the destination.
  consumer-wave | The consumer wave (Meta Ray-Ban Display, Samsung Galaxy XR, Android XR) | The industry's investment is flowing to consumer smart glasses and passthrough headsets. | The next hardware generation will be consumer-first by default. Enterprise requirements, ours, will only be designed in if someone feeds them to the optics makers early. That someone is us, through SENZ™.
sources: Microsoft, Meta, Apple and Magic Leap public announcements (2024-2026); Road to VR; UploadVR; Apple and Magic Leap newsrooms; device assessments from the XR team's POC criteria.
---
Fit for the cleanroom: what each device category can and cannot do for AR
work instructions, and how the shipping devices score against our enterprise
cleanroom requirements. Read by `/devices/fit`, which opens only with the IP
key. Capability of the category, not of any single product; assessments
reflect our POC criteria, not vendor marketing.

Format: `categories` rows are `id | eye | kind | examples | role | lane`
(lane: no · watch · interim · poc · target). `capabilities` rows are
`name | one cell per category` with YES / PART / NO. `devices` rows are
`id | name | segment | fit | verdict` (fit: poc · reference · training · no).
`requirements` rows are `name | one cell per device`, each `VERDICT: reason`.
`reads` rows are `id | device | designed for | strategic read`. `means` is
one conclusion per line. SENZ™ is Applied Materials' publicly announced
integrated visual system for smart glasses
(appliedmaterials.com/senz); always written with the ™.
