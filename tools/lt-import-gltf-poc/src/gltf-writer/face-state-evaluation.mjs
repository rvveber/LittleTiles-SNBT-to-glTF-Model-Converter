import {
  hasRenderablePolygon, RAW_COORD_EPSILON
} from './polygon-ops.mjs';
import {
  isOutsideFace, getOutsideNeighbourIndex, matchesOutsideNeighbour,
  isFaceSolid, doesProvideSolidFace, canBeRenderCombined, oppositeFacing,
  getBoxRawMinByAxis, getBoxRawMaxByAxis
} from './occluder-ops.mjs';

function cellStartFromRaw(value) {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) <= RAW_COORD_EPSILON)
    return rounded;
  return Math.floor(value + RAW_COORD_EPSILON);
}

function cellEndFromRaw(value) {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) <= RAW_COORD_EPSILON)
    return rounded;
  return Math.ceil(value - RAW_COORD_EPSILON);
}

function clampCellIndex(value, limitExclusive) {
  if (value <= 0)
    return 0;
  if (value >= limitExclusive)
    return limitExclusive;
  return value;
}

function roundRawCoord(value) {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) <= RAW_COORD_EPSILON)
    return rounded;
  return value;
}

function roundCellSpan(value) {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) <= RAW_COORD_EPSILON)
    return rounded;
  return Math.max(0, Math.floor(value + RAW_COORD_EPSILON));
}

function convertRawCoord(value, fromGrid, toGrid) {
  if (fromGrid > toGrid) {
    const ratio = Math.trunc(fromGrid / toGrid);
    if (ratio <= 0)
      return value;
    return Math.trunc(value / ratio);
  }
  const ratio = Math.trunc(toGrid / fromGrid);
  if (ratio <= 0)
    return 0;
  return value * ratio;
}

export function shouldOccludeOutsideFaces(runtimeFaceBehaviorProfile) {
  if (runtimeFaceBehaviorProfile?.faceStates?.outsideNeighborPolicy === 'air')
    return false;
  return runtimeFaceBehaviorProfile?.faceStates?.occludeOutsideFacesWithTiles === true;
}

export function evaluateFaceState(face, renderedTile, allTiles, runtimeFaceBehaviorProfile, options = {}) {
  const outside = isOutsideFace(face);
  const hasAxis = hasRenderablePolygon(face.axisPolys);
  const hasTilted = hasRenderablePolygon(face.tiltedPolys);

  if (!hasAxis && !hasTilted) {
    return {
      outside,
      state: 'UNLOADED',
      coveredFully: false,
      partially: false,
      renderable: false,
      reason: 'face_unloaded',
      needsAxisCutting: false,
    };
  }

  if (options.geometryMode === 'client' && !hasAxis && hasTilted)
    return evaluateClientTiltedOnlyFaceState(outside, renderedTile);

  if (outside)
    return evaluateOutsideFaceState(face, renderedTile, allTiles, runtimeFaceBehaviorProfile);
  return evaluateInsideFaceState(face, renderedTile, allTiles, runtimeFaceBehaviorProfile);
}

function evaluateClientTiltedOnlyFaceState(outside, renderedTile) {
  if (outside) {
    if (!renderedTile.cullOverEdge) {
      return {
        outside: true,
        state: 'OUTSIDE_UNCOVERED',
        coveredFully: false,
        partially: false,
        renderable: true,
        reason: 'outside_cull_over_edge_disabled',
        needsAxisCutting: false,
      };
    }
    return {
      outside: true,
      state: 'OUTSIDE_UNCOVERED',
      coveredFully: false,
      partially: false,
      renderable: true,
      reason: 'outside_assume_air_neighbour',
      needsAxisCutting: false,
    };
  }

  return {
    outside: false,
    state: 'INSIDE_UNCOVERED',
    coveredFully: false,
    partially: false,
    renderable: true,
    reason: 'inside_uncovered',
    needsAxisCutting: false,
  };
}

