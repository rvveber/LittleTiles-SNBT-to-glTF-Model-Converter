// Math constants
export const EPSILON = 5e-4;
export const CUT_EPSILON = 5e-4;
export const BOUNDARY_EPSILON = 1e-9;
export const RAW_COORD_EPSILON = 1e-6;
export const ZERO_VEC3 = [0, 0, 0];
const RAY2D_PARALLEL_ERROR = Symbol('ray2d-parallel');

// Vector operations
export function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function sub3f(a, b) {
  return [
    Math.fround(a[0] - b[0]),
    Math.fround(a[1] - b[1]),
    Math.fround(a[2] - b[2]),
  ];
}

export function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function cross3f(a, b) {
  return [
    Math.fround(Math.fround(a[1] * b[2]) - Math.fround(a[2] * b[1])),
    Math.fround(Math.fround(a[2] * b[0]) - Math.fround(a[0] * b[2])),
    Math.fround(Math.fround(a[0] * b[1]) - Math.fround(a[1] * b[0])),
  ];
}

export function dot3f(a, b) {
  return Math.fround(
    Math.fround(Math.fround(a[0] * b[0]) + Math.fround(a[1] * b[1])) +
    Math.fround(a[2] * b[2])
  );
}

export function normalLength(n) {
  return Math.fround(Math.hypot(n[0], n[1], n[2]));
}

export function normalizeVec(v) {
  const len = normalLength(v);
  return [Math.fround(v[0] / len), Math.fround(v[1] / len), Math.fround(v[2] / len)];
}

export function vectorsParallel(a, b, epsilon) {
  return (
    Math.abs(a[0] - b[0]) <= epsilon &&
    Math.abs(a[1] - b[1]) <= epsilon &&
    Math.abs(a[2] - b[2]) <= epsilon
  );
}

export function vectorEpsilonEquals(a, b, epsilon) {
  for (let i = 0; i < 3; i++) {
    const diff = a[i] - b[i];
    if (Number.isNaN(diff))
      return false;
    if (Math.abs(diff) > epsilon)
      return false;
  }
  return true;
}

export function pointsEqual(a, b, epsilon) {
  return (
    Math.abs(a[0] - b[0]) <= epsilon &&
    Math.abs(a[1] - b[1]) <= epsilon &&
    Math.abs(a[2] - b[2]) <= epsilon
  );
}

// Polygon check operations
export function isDegeneratePolygon(poly) {
  if (!poly || poly.length < 3)
    return true;
  const origin = poly[0];
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 1; i + 1 < poly.length; i++) {
    const a = sub3(poly[i], origin);
    const b = sub3(poly[i + 1], origin);
    const c = cross3(a, b);
    nx += c[0];
    ny += c[1];
    nz += c[2];
  }
  return nx * nx + ny * ny + nz * nz < 1e-12;
}

export function hasRenderablePolygon(polys) {
  for (const poly of polys ?? []) {
    if (!poly || poly.length < 3 || isDegeneratePolygon(poly))
      continue;
    return true;
  }
  return false;
}

export function dedupePolygons(polys, epsilon) {
  const out = [];
  for (const poly of polys) {
    let duplicate = false;
    for (const existing of out) {
      if (polygonsEqual(existing, poly, epsilon)) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate)
      out.push(poly);
  }
  return out;
}

export function polygonsEqual(a, b, epsilon) {
  if (a.length !== b.length)
    return false;
  for (const p of a) {
    let found = false;
    for (const q of b) {
      if (pointsEqual(p, q, epsilon)) {
        found = true;
        break;
      }
    }
    if (!found)
      return false;
  }
  return true;
}

export function simplifyPolygon(poly) {
  if (!poly || poly.length < 3)
    return null;

  const out = [];
  for (const point of poly) {
    if (out.length === 0 || !pointsEqual(out[out.length - 1], point, EPSILON))
      out.push(point.slice());
  }

  if (out.length > 1 && pointsEqual(out[0], out[out.length - 1], EPSILON))
    out.pop();

  if (out.length >= 3 && isPointBetween(out[out.length - 2], out[0], out[out.length - 1], EPSILON))
    out.pop();
  if (out.length >= 3 && isPointBetween(out[out.length - 1], out[1], out[0], EPSILON))
    out.shift();

  if (out.length < 3)
    return null;
  if (isDegeneratePolygon(out))
    return null;
  return out;
}

