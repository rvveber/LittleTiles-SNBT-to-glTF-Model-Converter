# LittleTiles Parity Exporter Addon

Companion NeoForge addon for generating debug reports from LittleTiles import SNBT using mod-side code paths.

## Why this exists

- Keep the main `LittleTiles` mod unmodified.
- Export authoritative debug data from within the game runtime.
- Feed standalone parity tooling with normalized, source-backed fixtures.

## Current command

```
/lt-debug-export "<input_folder>" "<output_folder>" [client|server]
```

Example:

```
/lt-debug-export "config/littletiles/in" "debug/parity/out"
/lt-debug-export "config/littletiles/in" "debug/parity/out" server
```

What it does:

- Reads SNBT from disk.
- Treats the first argument as an input directory and processes every regular file inside.
- Writes one JSON per input file into the output directory (`<basename>.json`).
- Detects legacy format and converts through `OldLittleTilesDataParser.convert(...)`.
- Loads normalized data via `LittleGroup.load(...)`.
- Writes a JSON tree with groups, tiles, boxes, and summary stats.
- Face-state export geometry mode defaults to `client`; `server` remains available via optional third argument.
- Writes selected face-state mode to top-level `geometryMode` (`client` or `server`).
- `client` mode is intended to match client-visible face candidates (including transformable tilted-only facings); it does not run the full in-game client renderer pipeline directly.
- In `client` mode, transformable tilted-only face renderability is keyed from facing-assigned `tiltedRenderCount > 0` (not raw `hasTiltedStrip`), matching rendered-facing semantics.
- Always records standalone parity policy as `outsideNeighborPolicy = "air"`.
- Always exports per-box/per-facing face-state data:
  - `LittleFaceState` (`UNLOADED`, `INSIDE_*`, `OUTSIDE_*`),
  - state booleans (`outside`, `coveredFully`, `partially`, `renderable`),
  - culling reason tags (`inside_covered`, `inside_partially_covered`, `inside_uncovered`, `outside_assume_air_neighbour`, ...),
  - eligibility counters (`eligibleSolidFaceTiles`, `eligibleRenderCombinedOnlyTiles`, skipped no-collision/ineligible counts).
- Face-state summary is written at top-level as `faceStateSummary`.
- Runtime metadata is written under `runtime`:
  - `minecraftVersion`,
  - `littleTilesVersion`,
  - `creativeCoreVersion`,
  - `parityExporterVersion`.

## Texture export command

```
/lt-texture-export "<input_folder>" "<output_folder>"
```

Example:

```
/lt-texture-export "config/littletiles/in" "debug/parity/textures"
```

What it does:

- Reads SNBT from the input folder and normalizes legacy payloads through `OldLittleTilesDataParser.convert(...)`.
- Loads structures via `LittleGroup.load(...)` and collects referenced block states.
- Resolves texture dependencies through blockstate + model JSON graphs (`assets/<namespace>/blockstates`, `assets/<namespace>/models`).
- Exports texture files as standalone PNGs to:
  - `textures/<namespace>/<path>.png`
- Writes one per-input report (`<basename>.textures.json`) with:
  - discovered block states,
  - resolved model ids,
  - texture ids and exported URIs,
  - missing assets diagnostics.

Texture strategy:

- Source format: original PNG texture resources from each namespace.
- Output format: external PNG files referenced by URI, suitable for direct `.gltf` image entries.
- Atlas policy: no stitched atlas assumptions; each texture remains an independent file.
- Browser caching: stable per-texture paths enable normal HTTP cache behavior.
- Future path: optional offline KTX2 transcode can be added later without changing logical texture ids.

## Notes

- Face-state export uses the agreed standalone context policy: world neighbor blocks are treated as air.

## Packaging and install notes

- Build with:
  - `gradle jar`
- Install this file into your game `mods/` folder:
  - `addons/littletiles-parity-exporter/build/libs/littletiles-parity-exporter-0.1.0.jar`
