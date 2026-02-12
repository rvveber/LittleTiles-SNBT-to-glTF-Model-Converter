# Standalone 3D Viewer (glTF-Sample-Viewer Based): Context Map

## Purpose
This document is a source-backed context map for bootstrapping and extending the standalone 3D viewer tool based on Khronos `glTF-Sample-Viewer`.

It focuses on:
- where the viewer code comes from,
- how it is integrated in this repository,
- where texture/material animation is driven,
- where `.mcmeta` support (animation + emissive) is implemented,
- which files are the primary adaptation points.

It is not a milestone log.

## Project Scope And Fixed Decisions
Authoritative target for this viewer tool:
- keep the viewer as close as possible to upstream `glTF-Sample-Viewer`,
- add Minecraft-style animated-texture support required by this repo,
- support `.mcmeta`-driven animation/emissive metadata in addition to plain texture URIs.

Key behavior requirements:
1. Viewer must load standard glTF (`.gltf` / `.glb`) with the upstream rendering path.
2. Viewer must support animated textures via additional `.mcmeta` metadata.
3. Animation mode must support frame-by-frame stepping and optional frame blending (`interpolate=true`).
4. Support both URL-loaded assets and drag/drop local file bundles with sidecar `.mcmeta` files.
5. `.mcmeta` emissive flags should map to glTF material emissive properties at runtime.

## Repository Map (Viewer)
- `tools/lt-3d-viewer` viewer tool implementation in this repository
- `subrepos/glTF-Sample-Viewer` upstream viewer codebase mirror/reference
- `subrepos/glTF-Sample-Viewer/glTF-Sample-Renderer` nested renderer submodule used by the viewer
- `tools/lt-3d-viewer/src/main.js` top-level app wiring (load/render/update loop)
- `tools/lt-3d-viewer/src/logic/mcmeta-texture-animator.js` repository adaptation module for `.mcmeta`-driven texture animation
- `docs/gltf-viewer-mcmeta-code-map.md` this context document

## Upstream Entry Points
Viewer app bootstrap:
- `subrepos/glTF-Sample-Viewer/src/main.js` (reference)

Renderer API entry used by app:
- `subrepos/glTF-Sample-Viewer/glTF-Sample-Renderer/source/GltfView/gltf_view.js`
- `subrepos/glTF-Sample-Viewer/glTF-Sample-Renderer/source/ResourceLoader/resource_loader.js`
- `subrepos/glTF-Sample-Viewer/glTF-Sample-Renderer/source/Renderer/renderer.js`

Texture upload path:
- `subrepos/glTF-Sample-Viewer/glTF-Sample-Renderer/source/Renderer/webgl.js` (`setTexture`)

Texture transform + pointer animation support already in upstream:
- `subrepos/glTF-Sample-Viewer/glTF-Sample-Renderer/source/gltf/texture.js` (`KHR_texture_transform`)
- `subrepos/glTF-Sample-Viewer/glTF-Sample-Renderer/source/gltf/material.js` (`updateTextureTransforms`)
- `subrepos/glTF-Sample-Viewer/glTF-Sample-Renderer/source/gltf/animation.js` (`KHR_animation_pointer`)

## Adaptation: `.mcmeta` Animation + Emissive Runtime
Primary adaptation module:
- `tools/lt-3d-viewer/src/logic/mcmeta-texture-animator.js`

Responsibilities:
1. discover animated textures from:
- inline texture/image extras metadata (`minecraftAnimation`),
- explicit `mcmetaUri` hints,
- fallback sidecar URI (`<image>.png.mcmeta`).

2. load animation metadata from:
- drag/drop additional files (local bundles), or
- network fetch (URL-loaded assets).

3. normalize Minecraft animation schema:
- `frametime` / `frameTime`,
- `frames` entries (`int` or `{index,time}`),
- `height` / `frameHeight`,
- `interpolate`.

4. normalize `.mcmeta` emissive schema:
- `fusion.emissive` / top-level `emissive`,
- optional `fusion.emissiveStrength` / `emissiveStrength`,
- optional emissive color fields (`fusion.emissiveColor`, `fusion.color`, top-level equivalents),
- fallback sampled color from the top square frame when no explicit color is provided.

