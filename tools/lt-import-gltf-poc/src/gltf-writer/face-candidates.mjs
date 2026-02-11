import {
  buildFaceCandidates,
  buildFaceCandidatesWithOptions
} from './face-candidate-builder.mjs';
import {
  evaluateFaceState, shouldOccludeOutsideFaces
} from './face-state-evaluation.mjs';
import {
  applyOccluders, isOutsideFace
} from './occluder-ops.mjs';
import {
  hasStaticExternalNeighbour
} from './tile-normalization.mjs';
import {
  isDegeneratePolygon, hasRenderablePolygon
} from './polygon-ops.mjs';
import {
  FACING_ORDER
} from './transformable-cache.mjs';
import {
  resolveGeometryMode
} from './postprocess-faces.mjs';

export { FACING_ORDER, isOutsideFace, hasStaticExternalNeighbour, hasRenderablePolygon, buildFaceCandidates, evaluateFaceState };

export function resolveEvaluateInternalOcclusion(options = {}) {
  return options.evaluateInternalOcclusion !== false;
}

function resolveRuntimeFaceBehaviorProfileOption(options = {}) {
  return options.runtimeFaceBehaviorProfile ?? null;
}

function resolveCandidateBuildOptions(options = {}) {
  const geometryMode = resolveGeometryMode(options);
  return {
    allowTiltedOnlyTransformableFaces: geometryMode === 'client',
  };
}

export function buildVisibleFaces(tiles, options) {
  const evaluateInternalOcclusion = resolveEvaluateInternalOcclusion(options);
  const runtimeFaceBehaviorProfile = resolveRuntimeFaceBehaviorProfileOption(options);
  const candidateBuildOptions = resolveCandidateBuildOptions(options);
  const out = [];

  for (const { tile, box, face, faceState, outside } of iterateRenderableFaceCandidates(tiles, {
    evaluateInternalOcclusion,
    runtimeFaceBehaviorProfile,
    candidateBuildOptions,
  })) {
    let visibleAxisPolys = face.axisPolys;

    if (
      evaluateInternalOcclusion &&
      visibleAxisPolys.length > 0 &&
      faceState?.needsAxisCutting === true
    ) {
      if (!outside) {
        visibleAxisPolys = applyOccluders(face, visibleAxisPolys, tile, tiles);
      } else if (shouldOccludeOutsideFaces(runtimeFaceBehaviorProfile)) {
        if (outside && hasStaticExternalNeighbour(face, tile))
          visibleAxisPolys = [];
        else
          visibleAxisPolys = applyOccluders(face, visibleAxisPolys, tile, tiles);
      }
    }

    for (const poly of visibleAxisPolys) {
      if (!poly || poly.length < 3 || isDegeneratePolygon(poly))
        continue;
      out.push({
        blockState: tile.blockState,
        blockId: tile.blockId,
        color: tile.color,
        providesSolidFace: tile.providesSolidFace,
        sourceKind: box.kind,
        facing: face.facing,
        faceType: 'axis',
        outside,
        vertices: poly,
      });
    }

    for (const poly of face.tiltedPolys) {
      if (!poly || poly.length < 3 || isDegeneratePolygon(poly))
        continue;
      out.push({
        blockState: tile.blockState,
        blockId: tile.blockId,
        color: tile.color,
        providesSolidFace: tile.providesSolidFace,
        sourceKind: box.kind,
        facing: face.facing,
        faceType: 'tilted',
        outside,
        vertices: poly,
      });
    }
  }

  return out;
}

export function* iterateRenderableFaceCandidates(tiles, options = {}) {
  const evaluateInternalOcclusion = resolveEvaluateInternalOcclusion(options);
  const runtimeFaceBehaviorProfile = resolveRuntimeFaceBehaviorProfileOption(options);
  const geometryMode = resolveGeometryMode(options);
  const candidateBuildOptions = options.candidateBuildOptions ?? resolveCandidateBuildOptions(options);

  for (const tile of tiles) {
    for (const box of tile.boxes) {
      for (const face of buildFaceCandidatesWithOptions(tile, box, candidateBuildOptions)) {
        const result = evaluateFaceCandidateRenderability(
          face,
          tile,
          tiles,
          evaluateInternalOcclusion,
          runtimeFaceBehaviorProfile,
          geometryMode
        );
        if (!result)
          continue;

        yield {
          tile,
          box,
          face,
          faceState: result.faceState,
          outside: result.outside,
        };
      }
    }
  }
}

function evaluateFaceCandidateRenderability(
  face,
  tile,
  allTiles,
  evaluateInternalOcclusion,
  runtimeFaceBehaviorProfile,
  geometryMode
) {
  if (evaluateInternalOcclusion) {
    const faceState = evaluateFaceState(face, tile, allTiles, runtimeFaceBehaviorProfile, {
      geometryMode,
    });
    if (!faceState.renderable)
      return null;
    return {
      faceState,
      outside: faceState.outside ?? isOutsideFace(face),
    };
  }

  const hasAxis = hasRenderablePolygon(face.axisPolys);
  const hasTilted = hasRenderablePolygon(face.tiltedPolys);
  if (!(hasAxis || hasTilted))
    return null;

  return {
    faceState: null,
    outside: isOutsideFace(face),
  };
}