function isPointBetween(start, end, between, epsilon) {
  const x = (end[1] - start[1]) * (between[2] - start[2]) - (end[2] - start[2]) * (between[1] - start[1]);
  const y = (between[0] - start[0]) * (end[2] - start[2]) - (between[2] - start[2]) * (end[0] - start[0]);
  const z = (end[0] - start[0]) * (between[1] - start[1]) - (end[1] - start[1]) * (between[0] - start[0]);
  const test = Math.abs(x) + Math.abs(y) + Math.abs(z);
  return test < epsilon;
}

// Plane/Cut operations
export function createPlane(origin, normal) {
  const n = normalizeVec(normal);
  return {
    origin: [
      Math.fround(origin[0]),
      Math.fround(origin[1]),
      Math.fround(origin[2]),
    ],
    normal: n,
    invalid: Number.isNaN(n[0]) || Number.isNaN(n[1]) || Number.isNaN(n[2]),
  };
}

export function isInFront(plane, point, epsilon) {
  const rel = sub3f(point, plane.origin);
  const value = dot3f(plane.normal, rel);
  if (value < 0 ? value > -epsilon : value < epsilon)
    return null;
  return value > 0;
}

export function planeIntersectSegment(plane, start, end) {
  const dir = sub3f(end, start);
  const len = normalLength(dir);
  if (len <= EPSILON)
    return null;
  const unitDir = [
    Math.fround(dir[0] / len),
    Math.fround(dir[1] / len),
    Math.fround(dir[2] / len),
  ];
  const denom = dot3f(plane.normal, unitDir);
  if (Math.abs(denom) <= EPSILON)
    return null;
  const t = Math.fround((dot3f(plane.normal, plane.origin) - dot3f(plane.normal, start)) / denom);
  return [
    Math.fround(start[0] + unitDir[0] * t),
    Math.fround(start[1] + unitDir[1] * t),
    Math.fround(start[2] + unitDir[2] * t),
  ];
}

export function clipPolygonByPlane(polygon, plane, epsilon) {
  if (!polygon || polygon.length < 3 || !plane || plane.invalid)
    return null;

  // Keep this branch as close as possible to CreativeCore VectorFan.cutInternal.
  const cutted = new Array(polygon.length);
  let allTheSame = true;
  let allValue = null;
  for (let i = 0; i < polygon.length; i++) {
    cutted[i] = isInFront(plane, polygon[i], epsilon);
    if (cutted[i] != null)
      cutted[i] = !cutted[i];
    if (allTheSame) {
      if (i === 0) {
        allValue = cutted[i];
      } else if (allValue == null) {
        allValue = cutted[i];
      } else if (allValue !== cutted[i] && cutted[i] != null) {
        allTheSame = false;
      }
    }
  }

  if (allTheSame) {
    if (allValue === true)
      return polygon.map((v) => v.slice());
    return null;
  }

  const right = [];
  let beforeCutted = cutted[cutted.length - 1];
  let beforeVec = polygon[polygon.length - 1];

  for (let i = 0; i < polygon.length; i++) {
    const vec = polygon[i];

    if (beforeCutted === false && cutted[i] === true) {
      const intersection = planeIntersectSegment(plane, vec, beforeVec);
      if (intersection)
        right.push(intersection);
      right.push(vec.slice());
    } else if (beforeCutted === true && cutted[i] === false) {
      const intersection = planeIntersectSegment(plane, vec, beforeVec);
      if (intersection)
        right.push(intersection);
    } else if (cutted[i] == null) {
      right.push(vec.slice());
    } else if (cutted[i] === true) {
      right.push(vec.slice());
    }

    beforeCutted = cutted[i];
    beforeVec = vec;
  }

  if (
    right.length >= 3 &&
    isPointBetween(right[right.length - 2], right[0], right[right.length - 1], EPSILON)
  ) {
    right.pop();
  }

  if (
    right.length >= 3 &&
    isPointBetween(right[right.length - 1], right[1], right[0], EPSILON)
  ) {
    right.shift();
  }

  if (right.length < 3)
    return null;
  return right;
}

