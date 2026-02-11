import {
  faceVerticesFromPlaneRect
} from './polygon-ops.mjs';
import {
  getTransformableRenderCache,
  FACING_ORDER, facingAxis, facingPositive, axisToIndex
} from './transformable-cache.mjs';

export function buildFaceCandidates(tile, box) {
  return buildFaceCandidatesWithOptions(tile, box, {});
}

export function buildFaceCandidatesWithOptions(tile, box, options = {}) {
  if (box.kind === 'transformable' && box.transformData)
    return buildTransformableFaceCandidates(tile, box, options);
  return buildAabbFaceCandidates(tile, box);
}

function buildAabbFaceCandidates(tile, box) {
  const out = [];
  for (const facing of FACING_ORDER) {
    const bounds = boundsForFace(box, facing);
    const rect = faceRectFromBounds(bounds.axis, bounds.sign, bounds.origin, bounds.minOne, bounds.maxOne, bounds.minTwo, bounds.maxTwo);
    out.push({
      tile,
      box,
      facing,
      axis: bounds.axis,
      sign: bounds.sign,
      axisIndex: bounds.axisIndex,
      oneIndex: bounds.oneIndex,
      twoIndex: bounds.twoIndex,
      origin: bounds.origin,
      originRaw: bounds.originRaw,
      minOne: bounds.minOne,
      maxOne: bounds.maxOne,
      minTwo: bounds.minTwo,
      maxTwo: bounds.maxTwo,
      axisPolys: [rect],
      tiltedPolys: [],
    });
  }
  return out;
}

function buildTransformableFaceCandidates(tile, box, options = {}) {
  const cache = getTransformableRenderCache(box);
  const out = [];
  const allowTiltedOnlyTransformableFaces = options.allowTiltedOnlyTransformableFaces === true;

  for (const facing of FACING_ORDER) {
    const bounds = boundsForFace(box, facing);
    const faceCache = cache.faces[facing];
    if (!faceCache)
      continue;
    if (!allowTiltedOnlyTransformableFaces && !faceCache.isCompletelyFilled && faceCache.axisStrips.length === 0) {
      continue;
    }

    let axisPolys = [];
    if (faceCache.isCompletelyFilled) {
      axisPolys = [
        faceRectFromBounds(bounds.axis, bounds.sign, bounds.origin, bounds.minOne, bounds.maxOne, bounds.minTwo, bounds.maxTwo),
      ];
    } else if (faceCache.axisStrips.length > 0) {
      axisPolys = faceCache.axisStrips.map((poly) => poly.map((v) => v.slice()));
    }

    const tiltedPolys = faceCache.tiltedRender.map((poly) => poly.map((v) => v.slice()));
    if (axisPolys.length === 0 && tiltedPolys.length === 0)
      continue;

    out.push({
      tile,
      box,
      facing,
      axis: bounds.axis,
      sign: bounds.sign,
      axisIndex: bounds.axisIndex,
      oneIndex: bounds.oneIndex,
      twoIndex: bounds.twoIndex,
      origin: bounds.origin,
      originRaw: bounds.originRaw,
      minOne: bounds.minOne,
      maxOne: bounds.maxOne,
      minTwo: bounds.minTwo,
      maxTwo: bounds.maxTwo,
      axisPolys,
      tiltedPolys,
    });
  }

  return out;
}

function boundsForFace(box, facing) {
  const axis = facingAxis(facing);
  const axisIndex = axisToIndex(axis);
  const { one, two } = facePlaneAxes(facing);
  const sign = facingPositive(facing) ? 1 : -1;
  const originRaw = sign > 0 ? box[`max${axis}`] : box[`min${axis}`];
  const origin = sign > 0 ? box[`maxWorld${axis}`] : box[`minWorld${axis}`];

  const minOne = getBoxWorldMinByIndex(box, one);
  const maxOne = getBoxWorldMaxByIndex(box, one);
  const minTwo = getBoxWorldMinByIndex(box, two);
  const maxTwo = getBoxWorldMaxByIndex(box, two);

  return {
    axis: axis.toLowerCase(),
    sign,
    axisIndex,
    oneIndex: one,
    twoIndex: two,
    originRaw,
    origin,
    minOne,
    maxOne,
    minTwo,
    maxTwo,
  };
}

function facePlaneAxes(facing) {
  const axis = facingAxis(facing);
  if (axis === 'X')
    return { one: 1, two: 2 };
  if (axis === 'Y')
    return { one: 0, two: 2 };
  return { one: 0, two: 1 };
}

function getBoxWorldMinByIndex(box, index) {
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
