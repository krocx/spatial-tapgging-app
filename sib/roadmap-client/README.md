# roadmap-client — SIB Roadmap Mind-Mapper (frontend source)

React 18 + TypeScript + Vite + Zustand. Compiles to a static bundle in `../roadmap/`, which the SIB server serves at **`/roadmap`** (same pattern as `../portal`). No canvas library, no CSS framework, no external calls — ~55 kB gzipped.

Full documentation (architecture, API, interactions, deployment): **`docs/roadmap-mindmapper.md`** at the repo root.

```bash
npm run dev:roadmap      # from repo root — dev server on :5174, proxies /mindmap + /config to SIB on :3001
npm run build:roadmap    # typecheck + build → sib/roadmap/ (commit the output; the server needs no build step)
```

Layout: business logic lives in `src/state/store.ts` (Zustand) and pure `src/utils/*`; `src/canvas/*` is the SVG interaction layer; `src/components/*` is chrome (toolbar, map list, versions). Types come from `@spatial/shared` (`shared/src/mindmap.ts`) — never redefine them here.
