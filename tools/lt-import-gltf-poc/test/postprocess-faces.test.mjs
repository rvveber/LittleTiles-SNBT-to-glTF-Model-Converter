import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGeometryModePipeline,
  resolveGeometryMode,
} from '../src/gltf-writer/postprocess-faces.mjs';

function quadYZ(x) {
  return [
    [x, 0, 0],
    [x, 1, 0],
    [x, 1, 1],
    [x, 0, 1],
  ];
}

function createFace(overrides = {}) {
  return {
    blockState: 'minecraft:glass',
    blockId: 'minecraft:glass',
    color: -1,
    providesSolidFace: false,
    sourceKind: 'aabb',
    facing: 'EAST',
    faceType: 'axis',
    outside: true,
    vertices: quadYZ(1),
    ...overrides,
  };
}

test('resolveGeometryMode falls back to client for unknown values', () => {
  assert.equal(resolveGeometryMode({ geometryMode: 'client' }), 'client');
  assert.equal(resolveGeometryMode({ geometryMode: 'SERVER' }), 'server');
  assert.equal(resolveGeometryMode({ geometryMode: 'invalid' }), 'client');
});

test('client mode removes opposite translucent coplanar seam pair', () => {
  const faces = [
    createFace({ facing: 'EAST' }),
    createFace({ facing: 'WEST' }),
  ];

  const result = applyGeometryModePipeline(faces, { geometryMode: 'client', optimize: true });
  assert.equal(result.faces.length, 0);
  assert.equal(result.stats.removedFaceCount, 2);
});

test('client mode keeps opposite opaque faces', () => {
  const faces = [
    createFace({ blockState: 'minecraft:stone', blockId: 'minecraft:stone', providesSolidFace: true, facing: 'EAST' }),
    createFace({ blockState: 'minecraft:stone', blockId: 'minecraft:stone', providesSolidFace: true, facing: 'WEST' }),
  ];

  const result = applyGeometryModePipeline(faces, { geometryMode: 'client', optimize: true });
  assert.equal(result.faces.length, 2);
  assert.equal(result.stats.removedFaceCount, 0);
});

test('client mode dedupes exact duplicate faces', () => {
  const face = createFace({ facing: 'NORTH', outside: false });
  const faces = [face, { ...face }];

  const result = applyGeometryModePipeline(faces, { geometryMode: 'client', optimize: true });
  assert.equal(result.faces.length, 1);
  assert.equal(result.stats.removedFaceCount, 1);
});

test('client mode keeps input faces unchanged when optimize is disabled', () => {
  const face = createFace({ facing: 'NORTH', outside: false });
  const faces = [face, { ...face }];
  const result = applyGeometryModePipeline(faces, { geometryMode: 'client' });
  assert.equal(result.faces.length, 2);
  assert.equal(result.stats.removedFaceCount, 0);
});

test('server mode keeps input faces unchanged even when optimize is enabled', () => {
  const faces = [
    createFace({ facing: 'NORTH' }),
    createFace({ facing: 'SOUTH' }),
  ];
  const result = applyGeometryModePipeline(faces, { geometryMode: 'server', optimize: true });
  assert.equal(result.faces.length, 2);
  assert.equal(result.stats.removedFaceCount, 0);
});
