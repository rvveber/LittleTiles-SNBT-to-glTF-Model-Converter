# LittleTiles Import to Standalone glTF: Context Map

## Purpose
This document is a source-backed context map for re-implementing and extending `tools/lt-import-gltf-poc`.

It focuses on:
- where LittleTiles import data comes from,
- how it is parsed and normalized,
- which rendering/culling rules define visible geometry,
- which parts are intentionally approximated in standalone,
- where parity tooling lives.

It is not a milestone log.

## Project Scope And Fixed Decisions
Authoritative project target in this repo:
- standalone viewer parity for:
  - tile grouping,
  - geometry,
  - colors,
  - transparency,
  - textures.

Priority:
- geometry parity first,
- then color/transparency/texture parity.

Out of scope:
- structure animations/timelines and structure-driven `extraRendering`.
- texture frame animation clip export from converter output (`KHR_texture_transform`, `KHR_animation_pointer`).

Confirmed constraints and permissions:
1. Outside-neighbor policy in standalone is always air.
2. Standalone block-behavior/material mapping is allowed and expected to evolve.
3. Mod-side debug exporter extension is allowed and expected for parity verification.
4. Behavior should remain source-backed to LittleTiles/CreativeCore code in this repo.
5. Main LittleTiles mod logic should not be changed directly; use companion addon.
6. Converter must not depend on exported texture files or output-directory side artifacts at convert time.
7. Texture URI derivation must come from SNBT block/material identity only (plus deterministic alias mapping).

## Repository Map
- `subrepos/LittleTiles` upstream mod code (primary behavior source)
- `subrepos/CreativeCore` upstream math/geometry helpers used by LittleTiles
- `tools/lt-import-gltf-poc` standalone parser/culler/gltf writer and parity checker
- `addons/littletiles-parity-exporter` companion addon for mod-side debug exports
- `fixtures/inputs` local input corpus
- `fixtures/outputs` local generated outputs (typically gitignored)
- `docs/lt-import-to-gltf-code-map.md` this context document

## Import Entry Points In Upstream Mod
Command/UI registration:
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/LittleTiles.java`
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/LittleTilesGuiRegistry.java`

Import parse flow:
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/common/gui/premade/GuiImport.java`
  - SNBT text parsed via `TagParser.parseTag(...)`
  - legacy detection/conversion through `OldLittleTilesDataParser`
  - structural validation via `LittleGroup.load(...)`

Export text shape (what users copy) is SNBT:
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/client/export/LittleExportType.java`

Implication:
- `/lt import` payloads are SNBT, not JSON.

## Data Model: Parsing-Relevant Source Contracts

### Current schema (`LittleGroup`)
Core keys are defined in:
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/common/block/little/tile/group/LittleGroup.java`

Important keys:
- `t` tiles compound
- `c` child groups
- `e` extension groups
- `s` structure tag
- optional cache metadata (`min`, `size`, `tiles`, `boxes`)

Load behavior:
- recursively reads `c`/`e`,
- resolves group grid via `LittleGrid.get(...)`,
- loads tile payload from `t` through `LittleCollection.load(...)`.

### Tile payload encoding (`t`)
Decoded in:
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/common/block/little/tile/collection/LittleCollection.java`

Structure:
- map of `blockStateString -> list<int[]>`.

Critical rule:
- `int[]` length `1` is a color marker for subsequent box entries.
- `int[]` length `>= 6` is box data.

Reimplementation implication:
- preserve marker boundaries as tile grouping boundaries,
- color value can be ignored in geometry-only stages, but marker segmentation must be preserved.

