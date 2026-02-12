import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveTextureUriFromBlock,
  deriveTopFrameTextureTransform,
  resolveTextureBlockId,
} from '../src/gltf-writer/texture-report.mjs';

test('deriveTextureUriFromBlock maps namespace:path into textures/<ns>/block/<path>.png', () => {
  const uri = deriveTextureUriFromBlock('minecraft:stone', 'minecraft:stone');
  assert.equal(uri, 'textures/minecraft/block/stone.png');
});

test('deriveTextureUriFromBlock applies URI prefix', () => {
  const uri = deriveTextureUriFromBlock('minecraft:stone', 'minecraft:stone', {
    textureUriPrefix: '/assets',
  });
  assert.equal(uri, '/assets/textures/minecraft/block/stone.png');
});

test('resolveTextureBlockId keeps legacy state aliases source-backed', () => {
  const id = resolveTextureBlockId('minecraft:stone:2', 'minecraft:stone');
  assert.equal(id, 'minecraft:polished_granite');
});

test('deriveTextureUriFromBlock supports explicit URI overrides', () => {
  const uri = deriveTextureUriFromBlock('minecraft:stone', 'minecraft:stone', {
    textureUriByBlockId: {
      'minecraft:stone': 'textures/custom/stone_custom.png',
    },
  });
  assert.equal(uri, 'textures/custom/stone_custom.png');
});

test('deriveTopFrameTextureTransform returns static top-frame crop for known non-square textures', () => {
  const transform = deriveTopFrameTextureTransform('littletiles:white_lava', 'littletiles:white_lava');
  assert.deepEqual(transform, {
    scale: [1, 1 / 20],
    offset: [0, 0],
  });
});

test('deriveTopFrameTextureTransform supports override hints', () => {
  const transform = deriveTopFrameTextureTransform('example:animated_like', 'example:animated_like', {
    topFrameByBlockId: {
      'example:animated_like': 8,
    },
  });
  assert.deepEqual(transform, {
    scale: [1, 1 / 8],
    offset: [0, 0],
  });
});

test('deriveTopFrameTextureTransform returns null for square/default textures', () => {
  const transform = deriveTopFrameTextureTransform('minecraft:stone', 'minecraft:stone');
  assert.equal(transform, null);
});
