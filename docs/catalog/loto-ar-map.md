---
id: loto-ar-map
name: AR LOTO map
area: iloto
status: shipped
version: 2026.4.42
depends: [iloto-anchors, loto-event-log]
terms: [LOTO, Energy Isolation Point]
spec: ILOTO.md
wireframe: iloto
---
The panel's electricity flow drawn in AR by tapping vertices along the conduit;
starting a line on a Safe Off marker links it to that breaker, making the map
status-aware — lock the breaker out and its lines go grey and pulse-free live,
restore it and the teal flow pulse returns. Saves are versioned with history.