### Box encoding (`LittleBox.create` compatibility)
Primary source:
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/common/math/box/LittleBox.java`

Required compatibility:
- length `6`: AABB `[minX,minY,minZ,maxX,maxY,maxZ]`
- identifier at index `6`:
  - `< 0` => transformable (`LittleTransformableBox`)
- legacy fallback:
  - array length `7` or `11` accepted as plain AABB (old slices compatibility)

### Transformable payload specifics
Primary sources:
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/common/math/box/LittleTransformableBox.java`
- `subrepos/CreativeCore/src/main/java/team/creative/creativecore/common/util/math/box/BoxCorner.java`
- `subrepos/CreativeCore/src/main/java/team/creative/creativecore/common/util/math/base/Facing.java`

Details that matter for decode parity:
- packed signed 16-bit deltas in int storage (`setData`/`getData` logic)
- corner order `EUN,EUS,EDN,EDS,WUN,WUS,WDN,WDS`
- per-corner bit triplets control x/y/z delta presence
- flip bits indexed by `Facing` ordinal order
- serialized payload is AABB followed by transform data (`getArray`/`getArrayExtended`)

### Grid and world-unit conversion
Primary source:
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/common/grid/LittleGrid.java`

Rules:
- grid key is `grid`
- missing grid falls back to default grid behavior
- world units use `coord / grid.count`
- coordinates are not constrained to a single block range

### Legacy schema support
Primary source:
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/common/convertion/OldLittleTilesDataParser.java`

Detection:
- old format when `tiles` is a list.

Conversion contract:
- `convert(...)` returns normalized current schema via `LittleGroup.save(load(nbt))`.

Standalone compatibility requirement:
- either implement both schemas directly,
- or detect legacy and normalize first (mod-like behavior).

## Rendering/Culling Behavior That Drives Geometry Parity

### High-level render pipeline in mod
Stage 1 (visibility state):
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/client/render/block/BERenderManager.java`
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/common/math/face/LittleServerFace.java`

Stage 2 (quad emission):
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/client/render/cache/build/RenderingThread.java`
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/client/render/cache/pipeline/LittleRenderPipelineForge.java`

Standalone glTF does not need MC buffer internals, but stage 1 rules define what is visible and therefore what geometry must be emitted.

### Face fill semantics (parity-critical)
Core sources:
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/common/math/box/LittleBox.java` (`fill`)
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/common/block/little/tile/LittleTile.java` (`fillFace`)
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/common/math/face/LittleFace.java`
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/common/math/face/LittleServerFace.java`

Key behavior:
- culling is not just binary face-touching.
- each candidate tile can:
  - fully cover,
  - partially cover,
  - leave face uncovered.
- `LittleTile.fillFace(...)` skips the source box and transforms coordinates to the working face grid.
- `LittleBox.fill(...)` branches to advanced cutters (`fillAdvanced`) when face is not solid and cutting is supported.

Difference to remember:
- `LittleFace.supportsCutting()` is true (client path)
- `LittleServerFace.supportsCutting()` is false (server face-state path)

### Tile eligibility gates during culling
Primary sources:
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/common/block/little/tile/LittleTile.java`
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/common/block/little/registry/LittleMCBlock.java`

Relevant methods:
- `doesProvideSolidFace()`
- `canBeRenderCombined(...)`

These gates decide whether another tile is allowed to occlude/cut candidate faces.

### Structure attributes affecting occlusion
Primary sources:
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/common/structure/attribute/LittleStructureAttribute.java`
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/common/structure/registry/LittleStructureRegistry.java`

Known implemented path in standalone:
- `noclip` mapped to `noCollision` behavior, excluded as occluder.

