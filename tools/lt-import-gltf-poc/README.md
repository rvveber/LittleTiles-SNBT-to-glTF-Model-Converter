# LittleTiles lt-import -> glTF (POC)

Static geometry converter for LittleTiles `/lt-import` SNBT data.

## Scope

- Target runtime: Node-style CLI (runs with Bun too)
- Output convention: Y-up, `1 Minecraft block = 1.0 glTF unit`
- Supports color/transparency materials and optional texture binding from addon texture reports
- Exports texture frame animation tracks from `.png.mcmeta` metadata (structure animations and `extraRendering` remain out of scope)
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

Textured export using addon texture report:

```bash
bun run src/cli.mjs ../../fixtures/inputs/empty\ wooden\ bucket.txt --out ./bucket.textured.gltf --texture-report ../../fixtures/inputs/empty\ wooden\ bucket.textures.json
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
- If `--texture-base-uri` is omitted, converter auto-derives a relative URI prefix from output folder to texture-report folder.
- `serve:textures` starts an Express static server on `http://127.0.0.1:4173`, serving `/fixtures/**` so existing glTF-relative texture URIs resolve directly.
- Converter or parity-check `--geometry-mode server` preserves parity-focused server-face semantics.
- Running parity-check in `client` mode against older server-semantics `faceStates` fixtures may fail on transformable-heavy cases by design.
- When a texture has `.mcmeta` animation metadata, converter emits `KHR_texture_transform` + `KHR_animation_pointer` tracks as the primary animation mode and also keeps raw metadata in `textures[*].extras.minecraftAnimation`.
- Texture animation tracks preserve per-frame timing, start at `t=0`, and are written with `STEP` interpolation for frame-by-frame playback.
- Mixed-period animated textures are repeated to a shared loop horizon (LCM-based with a cap) so shorter tracks do not freeze while longer tracks continue.
- `.mcmeta` object-frame entries with `index: 0` are supported and preserved.
- `.mcmeta interpolate=true` is retained in metadata but not mapped to linear glTF interpolation, because Minecraft-style pixel blending is not representable by UV offset animation.
- PNG alpha-channel detection is source-backed (IHDR color type + optional `tRNS` chunk) and automatically promotes textured materials to `alphaMode: BLEND`.
- Playback depends on viewer extension support (`KHR_animation_pointer` + `KHR_texture_transform`). `extras.minecraftAnimation` remains available as fallback metadata for custom runtimes.

## Known Open Items (2026-02-11)

- Face-state parity regression test currently fails for:
  - `contemporary style house.json` (`124455 !== 127256`)
  - `empty wooden bucket.json` (`1014 !== 1158`)
  - `light_switch.json` (`40 !== 43`)
- Tint is source-of-truth from texture reports only (no standalone hardcoded fallback). If `.textures.json` files are stale/missing `tintColor`, leaves can render untinted until `/lt-texture-export` is rerun.
- Online validators/viewers may report `IO_ERROR: Failed to fetch` for absolute localhost texture URIs (`http://127.0.0.1:4173/...`) depending on execution context/CORS; this is separate from `NON_RELATIVE_URI` warnings.
- Texture animation playback depends on runtime support for `KHR_animation_pointer`; unsupported viewers will show static textures.