5. run texture animation at runtime:
- map elapsed seconds to Minecraft ticks (`20 TPS`),
- use integer tick sampling (`floor`) for frame selection parity,
- blend only when `interpolate=true` and frame duration is greater than one tick.

6. upload animated pixels directly to existing WebGL textures:
- uses offscreen canvas as source,
- first upload per texture handle redefines storage (`texImage2D`) to single-frame size,
- subsequent updates use `texSubImage2D`,
- regenerates mipmaps when required by sampler mode.

7. apply emissive overrides to materials that use animated/flagged base textures:
- sets `material.emissiveTexture`,
- sets `material.emissiveFactor`,
- sets `material.extensions.KHR_materials_emissive_strength`,
- updates renderer texture bindings/defines (`HAS_EMISSIVE_MAP 1`).

Integration points in app loop:
- `tools/lt-3d-viewer/src/main.js`
  - instantiate animator,
  - attach per loaded glTF,
  - update each frame,
  - request redraw while mcmeta animation is active.

## Runtime Data Contracts
### Supported metadata origins
- `texture.extras.minecraftAnimation` (inline normalized metadata)
- `texture.extras.mcmetaUri` (explicit sidecar URI)
- `image.extras.mcmetaUri` (explicit sidecar URI)
- fallback: `<image.uri>.mcmeta`

### Supported animation fields
From inline metadata or parsed `.mcmeta` `animation` object:
- `frameCount` (optional)
- `frameTime` / `frametime`
- `frames` (ints or objects with `index` and optional `time`)
- `frameHeight` / `height`
- `interpolate`

### Supported emissive fields
From parsed `.mcmeta`:
- `fusion.emissive` or top-level `emissive` (boolean enable flag)
- `fusion.emissiveStrength` or top-level `emissiveStrength` (positive number)
- `fusion.emissiveColor`, `fusion.color`, `emissiveColor`, `color` (array/int/hex)
- fallback color sampling from the top square frame when color is omitted

### Image support boundary
Current implementation targets byte-addressable 2D texture images:
- PNG, JPEG, WEBP (`image/png`, `image/jpeg`, `image/webp`)

Compressed/opaque GPU sources (e.g. KTX2) are intentionally excluded from CPU-side frame compositing path.

## Build/Run Commands (Viewer)
Install and build viewer tool (includes renderer build via script):
- `cd tools/lt-3d-viewer && npm install`
- `cd tools/lt-3d-viewer && npm run build`

Run dev mode from upstream viewer package:
- `cd tools/lt-3d-viewer && npm run dev`

## Known Boundaries And Follow-Ups
1. Upstream updates:
- keep adaptations minimal and isolated to app-layer module/hook points to reduce merge friction.

2. Coexistence with glTF UV-offset animation:
- upstream already supports `KHR_animation_pointer` + `KHR_texture_transform`.
- if both glTF pointer animation and `.mcmeta` animation target the same texture simultaneously, behavior may need policy precedence rules.

3. Compressed animated textures:
- current path does not animate KTX2/compressed texture sources.

4. Emissive lighting model boundary:
- emissive support is material glow only (`emissiveTexture`/`emissiveFactor`/`KHR_materials_emissive_strength`).
- runtime does not create real scene lights from texture pixels (no colored light casting yet).

5. Advanced parity knobs:
- nearest/linear filtering policy and exact Minecraft blend behavior may require additional user/runtime toggles if strict visual parity is needed across all packs.

## Fast Reference: Where To Look First
- viewer app load/update loop: `tools/lt-3d-viewer/src/main.js`
- mcmeta animation controller: `tools/lt-3d-viewer/src/logic/mcmeta-texture-animator.js`
- texture upload internals: `subrepos/glTF-Sample-Viewer/glTF-Sample-Renderer/source/Renderer/webgl.js`
- texture-transform uniform update: `subrepos/glTF-Sample-Viewer/glTF-Sample-Renderer/source/gltf/material.js`
- pointer animation evaluation: `subrepos/glTF-Sample-Viewer/glTF-Sample-Renderer/source/gltf/animation.js`
