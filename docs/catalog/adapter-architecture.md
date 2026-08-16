---
id: adapter-architecture
name: Adapter architecture
area: platform
status: shipped
version: baseline
depends: []
terms: [Adapter]
spec: technical-architecture.md
---
Anything external — perception models, instruction sources, AI guidance, vision
stacks — is an isolated, swappable module behind a stable interface, and every
adapter ships with a working default. No vendor is ever hard-coded into the platform.