// 2D PolygonOps
export function polygonIntersect2d(polyA, polyB, one, two, inverse, epsilon) {
  if (polygonEqualsCyclic2d(polyA, polyB, one, two, EPSILON))
    return true;

  let parallel = 0;
  const ray1 = createRay2d(one, two, 0, 0, 0, 0);
  const ray2 = createRay2d(one, two, 0, 0, 0, 0);

  let before1 = polyA[0];
  for (let i = 1; i <= polyA.length; i++) {
    const vec1 = i === polyA.length ? polyA[0] : polyA[i];
    ray2dSetFromPoints(ray1, before1, vec1);

    let onEdgeLow = false;
    let onEdgeHigh = false;
    let doSideCheck = false;

    let before2 = polyB[0];
    for (let j = 1; j <= polyB.length; j++) {
      const vec2 = j === polyB.length ? polyB[0] : polyB[j];
      ray2dSetFromPoints(ray2, before2, vec2);

      try {
        const t = ray2dIntersectWhen(ray1, ray2);
        const otherT = ray2dIntersectWhen(ray2, ray1);
        if (t > epsilon && t < 1 - epsilon && otherT > epsilon && otherT < 1 - epsilon)
          return true;
        if (within(otherT, 0, 1, epsilon)) {
          if (equalsWithEps(t, 0, epsilon))
            onEdgeLow = true;
          if (equalsWithEps(t, 1, epsilon))
            onEdgeHigh = true;
        }
        if (onEdgeLow && onEdgeHigh)
          doSideCheck = true;
      } catch (error) {
        if (error !== RAY2D_PARALLEL_ERROR)
          throw error;

        let startT;
        let endT;
        if (Math.abs(ray1.directionOne) <= EPSILON) {
          startT = ray2dGetT(ray1, ray1.two, ray2.originTwo);
          endT = ray2dGetT(ray1, ray1.two, ray2.originTwo + ray2.directionTwo);
        } else {
          startT = ray2dGetT(ray1, ray1.one, ray2.originOne);
          endT = ray2dGetT(ray1, ray1.one, ray2.originOne + ray2.directionOne);
        }
        if (
          (startT > epsilon && startT < 1 - epsilon) ||
          (endT > epsilon && endT < 1 - epsilon)
        ) {
          parallel++;
          if (parallel > 1)
            return true;
        }
      }

      before2 = vec2;
    }

    let side = null;
    if (doSideCheck) {
      for (const vec of polyB) {
        const result = ray2dIsCoordinateToTheRight(ray1, vec[one], vec[two]);
        if (result != null) {
          if (side == null)
            side = result;
          else if (side !== result)
            return true;
        }
      }
    }

    before1 = vec1;
  }

  return (
    polygonIsInside2d(polyA, one, two, polyB, inverse) ||
    polygonIsInside2d(polyB, one, two, polyA, inverse)
  );
}

export function polygonCut2d(poly, cutter, one, two, inverse, takeInner) {
  const done = [];
  let toCut = poly;
  let before = cutter[0];
  const ray = createRay2d(one, two, 0, 0, 0, 0);

  for (let i = 1; i <= cutter.length; i++) {
    const vec = i === cutter.length ? cutter[0] : cutter[i];
    ray2dSet(ray, one, two, before[one], before[two], vec[one], vec[two]);

    toCut = polygonCutByRay2d(toCut, ray, one, two, takeInner ? null : done, inverse);
    if (!toCut)
      return done;

    before = vec;
  }

  if (takeInner)
    done.push(toCut);
  return done;
}

function polygonIsInside2d(subject, one, two, other, inverse) {
  const temp = createRay2d(one, two, 0, 0, 0, 0);

  for (const point of other) {
    const pointOne = point[one];
    const pointTwo = point[two];

    let inside = false;
    let index = 0;
    while (index < subject.length - 2) {
      const first = subject[0];
      const second = subject[index + 1];
      const third = subject[index + 2];

      ray2dSet(temp, one, two, first[one], first[two], second[one], second[two]);
      let result = ray2dIsCoordinateToTheRight(temp, pointOne, pointTwo);
      if (result == null || (result === false) === inverse) {
        ray2dSet(temp, one, two, second[one], second[two], third[one], third[two]);
        result = ray2dIsCoordinateToTheRight(temp, pointOne, pointTwo);
        if (result == null || (result === false) === inverse) {
          ray2dSet(temp, one, two, third[one], third[two], first[one], first[two]);
          result = ray2dIsCoordinateToTheRight(temp, pointOne, pointTwo);
          if (result == null || (result === false) === inverse) {
            inside = true;
            break;
          }
        }
      }

      index += 1;
    }

    if (!inside)
      return false;
  }

  return true;
}

