import {
  EPSILON, CUT_EPSILON, ZERO_VEC3,
  sub3f, cross3f, dot3f,
  normalizeVec, vectorsParallel, vectorEpsilonEquals, pointsEqual,
  simplifyPolygon, isDegeneratePolygon, polygonsEqual, dedupePolygons,
  createPlane, isInFront, clipPolygonByPlane,
  polygonIntersect2d, polygonCut2d
} from './polygon-ops.mjs';

const BOX_CORNER_ORDER = [
  'EUN',
  'EUS',
  'EDN',
  'EDS',
  'WUN',
  'WUS',
  'WDN',
  'WDS',
];

const FACE_DEFS = [
  // Matches CreativeCore BoxFace definitions and Facing ordinals.
  { facing: 'EAST', facingOrdinal: 5, corners: ['EUS', 'EDS', 'EDN', 'EUN'] },
  { facing: 'WEST', facingOrdinal: 4, corners: ['WUN', 'WDN', 'WDS', 'WUS'] },
  { facing: 'UP', facingOrdinal: 1, corners: ['WUN', 'WUS', 'EUS', 'EUN'] },
  { facing: 'DOWN', facingOrdinal: 0, corners: ['WDS', 'WDN', 'EDN', 'EDS'] },
  { facing: 'SOUTH', facingOrdinal: 3, corners: ['WUS', 'WDS', 'EDS', 'EUS'] },
  { facing: 'NORTH', facingOrdinal: 2, corners: ['EUN', 'EDN', 'WDN', 'WUN'] },
];

const FACE_DEF_BY_FACING = new Map(FACE_DEFS.map((f) => [f.facing, f]));
export const FACING_ORDER = ['DOWN', 'UP', 'NORTH', 'SOUTH', 'WEST', 'EAST'];
export const FACING_NORMAL = {
  DOWN: [0, -1, 0],
  UP: [0, 1, 0],
  NORTH: [0, 0, -1],
  SOUTH: [0, 0, 1],
  WEST: [-1, 0, 0],
  EAST: [1, 0, 0],
};

export { FACE_DEF_BY_FACING, BOX_CORNER_ORDER, FACE_DEFS };

export function getTransformableRenderCache(box) {
  if (box.transformCache)
    return box.transformCache;

  const empty = { faces: Object.fromEntries(FACING_ORDER.map((f) => [f, { axisStrips: [], tiltedRender: [], isCompletelyFilled: false }])) };
  if (!Array.isArray(box.transformData) || box.transformData.length === 0) {
    box.transformCache = empty;
    return empty;
  }

  const { faceCaches, baseCorners } = computeTransformableRawFaceCache(box);
  const invGrid = 1 / box.grid;
  const faces = {};

  for (const facing of FACING_ORDER) {
    const faceCache = faceCaches[facing];
    const axisFace = FACE_DEF_BY_FACING.get(facing);
    const fullRaw = axisFace ? createStrip(axisFace.corners, baseCorners) : null;
    const axisStrips = (faceCache.axisStrips ?? [])
      .filter((poly) => poly && poly.length >= 3 && !isDegeneratePolygon(poly))
      .map((poly) => poly.map((v) => [v[0] * invGrid, v[1] * invGrid, v[2] * invGrid]));
    const tiltedRender = (faceCache.tiltedRender ?? [])
      .filter((poly) => poly && poly.length >= 3 && !isDegeneratePolygon(poly))
      .map((poly) => poly.map((v) => [v[0] * invGrid, v[1] * invGrid, v[2] * invGrid]));

    const isCompletelyFilled = (
      !faceCache.tiltedStrip1 &&
      !faceCache.tiltedStrip2 &&
      faceCache.axisStrips.length === 1 &&
      fullRaw &&
      polygonsEqual(faceCache.axisStrips[0], fullRaw, 1e-4)
    );

    faces[facing] = {
      axisStrips,
      tiltedRender,
      isCompletelyFilled,
    };
  }

  box.transformCache = { faces };
  return box.transformCache;
}

