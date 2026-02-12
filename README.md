# GLTF LittleTiles

Standalone workbench for converting LittleTiles import payloads (`.txt` / `.struct` SNBT) into glTF.

## What This Repo Does

- Parses LittleTiles import SNBT (current + legacy forms).
- Rebuilds visible tile geometry with source-backed culling behavior.
- Writes `.gltf` + `.bin` outputs for standalone viewing/parity checks.
- Provides parity tooling against mod-exported debug fixtures.

## Converter Contract

Main converter: `tools/lt-import-gltf-poc/src/cli.mjs`

Input:
- a `.txt` / `.struct` SNBT file, or
- `stdin` (use `-` as input)

Output:
- one `.gltf`
- one `.bin`

Texture URI behavior:
- default: texture URIs are derived from block/material identity in SNBT (no external texture lookup required)
- optional: `--texture-base-uri` / `--texture-uri-prefix` prepends a static prefix to derived texture URIs

## Quick Start

```bash
cd tools/lt-import-gltf-poc
npm install
```

Convert from file:

```bash
node src/cli.mjs ../../fixtures/inputs/empty\ wooden\ bucket.txt --out ../../fixtures/outputs/bucket.gltf
```

Convert from `stdin`:

```bash
cat ../../fixtures/inputs/simple_light.struct | node src/cli.mjs - --out ../../fixtures/outputs/simple_light.gltf
```

Show CLI help:

```bash
node src/cli.mjs --help
```

## 3D Viewer Bootstrap

Viewer tool location:
- `tools/lt-3d-viewer/`

Upstream baseline reference:
- `subrepos/glTF-Sample-Viewer/` (kept as upstream source mirror)

Build viewer app:

```bash
cd tools/lt-3d-viewer
npm install
npm run build
```

Run local viewer dev server:

```bash
cd tools/lt-3d-viewer
npm run dev
```

## Common Commands

Run converter tests:

```bash
cd tools/lt-import-gltf-poc
npm run test:parser
```

Re-convert all fixture inputs after converter changes:

```bash
cd tools/lt-import-gltf-poc
npm run reconvert:fixtures
```

`reconvert:fixtures` uses `LT_TEXTURE_BASE_URI` as URI prefix for derived texture URIs (default: `http://127.0.0.1:4173/fixtures/outputs/textures/`).

Run parity checker on fixture exports:

```bash
cd tools/lt-import-gltf-poc
node src/parity-debug-check.mjs --require-face-states ../../fixtures/outputs/parity-debug
```

Serve fixture outputs/textures for local viewer testing:

```bash
cd tools/lt-import-gltf-poc
node src/texture-server.mjs
```

## Repository Layout

- `tools/lt-import-gltf-poc/` standalone parser, culling pipeline, glTF writer, parity checker
- `tools/lt-3d-viewer/` standalone 3D viewer tool (based on official glTF-Sample-Viewer architecture)
- `subrepos/glTF-Sample-Viewer/` upstream viewer baseline mirror/reference
- `addons/littletiles-parity-exporter/` NeoForge addon with `/lt-debug-export` and `/lt-texture-export`
- `docs/` project context and source-backed behavior map
- `fixtures/inputs/` local SNBT corpus and optional texture fixture assets
- `fixtures/outputs/` generated outputs (glTF/parity/texture fixtures)
- `subrepos/LittleTiles/` upstream LittleTiles source reference
- `subrepos/CreativeCore/` upstream CreativeCore source reference

## Source Of Truth Docs

- Main context map: `docs/lt-import-to-gltf-code-map.md`
- Viewer adaptation map: `docs/gltf-viewer-mcmeta-code-map.md`
- Addon details: `addons/littletiles-parity-exporter/README.md`

## Development Environment

If you use Nix + direnv, this repo includes a flake-based dev shell:

```bash
direnv allow
```

## Scope Notes

Current priority is geometry parity first, then color/transparency/texture parity refinement.

Standalone outside-neighbor policy is fixed to `air`.
