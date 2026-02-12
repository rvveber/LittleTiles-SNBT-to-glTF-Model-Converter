# GLTF_LittleTiles

Standalone LittleTiles import-to-glTF workbench.

## Repository Layout

- `subrepos/LittleTiles/` - upstream LittleTiles submodule (source reference + parity target)
- `subrepos/CreativeCore/` - upstream CreativeCore submodule (math/render primitives LittleTiles depends on)
- `tools/lt-import-gltf-poc/` - Node/Bun standalone converter CLI
- `addons/littletiles-parity-exporter/` - companion NeoForge addon scaffold for mod-side debug export commands
- `docs/` - implementation notes, parity map, and project decisions
- `fixtures/inputs/` - local standalone test inputs (`.txt`/`.struct`) and optional texture assets (`textures/...`)
- `fixtures/outputs/` - generated local outputs (`.gltf + .bin`)

## Quick Start

```bash
cd tools/lt-import-gltf-poc
bun install
node src/cli.mjs ../../fixtures/inputs/empty\ wooden\ bucket.txt --out ../../fixtures/outputs/bucket.gltf
```

## Notes

- Submodule paths are intentionally grouped under `subrepos/`.
- Geometry parity is currently the active implementation stage.
- Outside world-neighbor policy for standalone conversion is fixed to `air`.
