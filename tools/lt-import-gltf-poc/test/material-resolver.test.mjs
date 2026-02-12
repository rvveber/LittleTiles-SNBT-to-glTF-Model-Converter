import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMaterial, rgbaFromArgb } from '../src/gltf-writer/material-resolver.mjs';

test('rgbaFromArgb decodes signed int ARGB', () => {
  const rgba = rgbaFromArgb(0x80ff0000);
  assert.equal(rgba[0], 1);
  assert.equal(rgba[1], 0);
  assert.equal(rgba[2], 0);
  assert.ok(Math.abs(rgba[3] - (128 / 255)) < 1e-9);
});

test('resolveMaterial keeps opaque default for solid tiles', () => {
  const material = resolveMaterial({
    blockState: 'minecraft:stone',
    blockId: 'minecraft:stone',
    color: -1,
    providesSolidFace: true,
  });

  assert.equal(material.alphaMode, 'OPAQUE');
  assert.deepEqual(material.baseColorFactor, [1, 1, 1, 1]);
  assert.equal(material.textureUri, 'textures/minecraft/block/stone.png');
});

test('resolveMaterial uses color alpha when present', () => {
  const material = resolveMaterial({
    blockState: 'minecraft:red_stained_glass',
    blockId: 'minecraft:red_stained_glass',
    color: 0x80ff0000,
    providesSolidFace: false,
  });

  assert.equal(material.alphaMode, 'BLEND');
  assert.ok(Math.abs(material.baseColorFactor[0] - 1) < 1e-9);
  assert.ok(Math.abs(material.baseColorFactor[1] - 0) < 1e-9);
  assert.ok(Math.abs(material.baseColorFactor[2] - 0) < 1e-9);
  assert.ok(Math.abs(material.baseColorFactor[3] - (128 / 255)) < 1e-9);
});

test('resolveMaterial uses configurable inferred alpha for translucent blocks', () => {
  const material = resolveMaterial({
    blockState: 'minecraft:glass',
    blockId: 'minecraft:glass',
    color: -1,
    providesSolidFace: false,
  }, {
    translucentAlpha: 0.2,
  });

  assert.equal(material.alphaMode, 'BLEND');
  assert.deepEqual(material.baseColorFactor, [1, 1, 1, 0.2]);
});

test('resolveMaterial derives texture URI from block id and includes it in key', () => {
  const material = resolveMaterial({
    blockState: 'minecraft:oak_log[axis=y]',
    blockId: 'minecraft:oak_log',
    color: -1,
    providesSolidFace: true,
  });

  assert.equal(material.textureUri, 'textures/minecraft/block/oak_log.png');
  assert.equal(material.textureKey, 'textures/minecraft/block/oak_log.png');
  assert.ok(material.materialKey.includes('textures/minecraft/block/oak_log.png'));
});

test('resolveMaterial applies legacy texture aliases from block state', () => {
  const material = resolveMaterial({
    blockState: 'minecraft:stone:2',
    blockId: 'minecraft:stone',
    color: -1,
    providesSolidFace: true,
  });

  assert.equal(material.textureUri, 'textures/minecraft/block/polished_granite.png');
});

test('resolveMaterial applies texture URI prefix', () => {
  const material = resolveMaterial({
    blockState: 'minecraft:stone',
    blockId: 'minecraft:stone',
    color: -1,
    providesSolidFace: true,
  }, {
    textureUriPrefix: '/assets',
  });

  assert.equal(material.textureUri, '/assets/textures/minecraft/block/stone.png');
});

test('resolveMaterial emits static top-frame transform for known non-square textures', () => {
  const material = resolveMaterial({
    blockState: 'littletiles:white_lava',
    blockId: 'littletiles:white_lava',
    color: -1,
    providesSolidFace: true,
  });

  assert.deepEqual(material.textureTransform, {
    scale: [1, 1 / 20],
    offset: [0, 0],
  });
});

test('resolveMaterial emits no texture transform for normal square textures', () => {
  const material = resolveMaterial({
    blockState: 'minecraft:stone',
    blockId: 'minecraft:stone',
    color: -1,
    providesSolidFace: true,
  });

  assert.equal(material.textureTransform, null);
});