### Outside-face and neighbour behavior
Primary source:
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/common/math/face/LittleServerFace.java`

In-game path includes neighbor block checks.
Standalone contract in this repo:
- always treat neighbor as air.

### Transformable rendering/cutting complexity
Primary sources:
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/common/math/box/LittleTransformableBox.java`
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/client/render/tile/LittleRenderBoxTransformable.java`
- `subrepos/CreativeCore/src/main/java/team/creative/creativecore/common/util/math/box/BoxFace.java`
- `subrepos/CreativeCore/src/main/java/team/creative/creativecore/common/util/math/base/Facing.java`

Complicated parts to preserve:
- axis strips plus tilted strips
- cache-driven face generation
- concave dual-plane cutting (`intersect2d`/`cut2d` style behavior)
- render-face assignment by nearest facing from plane normal
- conditional face emission (axis only, tilted only, or both)

Client/server semantic split to remember:
- client rendering can emit transformable tilted strips even when axis strips are empty:
  - `subrepos/LittleTiles/src/main/java/team/creative/littletiles/client/render/tile/LittleRenderBoxTransformable.java` (`shouldRenderFace`, `getRenderQuads`)
- server face-state path may classify the same facing as unloaded when no axis strips exist:
  - `subrepos/LittleTiles/src/main/java/team/creative/littletiles/common/math/box/LittleTransformableBox.java` (`set(LittleServerFace, ...)` returns false if `axisStrips` is empty)
  - `subrepos/LittleTiles/src/main/java/team/creative/littletiles/common/math/face/LittleServerFace.java` (`calculate()` -> `UNLOADED` for invalid face)

Implication:
- tilted-only transformable faces are not synthetic/add-on geometry in viewer mode; they are client-visible geometry that server face-state semantics cannot represent directly.

### Structure-driven extra rendering
Primary sources:
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/client/render/block/BERenderManager.java`
- `subrepos/LittleTiles/src/main/java/team/creative/littletiles/common/structure/LittleStructure.java`

Some structure types add `extraRendering` boxes not present in raw tile box data.
Current standalone converter scope ignores this.

## Standalone POC Code Map

### Parser
- `tools/lt-import-gltf-poc/src/lt-import-parser.mjs`
- `tools/lt-import-gltf-poc/src/snbt-parser.mjs`

Responsibilities:
- SNBT sanitize + parse boundary (`parseSnbtToObject`)
- legacy/current schema detection
- recursive group parse
- tile grouping preservation from color markers
- `LittleBox.create`-compatible box decoding
- transformable payload decode to `transformData`
- structure ID propagation
- flatten helpers (`tiles`, `boxes`)
- parser DI hook for parser-implementation parity checks (`parseLtImportSnbt(..., { parseSnbtToObject })`)

Parser-focused regression tests:
- `tools/lt-import-gltf-poc/test/parser-fixture-conformance.test.mjs`
- `tools/lt-import-gltf-poc/test/parser-edge-cases.test.mjs`
- `tools/lt-import-gltf-poc/test/parser-differential-parity.test.mjs`

### Geometry and culling
- `tools/lt-import-gltf-poc/src/gltf-writer.mjs`
- `tools/lt-import-gltf-poc/src/gltf-writer/tile-normalization.mjs`
- `tools/lt-import-gltf-poc/src/gltf-writer/face-candidates.mjs`
- `tools/lt-import-gltf-poc/src/gltf-writer/occluder-ops.mjs`
- `tools/lt-import-gltf-poc/src/gltf-writer/mesh-assembly.mjs`
- `tools/lt-import-gltf-poc/src/gltf-writer/material-resolver.mjs`
- `tools/lt-import-gltf-poc/src/gltf-writer/debug-stats.mjs`
- `tools/lt-import-gltf-poc/src/gltf-writer/runtime-face-behavior-profile.mjs`

Responsibilities:
- normalize tiles for render decisions
- standalone block behavior inference + override hook
- face candidate generation for AABB and transformable boxes
- inside/outside visibility decisions
- face-state candidate evaluation aligned with `LittleServerFace` semantics
- occluder application and cutting
- per-face debug summary helpers
- color/transparency material resolution
- deterministic texture URI derivation from block/material identity in SNBT
- glTF mesh primitive assembly grouped by resolved material key
- runtime face behavior profile for game-observed behavior deltas only

