# Server-side model variants (Phase B) - prerequisites

Proprietary & Confidential · Applied Materials

Status: **approved 2026-09-28** (ladder 2.5 M / 1.2 M / 700 k / 350 k) · **built end to end** (`sib/src/import/jobs.ts` + `worker.ts`, `sib/src/memory.ts`, `sib/src/models/glb-geometry.ts` + `variants.ts` + `reduce-clustering.ts`, `?budget=` on `GET /models/:id/file.glb`, `POST /models/:id/variants`, app `AssemblyModelCache` budget path). Verified over HTTP with the Bee publication: import 4.2 s including the ladder, 700 k request → 6.9 MB variant.

## Why

Today every device fits the assembly to its own memory at open time
(`GLBLoader`, phase A): download the full GLB once, count triangles, pick a
budget from physical memory, reduce if over budget. It works (Bee drone: 2.1 M
to 390 k triangles in 1.6 s on an iPhone) but it costs three things on every
open of a large guide: ~1.5 s of CPU, the full-size download on first use
(23 MB for the Bee), and a peak of source + reduced geometry in memory while
building. Phase B moves the reduction to the server, once per model, so the
device downloads a file that already fits and builds it directly.

## What the server has to do

Reduce once at import, store the results next to the full model, and let a
client ask for the size it wants.

1. **Reduce at import.** After `writeGlb` in the Cortona importer (and after
   any future GLB upload), produce fixed-size variants of the same model.
   Approved ladder, matching the device tiers the app already uses:
   `full` (as imported), `2500k`, `1200k`, `700k`, `350k` triangles. A variant is only
   written when the source is larger than its budget; a 90 k model has only
   `full`.
2. **Same algorithm as the device.** Port `GLBLoader.decimate` (vertex
   clustering on a per-part grid, budget spread across parts in proportion to
   their triangle count) to TypeScript. Same input, same output, so the
   operator sees the same geometry whether the server or the phone reduced
   it, and the phone's own reduction stays as the fallback for models
   imported before Phase B.
3. **Preserve what the guide depends on.** Node hierarchy, `cmp:<DEF>` names,
   `extras` (objectID, part number, description, visible), materials and
   transforms are copied through untouched. Only mesh positions and indices
   change. Steps address parts by name; a variant that renames or merges
   parts breaks every step.
4. **Store and serve.** `MODELS_DIR/<id>.glb` stays the full model.
   Variants live at `MODELS_DIR/<id>.<budget>.glb`. `Model3D` gains
   `variants: { budget: number; triangles: number; bytes: number; algorithm: string }[]`
   (the algorithm name + version, so a reducer change re-derives variants and
   a record says which geometry an operator saw).
   `GET /models/:id/file.glb?budget=700000` returns the smallest variant
   whose budget is at or above the request, or `full` when none is smaller
   than the source. No query string keeps today's behaviour exactly.
5. **Client asks, then trusts.** `AssemblyModelCache.glb` sends the device
   budget from `GLBLoadOptions.forThisDevice()`. If the server returns a
   variant at or under budget, `GLBLoader` skips the census and reduction
   (the header `X-SIB-Model-Triangles` tells it). Older servers ignore the
   query and the device reduces as today. Cache key on device becomes
   `<modelId>.<budget>.glb`.
6. **Re-run on demand.** `POST /models/:id/variants` rebuilds the ladder (a
   model imported before Phase B, or a changed ladder). Admin only.

## Prerequisites, in order

