import test from 'node:test';
import assert from 'node:assert/strict';
import { iterateRenderableFaceCandidates } from '../src/gltf-writer/face-candidates.mjs';
import { FACING_ORDER } from '../src/gltf-writer/transformable-cache.mjs';

function makeBaseFaceCache() {
  return {
    axisStrips: [],
    tiltedRender: [],
    isCompletelyFilled: false,
  };
}

function makeTransformCacheWithTiltedOnlyFace(targetFacing) {
  const faces = {};
  for (const facing of FACING_ORDER)
    faces[facing] = makeBaseFaceCache();
  faces[targetFacing] = {
    axisStrips: [],
    tiltedRender: [
      [
        [0, 1, 0],
        [1, 1, 0],
        [0, 1, 1],
      ],
    ],
    isCompletelyFilled: false,
  };
  return { faces };
}

function makeTileWithTransformableBox(cache) {
  return {
    id: 1,
    blockState: 'minecraft:stone',
    blockId: 'minecraft:stone',
    color: -1,
    structureId: null,
    structureNoCollision: false,
    grid: 16,
    providesSolidFace: true,
    cullOverEdge: true,
    boxes: [
      {
        id: 10,
        kind: 'transformable',
        grid: 16,
        minX: 0,
        minY: 1,
        minZ: 0,
        maxX: 16,
        maxY: 15,
        maxZ: 16,
        minWorldX: 0,
        minWorldY: 1 / 16,
        minWorldZ: 0,
        maxWorldX: 1,
        maxWorldY: 15 / 16,
        maxWorldZ: 1,
        transformData: [1],
        transformCache: cache,
      },
    ],
  };
}

function makeOccluderTileForUpFace() {
  return {
    id: 2,
    blockState: 'minecraft:stone',
    blockId: 'minecraft:stone',
    color: -1,
    structureId: null,
    structureNoCollision: false,
    grid: 16,
    providesSolidFace: true,
    cullOverEdge: true,
    boxes: [
      {
        id: 11,
        kind: 'aabb',
        grid: 16,
        minX: 0,
        minY: 15,
        minZ: 0,
        maxX: 16,
        maxY: 16,
        maxZ: 16,
        minWorldX: 0,
        minWorldY: 15 / 16,
        minWorldZ: 0,
        maxWorldX: 1,
        maxWorldY: 1,
        maxWorldZ: 1,
      },
    ],
  };
}

test('geometry mode server keeps transformable tilted-only faces suppressed', () => {
  const tile = makeTileWithTransformableBox(makeTransformCacheWithTiltedOnlyFace('UP'));
  const candidates = [...iterateRenderableFaceCandidates([tile], {
    evaluateInternalOcclusion: false,
    geometryMode: 'server',
  })];

  assert.equal(candidates.length, 0);
});

test('geometry mode client emits transformable tilted-only faces', () => {
  const tile = makeTileWithTransformableBox(makeTransformCacheWithTiltedOnlyFace('UP'));
  const candidates = [...iterateRenderableFaceCandidates([tile], {
    evaluateInternalOcclusion: false,
    geometryMode: 'client',
  })];

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].face.facing, 'UP');
  assert.equal(candidates[0].face.axisPolys.length, 0);
  assert.equal(candidates[0].face.tiltedPolys.length, 1);
});

test('geometry mode client keeps tilted-only transformable faces renderable under occlusion checks', () => {
  const transformableTile = makeTileWithTransformableBox(makeTransformCacheWithTiltedOnlyFace('UP'));
  const occluder = makeOccluderTileForUpFace();
  const candidates = [...iterateRenderableFaceCandidates([transformableTile, occluder], {
    evaluateInternalOcclusion: true,
    geometryMode: 'client',
  })];

  const tiltedOnly = candidates.find((entry) => entry.box.id === 10 && entry.face.facing === 'UP');
  assert.ok(tiltedOnly);
  assert.equal(tiltedOnly.faceState?.state, 'INSIDE_UNCOVERED');
  assert.equal(tiltedOnly.faceState?.renderable, true);
});