export function collectTransformableDiagnostics(box) {
  if (box.kind !== 'transformable')
    return null;
  if (!Array.isArray(box.transformData) || box.transformData.length === 0)
    return null;

  const { faceCaches } = computeTransformableRawFaceCache(box);
  const out = {};

  for (const facing of FACING_ORDER) {
    const faceCache = faceCaches[facing];
    const rawAxisStrips = faceCache.axisStrips ?? [];
    const rawTiltedRender = faceCache.tiltedRender ?? [];
    const rawAxisDegenerateCount = rawAxisStrips.reduce(
      (sum, poly) => sum + (poly && poly.length >= 3 && isDegeneratePolygon(poly) ? 1 : 0),
      0
    );
    const rawTiltedDegenerateCount = rawTiltedRender.reduce(
      (sum, poly) => sum + (poly && poly.length >= 3 && isDegeneratePolygon(poly) ? 1 : 0),
      0
    );

    out[facing] = {
      rawAxisStripCount: rawAxisStrips.length,
      rawTiltedRenderCount: rawTiltedRender.length,
      rawAxisDegenerateCount,
      rawTiltedDegenerateCount,
    };
  }

  return out;
}

function computeTransformableRawFaceCache(box) {
  const corners = decodeTransformableCorners(box);
  const baseCorners = decodeBaseCorners(box);
  const indicator = (box.transformData[0] | 0);
  const faceCaches = {};
  for (const facing of FACING_ORDER) {
    faceCaches[facing] = {
      facing,
      convex: true,
      tiltedStrip1: null,
      tiltedStrip2: null,
      cutPlane1: null,
      cutPlane2: null,
      axisStrips: [],
      tiltedRender: [],
    };
  }

  const axisPlanes = {};
  for (const facing of FACING_ORDER)
    axisPlanes[facing] = planeForFacing(box, facing);

  for (const faceDef of FACE_DEFS) {
    const cache = faceCaches[faceDef.facing];
    const flipped = bitIs(indicator, 24 + faceDef.facingOrdinal);
    const triAKeys = flipped
      ? [faceDef.corners[0], faceDef.corners[1], faceDef.corners[3]]
      : [faceDef.corners[0], faceDef.corners[1], faceDef.corners[2]];
    const triBKeys = flipped
      ? [faceDef.corners[1], faceDef.corners[2], faceDef.corners[3]]
      : [faceDef.corners[0], faceDef.corners[2], faceDef.corners[3]];

    const axisIndex = axisToIndex(facingAxis(faceDef.facing));
    const firstSame = checkEqualAxis(corners, baseCorners, triAKeys, axisIndex);
    const secondSame = checkEqualAxis(corners, baseCorners, triBKeys, axisIndex);
    if (firstSame && secondSame)
      continue;

    const normalA = normalizeVec(triangleNormal(corners[triAKeys[0]], corners[triAKeys[1]], corners[triAKeys[2]]));
    const normalB = normalizeVec(triangleNormal(corners[triBKeys[0]], corners[triBKeys[1]], corners[triBKeys[2]]));

    let strip1 = null;
    let strip2 = null;
    let plane1 = null;
    let plane2 = null;

    if (vectorsParallel(normalA, normalB, EPSILON)) {
      if (!firstSame && !vectorEpsilonEquals(normalA, ZERO_VEC3, EPSILON)) {
        strip1 = createStrip(faceDef.corners, corners);
        plane1 = strip1 ? createPlane(corners[triAKeys[0]], normalA) : null;
      }
    } else {
      if (!firstSame && !vectorEpsilonEquals(normalA, ZERO_VEC3, EPSILON)) {
        strip1 = createStrip(triAKeys, corners);
        plane1 = strip1 ? createPlane(corners[triAKeys[0]], normalA) : null;
      }
      if (!secondSame && !vectorEpsilonEquals(normalB, ZERO_VEC3, EPSILON)) {
        strip2 = createStrip(triBKeys, corners);
        plane2 = strip2 ? createPlane(corners[triBKeys[0]], normalB) : null;
      }
    }

    if (strip1 && (!plane1 || plane1.invalid))
      strip1 = null;
    if (strip2 && (!plane2 || plane2.invalid))
      strip2 = null;

    if (strip1 && strip2 && plane1) {
      for (const vec of strip2) {
        const front = isInFront(plane1, vec, EPSILON);
        if (front === true) {
          cache.convex = false;
          break;
        }
      }
    }

    for (const facing of FACING_ORDER) {
      if (strip1)
        strip1 = clipPolygonByPlane(strip1, axisPlanes[facing], CUT_EPSILON);
      if (strip2)
        strip2 = clipPolygonByPlane(strip2, axisPlanes[facing], CUT_EPSILON);
    }

    cache.tiltedStrip1 = strip1;
    cache.tiltedStrip2 = strip2;
    cache.cutPlane1 = plane1;
    cache.cutPlane2 = plane2;

    if (strip1 && plane1) {
      const target = nearestFacing(plane1.normal);
      faceCaches[target].tiltedRender.push(strip1);
    }
    if (strip2 && plane2) {
      const target = nearestFacing(plane2.normal);
      faceCaches[target].tiltedRender.push(strip2);
    }
  }

  for (const facing of FACING_ORDER) {
    const axisFace = FACE_DEF_BY_FACING.get(facing);
    const axisCache = faceCaches[facing];
    axisCache.axisStrips = [createStrip(axisFace.corners, baseCorners)].filter(Boolean);

    for (const otherFacing of FACING_ORDER) {
      if (axisCache.axisStrips.length === 0)
        break;

      const source = faceCaches[otherFacing];
      let cutPlane1 = null;
      let cutPlane2 = null;

      if (!source.tiltedStrip1 && !source.tiltedStrip2) {
        cutPlane1 = source.cutPlane1;
        cutPlane2 = source.cutPlane2;
      } else {
        if (!source.convex || (source.tiltedStrip1 && source.tiltedStrip2)) {
          cutPlane1 = source.cutPlane1;
          cutPlane2 = source.cutPlane2;
        } else if (source.tiltedStrip1) {
          cutPlane1 = source.cutPlane1;
        } else if (source.tiltedStrip2) {
          cutPlane1 = source.cutPlane2;
        }
      }

      // Hybrid epsilon strategy to resolve parity divergence:
      // - UP faces (extras): Need 5e-4 to remove "On Plane" artifacts (Mod parity).
      // - DOWN faces (missing): Need 1e-7 to keep "Back" faces that Mod kept via looser isFacing check.
      // - Default (Mod/Java): 5e-4.
      const epsilon = facing === 'DOWN' ? 1e-7 : 5e-4;

      if (source.convex) {
        if (cutPlane1)
          axisCache.axisStrips = cutAxisStripsSingle(axisCache.axisStrips, facing, cutPlane1, epsilon);
        if (cutPlane2)
          axisCache.axisStrips = cutAxisStripsSingle(axisCache.axisStrips, facing, cutPlane2, epsilon);
      } else {
        axisCache.axisStrips = cutAxisStripsDual(axisCache.axisStrips, facing, cutPlane1, cutPlane2, epsilon);
      }
    }
  }

  return { faceCaches, baseCorners };
}

