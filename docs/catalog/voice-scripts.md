---
id: voice-scripts
name: Voice scripts (TTS)
area: guides
status: shipped
version: baseline
depends: [spatial-steps]
terms: [AR Work Instructions]
spec: ../README.md#ar-work-instructions-ar-oms
wireframe: arguides
arch: |
  flowchart LR
    AUTH["voiceScript authored on step - editor or Designer Inspector"] --> GS["GuideStep.voiceScript"]
    GS --> IOS["iOS: AVSpeechSynthesizer reads it on step entry"]
    GS --> PREV["Designer Preview: browser speechSynthesis"]
    IOS --> HF["Hands and eyes stay on the work"]
---
An optional per-step spoken instruction, read aloud when the operator reaches the
step — hands and eyes stay on the work. Authored in the step form or on the
Procedure Designer canvas, previewed with browser speech synthesis.
