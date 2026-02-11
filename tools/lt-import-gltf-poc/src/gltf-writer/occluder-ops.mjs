import {
  BOUNDARY_EPSILON,
  faceVerticesFromPlaneRect,
  polygonCut2d, polygonIntersect2d, polygonsEqual,
  simplifyPolygon, isDegeneratePolygon, dedupePolygons
} from './polygon-ops.mjs';
import {
  getTransformableRenderCache,
  facingPositive
} from './transformable-cache.mjs';

export function applyOccluders(face, startPolys, renderedTile, allTiles) {
  let visible = startPolys.map((poly) => poly.map((v) => v.slice()));
  const outside = isOutsideFace(face);
  const outsideNeighbourIndex = outside ? getOutsideNeighbourIndex(face) : null;

  for (const tile of allTiles) {
    if (tile.structureNoCollision === true)
      continue;
    if (!(doesProvideSolidFace(tile) || canBeRenderCombined(tile, renderedTile)))
      continue;

    for (const box of tile.boxes) {
      if (box.id === face.box.id)
        continue;
      if (outside && !matchesOutsideNeighbour(face, box, outsideNeighbourIndex))
        continue;
      if (visible.length === 0)
        return visible;
      visible = applyFillFromBox(face, visible, box);
    }
  }

  return visible;
}

export function isOutsideFace(face) {
  const grid = face.box.grid;
  if (!Number.isInteger(grid) || grid <= 0)
    return false;
  return isRawOutsideFaceOrigin(face.originRaw, grid);
}

function isRawOutsideFaceOrigin(originRaw, grid) {
  return !(originRaw > 0 && originRaw < grid);
}

export function getOutsideNeighbourIndex(face) {
  const grid = face.box.grid;
  if (!Number.isInteger(grid) || grid <= 0)
    return null;
  const owner = face.sign > 0
    ? Math.floor((face.originRaw - 1) / grid)
    : Math.floor(face.originRaw / grid);
  return owner + face.sign;
}

export function matchesOutsideNeighbour(face, box, neighbourIndex) {
  if (neighbourIndex == null)
    return false;
  const grid = face.box.grid;
  if (!Number.isInteger(grid) || grid <= 0)
    return false;

  const minAxisRaw = getBoxRawMinByAxis(box, face.axisIndex);
  const maxAxisRaw = getBoxRawMaxByAxis(box, face.axisIndex);
  const index = face.sign > 0
    ? Math.floor(minAxisRaw / grid)
    : Math.floor((maxAxisRaw - 1) / grid);
  return index === neighbourIndex;
}

export function doesProvideSolidFace(tile) {
  return tile.providesSolidFace === true;
}

export function canBeRenderCombined(one, two) {
  return one.blockId === two.blockId && one.color === two.color;
}

function applyFillFromBox(face, visiblePolys, box) {
  if (!boxIntersectsFace(box, face))
    return visiblePolys;

  const opposite = oppositeFacing(face.facing);
  if (isFaceSolid(box, opposite)) {
    const minOne = Math.max(face.minOne, getBoxWorldMinByIndex(box, face.oneIndex));
    const maxOne = Math.min(face.maxOne, getBoxWorldMaxByIndex(box, face.oneIndex));
    const minTwo = Math.max(face.minTwo, getBoxWorldMinByIndex(box, face.twoIndex));
    const maxTwo = Math.min(face.maxTwo, getBoxWorldMaxByIndex(box, face.twoIndex));
    if (maxOne - minOne <= BOUNDARY_EPSILON || maxTwo - minTwo <= BOUNDARY_EPSILON)
      return visiblePolys;

    const cutter = faceRectFromBounds(face.axis, face.sign, face.origin, minOne, maxOne, minTwo, maxTwo);
    return cutPolygons2d(visiblePolys, [cutter], face.oneIndex, face.twoIndex, !facingPositive(face.facing));
  }

  const advanced = fillAdvancedCutters(face, box);
  if (advanced.length === 0)
    return visiblePolys;
  return cutPolygons2d(visiblePolys, advanced, face.oneIndex, face.twoIndex, !facingPositive(face.facing));
}

