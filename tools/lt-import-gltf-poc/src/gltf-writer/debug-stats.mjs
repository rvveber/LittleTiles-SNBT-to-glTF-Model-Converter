import {
  FACING_ORDER,
  iterateRenderableFaceCandidates,
} from './face-candidates.mjs';

export function summarizeFaceSet(faces) {
  const byFacing = Object.fromEntries(FACING_ORDER.map((f) => [f, 0]));
  const bySourceKind = { aabb: 0, transformable: 0 };
  const byFaceType = { axis: 0, tilted: 0 };
  const byOutside = { inside: 0, outside: 0 };

  for (const face of faces) {
    if (typeof face.facing === 'string' && Object.hasOwn(byFacing, face.facing))
      byFacing[face.facing]++;

    if (face.sourceKind === 'aabb' || face.sourceKind === 'transformable')
      bySourceKind[face.sourceKind]++;

    if (face.faceType === 'axis' || face.faceType === 'tilted')
      byFaceType[face.faceType]++;

    if (face.outside === true)
      byOutside.outside++;
    else
      byOutside.inside++;
  }

  return {
    totalFaces: faces.length,
    byFacing,
    bySourceKind,
    byFaceType,
    byOutside,
  };
}

export function collectFaceDebugSummaryFromVisibleFaces(visibleFaces) {
  return summarizeFaceSet(visibleFaces);
}

export function collectRenderableFaceCandidateSummaryFromTiles(tiles, options = {}) {
  const byFacing = Object.fromEntries(FACING_ORDER.map((f) => [f, 0]));
  const bySourceKind = { aabb: 0, transformable: 0 };
  const byOutside = { inside: 0, outside: 0 };

  let totalVisibleCandidates = 0;

  for (const { face, box, outside } of iterateRenderableFaceCandidates(tiles, options)) {
    totalVisibleCandidates++;
    byFacing[face.facing]++;
    bySourceKind[box.kind]++;
    if (outside === true)
      byOutside.outside++;
    else
      byOutside.inside++;
  }

  return {
    totalVisibleCandidates,
    byFacing,
    bySourceKind,
    byOutside,
  };
}