Current standalone assumptions exposed in code:
- static external neighbor hook returns no blocking neighbor
- source-backed translucency/cull inference with override support
- source-backed `noclip` structure no-collision mapping
- outside face-state policy defaults to air-neighbour parity (`outsideNeighborPolicy = "air"`)
- geometry output mode defaults to `client` for viewer-facing conversion
- `server` geometry mode remains available for parity checks against exporter `faceStates`
- `client` geometry mode currently aligns to client-visible transformable face semantics without invoking the full in-game client renderer pipeline.
- post-process mesh cleanup is opt-in (`--optimize`) so parity-focused client exports are not modified by default.

### CLI
- `tools/lt-import-gltf-poc/src/cli.mjs`

Output contract:
- `.gltf + .bin`
- Y-up
- `1 block = 1.0`

### Parity checker
- `tools/lt-import-gltf-poc/src/parity-debug-check.mjs`
- `tools/lt-import-gltf-poc/src/parity/check-file.mjs`
- `tools/lt-import-gltf-poc/src/parity/candidate-diff.mjs`
- `tools/lt-import-gltf-poc/src/parity/schema-tree-compare.mjs`
- `tools/lt-import-gltf-poc/src/parity/face-state-summary.mjs`
- `tools/lt-import-gltf-poc/src/parity/io.mjs`
- `tools/lt-import-gltf-poc/src/parity/reporting.mjs`

Checks currently implemented:
- raw schema parity (`debug.schema` vs standalone parse of `inputPath`)
- normalized parse parity (`debug.normalizedSnbt` tree/stats)
- canonical recursive group/tile/box comparators
- cull snapshot collection for raw and normalized parses
- optional candidate-level assertions when `faceStates` are present in debug JSON
- `outsideNeighborPolicy` contract assertion (`air`)
- optional `faceStateSummary` assertions when top-level summary is present
- optional `--require-face-states` enforcement to fail fixtures missing `faceStates`/`faceStateSummary`
- parity checker geometry mode defaults to fixture `geometryMode` when present, with fallback to `server` for legacy fixtures
- per-file fatal error isolation (continues processing remaining fixtures)
- optional machine-readable `--json` output for CI/reporting
- surfaces exporter runtime metadata (Minecraft/LittleTiles/CreativeCore/exporter versions) when present

## Companion Addon Context (`littletiles-parity-exporter`)

Location:
- `addons/littletiles-parity-exporter`

Command contract:
- `/lt-debug-export "<input_folder>" "<output_folder>" [client|server]`
- `/lt-texture-export "<input_folder>" "<output_folder>"`

Implementation entry:
- `addons/littletiles-parity-exporter/src/main/java/dev/rvveber/littletiles/parityexporter/LtDebugExportCommand.java`
- `addons/littletiles-parity-exporter/src/main/java/dev/rvveber/littletiles/parityexporter/LtTextureExportCommand.java`

Behavior:
1. resolves input/output directories,
2. processes all regular files in input directory (sorted),
3. parses SNBT,
4. detects legacy and normalizes via `OldLittleTilesDataParser.convert(...)`,
5. loads with `LittleGroup.load(...)`,
6. writes one `<basename>.json` report per input,
7. always includes `outsideNeighborPolicy = "air"`,
8. includes per-box `faceStates` and top-level `faceStateSummary`,
9. default `geometryMode` is `client` (optional command arg allows `server`).
10. in `client` mode, transformable tilted-only facings are exported as renderable candidates (matching client-visible geometry semantics).
11. client tilted-only renderability should be keyed from `tiltedRenderCount > 0` (render-facing assignment), not from raw `hasTiltedStrip`.

`faceStates` payload includes:
- facing and `LittleFaceState`
- `outside`, `coveredFully`, `partially`, `renderable`
- reason tags
- tile eligibility/skipped counters used during face evaluation
- optional transformable cache diagnostics (when box is transformable):
  - `transformableCache.axisStripCount`
  - `transformableCache.tiltedRenderCount`
  - `transformableCache.hasAxisStrip`
  - `transformableCache.hasTiltedStrip`
  - `transformableCache.isCompletelyFilled`

