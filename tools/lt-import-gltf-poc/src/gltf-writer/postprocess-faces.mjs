const DEFAULT_GEOMETRY_MODE = 'client';
const DEFAULT_OPTIMIZE = false;
const QUANTIZE_SCALE = 1e6;

export const GEOMETRY_MODES = Object.freeze(['client', 'server']);

export function resolveGeometryMode(options = {}) {
  const raw = typeof options.geometryMode === 'string'
    ? options.geometryMode.trim().toLowerCase()
    : DEFAULT_GEOMETRY_MODE;
  if (GEOMETRY_MODES.includes(raw))
    return raw;
  return DEFAULT_GEOMETRY_MODE;
}

export function resolveOptimizeFaces(options = {}) {
  if (options.optimize === true)
    return true;
  return DEFAULT_OPTIMIZE;
}

export function applyGeometryModePipeline(faces, options = {}) {
  const mode = resolveGeometryMode(options);
  const optimize = resolveOptimizeFaces(options);
  const input = Array.isArray(faces) ? faces : [];
  let working = input;
  const passes = [];

  if (optimize && mode === 'client') {
    const deduped = dedupeExactFaces(working);
    passes.push({
      passId: 'dedupe_exact_faces',
      before: working.length,
      after: deduped.length,
      removed: working.length - deduped.length,
    });
    working = deduped;

    const seamRemoved = removeTransparentCoplanarSeams(working);
    passes.push({
      passId: 'remove_transparent_coplanar_seams',
      before: working.length,
      after: seamRemoved.length,
      removed: working.length - seamRemoved.length,
    });
    working = seamRemoved;
  }

  return {
    faces: working,
    stats: {
      mode,
      optimize,
      inputFaceCount: input.length,
      outputFaceCount: working.length,
      removedFaceCount: input.length - working.length,
      passes,
    },
  };
}

function dedupeExactFaces(faces) {
  const seen = new Set();
  const out = [];

  for (const face of faces) {
    const key = [
      faceRenderKey(face),
      String(face.facing ?? ''),
      String(face.faceType ?? ''),
      face.outside === true ? 'outside' : 'inside',
      normalizedPolygonKey(face.vertices),
    ].join('|');
    if (seen.has(key))
      continue;
    seen.add(key);
    out.push(face);
  }

  return out;
}

function removeTransparentCoplanarSeams(faces) {
  const buckets = new Map();
  for (let index = 0; index < faces.length; index++) {
    const face = faces[index];
    if (face.providesSolidFace !== false)
      continue;
    if (face.faceType !== 'axis')
      continue;

    const facing = String(face.facing ?? '');
    if (!Object.hasOwn(OPPOSITE_FACING, facing))
      continue;

    const key = [
      faceRenderKey(face),
      face.outside === true ? 'outside' : 'inside',
      normalizedPolygonKey(face.vertices),
    ].join('|');
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        DOWN: [],
        UP: [],
        NORTH: [],
        SOUTH: [],
        WEST: [],
        EAST: [],
      };
      buckets.set(key, bucket);
    }
    bucket[facing].push(index);
  }

  const removed = new Set();
  for (const bucket of buckets.values()) {
    pairOffFacing(bucket, 'UP', 'DOWN', removed);
    pairOffFacing(bucket, 'NORTH', 'SOUTH', removed);
    pairOffFacing(bucket, 'WEST', 'EAST', removed);
  }

  if (removed.size === 0)
    return faces;
  return faces.filter((_, index) => !removed.has(index));
}

function pairOffFacing(bucket, firstFacing, secondFacing, removed) {
  const first = bucket[firstFacing];
  const second = bucket[secondFacing];
  const pairCount = Math.min(first.length, second.length);
  for (let i = 0; i < pairCount; i++) {
    removed.add(first[i]);
    removed.add(second[i]);
  }
}

function faceRenderKey(face) {
  return [
    String(face.blockId ?? ''),
    String(Number.isInteger(face.color) ? face.color : -1),
    face.providesSolidFace === true ? 'solid' : 'translucent',
  ].join('|');
}

function normalizedPolygonKey(vertices) {
  if (!Array.isArray(vertices) || vertices.length === 0)
    return 'empty';
  const points = [];
  for (const vertex of vertices) {
    if (!Array.isArray(vertex) || vertex.length < 3) {
      points.push('nan,nan,nan');
      continue;
    }
    points.push([
      quantizeCoord(vertex[0]),
      quantizeCoord(vertex[1]),
      quantizeCoord(vertex[2]),
    ].join(','));
  }
  points.sort();
  return `${points.length}:${points.join(';')}`;
}

function quantizeCoord(value) {
  const number = Number(value);
  if (!Number.isFinite(number))
    return 'nan';
  const rounded = Math.round(number * QUANTIZE_SCALE) / QUANTIZE_SCALE;
  if (Math.abs(rounded) < 1 / QUANTIZE_SCALE)
    return '0';
  return String(rounded);
}

const OPPOSITE_FACING = Object.freeze({
  DOWN: 'UP',
  UP: 'DOWN',
  NORTH: 'SOUTH',
  SOUTH: 'NORTH',
  WEST: 'EAST',
  EAST: 'WEST',
});
