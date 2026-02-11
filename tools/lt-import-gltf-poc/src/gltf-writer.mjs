import {
  buildVisibleFaces,
  resolveEvaluateInternalOcclusion,
} from './gltf-writer/face-candidates.mjs';
import {
  collectFaceDebugSummaryFromVisibleFaces,
  collectRenderableFaceCandidateSummaryFromTiles,
  summarizeFaceSet,
} from './gltf-writer/debug-stats.mjs';
import { facesToPrimitiveMeshes, writeGltf } from './gltf-writer/mesh-assembly.mjs';
import { applyGeometryModePipeline } from './gltf-writer/postprocess-faces.mjs';
import { resolveRuntimeFaceBehaviorProfile } from './gltf-writer/runtime-face-behavior-profile.mjs';
import { normalizeTilesForRendering } from './gltf-writer/tile-normalization.mjs';

export function boxesToPrimitiveMeshes(input, options = {}) {
  const evaluateInternalOcclusion = resolveEvaluateInternalOcclusion(options);
  const runtimeFaceBehaviorProfile = resolveRuntimeFaceBehaviorProfile(options);
  const tiles = normalizeTilesForRendering(input, options.behaviorOverrides);
  const visibleFacesRaw = buildVisibleFaces(tiles, {
    evaluateInternalOcclusion,
    runtimeFaceBehaviorProfile,
    geometryMode: options.geometryMode,
  });
  const geometryProcessed = applyGeometryModePipeline(visibleFacesRaw, options);
  const visibleFaces = geometryProcessed.faces;
  const faceSummary = summarizeFaceSet(visibleFaces);
  const assembled = facesToPrimitiveMeshes(visibleFaces, {
    resolveMaterial: options.resolveMaterial,
    materialOptions: options.materialOptions,
  });
  const boxCount = tiles.reduce((sum, tile) => sum + tile.boxes.length, 0);

  return {
    meshes: assembled.meshes,
    stats: {
      boxCount,
      faceCount: assembled.stats.faceCount,
      primitiveCount: assembled.stats.primitiveCount,
      transformableFaceCount: assembled.stats.transformableFaceCount,
      faceSummary,
      geometry: geometryProcessed.stats,
    },
  };
}

export function collectFaceDebugSummary(input, options = {}) {
  const evaluateInternalOcclusion = resolveEvaluateInternalOcclusion(options);
  const runtimeFaceBehaviorProfile = resolveRuntimeFaceBehaviorProfile(options);
  const tiles = normalizeTilesForRendering(input, options.behaviorOverrides);
  const visibleFaces = buildVisibleFaces(tiles, {
    evaluateInternalOcclusion,
    runtimeFaceBehaviorProfile,
    geometryMode: options.geometryMode,
  });
  return collectFaceDebugSummaryFromVisibleFaces(visibleFaces);
}

export function collectRenderableFaceCandidateSummary(input, options = {}) {
  const evaluateInternalOcclusion = resolveEvaluateInternalOcclusion(options);
  const runtimeFaceBehaviorProfile = resolveRuntimeFaceBehaviorProfile(options);
  const tiles = normalizeTilesForRendering(input, options.behaviorOverrides);
  return collectRenderableFaceCandidateSummaryFromTiles(tiles, {
    evaluateInternalOcclusion,
    runtimeFaceBehaviorProfile,
    geometryMode: options.geometryMode,
  });
}

export { writeGltf };