function polygonCutByRay2d(poly, ray, one, two, done, inverse) {
  let allSame = true;
  let allValue = null;
  const cutted = new Array(poly.length);
  for (let i = 0; i < poly.length; i++) {
    let value = ray2dIsCoordinateToTheRight(ray, poly[i][one], poly[i][two]);
    if (inverse && value != null)
      value = !value;
    cutted[i] = value;

    if (allSame) {
      if (i === 0) {
        allValue = value;
      } else {
        if (allValue == null)
          allValue = value;
        else if (allValue !== value && value != null)
          allSame = false;
      }
    }
  }

  if (allSame) {
    if (allValue == null)
      return null;
    if (allValue === true)
      return poly;
    if (done != null)
      done.push(poly);
    return null;
  }

  const third = thirdAxisIndex(one, two);
  const thirdValue = poly[0][third];
  const left = [];
  const right = [];

  let beforeCutted = cutted[cutted.length - 1];
  let beforeVec = poly[poly.length - 1];
  for (let i = 0; i < poly.length; i++) {
    const vec = poly[i];
    const value = cutted[i];

    if (value === true) {
      if (beforeCutted === false) {
        const inter = ray2dIntersectSegment(ray, vec, beforeVec, thirdValue);
        if (inter) {
          left.push(inter);
          right.push(inter);
        }
      }
      right.push(vec);
    } else if (value === false) {
      if (beforeCutted === true) {
        const inter = ray2dIntersectSegment(ray, vec, beforeVec, thirdValue);
        if (inter) {
          left.push(inter);
          right.push(inter);
        }
      }
      left.push(vec);
    } else {
      left.push(vec);
      right.push(vec);
    }

    beforeCutted = value;
    beforeVec = vec;
  }

  const leftPoly = simplifyPolygon(left);
  if (leftPoly && done != null)
    done.push(leftPoly);

  const rightPoly = simplifyPolygon(right);
  return rightPoly;
}

function createRay2d(one, two, startOne, startTwo, endOne, endTwo) {
  return {
    one,
    two,
    originOne: startOne,
    originTwo: startTwo,
    directionOne: endOne - startOne,
    directionTwo: endTwo - startTwo,
  };
}

function ray2dSet(ray, one, two, startOne, startTwo, endOne, endTwo) {
  ray.one = one;
  ray.two = two;
  ray.originOne = startOne;
  ray.originTwo = startTwo;
  ray.directionOne = endOne - startOne;
  ray.directionTwo = endTwo - startTwo;
}

function ray2dSetFromPoints(ray, start, end) {
  ray.originOne = start[ray.one];
  ray.originTwo = start[ray.two];
  ray.directionOne = end[ray.one] - start[ray.one];
  ray.directionTwo = end[ray.two] - start[ray.two];
}

function ray2dGetOrigin(ray, axis) {
  return axis === ray.one ? ray.originOne : ray.originTwo;
}

function ray2dGetDirection(ray, axis) {
  return axis === ray.one ? ray.directionOne : ray.directionTwo;
}

function ray2dGetOther(ray, axis) {
  return axis === ray.one ? ray.two : ray.one;
}

function ray2dGetT(ray, axis, value) {
  return (value - ray2dGetOrigin(ray, axis)) / ray2dGetDirection(ray, axis);
}

function ray2dGet(ray, axis, value) {
  const other = ray2dGetOther(ray, axis);
  return ray2dGetOrigin(ray, other) + ray2dGetDirection(ray, other) * (value - ray2dGetOrigin(ray, axis)) / ray2dGetDirection(ray, axis);
}

function ray2dIsCoordinateOnLine(ray, one, two) {
  if (Math.abs(ray.directionOne) <= EPSILON)
    return equalsWithEps(ray.originOne, one, EPSILON);
  if (Math.abs(ray.directionTwo) <= EPSILON)
    return equalsWithEps(ray.originTwo, two, EPSILON);
  return equalsWithEps(ray2dGet(ray, ray.one, one), two, EPSILON);
}