function evaluateInsideFaceState(face, renderedTile, allTiles, runtimeFaceBehaviorProfile) {
  const coverage = computeFaceCoverage(face, renderedTile, allTiles, {
    runtimeFaceBehaviorProfile,
    outside: false,
    restrictOutsideNeighbour: false,
  });

  if (coverage.coveredFully) {
    return {
      outside: false,
      state: 'INSIDE_COVERED',
      coveredFully: true,
      partially: false,
      renderable: false,
      reason: 'inside_covered',
      needsAxisCutting: false,
    };
  }

  if (coverage.partially) {
    return {
      outside: false,
      state: 'INSIDE_PARTIALLY_COVERED',
      coveredFully: false,
      partially: true,
      renderable: true,
      reason: 'inside_partially_covered',
      needsAxisCutting: coverage.needsAxisCutting,
    };
  }

  return {
    outside: false,
    state: 'INSIDE_UNCOVERED',
    coveredFully: false,
    partially: false,
    renderable: true,
    reason: 'inside_uncovered',
    needsAxisCutting: false,
  };
}

function evaluateOutsideFaceState(face, renderedTile, allTiles, runtimeFaceBehaviorProfile) {
  if (!renderedTile.cullOverEdge) {
    return {
      outside: true,
      state: 'OUTSIDE_UNCOVERED',
      coveredFully: false,
      partially: false,
      renderable: true,
      reason: 'outside_cull_over_edge_disabled',
      needsAxisCutting: false,
    };
  }

  const outsidePolicy = runtimeFaceBehaviorProfile?.faceStates?.outsideNeighborPolicy;
  if (outsidePolicy === 'air' || !shouldOccludeOutsideFaces(runtimeFaceBehaviorProfile)) {
    return {
      outside: true,
      state: 'OUTSIDE_UNCOVERED',
      coveredFully: false,
      partially: false,
      renderable: true,
      reason: 'outside_assume_air_neighbour',
      needsAxisCutting: false,
    };
  }

  const coverage = computeFaceCoverage(face, renderedTile, allTiles, {
    runtimeFaceBehaviorProfile,
    outside: true,
    restrictOutsideNeighbour: true,
  });

  if (coverage.coveredFully) {
    return {
      outside: true,
      state: 'OUTISDE_COVERED',
      coveredFully: true,
      partially: false,
      renderable: false,
      reason: 'outside_covered',
      needsAxisCutting: false,
    };
  }

  if (coverage.partially) {
    return {
      outside: true,
      state: 'OUTSIDE_PARTIALLY_COVERED',
      coveredFully: false,
      partially: true,
      renderable: true,
      reason: 'outside_partially_covered',
      needsAxisCutting: coverage.needsAxisCutting,
    };
  }

  return {
    outside: true,
    state: 'OUTSIDE_UNCOVERED',
    coveredFully: false,
    partially: false,
    renderable: true,
    reason: 'outside_uncovered',
    needsAxisCutting: false,
  };
}

