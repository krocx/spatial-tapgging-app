---
id: gemba
kind: area
name: Gemba Walk
color: "#f59e0b"
order: 2
wireframe: gemba
flow: |
  flowchart LR
    LIB[Audit Reference Library] --> WALK[Start walk: header, continue or join]
    WALK --> RELOC[ARWorldMap relocalizes]
    RELOC --> PIN[Tap surface: pin finding]
    PIN --> TAX[Focus Area → Question or custom · Strength/OFI/NC · risk · photos + markup]
    TAX --> TOG[Colleagues see it live · Live Activity guides phone-down]
    TOG --> SUB[Submit: session summary]
    SUB --> PORTAL[Portal Walk Sessions · 3-sheet Excel with every photo]
    RELOC --> CK[Background / kill → welcome-back checkpoint]
---
Audit rounds without preparation: no QR, no setup — tap any surface to drop a finding
and the space itself remembers where it was. Findings are logged in Corporate
Quality's vocabulary (or honestly as custom text) with category, risk, captioned
photos and markup; walks carry a header and a derived summary; auditors can walk
together; and the portal exports every photo to Excel.