function ray2dIsCoordinateToTheRight(ray, one, two) {
  const tempOne = one - ray.originOne;
  const tempTwo = two - ray.originTwo;
  const result = ray.directionOne * tempTwo - ray.directionTwo * tempOne;
  if (result > -EPSILON && result < EPSILON)
    return null;
  return result < 0;
}

function ray2dIntersectSegment(ray, start, end, thirdValue) {
  const lineOriginOne = start[ray.one];
  const lineOriginTwo = start[ray.two];
  const lineDirectionOne = end[ray.one] - start[ray.one];
  const lineDirectionTwo = end[ray.two] - start[ray.two];

  if (Math.abs(ray.directionOne * lineDirectionTwo - ray.directionTwo * lineDirectionOne) <= EPSILON)
    return null;

  const point = [thirdValue, thirdValue, thirdValue];
  const t = (
    ((lineOriginTwo - ray.originTwo) * lineDirectionOne + ray.originOne * lineDirectionTwo - lineOriginOne * lineDirectionTwo) /
    (lineDirectionOne * ray.directionTwo - ray.directionOne * lineDirectionTwo)
  );
  point[ray.one] = ray.originOne + t * ray.directionOne;
  point[ray.two] = ray.originTwo + t * ray.directionTwo;
  return point;
}

function ray2dIntersectWhen(ray, line) {
  if (Math.abs(ray.directionOne * line.directionTwo - ray.directionTwo * line.directionOne) <= EPSILON) {
    if (ray2dIsCoordinateOnLine(ray, line.originOne, line.originTwo))
      throw RAY2D_PARALLEL_ERROR;
    return -1;
  }
  return (
    ((line.originTwo - ray.originTwo) * line.directionOne + ray.originOne * line.directionTwo - line.originOne * line.directionTwo) /
    (line.directionOne * ray.directionTwo - ray.directionOne * line.directionTwo)
  );
}

function polygonEqualsCyclic2d(a, b, one, two, epsilon) {
  if (a.length !== b.length)
    return false;

  let start = 0;
  while (start < a.length && !equals2d(a[start], b[0], one, two, epsilon))
    start++;
  if (start >= a.length)
    return false;

  for (let i = 1; i < b.length; i++) {
    start = (start + 1) % a.length;
    if (!equals2d(a[start], b[i], one, two, epsilon))
      return false;
  }
  return true;
}

function equals2d(a, b, one, two, epsilon) {
  return (
    Math.abs(a[one] - b[one]) <= epsilon &&
    Math.abs(a[two] - b[two]) <= epsilon
  );
}

function thirdAxisIndex(one, two) {
  if ((one === 0 && two === 1) || (one === 1 && two === 0))
    return 2;
  if ((one === 0 && two === 2) || (one === 2 && two === 0))
    return 1;
  return 0;
}

function within(value, min, max, epsilon) {
  return greaterThanOrEquals(value, min, epsilon) && smallerThanOrEquals(value, max, epsilon);
}

function smallerThanOrEquals(a, b, epsilon) {
  return a < b || equalsWithEps(a, b, epsilon);
}

function greaterThanOrEquals(a, b, epsilon) {
  return a > b || equalsWithEps(a, b, epsilon);
}

function equalsWithEps(a, b, epsilon) {
  return a === b || Math.abs(a - b) < epsilon;
}

export function faceVerticesFromPlaneRect(f) {
  const { axis, sign, c, a0, a1, b0, b1 } = f;

  if (axis === 'x' && sign > 0)
    return [[c, a0, b0], [c, a1, b0], [c, a1, b1], [c, a0, b1]];

  if (axis === 'x' && sign < 0)
    return [[c, a0, b1], [c, a1, b1], [c, a1, b0], [c, a0, b0]];

  if (axis === 'y' && sign > 0)
    return [[a0, c, b1], [a1, c, b1], [a1, c, b0], [a0, c, b0]];

  if (axis === 'y' && sign < 0)
    return [[a0, c, b0], [a1, c, b0], [a1, c, b1], [a0, c, b1]];

  if (axis === 'z' && sign > 0)
    return [[a0, b0, c], [a1, b0, c], [a1, b1, c], [a0, b1, c]];

  return [[a1, b0, c], [a0, b0, c], [a0, b1, c], [a1, b1, c]];
}