function computeFaceCoverage(face, renderedTile, allTiles, options = {}) {
  const faceGrid = face.box.grid;
  const faceMinOneRaw = roundRawCoord(getBoxRawMinByAxis(face.box, face.oneIndex));
  const faceMaxOneRaw = roundRawCoord(getBoxRawMaxByAxis(face.box, face.oneIndex));
  const faceMinTwoRaw = roundRawCoord(getBoxRawMinByAxis(face.box, face.twoIndex));
  const faceMaxTwoRaw = roundRawCoord(getBoxRawMaxByAxis(face.box, face.twoIndex));
  const totalCellsOne = Math.max(0, roundCellSpan(faceMaxOneRaw - faceMinOneRaw));
  const totalCellsTwo = Math.max(0, roundCellSpan(faceMaxTwoRaw - faceMinTwoRaw));
  const totalCells = totalCellsOne * totalCellsTwo;

  if (totalCells === 0) {
    return {
      coveredFully: false,
      partially: false,
      needsAxisCutting: false,
    };
  }

  const filled = new Uint8Array(totalCells);
  let filledCells = 0;
  let hasPartialByNonSolid = false;

  const outside = options.outside === true;
  const outsideNeighbourIndex = outside ? getOutsideNeighbourIndex(face) : null;
  const supportsCutting = options.runtimeFaceBehaviorProfile?.faceStates?.supportsCutting === true;

  for (const tile of allTiles) {
    if (tile.structureNoCollision === true)
      continue;
    if (!(doesProvideSolidFace(tile) || canBeRenderCombined(tile, renderedTile)))
      continue;

    for (const box of tile.boxes) {
      if (box.id === face.box.id)
        continue;
      if (outside && options.restrictOutsideNeighbour && !matchesOutsideNeighbour(face, box, outsideNeighbourIndex))
        continue;

      const overlap = projectFaceOverlapToGrid(face, box, faceGrid, faceMinOneRaw, faceMaxOneRaw, faceMinTwoRaw, faceMaxTwoRaw);
      if (!overlap)
        continue;

      if (!isFaceSolid(box, oppositeFacing(face.facing))) {
        if (!supportsCutting)
          hasPartialByNonSolid = true;
        continue;
      }

      const oneStart = clampCellIndex(cellStartFromRaw(overlap.minOneRaw - faceMinOneRaw), totalCellsOne);
      const oneEnd = clampCellIndex(cellEndFromRaw(overlap.maxOneRaw - faceMinOneRaw), totalCellsOne);
      const twoStart = clampCellIndex(cellStartFromRaw(overlap.minTwoRaw - faceMinTwoRaw), totalCellsTwo);
      const twoEnd = clampCellIndex(cellEndFromRaw(overlap.maxTwoRaw - faceMinTwoRaw), totalCellsTwo);

      if (oneEnd <= oneStart || twoEnd <= twoStart)
        continue;

      for (let one = oneStart; one < oneEnd; one++) {
        for (let two = twoStart; two < twoEnd; two++) {
          const index = one * totalCellsTwo + two;
          if (filled[index] !== 0)
            continue;
          filled[index] = 1;
          filledCells++;
        }
      }
    }
  }

  const coveredFully = filledCells === totalCells;
  const partially = !coveredFully && (filledCells > 0 || hasPartialByNonSolid);

  return {
    coveredFully,
    partially,
    needsAxisCutting: partially,
  };
}

function projectFaceOverlapToGrid(
  face,
  box,
  targetGrid,
  faceMinOneRaw,
  faceMaxOneRaw,
  faceMinTwoRaw,
  faceMaxTwoRaw
) {
  const minAxisRaw = roundRawCoord(convertRawCoord(getBoxRawMinByAxis(box, face.axisIndex), box.grid, targetGrid));
  const maxAxisRaw = roundRawCoord(convertRawCoord(getBoxRawMaxByAxis(box, face.axisIndex), box.grid, targetGrid));
  const matchesPlane = face.sign > 0
    ? Math.abs(minAxisRaw - face.originRaw) <= RAW_COORD_EPSILON
    : Math.abs(maxAxisRaw - face.originRaw) <= RAW_COORD_EPSILON;
  if (!matchesPlane)
    return null;

  const boxMinOneRaw = roundRawCoord(convertRawCoord(getBoxRawMinByAxis(box, face.oneIndex), box.grid, targetGrid));
  const boxMaxOneRaw = roundRawCoord(convertRawCoord(getBoxRawMaxByAxis(box, face.oneIndex), box.grid, targetGrid));
  const boxMinTwoRaw = roundRawCoord(convertRawCoord(getBoxRawMinByAxis(box, face.twoIndex), box.grid, targetGrid));
  const boxMaxTwoRaw = roundRawCoord(convertRawCoord(getBoxRawMaxByAxis(box, face.twoIndex), box.grid, targetGrid));

  const minOneRaw = Math.max(faceMinOneRaw, boxMinOneRaw);
  const maxOneRaw = Math.min(faceMaxOneRaw, boxMaxOneRaw);
  const minTwoRaw = Math.max(faceMinTwoRaw, boxMinTwoRaw);
  const maxTwoRaw = Math.min(faceMaxTwoRaw, boxMaxTwoRaw);

  if (maxOneRaw - minOneRaw <= RAW_COORD_EPSILON || maxTwoRaw - minTwoRaw <= RAW_COORD_EPSILON)
    return null;

  return {
    minOneRaw,
    maxOneRaw,
    minTwoRaw,
    maxTwoRaw,
  };
}