Texture export behavior:
1. resolves input/output directories,
2. processes all regular files in input directory (sorted),
3. parses SNBT and normalizes legacy payloads,
4. discovers block states from loaded `LittleGroup`,
5. resolves model references from `assets/<namespace>/blockstates/*.json`,
6. resolves texture references from `assets/<namespace>/models/*.json` parent/texture graphs,
7. exports standalone PNG files to `textures/<namespace>/<path>.png`,
8. writes one `<basename>.textures.json` report per input,
9. writes per-block tint metadata (`tintColor`, `tintColorHex`) when available from exporter-side defaults.

Texture export strategy contracts:
- source is per-resource texture files (not stitched atlas coordinates),
- output image URIs are glTF-friendly and browser-cache-friendly,
- no assumption of a single global texture atlas (supports mixed-mod namespaces).
- `.png.mcmeta` files are copied with textures and surfaced to standalone for animation metadata extraction.

Texture animation responsibility split (current):
- converter output remains static texture binding only.
- converter does not parse `.mcmeta` and does not emit glTF animation channels for texture frames.
- `.mcmeta` sidecars are consumed by `tools/lt-3d-viewer` runtime adaptation (`docs/gltf-viewer-mcmeta-code-map.md`).

## Parity Debug JSON: Expected Shape
Common top-level keys:
- `generatedAt`
- `schema`
- `inputPath`
- `outputPath`
- `normalizedSnbt`
- `outsideNeighborPolicy`
- `withFaceStates`
- `geometryMode` (`client` or `server`)
- `runtime` (`minecraftVersion`, `littleTilesVersion`, `creativeCoreVersion`, `parityExporterVersion`)
- `root`
- `stats`
- `faceStateSummary`

`schema` format:
- current exporter writes `schema` as string: `"legacy"` or `"current"`
- source: `addons/littletiles-parity-exporter/src/main/java/dev/rvveber/littletiles/parityexporter/LtDebugExportCommand.java` (`report.addProperty("schema", legacy ? "legacy" : "current")`)

`root` is a recursive group tree:
- group: `path`, `grid`, `structureId`, `structureName`, `tiles[]`, `children[]`
- tile: `index`, `blockState`, `color`, `boxes[]`
- box: `index`, `kind`, bounds fields, raw `array`, optional `faceStates[]`

`stats` includes at least:
- `groups`
- `tiles`
- `boxes`
- `transformableBoxes`
- plus face counters from exporter face-state output:
  - `facesEvaluated`
  - `renderableFaces`

## Current Parity Snapshot (2026-02-11)
Primary parity fixtures:
- `fixtures/outputs/parity-debug/basic_lever.json`
- `fixtures/outputs/parity-debug/contemporary style house.json`
- `fixtures/outputs/parity-debug/double_door.json`
- `fixtures/outputs/parity-debug/empty wooden bucket.json`
- `fixtures/outputs/parity-debug/light_switch.json`
- `fixtures/outputs/parity-debug/simple_light.json`
- `fixtures/outputs/parity-debug/stone_plate.json`
- `fixtures/outputs/parity-debug/wooden_plate.json`

Current status:
- parser regression tests pass
- face-state parity regression tests currently fail on three fixtures in `tools/lt-import-gltf-poc/test/face-state-parity-regression.test.mjs`:
  - `contemporary style house.json`: `124455 !== 127256`
  - `empty wooden bucket.json`: `1014 !== 1158`
  - `light_switch.json`: `40 !== 43`
- material/texture focused tests pass:
  - `tools/lt-import-gltf-poc/test/material-resolver.test.mjs`
  - `tools/lt-import-gltf-poc/test/mesh-assembly-materials.test.mjs`