function fillAdvancedCutters(face, box) {
  if (box.kind !== 'transformable' || !box.transformData)
    return [];

  const cache = getTransformableRenderCache(box);
  const opposite = cache.faces[oppositeFacing(face.facing)];
  if (!opposite || opposite.axisStrips.length === 0)
    return [];

  const cutters = [];
  for (const strip of opposite.axisStrips) {
    const projected = projectPolygonToFaceAxis(strip, face.axisIndex, face.origin);
    if (projected && projected.length >= 3)
      cutters.push(projected);
  }
  return cutters;
}

function cutPolygons2d(polys, cutters, one, two, inverse) {
  let result = polys;
  for (const cutter of cutters) {
    const next = [];
    for (const poly of result) {
      if (!poly || poly.length < 3)
        continue;

      const cut = polygonCut2d(poly, cutter, one, two, inverse, false);
      if (cut.length === 0) {
        if (!polygonIntersect2d(poly, cutter, one, two, inverse, 0.001))
          next.push(poly);
        continue;
      }

      const unchanged = cut.length === 1 && polygonsEqual(cut[0], poly, 1e-4);
      if (unchanged && !polygonIntersect2d(poly, cutter, one, two, inverse, 0.001)) {
        next.push(poly);
        continue;
      }

      for (const piece of cut) {
        const simplified = simplifyPolygon(piece);
        if (simplified && !isDegeneratePolygon(simplified))
          next.push(simplified);
      }
    }
    result = dedupePolygons(next, 1e-4);
    if (result.length === 0)
      break;
  }
  return result;
}

function projectPolygonToFaceAxis(poly, axisIndex, value) {
  if (!poly || poly.length < 3)
    return null;
  const projected = new Array(poly.length);
  for (let i = 0; i < poly.length; i++) {
    const point = poly[i].slice();
    point[axisIndex] = value;
    projected[i] = point;
  }
  return projected;
}

function boxIntersectsFace(box, face) {
  const boxMinAxis = getBoxWorldMinByIndex(box, face.axisIndex);
  const boxMaxAxis = getBoxWorldMaxByIndex(box, face.axisIndex);
  const matchesPlane = face.sign > 0
    ? Math.abs(boxMinAxis - face.origin) <= BOUNDARY_EPSILON
    : Math.abs(boxMaxAxis - face.origin) <= BOUNDARY_EPSILON;
  if (!matchesPlane)
    return false;

  const boxMinOne = getBoxWorldMinByIndex(box, face.oneIndex);
  const boxMaxOne = getBoxWorldMaxByIndex(box, face.oneIndex);
  const boxMinTwo = getBoxWorldMinByIndex(box, face.twoIndex);
  const boxMaxTwo = getBoxWorldMaxByIndex(box, face.twoIndex);

  return (
    face.maxOne > boxMinOne + BOUNDARY_EPSILON &&
    face.minOne < boxMaxOne - BOUNDARY_EPSILON &&
    face.maxTwo > boxMinTwo + BOUNDARY_EPSILON &&
    face.minTwo < boxMaxTwo - BOUNDARY_EPSILON
  );
}

export function isFaceSolid(box, facing) {
  if (box.kind !== 'transformable' || !box.transformData)
    return true;
  const cache = getTransformableRenderCache(box);
  return cache.faces[facing]?.isCompletelyFilled === true;
}

export function oppositeFacing(facing) {
  switch (facing) {
    case 'DOWN': return 'UP';
    case 'UP': return 'DOWN';
    case 'NORTH': return 'SOUTH';
    case 'SOUTH': return 'NORTH';
    case 'WEST': return 'EAST';
    case 'EAST': return 'WEST';
    default: return 'WEST';
  }
}

export function getBoxWorldMinByIndex(box, index) {
  if (index === 0)
    return box.minWorldX;
  if (index === 1)
    return box.minWorldY;
  return box.minWorldZ;
}

function getBoxWorldMaxByIndex(box, index) {
  if (index === 0)
    return box.maxWorldX;
  if (index === 1)
    return box.maxWorldY;
  return box.maxWorldZ;
}

export function getBoxRawMinByAxis(box, index) {
  if (index === 0)
    return box.minX;
  if (index === 1)
    return box.minY;
  return box.minZ;
}

export function getBoxRawMaxByAxis(box, index) {
  if (index === 0)
    return box.maxX;
  if (index === 1)
    return box.maxY;
  return box.maxZ;
}

function faceRectFromBounds(axis, sign, c, a0, a1, b0, b1) {
  return faceVerticesFromPlaneRect({
    axis,
    sign,
    c,
    a0,
    a1,
    b0,
    b1,
  });
}
