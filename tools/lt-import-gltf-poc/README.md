# LittleTiles lt-import -> glTF (POC)

Static geometry converter for LittleTiles `/lt-import` SNBT data.

## Scope

- Target runtime: Node-style CLI (runs with Bun too)
- Output convention: Y-up, `1 Minecraft block = 1.0 glTF unit`
- Supports color/transparency materials and deterministic texture URI derivation from encoded block names
- Texture animation export is intentionally out of scope (structure animations and `extraRendering` remain out of scope)
- Includes `LittleTransformableBox` decoding and triangulation

## Install

```bash
bun install
```

## Usage

```bash
bun run src/cli.mjs ../../fixtures/inputs/empty\ wooden\ bucket.txt --out ./bucket.gltf
```

Client-like render geometry mode:

```bash
bun run src/cli.mjs ../../fixtures/inputs/empty\ wooden\ bucket.txt --out ./bucket.client.gltf --geometry-mode client
```

Optional post-process optimization for web-viewer outputs:

```bash
bun run src/cli.mjs ../../fixtures/inputs/empty\ wooden\ bucket.txt --out ./bucket.client.optimized.gltf --geometry-mode client --optimize
```

Textured export with URI prefix:

```bash
bun run src/cli.mjs ../../fixtures/inputs/empty\ wooden\ bucket.txt --out ./bucket.textured.gltf --texture-base-uri /assets
```

Texture sampling is always pixel-crisp (nearest-neighbor).

or:

```bash
./src/cli.mjs ../../subrepos/LittleTiles/src/main/resources/data/littletiles/premade/workbench.struct ./workbench.gltf
```

Parity debug verification against addon exports:

```bash
bun run src/parity-debug-check.mjs ../../fixtures/outputs/parity-debug
```

Machine-readable parity output:

```bash
bun run src/parity-debug-check.mjs --json ../../fixtures/outputs/parity-debug
```

Require exporter-backed face-state fixtures:

```bash
bun run src/parity-debug-check.mjs --require-face-states ../../fixtures/outputs/parity-debug
```

Force parity checker geometry mode explicitly:

```bash
bun run src/parity-debug-check.mjs --geometry-mode server ../../fixtures/outputs/parity-debug
```

Serve fixtures/textures for browser-based glTF viewers:

```bash
npm run serve:textures
```

## Notes

- Supports both current schema (`t/c/s/e`) and legacy schema (`tiles/children/structure`).
- Preserves structure IDs and applies `noclip` (`noCollision`) structure gating in internal face-fill culling.
- Legacy empty typed arrays like `[I;]` are normalized before parsing.
- Block behavior gating uses canonical block IDs (including legacy `namespace:block:meta` normalization) with optional `behaviorOverrides` for standalone mapping extensions.
- Internal-face culling for axis-aligned boxes uses partial overlap subtraction (plane cell decomposition), not only exact full-face matches.
- Transformable boxes use a cache-style face build path (axis strips + tilted strips, clipped by face planes) with fallback to simple triangle split if cache output is empty.
- `parity-debug-check` validates standalone parser output against addon-exported normalized trees/stats and prints culling face summaries for parity baselining.
- When debug fixtures include mod-side `faceStates`, `parity-debug-check` also compares renderable face-candidate counts (total/by-facing/inside-outside) against standalone culling output.
- `parity-debug-check --json` emits a machine-readable report while keeping default human output unchanged.
- `parity-debug-check --require-face-states` fails fixtures that do not include `faceStates`/`faceStateSummary`, so exporter-backed face-state fixtures can be used as a strict geometry gate.
- `parity-debug-check` auto-detects geometry mode from fixture `geometryMode` metadata; if absent, it falls back to `server`.
- Converter `--geometry-mode client` (default) targets rendered geometry parity (including transformable tilted-only candidates).
- Converter `--optimize` enables additional post-process cleanup passes for web-viewer-oriented output.
- `writeGltf` emits `TEXCOORD_0` UVs for all faces so texture materials render correctly.
- Converter writes glTF texture samplers as nearest-neighbor for pixel-crisp rendering.
- Converter derives texture URIs from block IDs/state names (`textures/<namespace>/block/<path>.png`) only.
- `--texture-base-uri` (alias `--texture-uri-prefix`) prepends a static prefix to all derived texture URIs.
- `serve:textures` starts an Express static server on `http://127.0.0.1:4173`, serving `/fixtures/**` so existing glTF-relative texture URIs resolve directly.
- `serve:textures` now returns a fallback PNG for missing requests under `/fixtures/outputs/textures/textures/**/*.png` (disable with `--no-missing-texture-fallback` or provide custom fallback via `--missing-texture <path>`).
- Converter or parity-check `--geometry-mode server` preserves parity-focused server-face semantics.
- Running parity-check in `client` mode against older server-semantics `faceStates` fixtures may fail on transformable-heavy cases by design.
- Texture files are not required at conversion time; missing URIs are allowed by design.

## Known Open Items (2026-02-11)

- Face-state parity regression test currently fails for:
  - `contemporary style house.json` (`124455 !== 127256`)
  - `empty wooden bucket.json` (`1014 !== 1158`)
  - `light_switch.json` (`40 !== 43`)
- Online validators/viewers may report `IO_ERROR: Failed to fetch` for absolute localhost texture URIs (`http://127.0.0.1:4173/...`) depending on execution context/CORS; this is separate from `NON_RELATIVE_URI` warnings.
- Some derived texture URIs may not resolve in a given runtime/resource pack context; this is expected when blocks have no matching texture asset at the derived path.