- parity checker fixture pass-rate should be re-validated after refreshing parity fixtures/baselines.
- canonical fixture checks are currently run in `client` geometry mode (`geometryMode: "client"` in fixtures).
- web-viewer cleanup is separated from parity via converter `--optimize` (default off), so client parity fixtures remain unoptimized.

Canonical parity outcomes that should remain true:
- raw schema parity against exporter `schema` (`legacy` or `current`)
- normalized parse parity as `current`
- recursive group/tile/box/tree parity against `debug.root`
- `outsideNeighborPolicy === "air"` validation
- face-state candidate parity (`renderable`, by-facing, by-inside/outside)
- top-level `faceStateSummary` consistency validation when present

## Open Items (2026-02-11)
1. Face-state parity regression drift:
- failing fixtures and counts are listed in the parity snapshot above.
- open question is whether fixture expected counts are stale after client-mode/parity refactors, or whether candidate evaluation still differs.
- required follow-up: regenerate exporter parity-debug fixtures in `client` mode and either align expected baselines or fix evaluator drift.

2. Tint source-of-truth enforcement:
- standalone converter no longer applies hardcoded foliage tint fallback.
- converter currently derives texture URI from SNBT block/material identity only.
- required follow-up: if tint parity is needed later, add explicit SNBT-driven tint contract.

3. Browser validator/viewer texture IO failures:
- online glTF validator/viewers can report `IO_ERROR: Failed to fetch` for absolute `http://127.0.0.1:4173/...` texture URIs.
- warning-level `NON_RELATIVE_URI` is acceptable by project choice, but fetch errors still block full texture validation.
- required follow-up: decide one validation contract (local viewer/server context that can reach host URIs, or relative in-package URIs).

4. Exact client-render-pipeline parity remains partial:
- current addon `client` mode is semantic parity for candidate visibility (including tilted-only transformable faces).
- it is not a direct invocation of the full in-game client renderer pipeline classes.

5. Still-open scope gaps from earlier decisions:
- structure-driven `extraRendering` is still not exported in standalone glTF.
- block behavior/material parity is still partial outside current source-backed rules.

6. Texture animation runtime compatibility boundaries:
- base converter output is static texture binding only (no `.mcmeta`-driven clip export path).
- Minecraft-style `.mcmeta` animation behavior is handled in `tools/lt-3d-viewer` runtime adaptation.

## Key Standalone Breakthroughs To Preserve
1. Parser boundary hardening and DI:
- `tools/lt-import-gltf-poc/src/snbt-parser.mjs` includes targeted fallback for known `mojangson` list-compound bug (`tickets:[...]` pattern).
- `tools/lt-import-gltf-poc/src/lt-import-parser.mjs` keeps SNBT parsing boundary injectable for differential parity testing.

2. Face-state parity path:
- candidate visibility is evaluated via face-state semantics (`evaluateFaceState`) aligned with `LittleServerFace` behavior.
- outside-face detection uses raw-origin strict-inside test (`originRaw > 0 && originRaw < grid`).
- outside-neighbor policy in standalone remains explicitly air.

3. Transformable parity stabilization:
- transformable cache generation in `transformable-cache` remains source-backed and regression-guarded.
- hybrid epsilon strategy in axis-strip cutting is currently required for parity:
  - `DOWN` uses `1e-7`
  - other facings use `5e-4`
- `planeIsFacing` guard remains with relaxed tolerance (`2e-3`) as part of the stabilized parity behavior.

4. Debug/exporter diagnostics integration:
- parity checker and exporter diagnostics support transformable cache comparisons and runtime metadata surfacing.
- fixture-based parity remains the contract; local fixture artifacts may be regenerated and are not always committed.

5. Texture URI determinism and runtime split:
- material resolver now derives texture URI from SNBT block/material identity with explicit alias mapping.
- converter no longer consumes texture-report artifacts or output texture metadata at convert time.
- Minecraft `.mcmeta` animation/emissive behavior is delegated to viewer runtime adaptation.