function cutAxisStripsSingle(strips, facing, plane, epsilon) {
  if (!plane || plane.invalid || planeIsFacing(plane, facing))
    return strips;
  
  const out = [];
  for (const strip of strips) {
    const clipped = clipPolygonByPlane(strip, plane, epsilon);
    if (clipped)
      out.push(clipped);
  }
  return out;
}

function cutAxisStripsDual(strips, facing, plane1, plane2, epsilon) {
  if ((!plane1 || plane1.invalid) && (!plane2 || plane2.invalid))
    return strips;

  if (!plane1 || plane1.invalid)
    return cutAxisStripsSingle(strips, facing, plane2, epsilon);
  if (!plane2 || plane2.invalid)
    return cutAxisStripsSingle(strips, facing, plane1, epsilon);

  const { one, two } = facePlaneAxes(facing);
  const inverse = facingPositive(facing);
  const out = [];

  for (const strip of strips) {
    const cut1 = plane1 && !plane1.invalid ? clipPolygonByPlane(strip, plane1, epsilon) : null;
    const cut2 = plane2 && !plane2.invalid ? clipPolygonByPlane(strip, plane2, epsilon) : null;

    if (cut1 && cut2) {
      if (polygonIntersect2d(cut1, cut2, one, two, inverse, 0.001)) {
        const fans = polygonCut2d(cut1, cut2, one, two, inverse, false);
        if (cut2.length >= 3)
          out.push(cut2);
        for (const fan of fans) {
          if (fan.length >= 3)
            out.push(fan);
        }
      } else {
        out.push(cut1, cut2);
      }
    } else if (cut1) {
      out.push(cut1);
    } else if (cut2) {
      out.push(cut2);
    }
  }
  return dedupePolygons(out, 1e-4);
}