| # | Prerequisite | Why it comes first | GPU? |
|---|---|---|---|
| 1 | **Import runs off the request thread.** Cortona import is already the heaviest thing the server does (490 MB peak for the Bee after the streaming tokenizer). Adding reduction on top, inline in the HTTP request, will hit Render's 512 MB and stall the company server for tens of seconds. Move import + reduction to a `worker_threads` worker with a queue of one, and return `202 { status: 'processing' }` as the model store already supports. | Everything else sits on this worker. | No |
| 2 | **Memory guard covers the variants.** `memoryLimitBytes()` currently refuses imports needing ~9x file size + 60 MB. Reduction needs source positions + indices + one variant at a time; budget it explicitly and write each variant to disk before starting the next, so the peak is source + one variant, never source + ladder. | Render would OOM otherwise. | No |
| 3 | **A GLB reader on the server.** We only have a writer. Variants must be built from the stored GLB, not only at Cortona import, or models imported earlier and any future direct GLB uploads never get variants. Small: parse the JSON chunk, walk meshes, read POSITION and index accessors (float32 / uint16 / uint32). Own code, no library, same rule as the app. | Needed by #4 and #6. | No |
| 4 | **The decimator in TypeScript, with a fixture test.** Port `decimate(positions:indices:keep:)` line for line. Test: reduce the Bee drone sample to 700 k on the server and on the device build, compare part count, names, bounds per part, triangle count within 1 %. The app's summary line (`parts=719 meshes=183 tris=389641`) is the reference. | Correctness before storage. | No |
| 5 | **Disk headroom.** Variants are smaller than the source but there are up to three of them; the Bee adds roughly 40 % on top of its 23 MB. Models are never deleted with guides today (open note), so add the variant sizes to the model record and to the Admin disk figures, and delete variants together with the model. | Ops visibility. | No |
| 6 | **Shared type + client change.** `Model3D.variants` in `shared/`, the `?budget=` query on the GLB route, the `X-SIB-Model-Triangles` header, and the `AssemblyModelCache` / `GLBLoader` skip path in the app. Ship server first; the old app keeps working. | Last, and only once #1 to #5 are green. | No |

## What is parked (needs a GPU or is not worth it now)

- **Texture baking / normal maps** to make a 350 k model look like the full
  one. GPU work, and our models are untextured CAD colours - no benefit.
- **Draco / meshopt compression.** Smaller downloads, but decoding on the
  device is a third-party library. Against the platform rule; not needed at
  23 MB on Wi-Fi.
- **Per-step detail (Phase C)** - full detail only for the parts a step
  touches. Server side this is a cheap extension of the same worker (one
  more variant per step group), but the app needs to swap geometry per step
  and that is a runtime change. Plan after Phase B is measured.
- **LOD switching by distance.** SceneKit can do it, but the operator stands
  at one distance from a chamber; not our problem.

## Estimate

Server (#1 to #5): about three working days including the fixture test and
the memory profiling on Render. Client (#6): half a day. No new dependencies,
no GPU, runs on the company Windows server under nssm as today.

## Decision needed

- Approve the ladder (`1200k`, `700k`, `350k`) or name different budgets.
- Approve `worker_threads` for import (prerequisite #1). This changes the
  import endpoint from synchronous to `202 + poll`, which the portal upload
  page already handles for USDZ conversion.

## Measured (2026-09-28, Bee drone publication, 45 MB .htm)

Server import 3.7 s → 23.2 MB GLB, 719 nodes, 190 primitives, 1,329,208
unique triangles, 2,131,258 drawn (instances counted once per reference -
the same census the device logs). Ladder built in 0.3 s:

| Budget | Drawn triangles | Unique triangles | Primitives | File |
|---|---|---|---|---|
| full | 2,131,258 | 1,329,208 | 190 | 23.2 MB |
| 1.2 M | 991,123 | 534,218 | 184 | 9.4 MB |
| 700 k | 651,097 | **389,641** | **183** | 6.9 MB |
| 350 k | 309,444 | 186,759 | 180 | 3.3 MB |

(Measured before hose sweeps were rebuilt; with the 47 tubes the census is
2,160,884 and the 700 k variant is 389,090 unique triangles in 231
primitives - the parity test carries the current numbers.)

The 700 k row is exactly what the iPhone built for itself
(`[GLBLoader] parts=719 meshes=183 tris=389641`), so the parity test in
`sib/test/reduce-clustering.test.ts` asserts those two numbers. The test
runs when the publication is at `sib/test/fixtures/bee.htm` (git-ignored)
or `SIB_BEE_HTM` points at it; otherwise it is skipped, never failed.

The variant pipeline reads the stored GLB, not the Cortona bundle, so it is
the same for every source the importer accepts (single-file `.htm`,
multi-file publication zipped, a GLB uploaded directly) and for any future
importer. What a new publication can change is the importer's input; the
variant ladder never sees it.

## Memory on Render (512 MB)

The import guard refuses the Bee publication on Render: a 43 MB `.htm`
peaks at ~700 MB resident (parse in the worker, hose sweeps, ladder), and a
512 MB container keeps 160 MB for the API. That is the guard doing its
job - before it, the same import took the whole Render service down. The
numbers are measured, not conservative: `importNeedBytes` is 16x the file
plus 60 MB. Publications of this size are imported on the company server
(no limit) or on a Render instance of 1 GB or more; Render's free tier
stays the portal and demo host. Smaller publications (the Motorcycle at
22 MB scene, the Axle at 12 MB) fit.