## Validation Corpus And Commands
Required corpus paths:
- `subrepos/LittleTiles/src/main/resources/assets/littletiles/example/simple_light.struct`
- `subrepos/LittleTiles/src/main/resources/data/littletiles/premade/workbench.struct`
- `fixtures/inputs/empty wooden bucket.txt`
- `fixtures/inputs/contemporary style house.txt`

Core commands:
- parser tests:
  - `cd tools/lt-import-gltf-poc && npm run test:parser`
- converter:
  - `node tools/lt-import-gltf-poc/src/cli.mjs <input> --out <output.gltf>`
  - `node tools/lt-import-gltf-poc/src/cli.mjs <input> --out <output.gltf> --optimize`
  - `node tools/lt-import-gltf-poc/src/cli.mjs <input> --out <output.gltf> --texture-base-uri <prefix>`
- parity checker:
  - `node tools/lt-import-gltf-poc/src/parity-debug-check.mjs <json-file-or-dir>`
  - `node tools/lt-import-gltf-poc/src/parity-debug-check.mjs --json <json-file-or-dir>`
  - `node tools/lt-import-gltf-poc/src/parity-debug-check.mjs --require-face-states <json-file-or-dir>`
  - `node tools/lt-import-gltf-poc/src/parity-debug-check.mjs --geometry-mode server <json-file-or-dir>`
- addon compile:
  - `cd addons/littletiles-parity-exporter && gradle compileJava`
  - if `gradle` is missing in shell PATH, load repo env first:
    - `direnv allow` at repo root (uses `.envrc` -> `use flake .`)
    - or run one-shot via `direnv exec . gradle -p addons/littletiles-parity-exporter compileJava`

## Known High-Risk Areas For Future Expansion
1. Block behavior/material parity is still partial:
- current standalone logic uses source-backed defaults plus heuristics and overrides, not full runtime block implementation parity.

2. Primitive grouping policy for legacy state strings:
- legacy `namespace:block:meta` and normalized forms can drift primitive grouping unless canonicalization rules are fixed consistently.

3. `faceStates` parity assertions require runtime-exported fixtures:
- checker supports them; confidence depends on regenerating fixtures with current addon exports.
- if client by-facing parity drifts while totals match, verify exporter uses tilted-only criterion `tiltedRenderCount > 0` (render-facing) rather than `hasTiltedStrip` (raw strip presence).

4. Exact "same process as in-game client render" for parity export:
- current addon command is server-registered; it does not execute the full client render pipeline classes directly.
- current `client` export mode is a semantic bridge for candidate visibility (especially tilted-only transformable faces), not a direct invocation of MC renderer internals.

5. Structure `extraRendering` is not represented in standalone output:
- for structure types that inject procedural render boxes, current output is intentionally incomplete.

6. Colors/transparency/textures are still downstream of geometry stability:
- geometry parity should remain regression-guarded while adding material pipeline features.

## Fast Reference: Where To Look First
- import parse path in mod: `subrepos/LittleTiles/.../GuiImport.java`
- canonical group/tile schema: `subrepos/LittleTiles/.../LittleGroup.java`, `LittleCollection.java`
- legacy conversion behavior: `subrepos/LittleTiles/.../OldLittleTilesDataParser.java`
- face/culling semantics: `subrepos/LittleTiles/.../LittleServerFace.java`, `LittleTile.java`, `LittleBox.java`
- transformable complexity: `subrepos/LittleTiles/.../LittleTransformableBox.java`, `LittleRenderBoxTransformable.java`
- standalone parser: `tools/lt-import-gltf-poc/src/lt-import-parser.mjs`
- standalone culling/mesh: `tools/lt-import-gltf-poc/src/gltf-writer.mjs`
- parity checker: `tools/lt-import-gltf-poc/src/parity-debug-check.mjs`
- mod-side debug exporter: `addons/littletiles-parity-exporter/src/main/java/dev/rvveber/littletiles/parityexporter/LtDebugExportCommand.java`