function decodeTransformableCorners(box) {
  const data = box.transformData;
  const indicator = data[0] | 0;
  let activeBits = 0;

  const out = {};
  for (let i = 0; i < BOX_CORNER_ORDER.length; i++) {
    const corner = BOX_CORNER_ORDER[i];
    const base = baseCorner(box, corner);

    let dx = 0;
    let dy = 0;
    let dz = 0;

    const bit = i * 3;
    if (bitIs(indicator, bit)) {
      dx = getDataShort(data, activeBits);
      activeBits++;
    }
    if (bitIs(indicator, bit + 1)) {
      dy = getDataShort(data, activeBits);
      activeBits++;
    }
    if (bitIs(indicator, bit + 2)) {
      dz = getDataShort(data, activeBits);
      activeBits++;
    }

    out[corner] = [base[0] + dx, base[1] + dy, base[2] + dz];
  }

  return out;
}

function decodeBaseCorners(box) {
  const out = {};
  for (const corner of BOX_CORNER_ORDER)
    out[corner] = baseCorner(box, corner);
  return out;
}

function baseCorner(box, corner) {
  const x = corner[0] === 'E' ? box.maxX : box.minX;
  const y = corner[1] === 'U' ? box.maxY : box.minY;
  const z = corner[2] === 'S' ? box.maxZ : box.minZ;
  return [x, y, z];
}

function bitIs(value, bit) {
  return ((value >>> bit) & 1) === 1;
}

function getDataShort(data, index) {
  const realIndex = (index >> 1) + 1;
  if (realIndex >= data.length)
    return 0;

  const word = data[realIndex] | 0;
  let out;
  if ((index & 1) === 1)
    out = word & 0xffff;
  else
    out = (word >>> 16) & 0xffff;

  if ((out & 0x8000) !== 0)
    out -= 0x10000;
  return out;
}

function planeForFacing(box, facing) {
  const normal = FACING_NORMAL[facing];
  const origin = [0, 0, 0];
  const axis = facingAxis(facing);
  const axisIndex = axisToIndex(axis);
  origin[axisIndex] = facingPositive(facing) ? box[`max${axis}`] : box[`min${axis}`];
  return createPlane(origin, normal);
}

export function facingAxis(facing) {
  if (facing === 'EAST' || facing === 'WEST')
    return 'X';
  if (facing === 'UP' || facing === 'DOWN')
    return 'Y';
  return 'Z';
}

export function facingPositive(facing) {
  return facing === 'EAST' || facing === 'UP' || facing === 'SOUTH';
}

export function axisToIndex(axis) {
  if (axis === 'X')
    return 0;
  if (axis === 'Y')
    return 1;
  return 2;
}

function checkEqualAxis(corners, baseCorners, cornerKeys, axisIndex) {
  for (const key of cornerKeys) {
    if (Math.abs(corners[key][axisIndex] - baseCorners[key][axisIndex]) > EPSILON)
      return false;
  }
  return true;
}

function createStrip(cornerKeys, corners) {
  const out = [];
  for (const key of cornerKeys) {
    const point = corners[key];
    let duplicate = false;
    for (const existing of out) {
      if (pointsEqual(existing, point, EPSILON)) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate)
      out.push(point.slice());
  }
  return simplifyPolygon(out);
}

function triangleNormal(a, b, c) {
  return cross3f(sub3f(b, a), sub3f(c, a));
}

function planeIsFacing(plane, facing) {
  const n = FACING_NORMAL[facing];
  const tol = 2e-3;
  return (
    Math.abs(plane.normal[0] - n[0]) <= tol &&
    Math.abs(plane.normal[1] - n[1]) <= tol &&
    Math.abs(plane.normal[2] - n[2]) <= tol
  );
}

function nearestFacing(normal) {
  if (
    (normal[0] === 0 || Object.is(normal[0], -0)) &&
    (normal[1] === 0 || Object.is(normal[1], -0)) &&
    (normal[2] === 0 || Object.is(normal[2], -0))
  ) {
    return 'DOWN';
  }

  // Match CreativeCore Facing.nearest(float x, float y, float z):
  // iterate Facing.VALUES order and select first strict-max dot product.
  let facing = 'DOWN';
  let distance = Number.NEGATIVE_INFINITY;
  for (const candidate of FACING_ORDER) {
    const axisNormal = FACING_NORMAL[candidate];
    const dot = (
      normal[0] * axisNormal[0] +
      normal[1] * axisNormal[1] +
      normal[2] * axisNormal[2]
    );
    if (dot > distance) {
      distance = dot;
      facing = candidate;
    }
  }
  return facing;
}

function facePlaneAxes(facing) {
  const axis = facingAxis(facing);
  if (axis === 'X')
    return { one: 1, two: 2 };
  if (axis === 'Y')
    return { one: 0, two: 2 };
  return { one: 0, two: 1 };
}
