---
id: onboarding-ftue
name: Guided onboarding (FTUE)
area: platform
status: shipped
version: baseline
depends: []
terms: [Operator Mode, Author Mode]
spec: APP-FEATURES.md
wireframe: operator
arch: |
  flowchart LR
    FLAGS["AppSettings ftue*Seen flags - per workflow"] --> SHEET["OnboardingSheet - dark paged FTUE, one context per mode"]
    TOUR["GuidedTourManager + CoachMarkOverlay - spotlight steps that drive real navigation"]
    HELP["? button re-opens the sheet contextually - help is never one-shot"]
    SHEET --> ZERO["Goal: Operator Mode needs zero training"]
    TOUR --> ZERO
---
Six per-workflow walkthroughs, a spotlight tour, and contextual ? help throughout the
app. The design goal is that Operator Mode requires zero training — the author's
knowledge arrives through the phone.
