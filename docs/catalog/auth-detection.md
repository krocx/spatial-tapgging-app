---
id: auth-detection
name: Auth auto-detection
area: portal
status: shipped
version: baseline
depends: []
terms: [SIB]
spec: SERVER-REFERENCE.md
---
The portal asks /config whether the server enforces an API key and only prompts when
it does. Local development stays frictionless; production stays locked — one
codebase, no build flags.
